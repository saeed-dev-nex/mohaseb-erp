"""Customer document endpoints."""

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
import json, calendar, os, shutil
import mimetypes
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




from .common import HasModuleAccess

class DocumentViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, HasModuleAccess]
    module_name = 'customers'
    serializer_class = DocumentSerializer
    parser_classes = [MultiPartParser, FormParser]

    def get_queryset(self):
        qs = Document.objects.all().order_by('-uploaded_at')
        customer_id = self.request.query_params.get('customer', '')
        invoice_id = self.request.query_params.get('invoice', '')
        if customer_id:
            qs = qs.filter(customer_id=customer_id)
        if invoice_id:
            qs = qs.filter(invoice_id=invoice_id)
        return qs

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['request'] = self.request
        return ctx

    def perform_create(self, serializer):
        """Save file and also copy to customer folder if path configured"""
        doc = serializer.save()
        self._sync_to_customer_folder(doc)
        record_audit(user=self.request.user, instance=doc, action='create', after={'customer_id': doc.customer_id, 'filename': os.path.basename(doc.file.name) if doc.file else ''})

    def perform_update(self, serializer):
        before = {'customer_id': serializer.instance.customer_id, 'filename': os.path.basename(serializer.instance.file.name) if serializer.instance.file else ''}
        doc = serializer.save()
        self._sync_to_customer_folder(doc)
        record_audit(user=self.request.user, instance=doc, action='update', before=before, after={'customer_id': doc.customer_id, 'filename': os.path.basename(doc.file.name) if doc.file else ''})

    def perform_destroy(self, instance):
        record_audit(user=self.request.user, instance=instance, action='delete', before={'customer_id': instance.customer_id, 'filename': os.path.basename(instance.file.name) if instance.file else ''})
        instance.delete()

    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        doc = self.get_object()
        if not doc.file:
            return Response({'detail': 'فایلی برای این سند ثبت نشده است.'}, status=404)
        try:
            source = doc.file.open('rb')
        except (FileNotFoundError, OSError):
            return Response({'detail': 'فایل سند یافت نشد.'}, status=404)
        response = FileResponse(source, as_attachment=True, filename=os.path.basename(doc.file.name))
        response['X-Content-Type-Options'] = 'nosniff'
        response['Cache-Control'] = 'private, no-store'
        return response

    @action(detail=True, methods=['get'])
    def preview(self, request, pk=None):
        """Display a private document inline when the browser supports it."""
        doc = self.get_object()
        if not doc.file:
            return Response({'detail': 'فایلی برای این سند ثبت نشده است.'}, status=404)
        try:
            source = doc.file.open('rb')
        except (FileNotFoundError, OSError):
            return Response({'detail': 'فایل سند یافت نشد.'}, status=404)
        content_type = mimetypes.guess_type(doc.file.name)[0] or 'application/octet-stream'
        response = FileResponse(source, as_attachment=False, content_type=content_type)
        response['Content-Disposition'] = 'inline'
        response['X-Content-Type-Options'] = 'nosniff'
        response['Cache-Control'] = 'private, no-store'
        return response

    def _sync_to_customer_folder(self, doc):
        """Copy file to customer-specific folder on disk if configured"""
        try:
            profile = BusinessProfile.load()
            base_path = profile.customer_documents_path
            if not base_path:
                return
            customer = doc.customer
            safe = lambda value: ''.join('_' if ch in '<>:"/\\|?*' or ord(ch) < 32 else ch for ch in str(value)).strip(' .') or 'بدون نام'
            folder_name = f"{customer.id}_{safe(customer.name)}"
            owner = doc.invoice.green_card_owner_name.strip() if doc.invoice_id and doc.invoice else ''
            child_name = safe(owner or (doc.invoice.invoice_number if doc.invoice_id and doc.invoice else doc.title))
            folder_path = os.path.join(base_path, folder_name, child_name)
            os.makedirs(folder_path, exist_ok=True)
            if doc.file and hasattr(doc.file, 'path') and os.path.exists(doc.file.path):
                dest = os.path.join(folder_path, os.path.basename(doc.file.name))
                if os.path.abspath(doc.file.path) != os.path.abspath(dest) and not os.path.exists(dest):
                    shutil.copy2(doc.file.path, dest)
                doc.file_path = dest
                doc.save(update_fields=['file_path'])
        except Exception:
            pass

    @action(detail=False, methods=['get'])
    def customer_folder_files(self, request):
        """List files in customer's physical folder"""
        customer_id = request.query_params.get('customer', '')
        if not customer_id:
            return Response({'error': 'customer param required'}, status=400)
        try:
            customer = Customer.objects.get(pk=customer_id)
            profile = BusinessProfile.load()
            base_path = profile.customer_documents_path
            if not base_path:
                return Response({'files': []})
            safe_name = ''.join('_' if ch in '<>:"/\\|?*' or ord(ch) < 32 else ch for ch in customer.name).strip(' .') or 'بدون نام'
            folder_name = f"{customer.id}_{safe_name}"
            folder_path = os.path.join(base_path, folder_name)
            if not os.path.isdir(folder_path):
                return Response({'files': []})
            files = []
            for root, _, filenames in os.walk(folder_path):
              for f in filenames:
                fp = os.path.join(root, f)
                if os.path.isfile(fp):
                    files.append({
                        'name': f,
                        'size': os.path.getsize(fp),
                        'modified': os.path.getmtime(fp),
                    })
            return Response({'files': files})
        except Customer.DoesNotExist:
            return Response({'error': 'customer not found'}, status=404)
