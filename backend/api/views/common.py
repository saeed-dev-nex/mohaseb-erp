"""Shared permissions and helpers for the views package."""

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




class IsSuperuser(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_active and request.user.is_superuser)


class IsManagerOrAdmin(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_active and (request.user.is_staff or request.user.is_superuser))


class CanManageSettings(IsManagerOrAdmin):
    """Settings writes require both the management role and its module."""

    def has_permission(self, request, view):
        from ..module_access import effective_modules
        return super().has_permission(request, view) and 'settings' in effective_modules(request.user)


class HasModuleAccess(BasePermission):
    """Granular module gate (stage 6): the viewset declares ``module_name``
    and the caller's effective modules (api.module_access) decide. Viewsets
    without a module name are not gated by this class."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated or not request.user.is_active:
            return False
        module = getattr(view, 'module_name', None)
        if module is None:
            return True
        from ..module_access import effective_modules
        return module in effective_modules(request.user)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def database_revision(request):
    """Return a cheap revision token that changes after committed SQLite writes."""
    if connection.vendor == 'sqlite':
        database_path = connection.settings_dict['NAME']
        paths = (database_path, f'{database_path}-wal')
        revision = []
        for path in paths:
            try:
                stat = os.stat(path)
                revision.append((stat.st_mtime_ns, stat.st_size))
            except OSError:
                revision.append(None)
        return Response({'revision': revision})
    # Other database backends can use this endpoint without a schema change.
    return Response({'revision': timezone.now().timestamp()})
