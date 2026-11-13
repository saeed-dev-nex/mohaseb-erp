from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .auth_views import ThrottledTokenObtainPairView, ThrottledTokenRefreshView, TokenLogoutView
from .views import (
    CustomerViewSet, ServiceViewSet, ServicePackageViewSet, InvoiceViewSet,
    DocumentViewSet, DashboardViewSet,
    BusinessProfileViewSet, ExpenseCategoryViewSet,
    ExpenseViewSet, StaffViewSet, BackupViewSet, VehicleTypeViewSet,
    UserViewSet, BackupConfigViewSet, DatabaseConfigViewSet, AppUpdateViewSet, InvoiceSettingsViewSet, ChequeViewSet, AuditLogViewSet, ChatMessageViewSet,
    BusinessViewSet, BusinessTemplateListView,
    AccountViewSet, JournalEntryViewSet, ChartSeedView, TrialBalanceView, AccountLedgerView,
    WarehouseViewSet, ProductViewSet, PurchaseInvoiceViewSet, KardexView, StockAdjustView,
    EmploymentProfileViewSet, PayrollPeriodViewSet, PayrollSettingsView, PayslipViewSet,
    TaxSettingsView, VatReportView, SeasonalReportView, MoadianSubmissionViewSet,
    FixedAssetViewSet, DepreciationRunViewSet,
    SetupStatusView, SetupTestDatabaseView, SetupConfigureDatabaseView,
    SetupCreateAdminView,
    CaptchaView, ChangePasswordView, CheckRegistrationCodeView,
    ForgotPasswordView, LoginOtpRequestView, LoginOtpVerifyView,
    RegistrationCodeViewSet, RegisterView, ResetPasswordView,
    ResendVerificationView, VerifyEmailView,
    WelcomeSettingsViewSet, SocialNetworkViewSet
)
from .serializers import SafeTokenRefreshSerializer
from .views import database_revision

router = DefaultRouter()
router.register(r'customers', CustomerViewSet, basename='customer')
router.register(r'services', ServiceViewSet, basename='service')
router.register(r'service-packages', ServicePackageViewSet, basename='service-package')
router.register(r'invoices', InvoiceViewSet, basename='invoice')
router.register(r'documents', DocumentViewSet, basename='document')
router.register(r'dashboard', DashboardViewSet, basename='dashboard')
router.register(r'profile', BusinessProfileViewSet, basename='profile')
router.register(r'expense-categories', ExpenseCategoryViewSet, basename='expense-category')
router.register(r'expenses', ExpenseViewSet, basename='expense')
router.register(r'staff', StaffViewSet, basename='staff')
router.register(r'backup', BackupViewSet, basename='backup')
router.register(r'backup-config', BackupConfigViewSet, basename='backup-config')
router.register(r'database-config', DatabaseConfigViewSet, basename='database-config')
router.register(r'app-update', AppUpdateViewSet, basename='app-update')
router.register(r'invoice-settings', InvoiceSettingsViewSet, basename='invoice-settings')
router.register(r'vehicle-types', VehicleTypeViewSet, basename='vehicle-type')
router.register(r'users', UserViewSet, basename='user')
router.register(r'cheques', ChequeViewSet, basename='cheque')
router.register(r'audit', AuditLogViewSet, basename='audit')
router.register(r'chat', ChatMessageViewSet, basename='chat')
router.register(r'welcome-settings', WelcomeSettingsViewSet, basename='welcome-settings')
router.register(r'social-networks', SocialNetworkViewSet, basename='social-network')
router.register(r'businesses', BusinessViewSet, basename='business')
router.register(r'accounts', AccountViewSet, basename='account')
router.register(r'journal-entries', JournalEntryViewSet, basename='journal-entry')
router.register(r'warehouses', WarehouseViewSet, basename='warehouse')
router.register(r'products', ProductViewSet, basename='product')
router.register(r'purchases', PurchaseInvoiceViewSet, basename='purchase')
router.register(r'employment-profiles', EmploymentProfileViewSet, basename='employment-profile')
router.register(r'payroll-periods', PayrollPeriodViewSet, basename='payroll-period')
router.register(r'payslips', PayslipViewSet, basename='payslip')
router.register(r'moadian-submissions', MoadianSubmissionViewSet, basename='moadian-submission')
router.register(r'fixed-assets', FixedAssetViewSet, basename='fixed-asset')
router.register(r'depreciation-runs', DepreciationRunViewSet, basename='depreciation-run')
router.register(r'registration-codes', RegistrationCodeViewSet, basename='registration-code')


urlpatterns = [
    path('changes/', database_revision, name='database_revision'),
    path('business-templates/', BusinessTemplateListView.as_view(), name='business_templates'),
    path('accounting/seed-chart/', ChartSeedView.as_view(), name='accounting_seed_chart'),
    path('accounting/trial-balance/', TrialBalanceView.as_view(), name='accounting_trial_balance'),
    path('accounting/ledger/', AccountLedgerView.as_view(), name='accounting_ledger'),
    path('inventory/kardex/', KardexView.as_view(), name='inventory_kardex'),
    path('inventory/adjust/', StockAdjustView.as_view(), name='inventory_adjust'),
    path('setup/status/', SetupStatusView.as_view(), name='setup_status'),
    path('setup/test-database/', SetupTestDatabaseView.as_view(), name='setup_test_database'),
    path('setup/configure-database/', SetupConfigureDatabaseView.as_view(), name='setup_configure_database'),
    path('setup/admin/', SetupCreateAdminView.as_view(), name='setup_admin'),
    path('registration/check-code/', CheckRegistrationCodeView.as_view(), name='registration_check_code'),
    path('registration/register/', RegisterView.as_view(), name='registration_register'),
    path('registration/verify-email/', VerifyEmailView.as_view(), name='registration_verify_email'),
    path('registration/resend-code/', ResendVerificationView.as_view(), name='registration_resend_code'),
    path('auth/captcha/', CaptchaView.as_view(), name='auth_captcha'),
    path('auth/forgot-password/', ForgotPasswordView.as_view(), name='auth_forgot_password'),
    path('auth/reset-password/', ResetPasswordView.as_view(), name='auth_reset_password'),
    path('auth/otp/request/', LoginOtpRequestView.as_view(), name='auth_otp_request'),
    path('auth/otp/verify/', LoginOtpVerifyView.as_view(), name='auth_otp_verify'),
    path('auth/change-password/', ChangePasswordView.as_view(), name='auth_change_password'),
    path('payroll/settings/', PayrollSettingsView.as_view(), name='payroll_settings'),
    path('tax/settings/', TaxSettingsView.as_view(), name='tax_settings'),
    path('tax/vat-report/', VatReportView.as_view(), name='tax_vat_report'),
    path('tax/seasonal/', SeasonalReportView.as_view(), name='tax_seasonal'),
    path('token/', ThrottledTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('token/logout/', TokenLogoutView.as_view(), name='token_logout'),
    path(
        'token/refresh/',
        ThrottledTokenRefreshView.as_view(serializer_class=SafeTokenRefreshSerializer),
        name='token_refresh',
    ),
    path('', include(router.urls)),
]
