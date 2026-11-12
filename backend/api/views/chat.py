"""Internal user chat endpoints."""

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

class ChatMessageViewSet(viewsets.GenericViewSet, viewsets.mixins.ListModelMixin, viewsets.mixins.CreateModelMixin, viewsets.mixins.DestroyModelMixin):
    permission_classes = [IsAuthenticated, HasModuleAccess]
    module_name = 'chat'
    serializer_class = ChatMessageSerializer
    queryset = ChatMessage.objects.select_related('sender', 'recipient').all()
    pagination_class = OptionalPageNumberPagination

    def get_queryset(self):
        user = self.request.user
        return super().get_queryset().filter(Q(sender=user) | Q(recipient=user) | Q(recipient__isnull=True))

    def list(self, request, *args, **kwargs):
        queryset = self.get_queryset()
        recipient_id = request.query_params.get('recipient')
        if recipient_id:
            try:
                recipient_id = int(recipient_id)
            except (TypeError, ValueError):
                return Response({'recipient': ['کاربر انتخاب‌شده معتبر نیست.']}, status=status.HTTP_400_BAD_REQUEST)
            if recipient_id == request.user.id:
                queryset = queryset.none()
            else:
                queryset = queryset.filter(
                    Q(sender=request.user, recipient_id=recipient_id) |
                    Q(sender_id=recipient_id, recipient=request.user)
                )
        else:
            queryset = queryset.filter(recipient__isnull=True)
        # Keep the historical latest-100 cap, but restore chronological order
        # before applying pagination so adjacent pages are also chronological.
        messages = list(reversed(list(queryset.order_by('-created_at', '-id')[:100])))
        page = self.paginate_queryset(messages)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        return Response(self.get_serializer(messages, many=True).data)

    def perform_create(self, serializer):
        message = serializer.save(sender=self.request.user)
        recipients = User.objects.filter(is_active=True).exclude(pk=self.request.user.pk)
        if message.recipient_id:
            recipients = recipients.filter(pk=message.recipient_id)
        ChatNotification.objects.bulk_create([
            ChatNotification(recipient=user, message=message) for user in recipients
        ], ignore_conflicts=True)

        layer = get_channel_layer()
        if layer:
            async_to_sync(layer.group_send)('chat_room', {
                'type': 'chat.message',
                'payload': ChatMessageSerializer(message, context={'request': self.request}).data,
            })

    def destroy(self, request, *args, **kwargs):
        message = self.get_object()
        if message.sender_id != request.user.id:
            return Response({'detail': 'فقط فرستنده می‌تواند پیام را حذف کند.'}, status=status.HTTP_403_FORBIDDEN)
        message_id = message.id
        if message.file:
            message.file.delete(save=False)
        self.perform_destroy(message)
        layer = get_channel_layer()
        if layer:
            async_to_sync(layer.group_send)('chat_room', {
                'type': 'chat.deleted', 'message_id': message_id,
            })
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['get'])
    def users(self, request):
        online_after = timezone.now() - timedelta(seconds=90)
        presence = {
            row['user_id']: row['last_seen']
            for row in ChatPresence.objects.filter(last_seen__gte=online_after).values('user_id', 'last_seen')
        }
        users = User.objects.filter(is_active=True).exclude(pk=request.user.pk).order_by('first_name', 'last_name', 'username')
        return Response([{
            'id': user.id,
            'name': user.get_full_name().strip() or user.username,
            'username': user.username,
            'online': user.id in presence,
            'last_seen': presence.get(user.id),
        } for user in users])

    @action(detail=False, methods=['get'])
    def unread(self, request):
        unread = ChatNotification.objects.filter(recipient=request.user, read_at__isnull=True)
        latest = unread.select_related('message__sender').order_by('-created_at', '-id')[:20]
        return Response({
            'count': unread.count(),
            'results': [{
                'id': notification.id,
                'created_at': notification.created_at,
                'message': ChatMessageSerializer(notification.message, context={'request': request}).data,
            } for notification in latest],
        })

    @action(detail=False, methods=['post'])
    def mark_read(self, request):
        updated = ChatNotification.objects.filter(recipient=request.user, read_at__isnull=True).update(read_at=timezone.now())
        return Response({'updated': updated})

    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        message = self.get_object()
        if not message.file:
            return Response({'detail': 'فایلی برای این پیام ثبت نشده است.'}, status=404)
        return FileResponse(message.file.open('rb'), as_attachment=True, filename=os.path.basename(message.file.name))
