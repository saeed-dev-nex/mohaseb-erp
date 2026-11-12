"""Dashboard, staff, users and audit-log endpoints."""

from rest_framework import viewsets, status, filters
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import BasePermission, IsAuthenticated, IsAdminUser
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.exceptions import ValidationError
from collections.abc import Mapping
from decimal import Decimal
from django.db.models import Sum, Count, Q, OuterRef, Subquery, DecimalField, Value, Case, When, F, ExpressionWrapper
from django.db.models.functions import Coalesce
from django.db import transaction, connection
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from datetime import timedelta, date, datetime, time
from django.http import JsonResponse, HttpResponse
from django.http import FileResponse
from django.core.paginator import Paginator, EmptyPage
from django.shortcuts import get_object_or_404
from django.contrib.auth.models import User
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
import json, calendar, os, shutil
from zoneinfo import ZoneInfo

from ..models import (
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
from ..pagination import OptionalPageNumberPagination




from .common import HasModuleAccess, IsManagerOrAdmin, IsSuperuser
from ..module_access import effective_modules

class DashboardViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['get'])
    def reminders(self, request):
        """Due-date digest: overdue + due-soon invoices and cheques (stage 4)."""
        from ..services.reminders import build_reminders

        try:
            within_days = min(90, max(1, int(request.query_params.get('days', 7))))
        except (TypeError, ValueError):
            within_days = 7
        modules = effective_modules(request.user)
        if 'reports' not in modules:
            return Response({'today': timezone.localdate().isoformat(), 'within_days': within_days, 'totals': {}})
        digest = build_reminders(within_days=within_days)
        allowed_sections = set()
        if 'invoices' in modules:
            allowed_sections.update(('overdue_invoices', 'due_soon_invoices'))
        if 'cheques' in modules:
            allowed_sections.update(('cheques_due', 'cheques_overdue', 'bounced_cheques'))
        digest = {key: value for key, value in digest.items()
                  if key in allowed_sections or key in ('today', 'within_days', 'totals')}
        digest['totals'] = {key: value for key, value in digest['totals'].items()
                            if any(key.startswith(section + '_') for section in allowed_sections)}
        return Response(digest)

    @action(detail=False, methods=['get'])
    def stats(self, request):
        now = timezone.localtime()
        today = now.date()

        total_customers = Customer.objects.count()
        total_invoices = Invoice.objects.count()
        total_revenue = Invoice.objects.filter(Q(status='paid') | Q(commission_paid=True)).aggregate(
            total=Sum('commission_total')
        )['total'] or 0
        total_commission = total_revenue
        pending_count = Invoice.objects.filter(status='pending').count()
        paid_count = Invoice.objects.filter(status='paid').count()
        overdue_queryset = Invoice.objects.filter(status='pending', due_date__lt=today).select_related('customer').prefetch_related('payments').order_by('due_date')
        overdue_count = overdue_queryset.count()
        overdue_amount = 0
        overdue_items = []
        for inv in overdue_queryset:
            received = sum(int(payment.amount) for payment in inv.payments.all())
            remaining = max(0, int(inv.final_amount) - received)
            overdue_amount += remaining
            if len(overdue_items) < 8:
                overdue_items.append({
                    'id': inv.id,
                    'invoice_number': inv.invoice_number,
                    'customer_name': inv.customer.name if inv.customer else '---',
                    'due_date': inv.due_date.isoformat(),
                    'remaining_amount': remaining,
                })

        # Total expenses
        total_expenses = Expense.objects.aggregate(t=Sum('amount'))['t'] or 0

        # Monthly revenue (last 6 months) — JALALI months: in this app a
        # month is a Shamsi month (e.g. آبان runs Oct 23 – Nov 21), so the
        # buckets follow Jalali boundaries, never Gregorian ones.
        from ..jalali import gregorian_to_jalali, jalali_month_bounds, jalali_month_label
        monthly_revenue = []
        today_local = now.date()
        cur_jy, cur_jm, _ = gregorian_to_jalali(today_local.year, today_local.month, today_local.day)
        for i in range(5, -1, -1):
            absolute_month = cur_jy * 12 + (cur_jm - 1) - i
            month_year, month_zero_indexed = divmod(absolute_month, 12)
            month_number = month_zero_indexed + 1
            start_date, next_start_date = jalali_month_bounds(month_year, month_number)
            month_start = datetime.combine(start_date, time.min, tzinfo=now.tzinfo)
            month_end = datetime.combine(next_start_date, time.min, tzinfo=now.tzinfo)

            revenue = Invoice.objects.filter(
                Q(status='paid') | Q(commission_paid=True),
                date__gte=month_start,
                date__lt=month_end
            ).aggregate(total=Sum('commission_total'))['total'] or 0

            expense = Expense.objects.filter(
                date__gte=start_date,
                date__lt=next_start_date
            ).aggregate(total=Sum('amount'))['total'] or 0

            monthly_revenue.append({
                'month': f'{month_year:04d}-{month_number:02d}',
                'label': jalali_month_label(month_year, month_number),
                'revenue': int(revenue),
                'expense': int(expense),
                'profit': int(revenue) - int(expense),
            })

        # Top services
        from ..models import InvoiceItem
        top_services = list(
            InvoiceItem.objects.values('service_title_snapshot')
            .annotate(count=Count('id'), total=Sum('main_price'))
            .order_by('-count')[:5]
        )

        # Top customers
        top_customers = list(
            Invoice.objects.filter(Q(status='paid') | Q(commission_paid=True))
            .values('customer__name')
            .annotate(total=Sum('total_amount'), count=Count('id'))
            .order_by('-total')[:5]
        )

        # Recent invoices
        recent = Invoice.objects.select_related('customer').order_by('-date')[:8]
        recent_invoices = []
        for inv in recent:
            recent_invoices.append({
                'id': inv.id,
                'invoice_number': inv.invoice_number,
                'customer_name': inv.customer.name if inv.customer else '---',
                'total_amount': int(inv.total_amount),
                'status': inv.status,
                'status_display': inv.get_status_display(),
                'date': inv.date.isoformat(),
            })

        # Cheque stats
        upcoming_cheques = Cheque.objects.filter(
            status='pending',
            due_date__gte=today,
            due_date__lte=today + timedelta(days=10)
        ).select_related('customer').order_by('due_date')
        
        upcoming_cheques_data = []
        for chq in upcoming_cheques:
            upcoming_cheques_data.append({
                'id': chq.id,
                'cheque_number': chq.cheque_number,
                'bank_name': chq.bank_name,
                'amount': int(chq.amount),
                'due_date': chq.due_date.isoformat(),
                'type': chq.type,
                'customer_name': chq.customer.name if chq.customer else '---',
            })
            
        pending_incoming_cheques_amount = Cheque.objects.filter(
            type='incoming', status='pending'
        ).aggregate(t=Sum('amount'))['t'] or 0
        
        pending_outgoing_cheques_amount = Cheque.objects.filter(
            type='outgoing', status='pending'
        ).aggregate(t=Sum('amount'))['t'] or 0

        data = {
            'total_customers': total_customers,
            'total_invoices': total_invoices,
            'total_revenue': int(total_revenue),
            'total_commission': int(total_commission),
            'total_expenses': int(total_expenses),
            'net_profit': int(total_revenue) - int(total_expenses),
            'pending_invoices': pending_count,
            'paid_invoices': paid_count,
            'overdue_invoices': overdue_count,
            'overdue_amount': overdue_amount,
            'overdue_items': overdue_items,
            'monthly_revenue': monthly_revenue,
            'top_services': top_services,
            'top_customers': top_customers,
            'recent_invoices': recent_invoices,
            'upcoming_cheques': upcoming_cheques_data,
            'pending_incoming_cheques_amount': int(pending_incoming_cheques_amount),
            'pending_outgoing_cheques_amount': int(pending_outgoing_cheques_amount),
        }
        # Keep the landing accessible, exposing only the caller's modules.
        modules = effective_modules(request.user)
        allowed = set()
        if 'customers' in modules:
            allowed.add('total_customers')
        if 'invoices' in modules:
            allowed.update(('total_invoices', 'pending_invoices', 'paid_invoices', 'recent_invoices'))
        if 'reports' in modules:
            if 'invoices' in modules:
                allowed.update(('total_revenue', 'total_commission', 'overdue_invoices', 'overdue_amount', 'overdue_items'))
                if 'services' in modules:
                    allowed.add('top_services')
                if 'customers' in modules:
                    allowed.add('top_customers')
            if 'expenses' in modules:
                allowed.add('total_expenses')
            if {'invoices', 'expenses'} <= modules:
                allowed.update(('net_profit', 'monthly_revenue'))
            if 'cheques' in modules:
                allowed.update(('upcoming_cheques', 'pending_incoming_cheques_amount', 'pending_outgoing_cheques_amount'))
        return Response({key: value for key, value in data.items() if key in allowed})

class StaffViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, HasModuleAccess]
    module_name = 'staff'
    serializer_class = StaffSerializer
    pagination_class = OptionalPageNumberPagination

    def get_queryset(self):
        qs = Staff.objects.all()
        active = self.request.query_params.get('active', '')
        if active == 'true':
            qs = qs.filter(is_active=True)
        return qs

    def check_permissions(self, request):
        super().check_permissions(request)
        if self.action == 'performance' and 'reports' not in effective_modules(request.user):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('دسترسی به ماژول گزارشات لازم است.')

    @action(detail=True, methods=['get'])
    def performance(self, request, pk=None):
        """Staff performance: how many items, total revenue"""
        staff = self.get_object()
        from ..models import InvoiceItem
        items = InvoiceItem.objects.filter(staff=staff)
        date_from = request.query_params.get('date_from', '')
        date_to = request.query_params.get('date_to', '')
        if date_from:
            items = items.filter(invoice__date__date__gte=date_from)
        if date_to:
            items = items.filter(invoice__date__date__lte=date_to)

        line_total = ExpressionWrapper(
            (F('main_price') + F('extra_price')) * F('quantity'),
            output_field=DecimalField(max_digits=30, decimal_places=0),
        )
        totals = items.aggregate(
            total_items=Count('id'),
            total_revenue=Coalesce(
                Sum(line_total),
                Value(Decimal('0')),
                output_field=DecimalField(max_digits=30, decimal_places=0),
            ),
        )
        total_items = totals['total_items']
        total_revenue = totals['total_revenue'] or Decimal('0')
        commission_earned = int(total_revenue * staff.commission_rate / 100)
        return Response({
            'staff_id': staff.id,
            'staff_name': staff.name,
            'total_items': total_items,
            'total_revenue': int(total_revenue),
            'commission_rate': float(staff.commission_rate),
            'commission_earned': commission_earned,
        })

class UserViewSet(viewsets.ModelViewSet):
    """
    Admin-only: manage operator/manager user accounts.
    GET    /api/users/         -> list all users
    POST   /api/users/         -> create new user
    PATCH  /api/users/{id}/    -> update user (name, password, role, active)
    DELETE /api/users/{id}/    -> delete user (cannot delete yourself)
    GET    /api/users/me/      -> current user info + role
    """
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return User.objects.all().order_by('id')

    def get_permissions(self):
        # User management, including custom actions, is superuser-only.
        if self.action == 'me':
            return [IsAuthenticated()]
        return [IsSuperuser()]

    def get_serializer(self, *args, **kwargs):
        data = kwargs.get('data')
        if isinstance(data, Mapping) and 'role' in data:
            role = data['role']
            if role not in ('admin', 'manager', 'operator'):
                raise ValidationError({'role': ['نقش انتخاب‌شده معتبر نیست.']})
            data = dict(data.items())
            data.pop('role')
            data['is_superuser'] = role == 'admin'
            data['is_staff'] = role in ('admin', 'manager')
            kwargs['data'] = data
        return super().get_serializer(*args, **kwargs)

    def lock_active_admins(self):
        # Lock the same ordered set for updates/deletes so two requests cannot
        # concurrently remove each other's last active administrator.
        return list(User.objects.select_for_update().filter(is_superuser=True, is_active=True).order_by('pk'))

    def validate_account_change(self, user, *, is_superuser, is_active):
        losing_access = not is_superuser or not is_active
        if user.pk == self.request.user.pk and losing_access:
            raise ValidationError({'detail': 'نمی‌توانید دسترسی مدیریتی حساب خود را غیرفعال کنید.'})
        if user.is_superuser and user.is_active and losing_access:
            if not User.objects.filter(is_superuser=True, is_active=True).exclude(pk=user.pk).exists():
                raise ValidationError({'detail': 'حداقل یک ادمین فعال باید باقی بماند.'})

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        self.lock_active_admins()
        return super().update(request, *args, **kwargs)

    def perform_update(self, serializer):
        self.validate_account_change(
            serializer.instance,
            is_superuser=serializer.validated_data.get('is_superuser', serializer.instance.is_superuser),
            is_active=serializer.validated_data.get('is_active', serializer.instance.is_active),
        )
        serializer.save()

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        self.lock_active_admins()
        user = self.get_object()
        if user == request.user:
            return Response(
                {'error': 'نمی‌توانید حساب خود را حذف کنید'},
                status=status.HTTP_400_BAD_REQUEST
            )
        self.validate_account_change(user, is_superuser=False, is_active=False)
        user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def me(self, request):
        """Return current logged-in user info with role"""
        serializer = UserSerializer(request.user)
        return Response(serializer.data)

    @action(detail=True, methods=['get', 'put'], permission_classes=[IsSuperuser])
    def module_access(self, request, pk=None):
        """Read or update a user's module restriction row (stage 6).

        GET returns the user's effective modules plus the raw row (null
        when the user simply follows their role). PUT updates the row with
        the given module booleans; PUT with an empty body removes the row
        and restores pure role-based access.
        """
        from ..models import UserModuleAccess
        from ..module_access import effective_modules
        from ..serializers import UserModuleAccessSerializer

        user = self.get_object()
        if request.method == 'GET':
            try:
                row = user.module_access
            except UserModuleAccess.DoesNotExist:
                row = None
            return Response({
                'modules': sorted(effective_modules(user)),
                'access': UserModuleAccessSerializer(row).data if row else None,
            })
        if not request.data:
            UserModuleAccess.objects.filter(user=user).delete()
            user.refresh_from_db()
            return Response({
                'modules': sorted(effective_modules(user)),
                'access': None,
            })
        row, _created = UserModuleAccess.objects.get_or_create(user=user)
        serializer = UserModuleAccessSerializer(row, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        user.refresh_from_db()
        return Response({
            'modules': sorted(effective_modules(user)),
            'access': serializer.data,
        })

    @action(detail=False, methods=['post'], permission_classes=[IsSuperuser])
    @transaction.atomic
    def set_role(self, request):
        """
        Quick role assignment.
        Body: { user_id, role: 'admin' | 'manager' | 'operator' }
        """
        user_id = request.data.get('user_id')
        role = request.data.get('role')
        if role not in ('admin', 'manager', 'operator'):
            raise ValidationError({'role': ['نقش انتخاب‌شده معتبر نیست.']})
        self.lock_active_admins()
        try:
            user = User.objects.get(id=user_id)
        except (User.DoesNotExist, TypeError, ValueError):
            return Response({'error': 'کاربر یافت نشد'}, status=404)

        serializer = self.get_serializer(user, data={'role': role}, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return Response(serializer.data)

    # ---- User performance monitoring (per-user profile) ----

    def _performance_range_start(self, range_key):
        """Inclusive local start date for a performance range, or None."""
        today = timezone.localdate()
        if range_key == '30d':
            return today - timedelta(days=29)
        if range_key == 'month':
            from ..jalali import gregorian_to_jalali, jalali_to_gregorian
            jy, jm, _ = gregorian_to_jalali(today.year, today.month, today.day)
            gy, gm, gd = jalali_to_gregorian(jy, jm, 1)
            return date(gy, gm, gd)
        return None

    def _user_stats(self, user, start):
        invoices = Invoice.objects.filter(created_by=user)
        payments = InvoicePayment.objects.filter(created_by=user)
        edit_requests = InvoiceEditRequest.objects.filter(requested_by=user)
        activity = AuditLog.objects.filter(user=user)
        if start is not None:
            invoices = invoices.filter(date__date__gte=start)
            payments = payments.filter(paid_at__date__gte=start)
            edit_requests = edit_requests.filter(created_at__date__gte=start)
            activity = activity.filter(created_at__date__gte=start)
        invoice_totals = invoices.aggregate(
            count=Count('id'),
            total=Coalesce(Sum('total_amount'), Value(Decimal('0')), output_field=DecimalField(max_digits=30, decimal_places=0)),
        )
        payment_totals = payments.aggregate(
            count=Count('id'),
            total=Coalesce(Sum('amount'), Value(Decimal('0')), output_field=DecimalField(max_digits=30, decimal_places=0)),
        )
        return {
            'invoices_issued': invoice_totals['count'],
            'invoices_total': int(invoice_totals['total'] or 0),
            'payments_recorded': payment_totals['count'],
            'payments_total': int(payment_totals['total'] or 0),
            'edit_requests': edit_requests.count(),
            'edit_requests_approved': edit_requests.filter(status__in=['approved', 'used']).count(),
            'activity_events': activity.count(),
        }

    @action(detail=False, methods=['get'], url_path='performance-summary')
    def performance_summary(self, request):
        """Headline per-user stats for the users list (superuser only)."""
        start = self._performance_range_start(request.query_params.get('range', 'month'))
        rows = []
        for user in User.objects.all().order_by('id'):
            stats = self._user_stats(user, start)
            last_activity = (
                AuditLog.objects.filter(user=user).order_by('-created_at')
                .values_list('created_at', flat=True).first()
            )
            rows.append({
                'id': user.id,
                'username': user.username,
                'full_name': user.get_full_name(),
                'is_active': user.is_active,
                'is_staff': user.is_staff,
                'is_superuser': user.is_superuser,
                'last_login': user.last_login,
                'last_activity': last_activity,
                **stats,
            })
        return Response({'range': request.query_params.get('range', 'month'), 'users': rows})

    @action(detail=True, methods=['get'])
    def performance(self, request, pk=None):
        """One user's performance profile (superuser only)."""
        user = self.get_object()
        range_key = request.query_params.get('range', 'month')
        start = self._performance_range_start(range_key)
        stats = self._user_stats(user, start)

        # Monthly issued-invoice series over the last 6 Jalali months.
        from ..jalali import gregorian_to_jalali, jalali_month_bounds, jalali_month_label
        today = timezone.localdate()
        cur_jy, cur_jm, _ = gregorian_to_jalali(today.year, today.month, today.day)
        months = []
        jy, jm = cur_jy, cur_jm
        for _ in range(6):
            months.append((jy, jm))
            jm -= 1
            if jm == 0:
                jm = 12
                jy -= 1
        months.reverse()
        series = []
        for month_year, month_number in months:
            month_start, next_month_start = jalali_month_bounds(month_year, month_number)
            totals = Invoice.objects.filter(
                created_by=user,
                date__date__gte=month_start,
                date__date__lt=next_month_start,
            ).aggregate(
                count=Count('id'),
                total=Coalesce(Sum('total_amount'), Value(Decimal('0')), output_field=DecimalField(max_digits=30, decimal_places=0)),
            )
            series.append({
                'label': jalali_month_label(month_year, month_number),
                'count': totals['count'],
                'total': int(totals['total'] or 0),
            })

        recent_invoices = [
            {
                'id': invoice.id,
                'invoice_number': invoice.invoice_number,
                'customer_name': invoice.customer.name if invoice.customer else '',
                'status': invoice.status,
                'total_amount': int(invoice.total_amount or 0),
                'date': invoice.date,
            }
            for invoice in Invoice.objects.filter(created_by=user).select_related('customer').order_by('-date')[:10]
        ]
        recent_payments = [
            {
                'id': payment.id,
                'invoice_id': payment.invoice_id,
                'invoice_number': payment.invoice.invoice_number,
                'amount': int(payment.amount or 0),
                'method': payment.method,
                'paid_at': payment.paid_at,
            }
            for payment in InvoicePayment.objects.filter(created_by=user).select_related('invoice').order_by('-paid_at')[:10]
        ]
        last_activity = (
            AuditLog.objects.filter(user=user).order_by('-created_at')
            .values_list('created_at', flat=True).first()
        )
        return Response({
            'user': {
                'id': user.id,
                'username': user.username,
                'full_name': user.get_full_name(),
                'is_active': user.is_active,
                'is_staff': user.is_staff,
                'is_superuser': user.is_superuser,
                'date_joined': user.date_joined,
                'last_login': user.last_login,
                'last_activity': last_activity,
            },
            'range': range_key,
            'stats': stats,
            'monthly_series': series,
            'recent_invoices': recent_invoices,
            'recent_payments': recent_payments,
        })

class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated, IsManagerOrAdmin, HasModuleAccess]
    module_name = 'reports'
    serializer_class = AuditLogSerializer

    def get_queryset(self):
        qs = AuditLog.objects.select_related('user').all()
        modules = effective_modules(self.request.user)
        object_modules = {
            'customer': 'customers', 'document': 'customers', 'invoice': 'invoices',
            'invoicepayment': 'invoices', 'expense': 'expenses', 'cheque': 'cheques',
            'service': 'services', 'staff': 'staff',
        }
        if not self.request.user.is_superuser:
            qs = qs.filter(object_type__in=[name for name, module in object_modules.items() if module in modules])
        object_type = self.request.query_params.get('object_type', '')
        object_id = self.request.query_params.get('object_id', '')
        if object_type:
            qs = qs.filter(object_type=object_type)
        if object_id:
            qs = qs.filter(object_id=object_id)
        # Detail lookup must remain filterable; slicing it makes DRF's get()
        # raise TypeError (which get_object_or_404 turns into a false 404).
        return qs[:500] if self.action == 'list' else qs
