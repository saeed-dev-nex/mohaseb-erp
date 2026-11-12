"""Business profile, invoice/welcome settings and social links."""

from rest_framework import viewsets, status, filters
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import BasePermission, IsAuthenticated, IsAdminUser
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.exceptions import PermissionDenied
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
from .common import CanManageSettings




class InvoiceSettingsViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def list(self, request):
        return Response(InvoiceSettingsSerializer(InvoiceSettings.load()).data)

    @action(detail=False, methods=['put', 'patch'], permission_classes=[CanManageSettings])
    def update_config(self, request):
        settings_obj = InvoiceSettings.load()
        serializer = InvoiceSettingsSerializer(settings_obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

class WelcomeSettingsViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['get', 'patch'], permission_classes=[CanManageSettings])
    def config(self, request):
        settings_obj = WelcomeSettings.load()
        if request.method == 'PATCH':
            settings_obj.enabled = bool(request.data.get('enabled', settings_obj.enabled))
            settings_obj.global_message = str(request.data.get('global_message', settings_obj.global_message))[:5000]
            settings_obj.save(update_fields=['enabled', 'global_message'])
        return Response({'enabled': settings_obj.enabled, 'global_message': settings_obj.global_message})

    @action(detail=False, methods=['get'], permission_classes=[CanManageSettings])
    def users(self, request):
        users = User.objects.filter(is_active=True).order_by('first_name', 'last_name', 'username')
        return Response([{
            'id': user.id,
            'name': user.get_full_name().strip() or user.username,
        } for user in users])

    @action(detail=False, methods=['get', 'post', 'delete'], permission_classes=[CanManageSettings])
    def personal(self, request):
        if request.method == 'GET':
            messages = UserWelcomeMessage.objects.select_related('user').order_by('user__first_name', 'user__last_name', 'user__username')
            return Response([{
                'user_id': item.user_id,
                'name': item.user.get_full_name().strip() or item.user.username,
                'message': item.message,
            } for item in messages])

        user_id = request.data.get('user_id')
        if not user_id:
            return Response({'user_id': ['انتخاب کاربر الزامی است.']}, status=status.HTTP_400_BAD_REQUEST)
        try:
            user = User.objects.get(pk=user_id, is_active=True)
        except (User.DoesNotExist, TypeError, ValueError):
            return Response({'user_id': ['کاربر انتخاب‌شده معتبر نیست.']}, status=status.HTTP_400_BAD_REQUEST)

        if request.method == 'DELETE':
            UserWelcomeMessage.objects.filter(user=user).delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        message = str(request.data.get('message', '')).strip()
        if not message:
            return Response({'message': ['متن پیام را وارد کنید.']}, status=status.HTTP_400_BAD_REQUEST)
        if len(message) > 5000:
            return Response({'message': ['حداکثر طول پیام ۵۰۰۰ نویسه است.']}, status=status.HTTP_400_BAD_REQUEST)
        item, _ = UserWelcomeMessage.objects.update_or_create(user=user, defaults={'message': message})
        return Response({'user_id': user.id, 'message': item.message})

    @action(detail=False, methods=['post'])
    def today(self, request):
        settings_obj = WelcomeSettings.load()
        if not settings_obj.enabled:
            return Response({'show': False})
        personal = UserWelcomeMessage.objects.filter(user=request.user).values_list('message', flat=True).first()
        message = personal or settings_obj.global_message
        if not message.strip():
            return Response({'show': False})
        local_day = timezone.localtime(timezone.now(), ZoneInfo('Asia/Tehran')).date()
        _, created = WelcomeMessageShown.objects.get_or_create(user=request.user, date=local_day)
        return Response({'show': created, 'message': message if created else ''})

class BusinessProfileViewSet(viewsets.ViewSet):
    """Singleton business profile / branding settings"""
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def profile_data(self, serializer):
        data = dict(serializer.data)
        if not self.request.user.is_superuser:
            data.pop('customer_documents_path', None)
        return data

    def list(self, request):
        profile = BusinessProfile.load()
        serializer = BusinessProfileSerializer(profile, context={'request': request})
        return Response(self.profile_data(serializer))

    @action(detail=False, methods=['put', 'patch'], permission_classes=[CanManageSettings])
    def update_profile(self, request):
        if 'customer_documents_path' in request.data and not request.user.is_superuser:
            raise PermissionDenied('تغییر مسیر ذخیره‌سازی مدارک فقط برای ادمین مجاز است.')
        profile = BusinessProfile.load()
        serializer = BusinessProfileSerializer(
            profile, data=request.data, partial=True,
            context={'request': request}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(self.profile_data(serializer))

class SocialNetworkViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = SocialNetworkSerializer
    queryset = SocialNetwork.objects.select_related('profile').all()
    parser_classes = [MultiPartParser, FormParser]

    def get_permissions(self):
        if self.request.method in ('GET', 'HEAD', 'OPTIONS'):
            return [IsAuthenticated()]
        return [IsAuthenticated(), CanManageSettings()]

    def get_queryset(self):
        return super().get_queryset().filter(profile_id=1)

    def perform_create(self, serializer):
        serializer.save(profile=BusinessProfile.load())

    def perform_update(self, serializer):
        old_logo = self.get_object().logo
        network = serializer.save()
        if old_logo and old_logo.name != getattr(network.logo, 'name', None):
            old_logo.delete(save=False)

    def perform_destroy(self, instance):
        if instance.logo:
            instance.logo.delete(save=False)
        instance.delete()
