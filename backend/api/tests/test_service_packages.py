"""Service packages: manager-arranged bundles applied during invoicing.

Rules under test:
* operators (invoices module) can read packages — they apply them in the
  invoice form;
* only settings managers can create/edit/delete packages.
"""

from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from api.models import Service, ServicePackage


class ServicePackageApiTests(APITestCase):
    def setUp(self):
        self.manager = User.objects.create_user(
            username='manager', password='<redacted>', is_staff=True
        )
        self.operator = User.objects.create_user(
            username='operator', password='<redacted>'
        )
        self.s1 = Service.objects.create(title='خلافی', default_main_price=150000)
        self.s2 = Service.objects.create(title='عوارض آزادراهی', default_main_price=80000)
        self.package = ServicePackage.objects.create(name='استعلام و تسویه')
        self.package.services.set([self.s1, self.s2])

    def test_operator_can_read_packages_with_service_titles(self):
        self.client.force_authenticate(self.operator)
        response = self.client.get('/api/service-packages/')
        self.assertEqual(response.status_code, 200)
        rows = response.data['results'] if isinstance(response.data, dict) else response.data
        self.assertEqual(len(rows), 1)
        titles = {entry['title'] for entry in rows[0]['service_titles']}
        self.assertEqual(titles, {'خلافی', 'عوارض آزادراهی'})
        self.assertEqual(set(rows[0]['services']), {self.s1.id, self.s2.id})

    def test_operator_cannot_create_package(self):
        self.client.force_authenticate(self.operator)
        response = self.client.post(
            '/api/service-packages/',
            {'name': 'پکیج جدید', 'services': [self.s1.id]},
            format='json',
        )
        self.assertEqual(response.status_code, 403)

    def test_manager_can_create_update_delete_package(self):
        self.client.force_authenticate(self.manager)
        created = self.client.post(
            '/api/service-packages/',
            {'name': 'پکیج بیمه', 'services': [self.s2.id]},
            format='json',
        )
        self.assertEqual(created.status_code, 201)
        package_id = created.data['id']

        updated = self.client.patch(
            f'/api/service-packages/{package_id}/',
            {'name': 'پکیج بیمه و مالیات'},
            format='json',
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data['name'], 'پکیج بیمه و مالیات')

        deleted = self.client.delete(f'/api/service-packages/{package_id}/')
        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(ServicePackage.objects.filter(pk=package_id).exists())

    def test_anonymous_cannot_read(self):
        self.assertEqual(self.client.get('/api/service-packages/').status_code, 401)
