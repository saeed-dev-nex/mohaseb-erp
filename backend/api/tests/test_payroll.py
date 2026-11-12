"""ERP phase 3 — personnel profiles and payroll computation."""

from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from api.models import Business, JournalEntry, Payslip, Staff
from api.services.payroll import progressive_tax


class PayrollTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(username='pay-admin', password='admin' + '-pass-12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            '/api/businesses/',
            {'name': 'حقوق تست', 'template_key': 'general', 'person_type': 'legal'},
            format='json',
        )
        assert response.status_code == 201, response.content
        self.business = Business.objects.get(name='حقوق تست')
        self.headers = {'HTTP_X_BUSINESS_ID': str(self.business.id)}
        self.staff = Staff.objects.create(name='علی رضایی')
        profile = self.client.post(
            '/api/employment-profiles/',
            {
                'staff': self.staff.id, 'personnel_code': '1001',
                'national_id': '0012345678', 'insurance_number': '12345678',
                'bank_iban': 'IR060570000000000000000001',
                'base_salary': 30_000_000, 'housing_allowance': 3_000_000,
                'food_allowance': 2_000_000, 'child_allowance_each': 1_000_000,
                'children_count': 1, 'is_insured': True,
            },
            format='json', **self.headers,
        )
        assert profile.status_code == 201, profile.content
        self.profile_id = profile.data['id']

    def _make_period_with_slips(self, year=1405, month=1):
        created = self.client.post(
            '/api/payroll-periods/', {'year': year, 'month': month},
            format='json', **self.headers,
        )
        assert created.status_code == 201, created.content
        generated = self.client.post(
            f"/api/payroll-periods/{created.data['id']}/generate/", {},
            format='json', **self.headers,
        )
        assert generated.status_code == 200, generated.content
        slips = self.client.get(
            f"/api/payroll-periods/{created.data['id']}/payslips/", **self.headers,
        )
        assert slips.status_code == 200, slips.content
        return created.data, slips.data[0]

    def test_full_month_computation(self):
        _, slip = self._make_period_with_slips()
        self.assertEqual(int(slip['base_pay']), 30_000_000)
        self.assertEqual(int(slip['gross']), 36_000_000)
        self.assertEqual(int(slip['insurance_base']), 35_000_000)
        self.assertEqual(int(slip['insurance_employee']), 2_450_000)
        self.assertEqual(int(slip['insurance_employer']), 8_050_000)
        self.assertEqual(int(slip['tax']), 1_350_000)
        self.assertEqual(int(slip['net']), 32_200_000)

    def test_progressive_tax_function(self):
        brackets = [[24_000_000, 0], [30_000_000, 10], [38_000_000, 15], [None, 30]]
        self.assertEqual(progressive_tax(20_000_000, brackets), Decimal(0))
        self.assertEqual(progressive_tax(35_000_000, brackets), Decimal(1_350_000))
        self.assertEqual(progressive_tax(40_000_000, brackets), Decimal(2_400_000))

    def test_prorated_days_and_overtime_recompute(self):
        _, slip = self._make_period_with_slips()
        patched = self.client.patch(
            f"/api/payslips/{slip['id']}/",
            {'days_worked': 15, 'overtime_hours': '10'},
            format='json', **self.headers,
        )
        self.assertEqual(patched.status_code, 200, patched.content)
        self.assertEqual(int(patched.data['base_pay']), 15_000_000)
        expected_overtime = (
            Decimal(30_000_000) / 30 / Decimal('7.33') * 10 * Decimal('1.4')
        ).quantize(Decimal('1'))
        self.assertEqual(Decimal(patched.data['overtime_pay']), expected_overtime)

    def test_finalize_writes_balanced_journal_and_locks(self):
        period, slip = self._make_period_with_slips()
        finalized = self.client.post(
            f"/api/payroll-periods/{period['id']}/finalize/", {},
            format='json', **self.headers,
        )
        self.assertEqual(finalized.status_code, 200, finalized.content)
        self.assertEqual(finalized.data['status'], 'finalized')
        entry = JournalEntry.objects.get(id=finalized.data['journal_entry'])
        self.assertTrue(entry.is_balanced)
        self.assertEqual(entry.total_debit, Decimal(44_050_000))
        locked = self.client.patch(
            f"/api/payslips/{slip['id']}/", {'days_worked': 20},
            format='json', **self.headers,
        )
        self.assertEqual(locked.status_code, 400)
        unfinalized = self.client.post(
            f"/api/payroll-periods/{period['id']}/unfinalize/", {},
            format='json', **self.headers,
        )
        self.assertEqual(unfinalized.status_code, 200, unfinalized.content)
        self.assertFalse(JournalEntry.objects.filter(id=entry.id).exists())

    def test_uninsured_employee_has_no_insurance(self):
        staff2 = Staff.objects.create(name='سارا محمدی')
        profile = self.client.post(
            '/api/employment-profiles/',
            {'staff': staff2.id, 'base_salary': 10_000_000, 'is_insured': False},
            format='json', **self.headers,
        )
        assert profile.status_code == 201, profile.content
        _, slips = None, None
        created = self.client.post(
            '/api/payroll-periods/', {'year': 1405, 'month': 2},
            format='json', **self.headers,
        )
        self.client.post(
            f"/api/payroll-periods/{created.data['id']}/generate/", {},
            format='json', **self.headers,
        )
        slips = self.client.get(
            f"/api/payroll-periods/{created.data['id']}/payslips/", **self.headers,
        ).data
        slip2 = [s for s in slips if s['profile'] == profile.data['id']][0]
        self.assertEqual(int(slip2['insurance_employee']), 0)
        self.assertEqual(int(slip2['insurance_employer']), 0)
        self.assertEqual(int(slip2['tax']), 0)  # under the 24M exemption
        self.assertEqual(int(slip2['net']), 10_000_000)

    def test_bank_and_insurance_exports(self):
        period, _ = self._make_period_with_slips()
        bank = self.client.get(
            f"/api/payroll-periods/{period['id']}/export-bank/", **self.headers,
        )
        self.assertEqual(bank.status_code, 200)
        body = bank.content.decode('utf-8-sig')
        self.assertIn('علی رضایی', body)
        self.assertIn('32200000', body)
        insurance = self.client.get(
            f"/api/payroll-periods/{period['id']}/export-insurance/", **self.headers,
        )
        body = insurance.content.decode('utf-8-sig')
        self.assertIn('12345678', body)
        self.assertIn('8050000', body)

    def test_settings_defaults(self):
        response = self.client.get('/api/payroll/settings/', **self.headers)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(float(response.data['insurance_employee_rate']), 7.0)
        self.assertEqual(response.data['tax_brackets'][0][0], 24_000_000)
        self.assertEqual(Payslip.objects.count(), 0)
