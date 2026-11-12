"""Service and vehicle-type endpoints."""

from rest_framework import viewsets, status, filters
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import BasePermission, IsAuthenticated, IsAdminUser, SAFE_METHODS
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
    Customer, Service, ServicePackage, Invoice, InvoiceEditRequest, InvoicePayment, AuditLog, Document,
    BusinessProfile, ExpenseCategory, Expense, Staff, VehicleType, BackupConfig,
    Cheque, InvoiceSettings, ChatMessage, ChatNotification, ChatPresence,
    WelcomeSettings, UserWelcomeMessage, WelcomeMessageShown, SocialNetwork
)
from ..serializers import (
    CustomerListSerializer, CustomerDetailSerializer,
    ServiceSerializer, ServicePackageSerializer, InvoiceSerializer, DocumentSerializer,
    BusinessProfileSerializer, ExpenseCategorySerializer,
    ExpenseSerializer, StaffSerializer, VehicleTypeSerializer,
    UserSerializer, BackupConfigSerializer, InvoiceSettingsSerializer, ChequeSerializer, InvoicePaymentSerializer, AuditLogSerializer, ChatMessageSerializer, SocialNetworkSerializer
)
from ..audit import snapshot, record_audit, is_invoice_content_version
from ..pagination import OptionalPageNumberPagination




from .common import CanManageSettings, HasModuleAccess


class ServicePackagePermission(BasePermission):
    """Reads: operators who can invoice or work with services/settings.
    Writes: settings managers only — packages are arranged in Settings."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            from ..module_access import effective_modules

            return bool(
                effective_modules(request.user)
                & {'invoices', 'services', 'settings'}
            )
        return CanManageSettings().has_permission(request, view)


class ServicePackageViewSet(viewsets.ModelViewSet):
    permission_classes = [ServicePackagePermission]
    serializer_class = ServicePackageSerializer
    pagination_class = OptionalPageNumberPagination

    def get_queryset(self):
        qs = ServicePackage.objects.prefetch_related('services').all()
        if self.request.query_params.get('active'):
            qs = qs.filter(is_active=True)
        return qs

class ServiceViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, HasModuleAccess]
    module_name = 'services'
    serializer_class = ServiceSerializer
    pagination_class = OptionalPageNumberPagination

    def get_queryset(self):
        qs = Service.objects.all()
        active_only = self.request.query_params.get('active', None)
        if active_only == 'true':
            qs = qs.filter(is_active=True)
        return qs

class VehicleTypeViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, HasModuleAccess]
    module_name = 'services'
    serializer_class = VehicleTypeSerializer
    queryset = VehicleType.objects.all()
    pagination_class = OptionalPageNumberPagination
