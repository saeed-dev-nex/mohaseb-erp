"""Businesses, fiscal years, members and job templates (ERP phase 0).

A Business is the tenant dimension of the ERP edition. Creating one is
a superuser action; working inside one requires a membership (the
superuser implicitly owns every business). Each new business starts
with an owner membership for its creator and a current fiscal year
spanning the current Jalali year.
"""

from django.contrib.auth.models import User
from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from ..business_context import user_businesses
from ..business_templates import templates_payload
from ..models import Business, BusinessMembership
from ..serializers import (
    BusinessMembershipSerializer, BusinessSerializer, FiscalYearSerializer,
)
from ..services.business_setup import create_default_fiscal_year

MANAGE_ROLES = ('owner', 'manager')


class BusinessTemplateListView(APIView):
    """The job-template registry (قالب‌های شغلی) for the picker UI."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(templates_payload())


class BusinessViewSet(viewsets.ModelViewSet):
    serializer_class = BusinessSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return (
            user_businesses(self.request.user)
            .prefetch_related('fiscal_years', 'memberships')
            .order_by('id')
        )

    def _membership(self, business):
        return business.memberships.filter(user=self.request.user).first()

    def _require_manage(self, business):
        user = self.request.user
        if user.is_superuser:
            return
        membership = self._membership(business)
        if membership is None or membership.role not in MANAGE_ROLES:
            raise PermissionDenied('برای مدیریت این کسب‌وکار دسترسی ندارید.')

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        if not request.user.is_superuser:
            raise PermissionDenied('ساخت کسب‌وکار جدید فقط برای مدیر ارشد ممکن است.')
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        business = serializer.save(created_by=request.user)
        BusinessMembership.objects.create(
            user=request.user, business=business, role='owner', is_default=False,
        )
        create_default_fiscal_year(business)
        return Response(
            self.get_serializer(business).data, status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        self._require_manage(self.get_object())
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        self._require_manage(self.get_object())
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        # Businesses are deactivated, never hard-deleted: transactional
        # rows PROTECT-reference them, and ERP data must not vanish.
        business = self.get_object()
        self._require_manage(business)
        business.is_active = False
        business.save(update_fields=['is_active', 'updated_at'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['get'], url_path='modules')
    def modules(self, request, pk=None):
        business = self.get_object()
        return Response({
            'template_key': business.template_key,
            'modules': business.effective_modules(),
        })

    @action(detail=True, methods=['get', 'post'], url_path='fiscal-years')
    def fiscal_years(self, request, pk=None):
        business = self.get_object()
        if request.method == 'GET':
            years = business.fiscal_years.all()
            return Response(FiscalYearSerializer(years, many=True).data)
        self._require_manage(business)
        serializer = FiscalYearSerializer(data={**request.data, 'business': business.id})
        serializer.is_valid(raise_exception=True)
        year = serializer.save()
        if year.is_current:
            business.fiscal_years.exclude(id=year.id).update(is_current=False)
        return Response(FiscalYearSerializer(year).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get', 'post'], url_path='members')
    def members(self, request, pk=None):
        business = self.get_object()
        if request.method == 'GET':
            members = business.memberships.select_related('user').all()
            return Response(BusinessMembershipSerializer(members, many=True).data)
        self._require_manage(business)
        username = (request.data.get('username') or '').strip()
        role = request.data.get('role') or 'operator'
        if role not in dict(BusinessMembership.ROLE_CHOICES):
            raise ValidationError({'role': 'نقش نامعتبر است.'})
        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist:
            raise ValidationError({'username': 'کاربری با این نام کاربری یافت نشد.'})
        membership, _created = BusinessMembership.objects.update_or_create(
            user=user, business=business, defaults={'role': role},
        )
        return Response(
            BusinessMembershipSerializer(membership).data,
            status=status.HTTP_201_CREATED,
        )
