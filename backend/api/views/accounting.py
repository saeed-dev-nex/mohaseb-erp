"""Accounting endpoints (ERP phase 1): chart, journal, reports.

Every accounting request is scoped to the caller's current business
(the X-Business-Id header, membership-validated); without one the
endpoints answer 400, because accounting data has no meaning outside
a business and its fiscal year. Writes need an owner/manager
membership (the superuser counts as owner everywhere). Posted
entries are immutable: edit or delete requires unposting first.
"""

from django.db import transaction
from django.db.models import Max
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from ..business_context import resolve_business
from ..models import Account, FiscalYear, JournalEntry
from ..serializers import AccountSerializer, JournalEntrySerializer
from ..services.accounting import account_ledger, seed_standard_chart, trial_balance

WRITE_ROLES = ('owner', 'manager')


def _require_business(request):
    business = resolve_business(request)
    if business is None:
        raise ValidationError({'detail': 'کسب‌وکار جاری مشخص نیست؛ ابتدا از نوبار یک کسب‌وکار انتخاب کنید.'})
    return business


def _require_write(request, business):
    user = request.user
    if user.is_superuser:
        return
    membership = business.memberships.filter(user=user).first()
    if membership is None or membership.role not in WRITE_ROLES:
        raise PermissionDenied('برای ثبت و ویرایش اسناد حسابداری باید مدیر یا مالک کسب‌وکار باشید.')


def _resolve_fiscal_year(business, raw_id):
    if raw_id:
        year = business.fiscal_years.filter(id=raw_id).first()
        if year is None:
            raise ValidationError({'fiscal_year': 'سال مالی یافت نشد.'})
        return year
    year = business.current_fiscal_year
    if year is None:
        raise ValidationError({'fiscal_year': 'برای این کسب‌وکار سال مالی جاری تعریف نشده است.'})
    return year


class AccountViewSet(viewsets.ModelViewSet):
    serializer_class = AccountSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        business = _require_business(self.request)
        return business.accounts.select_related('parent').all()

    def perform_create(self, serializer):
        business = _require_business(self.request)
        _require_write(self.request, business)
        parent = serializer.validated_data.get('parent')
        if parent is not None and parent.business_id != business.id:
            raise ValidationError({'parent': 'حساب والد متعلق به این کسب‌وکار نیست.'})
        level = (parent.level + 1) if parent is not None else 1
        serializer.save(business=business, level=level)

    def perform_update(self, serializer):
        business = _require_business(self.request)
        _require_write(self.request, business)
        serializer.save()

    def perform_destroy(self, instance):
        business = _require_business(self.request)
        _require_write(self.request, business)
        if instance.children.exists():
            raise ValidationError('این حساب زیرحساب دارد و حذف نمی‌شود.')
        if instance.journal_lines.exists():
            raise ValidationError('این حساب در اسناد استفاده شده و حذف نمی‌شود.')
        instance.delete()


class JournalEntryViewSet(viewsets.ModelViewSet):
    serializer_class = JournalEntrySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        business = _require_business(self.request)
        qs = (
            business.journal_entries
            .select_related('fiscal_year', 'created_by')
            .prefetch_related('lines__account', 'lines__party')
        )
        fiscal_year = self.request.query_params.get('fiscal_year')
        if fiscal_year:
            qs = qs.filter(fiscal_year_id=fiscal_year)
        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs

    def _check_date_in_year(self, date_value, fiscal_year):
        if date_value and not (fiscal_year.start_date <= date_value <= fiscal_year.end_date):
            raise ValidationError({'date': 'تاریخ سند باید داخل بازهٔ سال مالی انتخاب‌شده باشد.'})

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        business = _require_business(request)
        _require_write(request, business)
        fiscal_year = _resolve_fiscal_year(business, request.data.get('fiscal_year'))
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self._check_date_in_year(serializer.validated_data.get('date'), fiscal_year)
        last = (
            JournalEntry.objects.filter(business=business, fiscal_year=fiscal_year)
            .aggregate(value=Max('number'))['value'] or 0
        )
        entry = serializer.save(
            business=business, fiscal_year=fiscal_year,
            number=last + 1, created_by=request.user,
        )
        return Response(
            self.get_serializer(entry).data, status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        entry = self.get_object()
        _require_write(request, entry.business)
        if entry.status == 'posted':
            raise ValidationError('سند ثبت‌شده قابل ویرایش نیست؛ ابتدا آن را به پیش‌نویس برگردانید.')
        fiscal_year = _resolve_fiscal_year(
            entry.business, request.data.get('fiscal_year', entry.fiscal_year_id),
        )
        serializer = self.get_serializer(entry, data=request.data, partial=kwargs.get('partial', False))
        serializer.is_valid(raise_exception=True)
        self._check_date_in_year(
            serializer.validated_data.get('date', entry.date), fiscal_year,
        )
        serializer.save(fiscal_year=fiscal_year)
        return Response(serializer.data)

    def partial_update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        entry = self.get_object()
        _require_write(request, entry.business)
        if entry.status == 'posted':
            raise ValidationError('سند ثبت‌شده حذف نمی‌شود؛ ابتدا آن را به پیش‌نویس برگردانید.')
        entry.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='post')
    def post_entry(self, request, pk=None):
        from django.utils import timezone

        entry = self.get_object()
        _require_write(request, entry.business)
        if entry.status == 'posted':
            raise ValidationError('این سند قبلاً ثبت شده است.')
        if entry.lines.count() < 2:
            raise ValidationError('سند باید دست‌کم دو سطر داشته باشد.')
        if not entry.is_balanced:
            raise ValidationError('جمع بدهکار و بستانکار سند برابر نیست؛ سند ثبت نمی‌شود.')
        entry.status = 'posted'
        entry.posted_at = timezone.now()
        entry.save(update_fields=['status', 'posted_at', 'updated_at'])
        return Response(self.get_serializer(entry).data)

    @action(detail=True, methods=['post'], url_path='unpost')
    def unpost_entry(self, request, pk=None):
        entry = self.get_object()
        _require_write(request, entry.business)
        if entry.status != 'posted':
            raise ValidationError('این سند پیش‌نویس است و ثبت نشده.')
        entry.status = 'draft'
        entry.posted_at = None
        entry.save(update_fields=['status', 'posted_at', 'updated_at'])
        return Response(self.get_serializer(entry).data)


class ChartSeedView(APIView):
    """POST /api/accounting/seed-chart/ — seed the standard chart."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        business = _require_business(request)
        _require_write(request, business)
        return Response(seed_standard_chart(business))


class TrialBalanceView(APIView):
    """GET /api/accounting/trial-balance/?fiscal_year=<id>"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        business = _require_business(request)
        fiscal_year = _resolve_fiscal_year(business, request.query_params.get('fiscal_year'))
        return Response(trial_balance(business, fiscal_year))


class AccountLedgerView(APIView):
    """GET /api/accounting/ledger/?account=<id>&fiscal_year=<id>"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        business = _require_business(request)
        fiscal_year = _resolve_fiscal_year(business, request.query_params.get('fiscal_year'))
        account_id = request.query_params.get('account')
        account = business.accounts.filter(id=account_id).first() if account_id else None
        if account is None:
            raise ValidationError({'account': 'حساب را مشخص کنید.'})
        rows = account_ledger(business, fiscal_year, account)
        return Response({
            'account': AccountSerializer(account).data,
            'fiscal_year': fiscal_year.id,
            'rows': rows,
        })
