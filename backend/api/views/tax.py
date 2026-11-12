"""Tax & fixed-asset endpoints (ERP phase 4).

Reports are computed per Jalali quarter from the business's invoices
and posted purchases. The مؤدیان queue tracks submissions manually
until a live provider is chosen. Depreciation runs book one month of
straight-line depreciation per run with an auto-journal.
"""

import csv
import io
import uuid

from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import DepreciationRun, FixedAsset, MoadianSubmission
from ..serializers import (
    DepreciationRunSerializer, FixedAssetSerializer,
    MoadianSubmissionSerializer, TaxSettingsSerializer,
)
from ..services.tax import (
    delete_depreciation_run, get_tax_settings, run_depreciation,
    seasonal_report, vat_report,
)
from .accounting import _require_business, _require_write


def _quarter_params(request):
    try:
        year = int(request.query_params.get('year', 0))
        season = int(request.query_params.get('season', 0))
    except (TypeError, ValueError):
        year, season = 0, 0
    if year <= 0 or season not in (1, 2, 3, 4):
        raise ValidationError('پارامترهای year و season (۱ تا ۴) لازم‌اند.')
    return year, season


class TaxSettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        business = _require_business(request)
        return Response(TaxSettingsSerializer(get_tax_settings(business)).data)

    def patch(self, request):
        business = _require_business(request)
        _require_write(request, business)
        settings = get_tax_settings(business)
        serializer = TaxSettingsSerializer(settings, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class VatReportView(APIView):
    """GET /api/tax/vat-report/?year=1405&season=1"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        business = _require_business(request)
        year, season = _quarter_params(request)
        return Response(vat_report(business, year, season))


class SeasonalReportView(APIView):
    """GET /api/tax/seasonal/?year=&season= (+ ?export=csv)"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        business = _require_business(request)
        year, season = _quarter_params(request)
        rows = seasonal_report(business, year, season)
        if request.query_params.get('export') == 'csv':
            buffer = io.StringIO()
            writer = csv.writer(buffer)
            writer.writerow(['طرف حساب', 'شناسه ملی', 'نوع', 'تعداد', 'مبلغ معامله', 'مالیات بر ارزش افزوده'])
            for row in rows:
                writer.writerow([
                    row['party_name'], row['national_id'],
                    'فروش' if row['side'] == 'sale' else 'خرید',
                    row['count'], int(row['amount']), int(row['vat']),
                ])
            response = HttpResponse(
                '\ufeff' + buffer.getvalue(), content_type='text/csv; charset=utf-8',
            )
            response['Content-Disposition'] = f'attachment; filename="seasonal-{year}-s{season}.csv"'
            return response
        return Response({'year': year, 'season': season, 'rows': rows})


class MoadianSubmissionViewSet(viewsets.ModelViewSet):
    serializer_class = MoadianSubmissionSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def get_queryset(self):
        business = _require_business(self.request)
        return business.moadian_submissions.select_related('invoice__customer').all()

    @action(detail=False, methods=['post'], url_path='queue')
    def queue(self, request):
        """Add a sales invoice to the مؤدیان submission queue."""
        business = _require_business(request)
        _require_write(request, business)
        invoice = business.business_invoices.filter(id=request.data.get('invoice')).first()
        if invoice is None:
            raise ValidationError({'invoice': 'فاکتور یافت نشد.'})
        existing = business.moadian_submissions.filter(
            invoice=invoice, status='queued',
        ).first()
        if existing is not None:
            return Response(self.get_serializer(existing).data)
        submission = MoadianSubmission.objects.create(
            business=business, invoice=invoice,
            unique_id=uuid.uuid4().hex[:22].upper(),
        )
        return Response(
            self.get_serializer(submission).data, status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['post'], url_path='mark-sent')
    def mark_sent(self, request, pk=None):
        submission = self.get_object()
        _require_write(request, submission.business)
        submission.status = 'sent'
        submission.submitted_at = timezone.now()
        if request.data.get('unique_id'):
            submission.unique_id = request.data['unique_id']
        if request.data.get('note'):
            submission.note = request.data['note']
        submission.save()
        return Response(self.get_serializer(submission).data)

    @action(detail=True, methods=['post'], url_path='mark-failed')
    def mark_failed(self, request, pk=None):
        submission = self.get_object()
        _require_write(request, submission.business)
        submission.status = 'failed'
        if request.data.get('note'):
            submission.note = request.data['note']
        submission.save()
        return Response(self.get_serializer(submission).data)


class FixedAssetViewSet(viewsets.ModelViewSet):
    serializer_class = FixedAssetSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        return _require_business(self.request).fixed_assets.all()

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
        if instance.depreciation_lines.exists():
            raise ValidationError('این دارایی استهلاک ثبت‌شده دارد و حذف نمی‌شود؛ آن را غیرفعال کنید.')
        instance.delete()


class DepreciationRunViewSet(viewsets.ModelViewSet):
    serializer_class = DepreciationRunSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def get_queryset(self):
        business = _require_business(self.request)
        return business.depreciation_runs.prefetch_related('lines__asset').all()

    def create(self, request, *args, **kwargs):
        business = _require_business(request)
        _require_write(request, business)
        try:
            year = int(request.data.get('year'))
            month = int(request.data.get('month'))
        except (TypeError, ValueError):
            raise ValidationError('سال و ماه شمسی لازم‌اند.')
        try:
            run = run_depreciation(business, year, month, user=request.user)
        except ValueError as exc:
            raise ValidationError(str(exc))
        return Response(
            self.get_serializer(run).data, status=status.HTTP_201_CREATED,
        )

    def destroy(self, request, *args, **kwargs):
        run = self.get_object()
        _require_write(request, run.business)
        delete_depreciation_run(run)
        return Response(status=status.HTTP_204_NO_CONTENT)
