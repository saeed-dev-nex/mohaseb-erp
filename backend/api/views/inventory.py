"""Inventory & purchasing endpoints (ERP phase 2).

Products, warehouses and purchases are scoped to the caller's current
business like the accounting endpoints. Posting a purchase (or the
auto-posting of a sales invoice) is what moves stock and writes the
auto-journals; drafts move nothing.
"""

from decimal import Decimal

from django.db import transaction
from django.db.models import Case, DecimalField, F, Max, ProtectedError, Sum, When
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import (
    InventorySettings, Product, PurchaseInvoice, StockCount, StockCountLine,
    StockMovement, StockTransfer, Warehouse,
)
from .common import HasBusinessModuleAccess
from ..serializers import (
    InventorySettingsSerializer, ProductSerializer, PurchaseInvoiceSerializer,
    StockCountSerializer, StockMovementSerializer, StockTransferSerializer,
    WarehouseSerializer,
)
from ..services.accounting import retry_on_number_conflict
from ..services.inventory import (
    apply_stock_count, ensure_stock_available, get_default_warehouse,
    get_inventory_settings, post_purchase, post_transfer, unpost_purchase,
    unpost_transfer, warehouse_stock,
)
from .accounting import _require_business, _require_write

IN_KINDS = ('in_purchase', 'in_return', 'in_adjust', 'in_transfer')


class WarehouseViewSet(viewsets.ModelViewSet):
    serializer_class = WarehouseSerializer
    permission_classes = [IsAuthenticated, HasBusinessModuleAccess]
    module_name = 'inventory'
    pagination_class = None

    def get_queryset(self):
        return _require_business(self.request).warehouses.all()

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
        try:
            instance.delete()
        except ProtectedError:
            raise ValidationError('این انبار دارای گردش است و حذف نمی‌شود.')


class ProductViewSet(viewsets.ModelViewSet):
    serializer_class = ProductSerializer
    permission_classes = [IsAuthenticated, HasBusinessModuleAccess]
    module_name = 'inventory'
    pagination_class = None

    def get_queryset(self):
        business = _require_business(self.request)
        return business.products.annotate(
            stock_qty=Sum(
                Case(
                    When(movements__kind__in=IN_KINDS, then=F('movements__quantity')),
                    default=-F('movements__quantity'),
                    output_field=DecimalField(max_digits=14, decimal_places=3),
                )
            )
        )

    def perform_create(self, serializer):
        business = _require_business(self.request)
        _require_write(self.request, business)
        if (serializer.validated_data.get('code') or '').strip():
            serializer.save(business=business)
            return
        # Auto code: the next sequential numeric code of this business
        # (seeded catalogs start at 1001). Retried on the unique
        # constraint in case two operators create products at once.
        from django.db import IntegrityError

        numeric_codes = [
            int(code)
            for code in business.products.values_list('code', flat=True)
            if (code or '').isdigit()
        ]
        next_code = (max(numeric_codes) + 1) if numeric_codes else 1001
        for attempt in range(5):
            try:
                serializer.save(business=business, code=str(next_code + attempt))
                return
            except IntegrityError:
                continue
        raise ValidationError({'code': 'ساخت کد خودکار ناموفق بود؛ یک کد دستی وارد کنید.'})

    def perform_update(self, serializer):
        business = _require_business(self.request)
        _require_write(self.request, business)
        serializer.save()

    def perform_destroy(self, instance):
        business = _require_business(self.request)
        _require_write(self.request, business)
        if instance.movements.exists():
            raise ValidationError('این کالا گردش انبار دارد و حذف نمی‌شود؛ آن را غیرفعال کنید.')
        instance.delete()


class PurchaseInvoiceViewSet(viewsets.ModelViewSet):
    serializer_class = PurchaseInvoiceSerializer
    permission_classes = [IsAuthenticated, HasBusinessModuleAccess]
    module_name = 'inventory'

    def get_queryset(self):
        business = _require_business(self.request)
        return (
            business.purchase_invoices
            .select_related('supplier', 'fiscal_year', 'journal_entry')
            .prefetch_related('lines__product')
        )

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        business = _require_business(request)
        _require_write(request, business)
        from .accounting import _resolve_fiscal_year

        fiscal_year = _resolve_fiscal_year(business, request.data.get('fiscal_year'))
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        supplier = serializer.validated_data.get('supplier')
        if supplier is not None and supplier.business_id not in (None, business.id):
            raise ValidationError({'supplier': 'تأمین‌کننده متعلق به این کسب‌وکار نیست.'})
        warehouse = serializer.validated_data.get('warehouse')
        if warehouse is not None and warehouse.business_id != business.id:
            raise ValidationError({'warehouse': 'انبار متعلق به این کسب‌وکار نیست.'})
        for line in serializer.validated_data.get('lines') or []:
            product = line.get('product')
            if product is not None and product.business_id != business.id:
                raise ValidationError({'lines': 'کالای انتخاب‌شده متعلق به این کسب‌وکار نیست.'})

        def _save():
            last = (
                PurchaseInvoice.objects.filter(business=business, fiscal_year=fiscal_year)
                .aggregate(value=Max('number'))['value'] or 0
            )
            return serializer.save(
                business=business, fiscal_year=fiscal_year,
                number=last + 1, created_by=request.user,
            )

        purchase = retry_on_number_conflict(_save)
        return Response(
            self.get_serializer(purchase).data, status=status.HTTP_201_CREATED,
        )

    def _validate_relations(self, business, data):
        """Create validates relations from validated data; the update
        path falls through to the serializer, so re-check the raw ids
        here as well (supplier + every line's product)."""
        from ..models import Customer, Product

        supplier_id = data.get('supplier')
        if supplier_id:
            supplier = Customer.objects.filter(id=supplier_id).first()
            if supplier is not None and supplier.business_id not in (None, business.id):
                raise ValidationError({'supplier': 'تأمین‌کننده متعلق به این کسب‌وکار نیست.'})
        warehouse_id = data.get('warehouse')
        if warehouse_id:
            from ..models import Warehouse

            warehouse = Warehouse.objects.filter(id=warehouse_id).first()
            if warehouse is not None and warehouse.business_id != business.id:
                raise ValidationError({'warehouse': 'انبار متعلق به این کسب‌وکار نیست.'})
        for line in data.get('lines') or []:
            product_id = line.get('product') if isinstance(line, dict) else None
            if product_id:
                product = Product.objects.filter(id=product_id).first()
                if product is not None and product.business_id != business.id:
                    raise ValidationError({'lines': 'کالای انتخاب‌شده متعلق به این کسب‌وکار نیست.'})

    def update(self, request, *args, **kwargs):
        purchase = self.get_object()
        _require_write(request, purchase.business)
        if purchase.status == 'posted':
            raise ValidationError('فاکتور خرید ثبت‌شده قابل ویرایش نیست؛ ابتدا آن را به پیش‌نویس برگردانید.')
        self._validate_relations(purchase.business, request.data)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        purchase = self.get_object()
        _require_write(request, purchase.business)
        if purchase.status == 'posted':
            raise ValidationError('فاکتور خرید ثبت‌شده حذف نمی‌شود؛ ابتدا آن را به پیش‌نویس برگردانید.')
        purchase.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='post')
    def post_entry(self, request, pk=None):
        purchase = self.get_object()
        _require_write(request, purchase.business)
        try:
            post_purchase(purchase, user=request.user)
        except ValueError as exc:
            raise ValidationError(str(exc))
        # Re-fetch so nested lines show the landed costs written while
        # posting (the get_object() prefetch cache predates them).
        purchase = self.get_queryset().get(id=purchase.id)
        return Response(self.get_serializer(purchase).data)

    @action(detail=True, methods=['post'], url_path='unpost')
    def unpost_entry(self, request, pk=None):
        purchase = self.get_object()
        _require_write(request, purchase.business)
        try:
            unpost_purchase(purchase)
        except ValueError as exc:
            raise ValidationError(str(exc))
        purchase = self.get_queryset().get(id=purchase.id)
        return Response(self.get_serializer(purchase).data)


class KardexView(APIView):
    """GET /api/inventory/kardex/?product=<id> — کاردکس کالا."""

    permission_classes = [IsAuthenticated, HasBusinessModuleAccess]

    module_name = 'inventory'

    def get(self, request):
        business = _require_business(request)
        product_id = request.query_params.get('product')
        product = business.products.filter(id=product_id).first() if product_id else None
        if product is None:
            raise ValidationError({'product': 'کالا را مشخص کنید.'})
        movements = product.movements.select_related('warehouse').all()
        warehouse_id = request.query_params.get('warehouse')
        if warehouse_id:
            movements = movements.filter(warehouse_id=warehouse_id)
        rows = []
        running = Decimal(0)
        running_value = Decimal(0)
        for movement in movements:
            running += movement.signed_quantity
            running_value += movement.signed_quantity * movement.unit_cost
            row = StockMovementSerializer(movement).data
            row['balance'] = running
            row['balance_value'] = running_value
            rows.append(row)
        return Response({
            'product': ProductSerializer(product).data,
            'rows': rows,
            'current_stock': running,
            'stock_value': running_value,
        })


class StockAdjustView(APIView):
    """POST /api/inventory/adjust/ — گردش اصلاحی دستی (ورود/خروج)."""

    permission_classes = [IsAuthenticated, HasBusinessModuleAccess]

    module_name = 'inventory'

    def post(self, request):
        business = _require_business(request)
        _require_write(request, business)
        from ..services.inventory import get_default_warehouse

        product = business.products.filter(id=request.data.get('product')).first()
        if product is None:
            raise ValidationError({'product': 'کالا یافت نشد.'})
        kind = request.data.get('kind')
        if kind not in ('in_adjust', 'out_adjust'):
            raise ValidationError({'kind': 'نوع گردش اصلاحی نامعتبر است.'})
        try:
            quantity = Decimal(str(request.data.get('quantity')))
        except Exception:
            raise ValidationError({'quantity': 'مقدار نامعتبر است.'})
        if quantity <= 0:
            raise ValidationError({'quantity': 'مقدار باید بزرگ‌تر از صفر باشد.'})
        from django.utils import timezone

        warehouse = get_default_warehouse(business)
        if kind == 'out_adjust':
            try:
                ensure_stock_available(business, product, warehouse, quantity)
            except ValueError as exc:
                raise ValidationError(str(exc))
        movement = StockMovement.objects.create(
            business=business, product=product,
            warehouse=warehouse, kind=kind,
            quantity=quantity, unit_cost=product.average_cost,
            source_type='adjust', date=timezone.localdate(),
            note=request.data.get('note', '') or 'گردش اصلاحی',
            created_by=request.user,
        )
        return Response(StockMovementSerializer(movement).data, status=status.HTTP_201_CREATED)


class StockTransferViewSet(viewsets.ModelViewSet):
    """حواله‌های انتقال بین انبارها."""

    serializer_class = StockTransferSerializer
    permission_classes = [IsAuthenticated, HasBusinessModuleAccess]
    module_name = 'inventory'
    pagination_class = None

    def get_queryset(self):
        business = _require_business(self.request)
        return (
            business.stock_transfers
            .select_related('from_warehouse', 'to_warehouse', 'fiscal_year')
            .prefetch_related('lines__product')
        )

    def _validate_relations(self, business, data, partial=False):
        for key in ('from_warehouse', 'to_warehouse'):
            warehouse_id = data.get(key)
            if warehouse_id:
                warehouse = Warehouse.objects.filter(id=warehouse_id).first()
                if warehouse is not None and warehouse.business_id != business.id:
                    raise ValidationError({key: 'انبار متعلق به این کسب‌وکار نیست.'})
        for line in data.get('lines') or []:
            product_id = line.get('product') if isinstance(line, dict) else None
            if product_id:
                product = Product.objects.filter(id=product_id).first()
                if product is not None and product.business_id != business.id:
                    raise ValidationError({'lines': 'کالای انتخاب‌شده متعلق به این کسب‌وکار نیست.'})

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        business = _require_business(request)
        _require_write(request, business)
        from .accounting import _resolve_fiscal_year

        fiscal_year = _resolve_fiscal_year(business, request.data.get('fiscal_year'))
        self._validate_relations(business, request.data)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if serializer.validated_data['from_warehouse'].id == serializer.validated_data['to_warehouse'].id:
            raise ValidationError('انبار مبدأ و مقصد نمی‌توانند یکی باشند.')

        def _save():
            last = (
                StockTransfer.objects.filter(business=business, fiscal_year=fiscal_year)
                .aggregate(value=Max('number'))['value'] or 0
            )
            return serializer.save(
                business=business, fiscal_year=fiscal_year,
                number=last + 1, created_by=request.user,
            )

        transfer = retry_on_number_conflict(_save)
        return Response(
            self.get_serializer(transfer).data, status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        transfer = self.get_object()
        _require_write(request, transfer.business)
        if transfer.status == 'posted':
            raise ValidationError('حوالهٔ ثبت‌شده قابل ویرایش نیست؛ ابتدا آن را به پیش‌نویس برگردانید.')
        self._validate_relations(transfer.business, request.data)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        transfer = self.get_object()
        _require_write(request, transfer.business)
        if transfer.status == 'posted':
            raise ValidationError('حوالهٔ ثبت‌شده حذف نمی‌شود؛ ابتدا آن را به پیش‌نویس برگردانید.')
        transfer.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='post')
    def post_entry(self, request, pk=None):
        transfer = self.get_object()
        _require_write(request, transfer.business)
        try:
            post_transfer(transfer, user=request.user)
        except ValueError as exc:
            raise ValidationError(str(exc))
        return Response(self.get_serializer(transfer).data)

    @action(detail=True, methods=['post'], url_path='unpost')
    def unpost_entry(self, request, pk=None):
        transfer = self.get_object()
        _require_write(request, transfer.business)
        try:
            unpost_transfer(transfer)
        except ValueError as exc:
            raise ValidationError(str(exc))
        return Response(self.get_serializer(transfer).data)


class StockCountViewSet(viewsets.ModelViewSet):
    """انبارگردانی — ساخت برگهٔ شمارش با عکس موجودی سیستم، ثبت شمارش
    فیزیکی و اعمال خودکار مغایرت‌ها به‌صورت گردش اصلاحی."""

    serializer_class = StockCountSerializer
    permission_classes = [IsAuthenticated, HasBusinessModuleAccess]
    module_name = 'inventory'
    pagination_class = None

    def get_queryset(self):
        business = _require_business(self.request)
        return (
            business.stock_counts
            .select_related('warehouse', 'fiscal_year')
            .prefetch_related('lines__product')
        )

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        business = _require_business(request)
        _require_write(request, business)
        from .accounting import _resolve_fiscal_year

        fiscal_year = _resolve_fiscal_year(business, request.data.get('fiscal_year'))
        warehouse = business.warehouses.filter(id=request.data.get('warehouse')).first()
        if warehouse is None:
            warehouse = get_default_warehouse(business)
        data = request.data.copy()
        data['warehouse'] = warehouse.id
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)

        def _save():
            last = (
                StockCount.objects.filter(business=business, fiscal_year=fiscal_year)
                .aggregate(value=Max('number'))['value'] or 0
            )
            return serializer.save(
                business=business, fiscal_year=fiscal_year,
                number=last + 1, warehouse=warehouse, created_by=request.user,
            )

        count = retry_on_number_conflict(_save)
        # Snapshot the warehouse's system stock for every active product.
        StockCountLine.objects.bulk_create([
            StockCountLine(
                count=count, product=product,
                system_qty=warehouse_stock(product, warehouse),
            )
            for product in business.products.filter(is_active=True)
        ])
        return Response(
            self.get_serializer(count).data, status=status.HTTP_201_CREATED,
        )

    def destroy(self, request, *args, **kwargs):
        count = self.get_object()
        _require_write(request, count.business)
        if count.status == 'applied':
            raise ValidationError('انبارگردانی اعمال‌شده حذف نمی‌شود.')
        count.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['put'], url_path='lines')
    def save_lines(self, request, pk=None):
        """ثبت مقادیر شمارش‌شده: [{id, counted_qty}, …]"""
        count = self.get_object()
        _require_write(request, count.business)
        if count.status == 'applied':
            raise ValidationError('انبارگردانی اعمال‌شده قابل ویرایش نیست.')
        updates = request.data.get('lines') or []
        by_id = {line.id: line for line in count.lines.all()}
        for item in updates:
            line = by_id.get(item.get('id'))
            if line is None:
                continue
            raw = item.get('counted_qty')
            if raw is None or raw == '':
                line.counted_qty = None
            else:
                try:
                    value = Decimal(str(raw))
                except Exception:
                    raise ValidationError('مقدار شمارش‌شده نامعتبر است.')
                if value < 0:
                    raise ValidationError('مقدار شمارش‌شده نمی‌تواند منفی باشد.')
                line.counted_qty = value
            line.save(update_fields=['counted_qty'])
        return Response(self.get_serializer(count).data)

    @action(detail=True, methods=['post'], url_path='apply')
    def apply_entry(self, request, pk=None):
        count = self.get_object()
        _require_write(request, count.business)
        try:
            adjusted = apply_stock_count(count, user=request.user)
        except ValueError as exc:
            raise ValidationError(str(exc))
        data = self.get_serializer(count).data
        data['adjusted_lines'] = adjusted
        return Response(data)


class InventorySettingsView(APIView):
    """GET/PUT /api/inventory/settings/ — تنظیمات انبار کسب‌وکار."""

    permission_classes = [IsAuthenticated, HasBusinessModuleAccess]

    module_name = 'inventory'

    def get(self, request):
        business = _require_business(request)
        return Response(
            InventorySettingsSerializer(get_inventory_settings(business)).data
        )

    def put(self, request):
        business = _require_business(request)
        _require_write(request, business)
        settings_obj = get_inventory_settings(business)
        serializer = InventorySettingsSerializer(
            settings_obj, data=request.data, partial=True,
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class InventoryAlertsView(APIView):
    """GET /api/inventory/alerts/ — هشدارهای انبار و پیشنهاد خرید.

    - low_stock: کالاهایی که موجودی‌شان به نقطهٔ سفارش رسیده یا از آن
      کمتر است، همراه با مقدار پیشنهادی خرید.
    - expiring: بچ‌هایی که تاریخ انقضایشان گذشته یا در ۳۰ روز آینده
      است (بر اساس گردش‌های ورود).
    - dead_stock: کالاهای دارای موجودی بدون هیچ فروش در ۹۰ روز گذشته.
    """

    permission_classes = [IsAuthenticated, HasBusinessModuleAccess]
    module_name = 'inventory'

    def get(self, request):
        from datetime import timedelta

        from django.utils import timezone

        business = _require_business(request)
        today = timezone.localdate()
        products = list(business.products.filter(is_active=True))
        stocks = {}
        for product in products:
            stocks[product.id] = sum(
                (m.signed_quantity for m in product.movements.all()), Decimal(0),
            )

        low_stock = []
        for product in products:
            current = stocks[product.id]
            if product.reorder_point > 0 and current <= product.reorder_point:
                target = max(product.max_stock, product.reorder_point)
                low_stock.append({
                    'product': product.id,
                    'code': product.code,
                    'name': product.name,
                    'unit': product.unit,
                    'current_stock': current,
                    'reorder_point': product.reorder_point,
                    'min_stock': product.min_stock,
                    'max_stock': product.max_stock,
                    'suggested_qty': max(Decimal(0), target - current),
                })

        expiring = []
        horizon = today + timedelta(days=30)
        batches = (
            business.stock_movements
            .filter(kind__in=('in_purchase', 'in_return'), expiry_date__isnull=False)
            .values('product_id', 'product__code', 'product__name', 'batch_no', 'expiry_date')
            .annotate(total_in=Sum('quantity'))
        )
        for batch in batches:
            if batch['expiry_date'] <= horizon:
                expiring.append({
                    'product': batch['product_id'],
                    'code': batch['product__code'],
                    'name': batch['product__name'],
                    'batch_no': batch['batch_no'],
                    'expiry_date': batch['expiry_date'],
                    'quantity_in': batch['total_in'],
                    'expired': batch['expiry_date'] < today,
                })
        expiring.sort(key=lambda row: row['expiry_date'])

        cutoff = today - timedelta(days=90)
        dead_stock = []
        for product in products:
            current = stocks[product.id]
            if current <= 0:
                continue
            has_recent_sale = product.movements.filter(
                kind='out_sale', date__gte=cutoff,
            ).exists()
            if not has_recent_sale:
                dead_stock.append({
                    'product': product.id,
                    'code': product.code,
                    'name': product.name,
                    'unit': product.unit,
                    'current_stock': current,
                    'stock_value': current * product.average_cost,
                })

        return Response({
            'low_stock': low_stock,
            'expiring': expiring,
            'dead_stock': dead_stock,
        })
