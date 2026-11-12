"""Authentication views: rate limiting + httpOnly refresh-token cookie.

The stock SimpleJWT views have no throttling, which leaves the login
endpoint open to password brute-force attempts. These subclasses add a
scoped throttle, and move the refresh token of the *web* client into an
httpOnly cookie so page scripts (and any XSS) can no longer read it from
JavaScript-accessible storage.

Compatibility: clients that do not send ``X-Client-Type: web`` (the browser
extensions) keep the previous behaviour and still receive the refresh
token in the response body.
"""

from django.conf import settings
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

REFRESH_COOKIE_NAME = 'mohaseb_refresh_token'
REFRESH_COOKIE_PATH = '/api/token/'


def _is_web_client(request):
    return request.headers.get('X-Client-Type', '').lower() == 'web'


def _set_refresh_cookie(request, response, refresh_token):
    max_age = int(settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME'].total_seconds())
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        refresh_token,
        max_age=max_age,
        httponly=True,
        # Secure only on HTTPS: the app is often served over plain HTTP on a
        # trusted LAN, where a Secure cookie would never be sent back.
        secure=request.is_secure(),
        samesite='Lax',
        path=REFRESH_COOKIE_PATH,
    )


def _delete_refresh_cookie(response):
    response.delete_cookie(REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH, samesite='Lax')


class ThrottledTokenObtainPairView(TokenObtainPairView):
    """Login: at most ``login`` rate (5/min per IP) from settings."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'login'

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200 and response.data.get('refresh'):
            _set_refresh_cookie(request, response, response.data['refresh'])
            if _is_web_client(request):
                # The web client must not persist the refresh token where
                # scripts can read it; it lives only in the httpOnly cookie.
                response.data.pop('refresh', None)
        return response


class ThrottledTokenRefreshView(TokenRefreshView):
    """Refresh: generous limit that still blocks token-guessing loops.

    Accepts the refresh token either in the request body (extensions and
    legacy clients) or from the httpOnly cookie (web client). When the
    cookie is used, the rotated token is written back to the cookie and is
    not exposed in the response body.
    """

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'token_refresh'

    def post(self, request, *args, **kwargs):
        used_cookie = False
        if not request.data.get('refresh'):
            cookie_token = request.COOKIES.get(REFRESH_COOKIE_NAME)
            if cookie_token:
                used_cookie = True
                # request.data was already parsed above; DRF caches the parsed
                # body in both attributes, so replace both.
                merged = {**request.data, 'refresh': cookie_token}
                request._data = merged
                request._full_data = merged
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200 and response.data.get('refresh'):
            _set_refresh_cookie(request, response, response.data['refresh'])
            if used_cookie or _is_web_client(request):
                response.data.pop('refresh', None)
        return response


class TokenLogoutView(APIView):
    """Blacklist the current refresh token and clear its cookie.

    Accepts the token from the body or the httpOnly cookie, so the web
    client can log out for real instead of only forgetting tokens locally.
    """

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'token_refresh'

    def post(self, request):
        token = request.data.get('refresh') or request.COOKIES.get(REFRESH_COOKIE_NAME)
        if token:
            try:
                RefreshToken(token).blacklist()
            except TokenError:
                pass  # Already invalid/blacklisted: logging out still succeeds.
        response = Response({'detail': 'با موفقیت خارج شدید.'})
        _delete_refresh_cookie(response)
        return response
