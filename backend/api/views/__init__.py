"""API views, split by domain (stage 3).

This package replaces the former single ``api/views.py`` module. Every name
the URL configuration (or older code) imported from ``api.views`` is
re-exported here, so no import paths changed.
"""

from .common import IsManagerOrAdmin, IsSuperuser, database_revision
from .customers import CustomerViewSet
from .catalog import ServicePackageViewSet, ServiceViewSet, VehicleTypeViewSet
from .invoices import InvoiceViewSet
from .documents import DocumentViewSet
from .chat import ChatMessageViewSet
from .finance import ChequeViewSet, ExpenseCategoryViewSet, ExpenseViewSet
from .settings_admin import (
    BusinessProfileViewSet, InvoiceSettingsViewSet, SocialNetworkViewSet, WelcomeSettingsViewSet,
)
from .backup import BackupConfigViewSet, BackupViewSet
from .app_update import AppUpdateViewSet
from .businesses import BusinessTemplateListView, BusinessViewSet
from .inventory import (
    KardexView, ProductViewSet, PurchaseInvoiceViewSet, StockAdjustView,
    WarehouseViewSet,
)
from .payroll import (
    EmploymentProfileViewSet, PayrollPeriodViewSet, PayrollSettingsView,
    PayslipViewSet,
)
from .tax import (
    DepreciationRunViewSet, FixedAssetViewSet, MoadianSubmissionViewSet,
    SeasonalReportView, TaxSettingsView, VatReportView,
)
from .accounting import (
    AccountLedgerView, AccountViewSet, ChartSeedView, JournalEntryViewSet,
    TrialBalanceView,
)
from .database_config import DatabaseConfigViewSet
from .management_views import AuditLogViewSet, DashboardViewSet, StaffViewSet, UserViewSet

__all__ = [
    'IsManagerOrAdmin', 'IsSuperuser', 'database_revision',
    'CustomerViewSet', 'ServiceViewSet', 'VehicleTypeViewSet', 'InvoiceViewSet',
    'DocumentViewSet', 'ChatMessageViewSet', 'ChequeViewSet', 'ExpenseCategoryViewSet',
    'ExpenseViewSet', 'BusinessProfileViewSet', 'InvoiceSettingsViewSet',
    'SocialNetworkViewSet', 'WelcomeSettingsViewSet', 'BackupConfigViewSet',
    'BackupViewSet', 'DatabaseConfigViewSet', 'AppUpdateViewSet', 'AuditLogViewSet', 'DashboardViewSet', 'StaffViewSet', 'UserViewSet',
    'BusinessViewSet', 'BusinessTemplateListView',
    'AccountViewSet', 'JournalEntryViewSet', 'ChartSeedView',
    'TrialBalanceView', 'AccountLedgerView',
    'WarehouseViewSet', 'ProductViewSet', 'PurchaseInvoiceViewSet',
    'KardexView', 'StockAdjustView',
    'EmploymentProfileViewSet', 'PayrollPeriodViewSet', 'PayrollSettingsView',
    'PayslipViewSet',
    'TaxSettingsView', 'VatReportView', 'SeasonalReportView',
    'MoadianSubmissionViewSet', 'FixedAssetViewSet', 'DepreciationRunViewSet',
]
