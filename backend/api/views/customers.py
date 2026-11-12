"""Customer endpoints."""

from rest_framework import viewsets, status, filters
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import BasePermission, IsAuthenticated, IsAdminUser
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from django.db.models import Sum, Count, Q, OuterRef, Subquery, DecimalField, Value, Case, When, F, ExpressionWrapper
from django.db.models import Prefetch
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




from .common import HasModuleAccess

class CustomerViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, HasModuleAccess]
    module_name = 'customers'
    pagination_class = OptionalPageNumberPagination

    def get_queryset(self):
        # Customer totals are calculated by the serializers through the shared
        # ``invoice_payment_totals`` helper. Prefetching both levels keeps those
        # calculations bounded to three queries for a list (customers,
        # invoices, payments), rather than one query per customer/invoice.
        qs = Customer.objects.all()
        if self.action in {'list', 'retrieve'}:
            invoice_queryset = Invoice.objects.prefetch_related('payments')
            qs = qs.prefetch_related(
                Prefetch('invoice_set', queryset=invoice_queryset),
            )
        if self.action == 'retrieve':
            qs = qs.prefetch_related('documents')
        search = self.request.query_params.get('search', '')
        if search:
            qs = qs.filter(
                Q(name__icontains=search) |
                Q(phone__icontains=search) |
                Q(email__icontains=search) |
                Q(national_id__icontains=search)
            )
        return qs

    def perform_create(self, serializer):
        customer = serializer.save()
        record_audit(user=self.request.user, instance=customer, action='create', after=snapshot(customer))

    def perform_update(self, serializer):
        before = snapshot(serializer.instance)
        customer = serializer.save()
        record_audit(user=self.request.user, instance=customer, action='update', before=before, after=snapshot(customer))

    def perform_destroy(self, instance):
        before = snapshot(instance)
        record_audit(user=self.request.user, instance=instance, action='delete', before=before)
        instance.delete()

    def get_serializer_class(self):
        if self.action in ['retrieve', 'create', 'update', 'partial_update']:
            return CustomerDetailSerializer
        return CustomerListSerializer

    @action(detail=True, methods=['get'])
    def invoices(self, request, pk=None):
        customer = self.get_object()
        invoices = Invoice.objects.filter(customer=customer).select_related(
            'customer', 'created_by', 'paid_by',
        ).prefetch_related(
            'items__service', 'payments__created_by', 'edit_requests',
        ).order_by('-date')
        serializer = InvoiceSerializer(invoices, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def search_by_vehicle(self, request):
        """Find customers by vehicle info"""
        plate = request.query_params.get('plate', '')
        vin = request.query_params.get('vin', '')
        qs = Invoice.objects.none()
        if plate:
            qs = Invoice.objects.filter(vehicle_plate__icontains=plate).select_related('customer')
        elif vin:
            qs = Invoice.objects.filter(vehicle_vin__icontains=vin).select_related('customer')

        results = []
        seen = set()
        for inv in qs:
            if inv.customer_id and inv.customer_id not in seen:
                seen.add(inv.customer_id)
                results.append({
                    'id': inv.customer.id,
                    'name': inv.customer.name,
                    'phone': inv.customer.phone,
                    'vehicle_plate': inv.vehicle_plate,
                    'vehicle_vin': inv.vehicle_vin,
                    'vehicle_model': inv.vehicle_model,
                })
        return Response(results)
