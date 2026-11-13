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

from ..models import Product, PurchaseInvoice, StockMovement, Warehouse
from ..serializers import (
    ProductSerializer, PurchaseInvoiceSerializer, StockMovementSerializer,
    WarehouseSerializer,
)
from ..services.accounting import retry_on_number_conflict
from ..services.inventory import post_purchase, unpost_purchase
from .accounting import _require_business, _require_write

IN_KINDS = ('in_purchase', 'in_return', 'in_adjust')


class WarehouseViewSet(viewsets.ModelViewSet):
    serializer_class = WarehouseSerializer
    permission_classes = [IsAuthenticated]
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
    permission_classes = [IsAuthenticated]
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
        serializer.save(business=business)

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
    permission_classes = [IsAuthenticated]

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
        return Response(self.get_serializer(purchase).data)

    @action(detail=True, methods=['post'], url_path='unpost')
    def unpost_entry(self, request, pk=None):
        purchase = self.get_object()
        _require_write(request, purchase.business)
        try:
            unpost_purchase(purchase)
        except ValueError as exc:
            raise ValidationError(str(exc))
        return Response(self.get_serializer(purchase).data)


class KardexView(APIView):
    """GET /api/inventory/kardex/?product=<id> — کاردکس کالا."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        business = _require_business(request)
        product_id = request.query_params.get('product')
        product = business.products.filter(id=product_id).first() if product_id else None
        if product is None:
            raise ValidationError({'product': 'کالا را مشخص کنید.'})
        movements = product.movements.select_related('warehouse').all()
        rows = []
        running = Decimal(0)
        for movement in movements:
            running += movement.signed_quantity
            row = StockMovementSerializer(movement).data
            row['balance'] = running
            rows.append(row)
        return Response({
            'product': ProductSerializer(product).data,
            'rows': rows,
            'current_stock': running,
        })


class StockAdjustView(APIView):
    """POST /api/inventory/adjust/ — گردش اصلاحی دستی (ورود/خروج)."""

    permission_classes = [IsAuthenticated]

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

        movement = StockMovement.objects.create(
            business=business, product=product,
            warehouse=get_default_warehouse(business), kind=kind,
            quantity=quantity, unit_cost=product.average_cost,
            source_type='adjust', date=timezone.localdate(),
            note=request.data.get('note', '') or 'گردش اصلاحی',
            created_by=request.user,
        )
        return Response(StockMovementSerializer(movement).data, status=status.HTTP_201_CREATED)
