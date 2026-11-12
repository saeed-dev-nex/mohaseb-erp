"""Opt-in pagination: existing clients must keep receiving plain arrays."""

from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase

from api.models import Customer


class OptionalPaginationTests(APITestCase):
    def setUp(self):
        cache.clear()
        User.objects.create_user(username='pager', password='test-pass-123')
        for i in range(5):
            Customer.objects.create(name=f'مشتری {i}')
        token = self.client.post('/api/token/', {'username': 'pager', 'password': 'test-pass-123'}, format='json')
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.data['access']}")

    def test_list_without_params_stays_a_plain_array(self):
        response = self.client.get('/api/customers/')
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.data, list)
        self.assertEqual(len(response.data), 5)

    def test_page_size_param_returns_paginated_envelope(self):
        response = self.client.get('/api/customers/?page_size=2')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 5)
        self.assertEqual(len(response.data['results']), 2)
        self.assertIsNotNone(response.data['next'])

    def test_second_page_returns_remaining_items(self):
        first = self.client.get('/api/customers/?page_size=2&page=1')
        second = self.client.get('/api/customers/?page_size=2&page=2')
        third = self.client.get('/api/customers/?page_size=2&page=3')
        ids = [item['id'] for item in first.data['results'] + second.data['results'] + third.data['results']]
        self.assertEqual(len(ids), 5)
        self.assertEqual(len(set(ids)), 5)
