"""httpOnly refresh-cookie contract for the web client (stage 2).

The web client must never receive the refresh token in a response body;
extensions (no ``X-Client-Type: web`` header) keep the legacy body flow.
"""

from django.contrib.auth.models import User
from django.core.cache import cache
from rest_framework.test import APITestCase

from api.auth_views import REFRESH_COOKIE_NAME

WEB = {'HTTP_X_CLIENT_TYPE': 'web'}


class CorsPreflightTests(APITestCase):
    def test_cors_preflight_allows_client_type_header(self):
        # Regression (stage 4): the web login sends X-Client-Type cross-origin;
        # without it in CORS_ALLOW_HEADERS the browser blocks login outright.
        response = self.client.options(
            '/api/token/',
            HTTP_ORIGIN='http://127.0.0.1:5173',
            HTTP_ACCESS_CONTROL_REQUEST_METHOD='POST',
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS='content-type,x-client-type',
        )
        self.assertEqual(response.status_code, 200)
        allowed = response.headers.get('Access-Control-Allow-Headers', '').lower()
        self.assertIn('x-client-type', allowed)
        self.assertEqual(response.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:5173')


class CookieAuthTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='cookie-user', password='test-pass-123')

    def web_login(self):
        return self.client.post(
            '/api/token/', {'username': 'cookie-user', 'password': 'test-pass-123'},
            format='json', **WEB,
        )

    def test_web_login_sets_httponly_cookie_and_hides_refresh_in_body(self):
        response = self.web_login()
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn('access', response.data)
        self.assertNotIn('refresh', response.data)
        cookie = response.cookies[REFRESH_COOKIE_NAME]
        self.assertTrue(cookie['httponly'])
        self.assertEqual(cookie['path'], '/api/token/')
        self.assertTrue(cookie.value)

    def test_extension_login_still_receives_refresh_in_body(self):
        response = self.client.post(
            '/api/token/', {'username': 'cookie-user', 'password': 'test-pass-123'}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn('refresh', response.data)

    def test_refresh_works_with_cookie_only(self):
        self.web_login()  # cookie jar of the test client now holds the token
        response = self.client.post('/api/token/refresh/', {}, format='json', **WEB)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn('access', response.data)
        self.assertNotIn('refresh', response.data)

    def test_cookie_refresh_rotates_and_old_token_is_blacklisted(self):
        login = self.web_login()
        first_cookie = login.cookies[REFRESH_COOKIE_NAME].value
        response = self.client.post('/api/token/refresh/', {}, format='json', **WEB)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertNotEqual(response.cookies[REFRESH_COOKIE_NAME].value, first_cookie)
        # Replaying the rotated-out token must fail.
        self.client.cookies[REFRESH_COOKIE_NAME] = first_cookie
        replay = self.client.post('/api/token/refresh/', {}, format='json', **WEB)
        self.assertEqual(replay.status_code, 401)

    def test_logout_blacklists_cookie_token_and_clears_cookie(self):
        login = self.web_login()
        old_token = login.cookies[REFRESH_COOKIE_NAME].value
        response = self.client.post('/api/token/logout/', {}, format='json', **WEB)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.cookies[REFRESH_COOKIE_NAME].value, '')
        # Even presenting the logged-out token explicitly must now fail,
        # because logout blacklisted it server-side.
        replay = self.client.post('/api/token/refresh/', {'refresh': old_token}, format='json')
        self.assertEqual(replay.status_code, 401)
