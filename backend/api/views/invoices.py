"""Invoice endpoints, payments, reports and exports."""

from rest_framework import viewsets, status, filters
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import BasePermission, IsAuthenticated, IsAdminUser
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from django.db.models import Sum, Count, Q, OuterRef, Subquery, DecimalField, Value, Case, When, F, ExpressionWrapper
from django.db.models.functions import Coalesce
from django.db import transaction, connection
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from datetime import timedelta, date
from django.http import JsonResponse, HttpResponse
from django.http import FileResponse
from django.core.paginator import Paginator, EmptyPage
from django.shortcuts import get_object_or_404
from django.contrib.auth.models import User
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
import json, calendar, os, shutil, uuid
from zoneinfo import ZoneInfo

from ..models import (
    IdempotentSubmission,
    Customer, Service, Invoice, InvoiceEditRequest, InvoicePayment, AuditLog, Document,
    BusinessProfile, ExpenseCategory, Expense, Staff, VehicleType, BackupConfig,
    Cheque, InvoiceSettings, ChatMessage, ChatNotification, ChatPresence,
    WelcomeSettings, UserWelcomeMessage, WelcomeMessageShown, SocialNetwork
)
from ..serializers import (
    CustomerListSerializer, CustomerDetailSerializer,
    ServiceSerializer, InvoiceSerializer, DocumentSerializer,
    BusinessProfileSerializer, ExpenseCategorySerializer,
    ExpenseSerializer, StaffSerializer, VehicleTypeSerializer,
    UserSerializer, BackupConfigSerializer, InvoiceSettingsSerializer, ChequeSerializer, InvoicePaymentSerializer, AuditLogSerializer, ChatMessageSerializer, SocialNetworkSerializer
)
from ..audit import snapshot, record_audit, is_invoice_content_version
from ..services.money import invoice_payment_totals, safe_spreadsheet_cell




from .common import HasModuleAccess

class InvoiceViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, HasModuleAccess]
    module_name = 'invoices'
    serializer_class = InvoiceSerializer

    def check_permissions(self, request):
        super().check_permissions(request)
        from ..module_access import effective_modules
        from rest_framework.exceptions import PermissionDenied
        modules = effective_modules(request.user)
        if self.action in {'report', 'export_excel', 'export_csv', 'history'} and 'reports' not in modules:
            raise PermissionDenied('دسترسی به ماژول گزارشات لازم است.')
        # Reports/Excel contain expense totals and rows: reject the whole report
        # instead of leaking expenses or presenting an incomplete profit figure.
        if self.action in {'report', 'export_excel'} and 'expenses' not in modules:
            raise PermissionDenied('این گزارش شامل هزینه‌هاست؛ دسترسی به ماژول هزینه‌ها لازم است.')

    def destroy(self, request, *args, **kwargs):
        invoice = self.get_object()
        if invoice.status == 'paid' and not (request.user.is_staff or request.user.is_superuser):
            return Response(
                {'detail': 'حذف فاکتور پرداخت‌شده فقط برای مدیر مجاز است.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().destroy(request, *args, **kwargs)

    @transaction.atomic
    def perform_update(self, serializer):
        invoice = Invoice.objects.select_for_update().get(pk=serializer.instance.pk)
        serializer.instance = invoice
        edit_request = None
        if invoice.status == 'paid' and not (self.request.user.is_staff or self.request.user.is_superuser):
            edit_request = InvoiceEditRequest.objects.select_for_update().filter(
                invoice=invoice, requested_by=self.request.user, status='approved'
            ).first()
            if not edit_request:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied('ویرایش فاکتور پرداخت‌شده نیاز به تأیید درخواست ویرایش توسط مدیر دارد.')
        before = snapshot(invoice)
        was_paid = invoice.status == 'paid'
        updated_invoice = serializer.save()
        if updated_invoice.status == 'paid' and not was_paid:
            updated_invoice.paid_by = self.request.user
            updated_invoice.save(update_fields=['paid_by', 'updated_at'])
        elif updated_invoice.status != 'paid' and was_paid:
            updated_invoice.paid_by = None
            updated_invoice.save(update_fields=['paid_by', 'updated_at'])
        if edit_request:
            edit_request.status = 'used'
            edit_request.used_at = timezone.now()
            edit_request.save(update_fields=['status', 'used_at'])
        record_audit(user=self.request.user, instance=invoice, action='update', before=before, after=snapshot(invoice))

    @transaction.atomic
    def perform_create(self, serializer):
        invoice = serializer.save(
            created_by=self.request.user,
            paid_by=self.request.user if serializer.validated_data.get('status') == 'paid' else None,
        )
        record_audit(user=self.request.user, instance=invoice, action='create', after=snapshot(invoice))

    def perform_destroy(self, instance):
        before = snapshot(instance)
        record_audit(user=self.request.user, instance=instance, action='delete', before=before)
        instance.delete()

    def get_queryset(self):
        qs = Invoice.objects.select_related('customer', 'created_by', 'paid_by').prefetch_related('items__service', 'payments__created_by', 'edit_requests')
        status_filter = self.request.query_params.get('status', '')
        customer_id = self.request.query_params.get('customer', '')
        customer_name = self.request.query_params.get('customer_name', '')
        payment_source = self.request.query_params.get('payment_source', '')
        vehicle_plate = self.request.query_params.get('vehicle_plate', '')
        search = self.request.query_params.get('search', '')
        date_from = self.request.query_params.get('date_from', '')
        date_to = self.request.query_params.get('date_to', '')
        overdue_only = self.request.query_params.get('overdue', '')
        payer = self.request.query_params.get('paid_by', '')
        issuer = self.request.query_params.get('created_by', '')
        paid_min = self.request.query_params.get('amount_min', self.request.query_params.get('paid_min', ''))
        paid_max = self.request.query_params.get('amount_max', self.request.query_params.get('paid_max', ''))

        if status_filter:
            if status_filter == 'commission_paid':
                # The commission bucket holds invoices whose commission is
                # settled but which are not fully paid yet; a fully-paid
                # invoice belongs to the paid bucket only.
                qs = qs.filter(commission_paid=True).exclude(status='paid')
            else:
                qs = qs.filter(status=status_filter)
                if status_filter == 'pending':
                    qs = qs.filter(commission_paid=False)
        if customer_id:
            qs = qs.filter(customer_id=customer_id)
        if customer_name:
            qs = qs.filter(Q(customer__name__icontains=customer_name) | Q(green_card_owner_name__icontains=customer_name))
        if payment_source in ('customer', 'office'):
            qs = qs.filter(card_payment_source=payment_source)
        if vehicle_plate:
            qs = qs.filter(vehicle_plate__icontains=vehicle_plate)
        if search:
            qs = qs.filter(
                Q(invoice_number__icontains=search) |
                Q(customer__name__icontains=search) |
                Q(vehicle_plate__icontains=search) |
                Q(vehicle_vin__icontains=search)
            )
        if date_from:
            qs = qs.filter(date__date__gte=date_from)
        if date_to:
            qs = qs.filter(date__date__lte=date_to)
        if payer:
            qs = qs.filter(Q(paid_by_id=payer) | Q(payments__created_by_id=payer)).distinct()
        if issuer:
            qs = qs.filter(created_by_id=issuer)
        if paid_min or paid_max:
            invoice_total = ExpressionWrapper(
                F('total_amount') + (F('total_amount') * F('tax') / Value(100)) - F('discount') + F('commission_total'),
                output_field=DecimalField(max_digits=18, decimal_places=2),
            )
            if paid_min:
                qs = qs.annotate(_invoice_total=invoice_total).filter(_invoice_total__gte=paid_min)
            if paid_max:
                qs = qs.annotate(_invoice_total=invoice_total).filter(_invoice_total__lte=paid_max)
        if overdue_only == 'true':
            today = timezone.localdate()
            qs = qs.filter(status='pending', due_date__lt=today)
        return qs.order_by('-created_at', '-id')

    def list(self, request, *args, **kwargs):
        # Keep the legacy array response for existing screens; the invoice page opts into paging.
        if 'page' not in request.query_params:
            return super().list(request, *args, **kwargs)
        queryset = self.filter_queryset(self.get_queryset())
        paginator = Paginator(queryset, 10)
        if paginator.count == 0:
            return Response({'count': 0, 'next': None, 'previous': None, 'results': []})
        try:
            page = paginator.page(max(1, int(request.query_params.get('page', 1))))
        except (ValueError, EmptyPage):
            page = paginator.page(paginator.num_pages)
        return Response({
            'count': paginator.count,
            'next': page.number + 1 if page.has_next() else None,
            'previous': page.number - 1 if page.has_previous() else None,
            'results': self.get_serializer(page.object_list, many=True).data,
        })

    @action(detail=False, methods=['get'])
    def stats(self, request):
        counts = {row['status']: row['total'] for row in Invoice.objects.values('status').annotate(total=Count('id'))}
        commission_paid = Invoice.objects.filter(commission_paid=True).exclude(status='paid').count()
        return Response({'all': sum(counts.values()), 'paid': counts.get('paid', 0), 'pending': counts.get('pending', 0) - Invoice.objects.filter(status='pending', commission_paid=True).count(), 'commission_paid': commission_paid})

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def mark_commission_paid(self, request, pk=None):
        invoice = Invoice.objects.select_for_update().get(pk=self.get_object().pk)
        before = snapshot(invoice)
        invoice.commission_paid = request.data.get('commission_paid', True) is True
        invoice.save(update_fields=['commission_paid', 'updated_at'])
        record_audit(user=request.user, instance=invoice, action='payment', before=before, after=snapshot(invoice))
        return Response(self.get_serializer(invoice).data)

    @action(detail=False, methods=['get'])
    def filter_options(self, request):
        def users_for(field):
            rows = Invoice.objects.exclude(**{f'{field}__isnull': True}).values_list(
                f'{field}_id', f'{field}__first_name', f'{field}__last_name', f'{field}__username'
            ).distinct().order_by(f'{field}__username')
            return [{'id': row[0], 'name': (' '.join(part for part in row[1:3] if part).strip() or row[3])} for row in rows]
        payer_ids = set(Invoice.objects.exclude(paid_by__isnull=True).values_list('paid_by_id', flat=True))
        payer_ids.update(InvoicePayment.objects.exclude(created_by__isnull=True).values_list('created_by_id', flat=True))
        payer_users = User.objects.filter(id__in=payer_ids).order_by('username')
        payers = [{'id': user.id, 'name': user.get_full_name() or user.username} for user in payer_users]
        can_see_issuers = request.user.is_staff or request.user.is_superuser
        return Response({'issuers': users_for('created_by') if can_see_issuers else [], 'payers': payers})

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def mark_paid(self, request, pk=None):
        invoice = Invoice.objects.select_for_update().get(pk=self.get_object().pk)
        before = snapshot(invoice)
        was_paid = invoice.status == 'paid'
        balance = int(invoice_payment_totals(invoice)[1])
        payment = None
        if balance:
            payment = InvoicePayment.objects.create(invoice=invoice, amount=balance, method='other', note='ثبت پرداخت کامل از صفحه فاکتورها', created_by=request.user)
        invoice.status = 'paid'
        if not was_paid:
            invoice.paid_by = request.user
        invoice.save()
        record_audit(user=request.user, instance=invoice, action='payment', before=before, after={**snapshot(invoice), 'payment': InvoicePaymentSerializer(payment).data if payment else None})
        return Response({'status': 'paid', 'message': 'فاکتور به عنوان پرداخت شده ثبت شد'})

    @action(detail=True, methods=['get', 'post'])
    def payments(self, request, pk=None):
        invoice = self.get_object()
        if request.method == 'GET':
            return Response(InvoicePaymentSerializer(invoice.payments.all(), many=True).data)
        if invoice.status == 'paid' and not (request.user.is_staff or request.user.is_superuser):
            return Response({'detail': 'اپراتور اجازهٔ تغییر پرداخت‌های فاکتور پرداخت‌شده را ندارد.'}, status=status.HTTP_403_FORBIDDEN)

        serializer = InvoicePaymentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        amount = serializer.validated_data['amount']
        if invoice.status in ['cancelled', 'draft']:
            return Response({'detail': 'برای این وضعیت فاکتور امکان ثبت پرداخت وجود ندارد.'}, status=400)

        with transaction.atomic():
            invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
            before = snapshot(invoice)
            was_paid = invoice.status == 'paid'
            if invoice.status in ['cancelled', 'draft']:
                return Response({'detail': 'برای این وضعیت فاکتور امکان ثبت پرداخت وجود ندارد.'}, status=400)
            already_paid, remaining = invoice_payment_totals(invoice)
            if amount > remaining:
                return Response({'amount': f'مبلغ پرداخت از ماندهٔ فاکتور ({remaining}) بیشتر است.'}, status=400)
            payment = serializer.save(invoice=invoice, created_by=request.user)
            new_paid_total = already_paid + amount
            if new_paid_total >= invoice.final_amount:
                invoice.status = 'paid'
                if not was_paid:
                    invoice.paid_by = request.user
                invoice.save(update_fields=['status', 'paid_by', 'updated_at'])
            record_audit(user=request.user, instance=invoice, action='payment', before=before, after={**snapshot(invoice), 'payment': InvoicePaymentSerializer(payment).data})
        return Response(InvoicePaymentSerializer(payment).data, status=201)

    @action(detail=True, methods=['patch', 'delete'], url_path=r'payments/(?P<payment_id>[^/.]+)')
    def payment_detail(self, request, pk=None, payment_id=None):
        with transaction.atomic():
            invoice = Invoice.objects.select_for_update().get(pk=self.get_object().pk)
            if invoice.status == 'paid' and not (request.user.is_staff or request.user.is_superuser):
                return Response({'detail': 'اپراتور اجازهٔ تغییر پرداخت‌های فاکتور پرداخت‌شده را ندارد.'}, status=status.HTTP_403_FORBIDDEN)
            payment = get_object_or_404(InvoicePayment.objects.select_for_update(), pk=payment_id, invoice=invoice)
            before_invoice = snapshot(invoice)
            was_paid = invoice.status == 'paid'
            before_payment = InvoicePaymentSerializer(payment).data

            if request.method == 'DELETE':
                payment.delete()
                operation = 'deleted'
                after_payment = None
            else:
                serializer = InvoicePaymentSerializer(payment, data=request.data, partial=True)
                serializer.is_valid(raise_exception=True)
                new_amount = serializer.validated_data.get('amount', payment.amount)
                if new_amount <= 0:
                    return Response({'amount': 'مبلغ پرداخت باید بیشتر از صفر باشد.'}, status=400)
                other_payments = invoice.payments.exclude(pk=payment.pk).aggregate(total=Sum('amount'))['total'] or 0
                if other_payments + new_amount > invoice.final_amount:
                    balance_limit = max(0, int(invoice.final_amount - other_payments))
                    return Response({'amount': f'مبلغ از ماندهٔ قابل ثبت ({balance_limit}) بیشتر است.'}, status=400)
                payment = serializer.save()
                operation = 'updated'
                after_payment = InvoicePaymentSerializer(payment).data

            if invoice.status not in ['cancelled', 'draft']:
                total_paid = invoice.payments.aggregate(total=Sum('amount'))['total'] or 0
                invoice.status = 'paid' if total_paid >= invoice.final_amount else 'pending'
                if invoice.status == 'paid' and not was_paid:
                    invoice.paid_by = request.user
                elif invoice.status != 'paid':
                    invoice.paid_by = None
                invoice.save(update_fields=['status', 'paid_by', 'updated_at'])

            record_audit(
                user=request.user,
                instance=invoice,
                action='payment',
                before={**before_invoice, 'payment': before_payment},
                after={**snapshot(invoice), 'payment': after_payment, 'payment_operation': operation,
                       'removed_payment': before_payment if operation == 'deleted' else None},
            )

        if request.method == 'DELETE':
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response(InvoicePaymentSerializer(payment).data)

    @action(detail=True, methods=['get'])
    def history(self, request, pk=None):
        if not (request.user.is_staff or request.user.is_superuser):
            return Response({'detail': 'مشاهدهٔ تاریخچهٔ فاکتور فقط برای مدیر یا ادمین مجاز است.'}, status=403)
        invoice = self.get_object()
        logs = AuditLog.objects.filter(object_type='invoice', object_id=str(invoice.pk))
        data = AuditLogSerializer(logs, many=True).data
        restorable_ids = {
            event.id for event in logs if is_invoice_content_version(event)
        }
        for item in data:
            item['is_invoice_version'] = item['id'] in restorable_ids
        return Response(data)

    @action(detail=True, methods=['post'], url_path='restore-version')
    @transaction.atomic
    def restore_version(self, request, pk=None):
        if not (request.user.is_staff or request.user.is_superuser):
            return Response({'detail': 'بازیابی نسخهٔ فاکتور فقط برای مدیر یا ادمین مجاز است.'}, status=403)

        invoice = Invoice.objects.select_for_update().get(pk=self.get_object().pk)
        event = get_object_or_404(
            AuditLog.objects.select_for_update(),
            pk=request.data.get('audit_id'),
            object_type='invoice',
            object_id=str(invoice.pk),
        )
        if not is_invoice_content_version(event):
            return Response({'detail': 'نسخهٔ قابل بازیابی برای این رویداد وجود ندارد.'}, status=400)

        from ..models import InvoiceItem, Service, Staff

        before = snapshot(invoice)
        previous = event.changes['before']
        invoice_fields = (
            'date', 'due_date', 'description', 'total_amount', 'commission_total',
            'commission_paid', 'discount', 'tax', 'status', 'paper_size', 'vehicle_plate',
            'vehicle_vin', 'vehicle_model', 'vehicle_type', 'vehicle_year',
            'green_card_owner_name', 'green_card_owner_national_id',
            'custom_fields', 'tags',
            'card_payment_source',
        )
        for field in invoice_fields:
            if field in previous:
                value = previous[field]
                if field == 'date' and isinstance(value, str):
                    value = parse_datetime(value) or value
                elif field == 'due_date' and isinstance(value, str):
                    value = parse_date(value) or value
                setattr(invoice, field, value)
        if invoice.status == 'paid' and before.get('status') != 'paid':
            invoice.paid_by = request.user
        elif invoice.status != 'paid':
            invoice.paid_by = None
        customer_id = previous.get('customer')
        invoice.customer_id = customer_id if Customer.objects.filter(pk=customer_id).exists() else None
        invoice.save()

        invoice.items.all().delete()
        for old_item in previous['items']:
            service_id = old_item.get('service')
            staff_id = old_item.get('staff')
            InvoiceItem.objects.create(
                invoice=invoice,
                service_id=service_id if Service.objects.filter(pk=service_id).exists() else None,
                staff_id=staff_id if Staff.objects.filter(pk=staff_id).exists() else None,
                service_title_snapshot=old_item.get('title') or '',
                quantity=old_item.get('quantity') or 1,
                main_price=old_item.get('main_price') or 0,
                extra_price=old_item.get('extra_price') or 0,
                commission=old_item.get('commission') or 0,
                notes=old_item.get('notes') or '',
                is_office_card_fee=old_item.get('is_office_card_fee', False),
            )

        record_audit(user=request.user, instance=invoice, action='update', before=before, after=snapshot(invoice))
        return Response(self.get_serializer(invoice).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        invoice = self.get_object()
        if invoice.status == 'paid' and not (request.user.is_staff or request.user.is_superuser):
            return Response({'detail': 'لغو فاکتور پرداخت‌شده فقط برای مدیر مجاز است.'}, status=status.HTTP_403_FORBIDDEN)
        before = snapshot(invoice)
        invoice.status = 'cancelled'
        invoice.save()
        record_audit(user=request.user, instance=invoice, action='update', before=before, after=snapshot(invoice))
        return Response({'status': 'cancelled', 'message': 'فاکتور لغو شد'})

    @action(detail=True, methods=['patch'])
    def change_status(self, request, pk=None):
        invoice = self.get_object()
        if invoice.status == 'paid' and not (request.user.is_staff or request.user.is_superuser):
            return Response({'detail': 'تغییر وضعیت فاکتور پرداخت‌شده فقط برای مدیر مجاز است.'}, status=status.HTTP_403_FORBIDDEN)
        new_status = request.data.get('status')
        valid = [s[0] for s in Invoice.STATUS_CHOICES]
        if new_status not in valid:
            return Response({'error': 'وضعیت نامعتبر'}, status=400)
        before = snapshot(invoice)
        was_paid = invoice.status == 'paid'
        invoice.status = new_status
        if new_status == 'paid' and not was_paid:
            invoice.paid_by = request.user
        elif new_status != 'paid':
            invoice.paid_by = None
        invoice.save(update_fields=['status', 'paid_by', 'updated_at'])
        record_audit(user=request.user, instance=invoice, action='update', before=before, after=snapshot(invoice))
        serializer = self.get_serializer(invoice)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], url_path='request-edit')
    def request_edit(self, request, pk=None):
        invoice = self.get_object()
        if invoice.status != 'paid':
            return Response({'detail': 'درخواست مجوز فقط برای فاکتور پرداخت‌شده لازم است.'}, status=400)
        if request.user.is_staff or request.user.is_superuser:
            return Response({'detail': 'مدیران برای ویرایش این فاکتور نیازی به درخواست ندارند.'}, status=400)
        existing = invoice.edit_requests.filter(requested_by=request.user, status__in=['pending', 'approved']).first()
        if existing:
            edit_request = existing
            created = False
        else:
            edit_request = InvoiceEditRequest.objects.create(invoice=invoice, requested_by=request.user)
            created = True
            record_audit(user=request.user, instance=invoice, action='approval', after={'event': 'edit_requested', 'request_id': edit_request.id, 'requested_by': request.user.username})
            from ..alerts import notify_edit_request_created
            notify_edit_request_created(edit_request)
        return Response({'id': edit_request.id, 'status': edit_request.status, 'created_at': edit_request.created_at}, status=201 if created else 200)

    @action(detail=False, methods=['get'], url_path='edit-requests')
    def edit_requests(self, request):
        if not (request.user.is_staff or request.user.is_superuser):
            return Response({'detail': 'فقط مدیران می‌توانند درخواست‌ها را بررسی کنند.'}, status=403)
        requests = InvoiceEditRequest.objects.filter(status='pending').select_related('invoice', 'invoice__customer', 'requested_by').order_by('created_at')
        return Response([{
            'id': item.id,
            'invoice_id': item.invoice_id,
            'invoice_number': item.invoice.invoice_number,
            'customer_name': item.invoice.customer.name if item.invoice.customer else '',
            'requested_by': item.requested_by.get_full_name() or item.requested_by.username,
            'created_at': item.created_at,
        } for item in requests])

    @action(detail=True, methods=['post'], url_path='review-edit-request')
    def review_edit_request(self, request, pk=None):
        if not (request.user.is_staff or request.user.is_superuser):
            return Response({'detail': 'فقط مدیران می‌توانند درخواست را بررسی کنند.'}, status=403)
        invoice = self.get_object()
        if invoice.status != 'paid':
            return Response({'detail': 'این فاکتور دیگر در وضعیت پرداخت‌شده نیست.'}, status=400)
        edit_request = InvoiceEditRequest.objects.filter(pk=request.data.get('request_id'), invoice=invoice, status='pending').first()
        if not edit_request:
            return Response({'detail': 'درخواست در انتظار بررسی برای این فاکتور یافت نشد.'}, status=404)
        decision = request.data.get('decision')
        if decision not in ['approve', 'reject']:
            return Response({'detail': 'تصمیم باید approve یا reject باشد.'}, status=400)
        edit_request.status = 'approved' if decision == 'approve' else 'rejected'
        edit_request.reviewed_by = request.user
        edit_request.reviewed_at = timezone.now()
        edit_request.save(update_fields=['status', 'reviewed_by', 'reviewed_at'])
        record_audit(user=request.user, instance=invoice, action='approval', before={'request_id': edit_request.id, 'status': 'pending'}, after={'request_id': edit_request.id, 'status': edit_request.status, 'reviewed_by': request.user.username})
        from ..alerts import notify_edit_request_reviewed
        notify_edit_request_reviewed(edit_request)
        return Response({'id': edit_request.id, 'status': edit_request.status})

    @action(detail=False, methods=['get'])
    def overdue(self, request):
        """Return overdue invoices"""
        today = timezone.localdate()
        qs = Invoice.objects.filter(
            status='pending', due_date__lt=today
        ).select_related('customer').order_by('due_date')
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def report(self, request):
        """Financial report; computation lives in api.services.reports."""
        from ..services.reports import build_report_data

        data, invoice_rows = build_report_data(
            date_from=request.query_params.get('date_from', ''),
            date_to=request.query_params.get('date_to', ''),
            status_filter=request.query_params.get('status', ''),
            customer_search=request.query_params.get('customer_name', ''),
        )
        data['invoices'] = self.get_serializer(invoice_rows[:100], many=True).data
        return Response(data)

    @action(detail=False, methods=['get'])
    def export_excel(self, request):
        """Download the financial report as a real .xlsx workbook (openpyxl)."""
        from ..services.reports import build_excel_bytes

        content = build_excel_bytes(
            date_from=request.query_params.get('date_from', ''),
            date_to=request.query_params.get('date_to', ''),
            status_filter=request.query_params.get('status', ''),
            customer_search=request.query_params.get('customer_name', ''),
        )
        response = HttpResponse(content, content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        response['Content-Disposition'] = 'attachment; filename="financial_report.xlsx"'
        return response

    @action(detail=False, methods=['get'])
    def export_csv(self, request):
        """Export invoices as CSV"""
        import csv
        from django.http import HttpResponse
        qs = Invoice.objects.select_related('customer').all().order_by('-date')
        date_from = request.query_params.get('date_from', '')
        date_to = request.query_params.get('date_to', '')
        status_filter = request.query_params.get('status', '')
        customer_search = request.query_params.get('customer_name', '')
        if date_from:
            qs = qs.filter(date__date__gte=date_from)
        if date_to:
            qs = qs.filter(date__date__lte=date_to)
        if status_filter:
            qs = qs.filter(status=status_filter)
        if customer_search:
            qs = qs.filter(customer__name__icontains=customer_search)

        # Encoding each writerow with utf-8-sig would insert a BOM on every row.
        response = HttpResponse(content_type='text/csv; charset=utf-8')
        response['Content-Disposition'] = 'attachment; filename="invoices.csv"'
        # BOM for Excel UTF-8
        response.write('\ufeff')
        writer = csv.writer(response)
        writer.writerow(['شماره فاکتور', 'مشتری', 'تاریخ', 'مبلغ کل', 'کارمزد', 'تخفیف', 'مالیات', 'وضعیت'])
        for inv in qs:
            writer.writerow([safe_spreadsheet_cell(value) for value in [
                inv.invoice_number,
                inv.customer.name if inv.customer else '',
                timezone.localtime(inv.date).strftime('%Y-%m-%d') if inv.date else '',
                int(inv.total_amount),
                int(inv.commission_total),
                int(inv.discount),
                str(inv.tax),
                inv.get_status_display(),
            ]])
        return response

    @action(detail=False, methods=['post'])
    @transaction.atomic
    def quick_create(self, request):
        """
        Quick invoice creation with auto-customer.
        Accepts customer_name (string) — finds or creates the customer.
        Body: {
            customer_name: str,
            customer_phone: str (optional),
            status: str (default: 'pending'),
            items: [{ service_title_snapshot, quantity, main_price, extra_price, notes }],
            discount, tax, commission_total, description, vehicle_plate, ...
        }
        """
        data = request.data
        # Offline-queue replay guard: the client may attach one UUID per
        # draft (idempotency_key). A retry with a known key returns the
        # original invoice instead of issuing a duplicate. An absent or
        # malformed key keeps the historical behaviour exactly.
        idempotency_key = None
        raw_key = data.get('idempotency_key')
        if raw_key:
            try:
                idempotency_key = uuid.UUID(str(raw_key))
            except (ValueError, AttributeError, TypeError):
                idempotency_key = None
        submission = None
        if idempotency_key is not None:
            submission, _created = IdempotentSubmission.objects.get_or_create(
                created_by=request.user, key=idempotency_key,
            )
            # Serialize concurrent same-key submissions on this row: the
            # loser waits, then sees the winner's linked invoice below.
            submission = IdempotentSubmission.objects.select_for_update().get(
                pk=submission.pk,
            )
            if submission.invoice_id is not None:
                invoice = submission.invoice
                customer = invoice.customer
                serializer = self.get_serializer(invoice)
                return Response({
                    'invoice': serializer.data,
                    'customer': {
                        'id': customer.id if customer else None,
                        'name': customer.name if customer else '',
                        'phone': customer.phone if customer else '',
                        'is_new': bool(customer) and timezone.localdate(customer.created_at) == timezone.localdate(),
                    },
                    'message': f'فاکتور {invoice.invoice_number} با موفقیت صادر شد',
                }, status=200)
        customer_serializer = CustomerListSerializer(data={
            'name': data.get('customer_name', ''),
            'phone': data.get('customer_phone', ''),
        })
        customer_serializer.is_valid(raise_exception=True)
        customer_name = customer_serializer.validated_data['name']
        customer_phone = customer_serializer.validated_data.get('phone')
        # Validate every invoice field before creating a customer. Known optional
        # fields (including tags, vehicle/custom fields and card source) share
        # the normal invoice serializer and calculations.
        payload = {key: value for key, value in data.items() if key not in {'customer', 'customer_name', 'customer_phone', 'idempotency_key'}}
        invoice_serializer = self.get_serializer(data=payload)
        invoice_serializer.is_valid(raise_exception=True)

        customer = None
        if customer_phone:
            customer = Customer.objects.filter(phone=customer_phone).first()
        if not customer:
            customer = Customer.objects.filter(name__iexact=customer_name).first()
        if not customer:
            customer = customer_serializer.save()

        invoice = invoice_serializer.save(
            customer=customer,
            created_by=request.user,
            paid_by=request.user if invoice_serializer.validated_data.get('status', 'pending') == 'paid' else None,
        )

        if submission is not None:
            submission.invoice = invoice
            submission.save(update_fields=['invoice'])

        record_audit(user=request.user, instance=invoice, action='create', after=snapshot(invoice))
        serializer = self.get_serializer(invoice)
        return Response({
            'invoice': serializer.data,
            'customer': {
                'id': customer.id,
                'name': customer.name,
                'phone': customer.phone,
                'is_new': timezone.localdate(customer.created_at) == timezone.localdate(),
            },
            'message': f'فاکتور {invoice.invoice_number} با موفقیت صادر شد',
        }, status=201)
