from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .auth_views import ThrottledTokenObtainPairView, ThrottledTokenRefreshView, TokenLogoutView
from .views import (
    CustomerViewSet, ServiceViewSet, ServicePackageViewSet, InvoiceViewSet,
    DocumentViewSet, DashboardViewSet,
    BusinessProfileViewSet, ExpenseCategoryViewSet,
    ExpenseViewSet, StaffViewSet, BackupViewSet, VehicleTypeViewSet,
    UserViewSet, BackupConfigViewSet, DatabaseConfigViewSet, AppUpdateViewSet, InvoiceSettingsViewSet, ChequeViewSet, AuditLogViewSet, ChatMessageViewSet,
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


urlpatterns = [
    path('changes/', database_revision, name='database_revision'),
    path('token/', ThrottledTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('token/logout/', TokenLogoutView.as_view(), name='token_logout'),
    path(
        'token/refresh/',
        ThrottledTokenRefreshView.as_view(serializer_class=SafeTokenRefreshSerializer),
        name='token_refresh',
    ),
    path('', include(router.urls)),
]
