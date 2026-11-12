"""Expenses and cheques endpoints."""

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
from ..module_access import effective_modules

class ExpenseCategoryViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, HasModuleAccess]
    module_name = 'expenses'
    serializer_class = ExpenseCategorySerializer
    queryset = ExpenseCategory.objects.all()
    pagination_class = OptionalPageNumberPagination

class ExpenseViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, HasModuleAccess]
    module_name = 'expenses'
    serializer_class = ExpenseSerializer
    pagination_class = OptionalPageNumberPagination

    def perform_create(self, serializer):
        expense = serializer.save()
        record_audit(user=self.request.user, instance=expense, action='create', after=snapshot(expense))

    def perform_update(self, serializer):
        before = snapshot(serializer.instance)
        expense = serializer.save()
        record_audit(user=self.request.user, instance=expense, action='update', before=before, after=snapshot(expense))

    def perform_destroy(self, instance):
        before = snapshot(instance)
        record_audit(user=self.request.user, instance=instance, action='delete', before=before)
        instance.delete()

    def get_queryset(self):
        qs = Expense.objects.select_related('category').all()
        cat = self.request.query_params.get('category', '')
        date_from = self.request.query_params.get('date_from', '')
        date_to = self.request.query_params.get('date_to', '')
        if cat:
            qs = qs.filter(category_id=cat)
        if date_from:
            qs = qs.filter(date__gte=date_from)
        if date_to:
            qs = qs.filter(date__lte=date_to)
        return qs

    def check_permissions(self, request):
        super().check_permissions(request)
        if self.action == 'summary' and 'reports' not in effective_modules(request.user):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('دسترسی به ماژول گزارشات لازم است.')

    @action(detail=False, methods=['get'])
    def summary(self, request):
        """Monthly expense summary"""
        date_from = request.query_params.get('date_from', '')
        date_to = request.query_params.get('date_to', '')
        qs = Expense.objects.all()
        if date_from:
            qs = qs.filter(date__gte=date_from)
        if date_to:
            qs = qs.filter(date__lte=date_to)

        total = qs.aggregate(t=Sum('amount'))['t'] or 0
        by_category = list(
            qs.values('category__name', 'category__icon', 'category__color')
            .annotate(total=Sum('amount'), count=Count('id'))
            .order_by('-total')
        )
        return Response({
            'total': int(total),
            'by_category': by_category,
        })

class ChequeViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, HasModuleAccess]
    module_name = 'cheques'
    serializer_class = ChequeSerializer
    pagination_class = OptionalPageNumberPagination

    def get_queryset(self):
        qs = Cheque.objects.select_related('customer').all()
        status_filter = self.request.query_params.get('status', '')
        type_filter = self.request.query_params.get('type', '')
        search = self.request.query_params.get('search', '')
        date_from = self.request.query_params.get('date_from', '')
        date_to = self.request.query_params.get('date_to', '')

        if status_filter:
            qs = qs.filter(status=status_filter)
        if type_filter:
            qs = qs.filter(type=type_filter)
        if search:
            qs = qs.filter(
                Q(cheque_number__icontains=search) |
                Q(bank_name__icontains=search) |
                Q(customer__name__icontains=search)
            )
        if date_from:
            qs = qs.filter(due_date__gte=date_from)
        if date_to:
            qs = qs.filter(due_date__lte=date_to)
        
        return qs
