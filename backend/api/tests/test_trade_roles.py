"""Phase 2.6: per-trade roles, income basis, auto product codes, currency."""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from ..models import Business, BusinessMembership, Customer, Invoice, Product

User = get_user_model()
PW = 'member' + '-pass-12345'


class TradeRolesBase(TestCase):
    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_superuser(username='roles-admin', password=PW)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            '/api/businesses/',
            {'name': 'فروشگاه نقش‌ها', 'template_key': 'retail', 'person_type': 'individual'},
            format='json',
        )
        assert response.status_code == 201, response.content
        self.shop = Business.objects.get(name='فروشگاه نقش‌ها')
        self.shop_headers = {'HTTP_X_BUSINESS_ID': str(self.shop.id)}

    def add_member(self, username, role):
        user = User.objects.create_user(username=username, password=PW)
        BusinessMembership.objects.create(user=user, business=self.shop, role=role)
        return user


class AutoProductCodeTests(TradeRolesBase):
    def test_empty_code_gets_next_sequential(self):
        response = self.client.post(
            '/api/products/', {'name': 'کالای یک'}, format='json', **self.shop_headers,
        )
        self.assertEqual(response.status_code, 201, response.content)
        first_code = response.data['code']
        self.assertTrue(first_code.isdigit())
        response = self.client.post(
            '/api/products/', {'name': 'کالای دو'}, format='json', **self.shop_headers,
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(int(response.data['code']), int(first_code) + 1)

    def test_manual_code_is_respected(self):
        response = self.client.post(
            '/api/products/', {'name': 'دستی', 'code': 'ABC-9'}, format='json',
            **self.shop_headers,
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data['code'], 'ABC-9')
        self.assertEqual(Product.objects.filter(business=self.shop, code='ABC-9').count(), 1)


class RoleAccessTests(TradeRolesBase):
    def test_seller_cannot_open_accounting_but_reads_products(self):
        seller = self.add_member('seller-1', 'seller')
        self.client.force_authenticate(seller)
        self.assertEqual(
            self.client.get('/api/accounts/', **self.shop_headers).status_code, 403)
        # Background dependency: the invoice form's product picker.
        self.assertEqual(
            self.client.get('/api/products/', **self.shop_headers).status_code, 200)
        # But no inventory writes.
        self.assertEqual(
            self.client.post(
                '/api/products/', {'name': 'نباید ساخته شود'}, format='json',
                **self.shop_headers,
            ).status_code,
            403,
        )

    def test_warehouse_keeper_writes_inventory_not_accounting(self):
        keeper = self.add_member('keeper-1', 'warehouse')
        self.client.force_authenticate(keeper)
        self.assertEqual(
            self.client.get('/api/accounts/', **self.shop_headers).status_code, 403)
        response = self.client.post(
            '/api/products/', {'name': 'کالای انباردار'}, format='json', **self.shop_headers,
        )
        self.assertEqual(response.status_code, 201, response.content)

    def test_accountant_writes_accounting_not_inventory(self):
        accountant = self.add_member('acc-1', 'accountant')
        self.client.force_authenticate(accountant)
        self.assertEqual(
            self.client.get('/api/accounts/', **self.shop_headers).status_code, 200)
        self.assertEqual(
            self.client.post(
                '/api/products/', {'name': 'نباید'}, format='json', **self.shop_headers,
            ).status_code,
            403,
        )

    def test_my_modules_reflect_the_role(self):
        seller = self.add_member('seller-2', 'seller')
        self.client.force_authenticate(seller)
        response = self.client.get('/api/businesses/')
        mine = [b for b in response.data if b['id'] == self.shop.id][0]
        self.assertIn('invoices', mine['my_modules'])
        self.assertNotIn('accounting', mine['my_modules'])
        self.assertNotIn('inventory', mine['my_modules'])
        roles = {p['key'] for p in mine['role_presets']}
        self.assertEqual(roles, {'manager', 'accountant', 'warehouse', 'seller', 'viewer'})

    def test_manager_sees_everything(self):
        manager = self.add_member('manager-1', 'manager')
        self.client.force_authenticate(manager)
        self.assertEqual(
            self.client.get('/api/accounts/', **self.shop_headers).status_code, 200)
        response = self.client.get('/api/businesses/')
        mine = [b for b in response.data if b['id'] == self.shop.id][0]
        self.assertIsNone(mine['my_modules'])


class PaymentCardsProfileTests(TradeRolesBase):
    def test_retail_invoice_profile_hides_payment_cards(self):
        response = self.client.get('/api/businesses/')
        mine = [b for b in response.data if b['id'] == self.shop.id][0]
        self.assertFalse(mine['invoice_profile']['payment_cards'])

    def test_services_repair_keeps_payment_cards(self):
        response = self.client.post(
            '/api/businesses/',
            {'name': 'دفتر خدماتی', 'template_key': 'services_repair', 'person_type': 'individual'},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(response.data['invoice_profile']['payment_cards'])
        roles = {p['key'] for p in response.data['role_presets']}
        self.assertIn('operator', roles)
        self.assertNotIn('seller', roles)


class IncomeBasisTests(TradeRolesBase):
    def _paid_invoice(self, business, total, commission):
        customer = Customer.objects.create(name='مشتری درآمد', business=business)
        return Invoice.objects.create(
            customer=customer, business=business, status='paid',
            date=timezone.now(), total_amount=Decimal(total),
            commission_total=Decimal(commission),
        )

    def test_shop_income_is_the_sale(self):
        self._paid_invoice(self.shop, 200000, 0)
        response = self.client.get('/api/dashboard/stats/', **self.shop_headers)
        self.assertEqual(response.data['income_basis'], 'sales')
        self.assertEqual(response.data['total_revenue'], 200000)
        self.assertEqual(response.data['total_invoices'], 1)

    def test_counter_income_is_the_commission(self):
        response = self.client.post(
            '/api/businesses/',
            {'name': 'دفتر پیشخوان', 'template_key': 'services_repair', 'person_type': 'individual'},
            format='json',
        )
        office = Business.objects.get(name='دفتر پیشخوان')
        self._paid_invoice(office, 900000, 45000)
        response = self.client.get(
            '/api/dashboard/stats/', HTTP_X_BUSINESS_ID=str(office.id))
        self.assertEqual(response.data['income_basis'], 'commission')
        self.assertEqual(response.data['total_revenue'], 45000)
        self.assertEqual(response.data['total_commission'], 45000)

    def test_shop_report_profit_uses_sales_income(self):
        self._paid_invoice(self.shop, 200000, 0)
        response = self.client.get('/api/invoices/report/', **self.shop_headers)
        self.assertEqual(response.data['income_basis'], 'sales')
        self.assertEqual(response.data['total_income'], 200000)
        self.assertEqual(response.data['net_profit'], 200000)


class CurrencyUnitTests(TestCase):
    def test_profile_exposes_and_persists_currency_unit(self):
        admin = User.objects.create_superuser(username='curr-admin', password=PW)
        client = APIClient()
        client.force_authenticate(admin)
        response = client.get('/api/profile/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['currency_unit'], 'toman')
        response = client.patch(
            '/api/profile/update_profile/', {'currency_unit': 'rial'}, format='multipart')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['currency_unit'], 'rial')


class MemberManagementTests(TradeRolesBase):
    """The users page manages members: presets carry descriptions and
    a membership can be removed (except the owner's)."""

    def test_presets_carry_descriptions(self):
        response = self.client.get('/api/businesses/')
        mine = [b for b in response.data if b['id'] == self.shop.id][0]
        for preset in mine['role_presets']:
            self.assertTrue(preset.get('description'), preset['key'])

    def test_manager_can_remove_a_member(self):
        seller = self.add_member('seller-rm', 'seller')
        manager = self.add_member('manager-rm', 'manager')
        self.client.force_authenticate(manager)
        response = self.client.delete(
            f'/api/businesses/{self.shop.id}/members/{seller.id}/')
        self.assertEqual(response.status_code, 204)
        self.assertFalse(BusinessMembership.objects.filter(
            user=seller, business=self.shop).exists())

    def test_owner_membership_cannot_be_removed(self):
        owner_membership = BusinessMembership.objects.get(
            business=self.shop, role='owner')
        response = self.client.delete(
            f'/api/businesses/{self.shop.id}/members/{owner_membership.user.id}/')
        self.assertEqual(response.status_code, 400)
        self.assertTrue(BusinessMembership.objects.filter(
            id=owner_membership.id).exists())

    def test_functional_role_cannot_remove_members(self):
        seller = self.add_member('seller-noperm', 'seller')
        other = self.add_member('seller-target', 'seller')
        self.client.force_authenticate(seller)
        response = self.client.delete(
            f'/api/businesses/{self.shop.id}/members/{other.id}/')
        self.assertEqual(response.status_code, 403)
