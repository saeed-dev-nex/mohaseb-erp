"""ERP phase 0: businesses, job templates, fiscal years, scoping."""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from ..models import Business, BusinessMembership, Customer, Invoice

User = get_user_model()


class BusinessApiTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(username='erp-admin', password='admin' + '-pass-12345')
        self.operator = User.objects.create_user(username='erp-op', password='op' + '-pass-12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_templates_registry_is_served(self):
        response = self.client.get('/api/business-templates/')
        self.assertEqual(response.status_code, 200, response.content)
        keys = [item['key'] for item in response.data]
        for expected in ('services_repair', 'retail', 'trade', 'manufacturing', 'restaurant', 'general'):
            self.assertIn(expected, keys)

    def test_create_business_bootstraps_owner_and_fiscal_year(self):
        response = self.client.post(
            '/api/businesses/',
            {'name': 'فروشگاه تست', 'template_key': 'retail', 'person_type': 'individual'},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        business = Business.objects.get(name='فروشگاه تست')
        membership = BusinessMembership.objects.get(user=self.admin, business=business)
        self.assertEqual(membership.role, 'owner')
        year = business.current_fiscal_year
        self.assertIsNotNone(year)
        self.assertLess(year.start_date, year.end_date)
        self.assertIn('inventory', business.effective_modules())
        self.assertEqual(response.data['template_title'], 'فروشگاه و خرده‌فروشی')
        self.assertEqual(response.data['my_role'], 'owner')

    def test_only_superuser_creates_businesses(self):
        self.client.force_authenticate(self.operator)
        response = self.client.post('/api/businesses/', {'name': 'بدون مجوز'}, format='json')
        self.assertEqual(response.status_code, 403)

    def test_operator_sees_only_member_businesses(self):
        mine = Business.objects.create(name='عضو هستم', template_key='general')
        Business.objects.create(name='عضو نیستم', template_key='general')
        BusinessMembership.objects.create(user=self.operator, business=mine, role='operator')
        self.client.force_authenticate(self.operator)
        response = self.client.get('/api/businesses/')
        names = [item['name'] for item in response.data]
        self.assertIn('عضو هستم', names)
        self.assertNotIn('عضو نیستم', names)

    def test_members_endpoint_adds_by_username(self):
        business = Business.objects.create(name='کسب‌وکار اعضا', template_key='general')
        BusinessMembership.objects.create(user=self.admin, business=business, role='owner')
        response = self.client.post(
            f'/api/businesses/{business.id}/members/',
            {'username': 'erp-op', 'role': 'manager'}, format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        membership = BusinessMembership.objects.get(user=self.operator, business=business)
        self.assertEqual(membership.role, 'manager')

    def test_fiscal_years_endpoint(self):
        business = Business.objects.create(name='سال مالی', template_key='general')
        response = self.client.post(
            f'/api/businesses/{business.id}/fiscal-years/',
            {'title': 'سال مالی ۱۴۰۶', 'start_date': '2027-03-21', 'end_date': '2028-03-19', 'is_current': True},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        listing = self.client.get(f'/api/businesses/{business.id}/fiscal-years/')
        self.assertEqual(len(listing.data), 1)


class BusinessScopingTests(TestCase):
    """The X-Business-Id header scopes invoices/customers when valid."""

    def setUp(self):
        self.admin = User.objects.create_superuser(username='scope-admin', password='admin' + '-pass-12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.b1 = Business.objects.create(name='شعبه یک', template_key='general')
        self.b2 = Business.objects.create(name='شعبه دو', template_key='general')
        self.c1 = Customer.objects.create(name='مشتری یک', business=self.b1)
        self.c2 = Customer.objects.create(name='مشتری دو', business=self.b2)
        Invoice.objects.create(customer=self.c1, business=self.b1, total_amount=1000)
        Invoice.objects.create(customer=self.c2, business=self.b2, total_amount=2000)
        Invoice.objects.create(customer=self.c1, total_amount=3000)  # unassigned

    def test_invoice_list_scoped_by_header(self):
        response = self.client.get('/api/invoices/', HTTP_X_BUSINESS_ID=str(self.b1.id))
        ids = [row['business'] for row in response.data['results']] if isinstance(response.data, dict) else [row['business'] for row in response.data]
        self.assertTrue(ids)
        self.assertTrue(all(b == self.b1.id for b in ids))

    def test_invoice_list_unscoped_without_header(self):
        response = self.client.get('/api/invoices/')
        rows = response.data['results'] if isinstance(response.data, dict) else response.data
        self.assertEqual(len(rows), 3)

    def test_customer_list_scoped_by_header(self):
        response = self.client.get('/api/customers/', HTTP_X_BUSINESS_ID=str(self.b2.id))
        rows = response.data['results'] if isinstance(response.data, dict) else response.data
        self.assertEqual([row['name'] for row in rows], ['مشتری دو'])

    def test_create_invoice_assigns_current_business(self):
        response = self.client.post(
            '/api/invoices/',
            {
                'customer': self.c1.id, 'status': 'pending',
                'items': [{'service_title_snapshot': 'خدمت', 'quantity': 1, 'main_price': 5000}],
            },
            format='json', HTTP_X_BUSINESS_ID=str(self.b1.id),
        )
        self.assertEqual(response.status_code, 201, response.content)
        invoice = Invoice.objects.get(id=response.data['id'])
        self.assertEqual(invoice.business_id, self.b1.id)

    def test_non_member_cannot_scope_into_a_business(self):
        other = User.objects.create_user(username='outsider', password='out' + '-pass-12345')
        self.client.force_authenticate(other)
        response = self.client.get('/api/invoices/', HTTP_X_BUSINESS_ID=str(self.b1.id))
        rows = response.data['results'] if isinstance(response.data, dict) else response.data
        # Header ignored for a non-member: the full (unscoped) list comes back
        # rather than the business's data being confirmed/filtered by it.
        self.assertEqual(len(rows), 3)


class TemplateDepthTests(TestCase):
    """Per-trade invoice profiles and starter catalogs (phase 0.5)."""

    def setUp(self):
        self.admin = User.objects.create_superuser(username='tpl-admin', password='admin' + '-pass-12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_gas_station_template_registered_with_profile(self):
        response = self.client.get('/api/business-templates/')
        by_key = {item['key']: item for item in response.data}
        self.assertIn('gas_station', by_key)
        gas = by_key['gas_station']
        self.assertEqual(gas['title'], 'پمپ بنزین و جایگاه سوخت')
        extra_keys = [e['key'] for e in gas['invoice_profile']['extras']]
        self.assertEqual(extra_keys, ['liters', 'nozzle', 'plate'])
        titles = [c['title'] for c in gas['catalog']]
        self.assertIn('بنزین معمولی', titles)
        self.assertIn('گازوئیل', titles)

    def test_repair_template_has_vehicle_profile(self):
        response = self.client.get('/api/business-templates/')
        by_key = {item['key']: item for item in response.data}
        self.assertTrue(by_key['services_repair']['invoice_profile']['vehicle'])
        self.assertFalse(by_key['restaurant']['invoice_profile']['vehicle'])

    def test_create_gas_station_business_seeds_fuel_catalog(self):
        from ..models import Service

        response = self.client.post(
            '/api/businesses/',
            {'name': 'جایگاه تست', 'template_key': 'gas_station', 'person_type': 'legal'},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        business = Business.objects.get(name='جایگاه تست')
        titles = set(Service.objects.filter(business=business).values_list('title', flat=True))
        self.assertIn('بنزین سوپر', titles)
        self.assertEqual(len(titles), 6)
        self.assertEqual(response.data['invoice_profile']['extras'][0]['key'], 'liters')

    def test_apply_catalog_is_idempotent(self):
        business = Business.objects.create(name='رستوران تست', template_key='restaurant')
        BusinessMembership.objects.create(user=self.admin, business=business, role='owner')
        first = self.client.post(f'/api/businesses/{business.id}/apply-catalog/', {}, format='json')
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(first.data['created'], 6)
        second = self.client.post(f'/api/businesses/{business.id}/apply-catalog/', {}, format='json')
        self.assertEqual(second.data['created'], 0)
        self.assertEqual(second.data['existing'], 6)

    def test_services_scoped_by_business_header(self):
        from ..models import Service

        b1 = Business.objects.create(name='فروشگاه یک', template_key='retail')
        b2 = Business.objects.create(name='فروشگاه دو', template_key='retail')
        Service.objects.create(title='کالای یک', business=b1)
        Service.objects.create(title='کالای دو', business=b2)
        response = self.client.get('/api/services/', HTTP_X_BUSINESS_ID=str(b1.id))
        rows = response.data['results'] if isinstance(response.data, dict) else response.data
        titles = [row['title'] for row in rows]
        self.assertEqual(titles, ['کالای یک'])


class AccountingTests(TestCase):
    """Phase 1: chart, journal entries, posting rules, trial balance."""

    def setUp(self):
        self.admin = User.objects.create_superuser(username='acc-admin', password='admin' + '-pass-12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            '/api/businesses/',
            {'name': 'حسابداری تست', 'template_key': 'retail', 'person_type': 'legal'},
            format='json',
        )
        assert response.status_code == 201, response.content
        self.business = Business.objects.get(name='حسابداری تست')
        self.fiscal_year = self.business.current_fiscal_year
        self.headers = {'HTTP_X_BUSINESS_ID': str(self.business.id)}
        accounts = self.client.get('/api/accounts/', **self.headers)
        self.by_code = {row['code']: row for row in accounts.data}

    def _entry_payload(self, debit_account, credit_account, amount=1_000_000, date_offset=10):
        from datetime import timedelta

        return {
            'date': (self.fiscal_year.start_date + timedelta(days=date_offset)).isoformat(),
            'description': 'سند آزمایشی',
            'lines': [
                {'account': debit_account, 'debit': amount, 'credit': 0, 'description': 'بدهکار'},
                {'account': credit_account, 'debit': 0, 'credit': amount, 'description': 'بستانکار'},
            ],
        }

    def test_chart_seeded_on_business_create(self):
        self.assertEqual(len(self.by_code), 47)
        self.assertIn('1101', self.by_code)  # صندوق
        self.assertIn('4102', self.by_code)  # درآمد ارائه خدمات
        self.assertEqual(self.by_code['1101']['level'], 3)

    def test_accounting_requires_business_context(self):
        response = self.client.get('/api/accounts/')
        self.assertEqual(response.status_code, 400)

    def test_balanced_entry_posts_and_trial_balance_matches(self):
        payload = self._entry_payload(self.by_code['1101']['id'], self.by_code['3101']['id'])
        created = self.client.post('/api/journal-entries/', payload, format='json', **self.headers)
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.data['number'], 1)
        self.assertTrue(created.data['is_balanced'])
        posted = self.client.post(f"/api/journal-entries/{created.data['id']}/post/", {}, format='json', **self.headers)
        self.assertEqual(posted.status_code, 200, posted.content)
        self.assertEqual(posted.data['status'], 'posted')
        trial = self.client.get('/api/accounting/trial-balance/', **self.headers)
        self.assertEqual(trial.status_code, 200, trial.content)
        self.assertTrue(trial.data['is_balanced'])
        self.assertEqual(int(trial.data['total_debit']), 1_000_000)
        codes = [row['code'] for row in trial.data['rows']]
        self.assertIn('1101', codes)

    def test_unbalanced_entry_cannot_post(self):
        payload = self._entry_payload(self.by_code['1101']['id'], self.by_code['3101']['id'])
        payload['lines'][1]['credit'] = 900_000
        created = self.client.post('/api/journal-entries/', payload, format='json', **self.headers)
        self.assertEqual(created.status_code, 201, created.content)
        self.assertFalse(created.data['is_balanced'])
        posted = self.client.post(f"/api/journal-entries/{created.data['id']}/post/", {}, format='json', **self.headers)
        self.assertEqual(posted.status_code, 400)

    def test_group_account_cannot_take_lines(self):
        payload = self._entry_payload(self.by_code['1']['id'], self.by_code['3101']['id'])
        created = self.client.post('/api/journal-entries/', payload, format='json', **self.headers)
        self.assertEqual(created.status_code, 400)

    def test_posted_entry_is_immutable_until_unposted(self):
        payload = self._entry_payload(self.by_code['1102']['id'], self.by_code['4102']['id'], amount=500_000)
        created = self.client.post('/api/journal-entries/', payload, format='json', **self.headers)
        entry_id = created.data['id']
        self.client.post(f'/api/journal-entries/{entry_id}/post/', {}, format='json', **self.headers)
        edited = self.client.patch(
            f'/api/journal-entries/{entry_id}/',
            {'description': 'ویرایش'}, format='json', **self.headers,
        )
        self.assertEqual(edited.status_code, 400)
        unposted = self.client.post(f'/api/journal-entries/{entry_id}/unpost/', {}, format='json', **self.headers)
        self.assertEqual(unposted.status_code, 200, unposted.content)
        edited = self.client.patch(
            f'/api/journal-entries/{entry_id}/',
            {'description': 'ویرایش'}, format='json', **self.headers,
        )
        self.assertEqual(edited.status_code, 200, edited.content)

    def test_entry_date_must_be_inside_fiscal_year(self):
        payload = self._entry_payload(self.by_code['1101']['id'], self.by_code['3101']['id'])
        payload['date'] = '1999-01-01'
        created = self.client.post('/api/journal-entries/', payload, format='json', **self.headers)
        self.assertEqual(created.status_code, 400)

    def test_operator_cannot_write_journal(self):
        operator = User.objects.create_user(username='acc-op', password='op' + '-pass-12345')
        BusinessMembership.objects.create(user=operator, business=self.business, role='operator')
        self.client.force_authenticate(operator)
        payload = self._entry_payload(self.by_code['1101']['id'], self.by_code['3101']['id'])
        created = self.client.post('/api/journal-entries/', payload, format='json', **self.headers)
        self.assertEqual(created.status_code, 403)

    def test_ledger_running_balance(self):
        payload = self._entry_payload(self.by_code['1101']['id'], self.by_code['4101']['id'], amount=750_000)
        created = self.client.post('/api/journal-entries/', payload, format='json', **self.headers)
        self.client.post(f"/api/journal-entries/{created.data['id']}/post/", {}, format='json', **self.headers)
        ledger = self.client.get(
            '/api/accounting/ledger/',
            {'account': self.by_code['1101']['id']}, **self.headers,
        )
        self.assertEqual(ledger.status_code, 200, ledger.content)
        self.assertEqual(len(ledger.data['rows']), 1)
        self.assertEqual(int(ledger.data['rows'][0]['balance']), 750_000)

    def test_numbers_increment_per_fiscal_year(self):
        first = self.client.post(
            '/api/journal-entries/',
            self._entry_payload(self.by_code['1101']['id'], self.by_code['3101']['id']),
            format='json', **self.headers,
        )
        second = self.client.post(
            '/api/journal-entries/',
            self._entry_payload(self.by_code['1101']['id'], self.by_code['3101']['id'], date_offset=11),
            format='json', **self.headers,
        )
        self.assertEqual((first.data['number'], second.data['number']), (1, 2))
