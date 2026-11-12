from django.contrib import admin
from .models import (
    Customer, Service, Invoice, InvoiceItem, Document,
    BusinessProfile, ExpenseCategory, Expense, Staff, VehicleType
)


@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ['name', 'phone', 'email', 'national_id', 'total_invoices', 'total_paid', 'created_at']
    list_filter = ['created_at']
    search_fields = ['name', 'phone', 'email', 'national_id']
    ordering = ['-created_at']


@admin.register(Service)
class ServiceAdmin(admin.ModelAdmin):
    list_display = ['title', 'default_main_price', 'default_extra_price', 'default_commission', 'is_active']
    list_filter = ['is_active']
    search_fields = ['title']


class InvoiceItemInline(admin.TabularInline):
    model = InvoiceItem
    extra = 1
    fields = ['service', 'service_title_snapshot', 'quantity', 'main_price', 'extra_price', 'commission', 'staff', 'notes']


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = ['invoice_number', 'customer', 'total_amount', 'commission_total', 'status', 'paper_size', 'vehicle_plate', 'date']
    list_filter = ['status', 'paper_size', 'date']
    search_fields = ['invoice_number', 'customer__name', 'vehicle_plate', 'vehicle_vin']
    inlines = [InvoiceItemInline]
    ordering = ['-date']
    readonly_fields = ['invoice_number', 'created_at', 'updated_at']
    fieldsets = (
        ('اطلاعات پایه', {
            'fields': ('invoice_number', 'customer', 'status', 'date', 'due_date', 'paper_size')
        }),
        ('مبالغ', {
            'fields': ('total_amount', 'commission_total', 'discount', 'tax')
        }),
        ('اطلاعات خودرو', {
            'fields': ('vehicle_plate', 'vehicle_vin', 'vehicle_model', 'vehicle_type', 'vehicle_year'),
            'classes': ('collapse',)
        }),

        ('سایر', {
            'fields': ('description', 'tags', 'custom_fields', 'created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ['title', 'customer', 'uploaded_at']
    list_filter = ['uploaded_at']
    search_fields = ['title', 'customer__name']


@admin.register(BusinessProfile)
class BusinessProfileAdmin(admin.ModelAdmin):
    list_display = ['name', 'phone', 'mobile']
    fieldsets = (
        ('اطلاعات پایه', {
            'fields': ('name', 'subtitle', 'logo', 'tax_id')
        }),
        ('تماس', {
            'fields': ('phone', 'mobile', 'address', 'website')
        }),
        ('شبکه‌های اجتماعی', {
            'fields': ('instagram', 'telegram'),
            'classes': ('collapse',)
        }),
        ('فاکتور', {
            'fields': ('footer_text',),
        }),
    )


@admin.register(ExpenseCategory)
class ExpenseCategoryAdmin(admin.ModelAdmin):
    list_display = ['name', 'icon', 'color']


@admin.register(Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = ['title', 'category', 'amount', 'date']
    list_filter = ['category', 'date']
    search_fields = ['title']
    ordering = ['-date']


@admin.register(Staff)
class StaffAdmin(admin.ModelAdmin):
    list_display = ['name', 'phone', 'specialty', 'commission_rate', 'is_active']
    list_filter = ['is_active']
    search_fields = ['name', 'phone']


@admin.register(VehicleType)
class VehicleTypeAdmin(admin.ModelAdmin):
    list_display = ['name']
    search_fields = ['name']

