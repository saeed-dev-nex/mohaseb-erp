"""Personnel & payroll endpoints (ERP phase 3).

Profiles, settings, periods and payslips are scoped to the caller's
current business. Writes need owner/manager membership (superuser
counts). A finalized period is locked: payslips cannot change until
the period is returned to draft.
"""

import csv
import io

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django.http import HttpResponse

from ..models import EmploymentProfile, PayrollPeriod, Payslip
from ..serializers import (
    EmploymentProfileSerializer, PayrollPeriodSerializer,
    PayrollSettingsSerializer, PayslipSerializer,
)
from ..services.payroll import (
    finalize_period, generate_payslips, get_payroll_settings,
    recalculate_payslip, unfinalize_period,
)
from .accounting import _require_business, _require_write


class EmploymentProfileViewSet(viewsets.ModelViewSet):
    serializer_class = EmploymentProfileSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        return _require_business(self.request).employment_profiles.select_related('staff').all()

    def perform_create(self, serializer):
        business = _require_business(self.request)
        _require_write(self.request, business)
        serializer.save(business=business)

    def perform_update(self, serializer):
        business = _require_business(self.request)
        _require_write(self.request, business)
        serializer.save()

    def perform_destroy(self, instance):
        business = _require_business(self.request)
        _require_write(self.request, business)
        instance.delete()


class PayrollSettingsView(APIView):
    """GET/PATCH /api/payroll/settings/ — rates and tax brackets."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        business = _require_business(request)
        return Response(PayrollSettingsSerializer(get_payroll_settings(business)).data)

    def patch(self, request):
        business = _require_business(request)
        _require_write(request, business)
        settings = get_payroll_settings(business)
        serializer = PayrollSettingsSerializer(settings, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class PayrollPeriodViewSet(viewsets.ModelViewSet):
    serializer_class = PayrollPeriodSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        business = _require_business(self.request)
        return business.payroll_periods.prefetch_related('payslips').all()

    def perform_create(self, serializer):
        business = _require_business(self.request)
        _require_write(self.request, business)
        serializer.save(business=business, created_by=self.request.user)

    def perform_destroy(self, instance):
        _require_write(self.request, instance.business)
        if instance.status == 'finalized':
            raise ValidationError('دورهٔ نهایی‌شده حذف نمی‌شود؛ ابتدا آن را به پیش‌نویس برگردانید.')
        instance.delete()

    @action(detail=True, methods=['post'], url_path='generate')
    def generate(self, request, pk=None):
        period = self.get_object()
        _require_write(request, period.business)
        if period.status == 'finalized':
            raise ValidationError('دوره نهایی شده است.')
        return Response(generate_payslips(period, user=request.user))

    @action(detail=True, methods=['post'], url_path='finalize')
    def finalize(self, request, pk=None):
        period = self.get_object()
        _require_write(request, period.business)
        try:
            finalize_period(period, user=request.user)
        except ValueError as exc:
            raise ValidationError(str(exc))
        return Response(self.get_serializer(period).data)

    @action(detail=True, methods=['post'], url_path='unfinalize')
    def unfinalize(self, request, pk=None):
        period = self.get_object()
        _require_write(request, period.business)
        try:
            unfinalize_period(period)
        except ValueError as exc:
            raise ValidationError(str(exc))
        return Response(self.get_serializer(period).data)

    @action(detail=True, methods=['get'], url_path='payslips')
    def payslips(self, request, pk=None):
        period = self.get_object()
        slips = period.payslips.select_related('profile__staff').all()
        return Response(PayslipSerializer(slips, many=True).data)

    def _csv_response(self, filename, header, rows):
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(header)
        writer.writerows(rows)
        response = HttpResponse(
            '\ufeff' + buffer.getvalue(), content_type='text/csv; charset=utf-8',
        )
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response

    @action(detail=True, methods=['get'], url_path='export-bank')
    def export_bank(self, request, pk=None):
        """لیست بانک: نام، شبا، خالص پرداختی."""
        period = self.get_object()
        rows = [
            [slip.profile.staff.name, slip.profile.bank_iban, int(slip.net)]
            for slip in period.payslips.select_related('profile__staff')
        ]
        return self._csv_response(
            f'bank-{period.year}-{period.month:02d}.csv',
            ['نام', 'شماره شبا', 'خالص پرداختی'], rows,
        )

    @action(detail=True, methods=['get'], url_path='export-insurance')
    def export_insurance(self, request, pk=None):
        """لیست بیمه: مشخصات و مبالغ سهم کارمند و کارفرما."""
        period = self.get_object()
        rows = [
            [
                slip.profile.staff.name, slip.profile.national_id,
                slip.profile.insurance_number, int(slip.insurance_base),
                int(slip.insurance_employee), int(slip.insurance_employer),
                int(slip.insurance_employee + slip.insurance_employer),
            ]
            for slip in period.payslips.select_related('profile__staff')
            if slip.profile.is_insured
        ]
        return self._csv_response(
            f'insurance-{period.year}-{period.month:02d}.csv',
            ['نام', 'کد ملی', 'شماره بیمه', 'مبنای بیمه', 'سهم کارمند', 'سهم کارفرما', 'جمع بیمه'],
            rows,
        )


class PayslipViewSet(viewsets.ModelViewSet):
    """Payslip reads + input edits (days/overtime/extras) with recompute."""

    serializer_class = PayslipSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'patch', 'head', 'options']

    def get_queryset(self):
        business = _require_business(self.request)
        return Payslip.objects.filter(period__business=business).select_related(
            'profile__staff', 'period',
        )

    def partial_update(self, request, *args, **kwargs):
        payslip = self.get_object()
        _require_write(request, payslip.period.business)
        if payslip.period.status == 'finalized':
            raise ValidationError('دوره نهایی شده است؛ فیش قابل ویرایش نیست.')
        serializer = self.get_serializer(payslip, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        recalculate_payslip(payslip)
        return Response(self.get_serializer(payslip).data)
