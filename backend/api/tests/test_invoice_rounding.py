"""Optional invoice rounding: auto nearest-10,000 rule + manual target."""

from decimal import Decimal

from django.contrib.auth.models import User
from django.test import SimpleTestCase
from rest_framework.test import APITestCase

from api.models import Customer
from api.services.money import compute_rounding_adjustment


class RoundingMathTests(SimpleTestCase):
    def test_remainder_under_5000_rounds_down(self):
        self.assertEqual(compute_rounding_adjustment(1253200), Decimal(-3200))
        self.assertEqual(compute_rounding_adjustment(3000), Decimal(-3000))

    def test_remainder_5000_or_more_rounds_up(self):
        self.assertEqual(compute_rounding_adjustment(1255000), Decimal(5000))
        self.assertEqual(compute_rounding_adjustment(1257800), Decimal(2200))
        self.assertEqual(compute_rounding_adjustment(9999), Decimal(1))

    def test_exact_multiple_and_zero_need_no_adjustment(self):
        self.assertEqual(compute_rounding_adjustment(1250000), Decimal(0))
        self.assertEqual(compute_rounding_adjustment(0), Decimal(0))

    def test_manual_target_wins(self):
        self.assertEqual(
            compute_rounding_adjustment(1253200, target=1200000), Decimal(-53200))
        self.assertEqual(
            compute_rounding_adjustment(1253200, target=1300000), Decimal(46800))


class RoundingApiTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(username='rounding-op')
        cls.customer = Customer.objects.create(name='مشتری رند')

    def setUp(self):
        self.client.force_authenticate(self.user)

    def payload(self, price, **overrides):
        data = {
            'customer': self.customer.id,
            'status': 'pending',
            'items': [{'service_title_snapshot': 'خدمت', 'quantity': 1,
                       'main_price': price, 'extra_price': 0, 'commission': 0}],
        }
        data.update(overrides)
        return data

    def test_create_with_auto_rounding_rounds_down(self):
        response = self.client.post(
            '/api/invoices/', self.payload(1253200, rounding_enabled=True), format='json')
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(int(response.data['rounding_amount']), -3200)
        self.assertEqual(int(response.data['final_amount']), 1250000)

    def test_create_with_manual_target(self):
        response = self.client.post(
            '/api/invoices/',
            self.payload(1253200, rounding_enabled=True, rounding_target=1200000),
            format='json')
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(int(response.data['rounding_amount']), -53200)
        self.assertEqual(int(response.data['final_amount']), 1200000)

    def test_create_without_rounding_is_untouched(self):
        response = self.client.post(
            '/api/invoices/', self.payload(1253200), format='json')
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(int(response.data['rounding_amount']), 0)
        self.assertEqual(int(response.data['final_amount']), 1253200)

    def test_detail_style_patch_applies_and_clears_rounding(self):
        created = self.client.post(
            '/api/invoices/', self.payload(1257800), format='json')
        self.assertEqual(created.status_code, 201, created.content)
        url = f"/api/invoices/{created.data['id']}/"

        # Rounding-only PATCH (what the details page sends): rounds up.
        response = self.client.patch(url, {'rounding_enabled': True}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(int(response.data['rounding_amount']), 2200)
        self.assertEqual(int(response.data['final_amount']), 1260000)

        # An unrelated PATCH must not disturb the stored adjustment.
        response = self.client.patch(url, {'description': 'یادداشت'}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(int(response.data['rounding_amount']), 2200)
        self.assertEqual(int(response.data['final_amount']), 1260000)

        # Turning the option off restores the exact final.
        response = self.client.patch(url, {'rounding_enabled': False}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(int(response.data['rounding_amount']), 0)
        self.assertEqual(int(response.data['final_amount']), 1257800)

    def test_show_amount_defaults_to_hidden_and_persists_when_chosen(self):
        # Default: the rounding happens but is NOT shown on the invoice.
        response = self.client.post(
            '/api/invoices/', self.payload(1253200, rounding_enabled=True), format='json')
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data['rounding_show_amount'], False)
        self.assertEqual(int(response.data['final_amount']), 1250000)

        # Opt-in: the user chooses to show the rounding amount.
        response = self.client.post(
            '/api/invoices/',
            self.payload(1253200, rounding_enabled=True, rounding_show_amount=True),
            format='json')
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data['rounding_show_amount'], True)
        self.assertEqual(int(response.data['final_amount']), 1250000)

    def test_patch_show_flag_alone_preserves_adjustment(self):
        created = self.client.post(
            '/api/invoices/', self.payload(1253200, rounding_enabled=True), format='json')
        self.assertEqual(created.status_code, 201, created.content)
        url = f"/api/invoices/{created.data['id']}/"
        response = self.client.patch(url, {'rounding_show_amount': True}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['rounding_show_amount'], True)
        self.assertEqual(int(response.data['rounding_amount']), -3200)
        self.assertEqual(int(response.data['final_amount']), 1250000)

    def test_negative_target_is_rejected(self):
        response = self.client.post(
            '/api/invoices/',
            self.payload(1253200, rounding_enabled=True, rounding_target=-5),
            format='json')
        self.assertEqual(response.status_code, 400)

    def test_rounding_target_is_readable(self):
        manual = self.client.post(
            '/api/invoices/',
            self.payload(1253200, rounding_enabled=True, rounding_target=1200000),
            format='json')
        self.assertEqual(manual.status_code, 201, manual.content)
        self.assertEqual(int(manual.data['rounding_target']), 1200000)
        auto = self.client.post(
            '/api/invoices/', self.payload(1253200, rounding_enabled=True),
            format='json')
        self.assertEqual(auto.status_code, 201, auto.content)
        self.assertIsNone(auto.data['rounding_target'])

    def test_auto_rounding_rederives_after_amount_change(self):
        created = self.client.post(
            '/api/invoices/', self.payload(1253200, rounding_enabled=True),
            format='json')
        self.assertEqual(created.status_code, 201, created.content)
        url = f"/api/invoices/{created.data['id']}/"
        # The amounts move: auto rounding follows the NEW base.
        response = self.client.patch(url, self.payload(1257800), format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(int(response.data['rounding_amount']), 2200)
        self.assertEqual(int(response.data['final_amount']), 1260000)
        self.assertFalse(response.data['rounding_cleared'])

    def test_manual_target_cleared_when_amounts_change(self):
        created = self.client.post(
            '/api/invoices/',
            self.payload(1253200, rounding_enabled=True, rounding_target=1200000),
            format='json')
        self.assertEqual(created.status_code, 201, created.content)
        url = f"/api/invoices/{created.data['id']}/"
        # Same invoice, new amounts, no fresh target: the one-shot manual
        # rounding is dropped and the caller is told.
        response = self.client.patch(url, self.payload(1300000), format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.data['rounding_cleared'])
        self.assertFalse(response.data['rounding_enabled'])
        self.assertIsNone(response.data['rounding_target'])
        self.assertEqual(int(response.data['rounding_amount']), 0)
        self.assertEqual(int(response.data['final_amount']), 1300000)

    def test_manual_target_survives_unrelated_patch(self):
        created = self.client.post(
            '/api/invoices/',
            self.payload(1253200, rounding_enabled=True, rounding_target=1200000),
            format='json')
        self.assertEqual(created.status_code, 201, created.content)
        url = f"/api/invoices/{created.data['id']}/"
        response = self.client.patch(url, {'description': 'یادداشت'}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.data['rounding_cleared'])
        self.assertTrue(response.data['rounding_enabled'])
        self.assertEqual(int(response.data['rounding_target']), 1200000)
        self.assertEqual(int(response.data['rounding_amount']), -53200)
        self.assertEqual(int(response.data['final_amount']), 1200000)

    def test_fresh_target_replaces_manual_in_same_save(self):
        created = self.client.post(
            '/api/invoices/',
            self.payload(1253200, rounding_enabled=True, rounding_target=1200000),
            format='json')
        self.assertEqual(created.status_code, 201, created.content)
        url = f"/api/invoices/{created.data['id']}/"
        # New amounts AND a new target in one save: the fresh target wins.
        payload = self.payload(1300000, rounding_target=1280000)
        response = self.client.patch(url, payload, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.data['rounding_cleared'])
        self.assertTrue(response.data['rounding_enabled'])
        self.assertEqual(int(response.data['rounding_target']), 1280000)
        self.assertEqual(int(response.data['rounding_amount']), -20000)
        self.assertEqual(int(response.data['final_amount']), 1280000)

    def test_clearing_target_switches_manual_to_auto(self):
        created = self.client.post(
            '/api/invoices/',
            self.payload(1253200, rounding_enabled=True, rounding_target=1200000),
            format='json')
        self.assertEqual(created.status_code, 201, created.content)
        url = f"/api/invoices/{created.data['id']}/"
        # Explicit null target with new amounts: auto from now on, no clear.
        payload = self.payload(1300000, rounding_target=None)
        response = self.client.patch(url, payload, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.data['rounding_cleared'])
        self.assertTrue(response.data['rounding_enabled'])
        self.assertIsNone(response.data['rounding_target'])
        self.assertEqual(int(response.data['rounding_amount']), 0)
        self.assertEqual(int(response.data['final_amount']), 1300000)
