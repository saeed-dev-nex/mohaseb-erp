"""
ASGI config for core project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/6.0/howto/deployment/asgi/

In production mode (``DJANGO_SERVE_FRONTEND=true`` and a frontend build in
``frontend/dist``) the HTTP application also serves the built frontend and
public uploaded media through WhiteNoise on the same port, so a single Daphne
process runs the whole app. API, admin and websocket traffic always goes to
Django/Channels; everything else is treated as a frontend asset or an SPA
route. Development mode is unchanged (Django only).
"""

import os
import posixpath
from pathlib import Path

from django.conf import settings
from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')

django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator
from api.routing import websocket_urlpatterns

# Paths that must always reach Django, never the static frontend app.
DJANGO_PATH_PREFIXES = ('/api/', '/admin/', '/static/')


def _not_found_wsgi(environ, start_response):
    start_response('404 Not Found', [('Content-Type', 'text/plain; charset=utf-8')])
    return [b'Not Found']


def build_frontend_app(dist, media_root=None, media_url='/media/'):
    """WSGI app serving the frontend build (SPA) plus uploaded media.

    Unknown paths without a file extension fall back to ``index.html`` so
    client-side routes (e.g. ``/invoices/3``) survive a page reload; paths
    that look like files keep a real 404.
    """
    from whitenoise import WhiteNoise

    class SpaWhiteNoise(WhiteNoise):
        def __call__(self, environ, start_response):
            path = environ.get('PATH_INFO', '')
            normalized = posixpath.normpath('/' + path.replace('\\', '/').lstrip('/'))
            media_prefix = '/' + media_url.strip('/') + '/'
            if normalized.lower().startswith(media_prefix.lower()):
                media_path = normalized[len(media_prefix):].split('/', 1)[0].lower()
                if media_path in {'customer_docs', 'chat_files'}:
                    return _not_found_wsgi(environ, start_response)
            if (
                environ.get('REQUEST_METHOD', 'GET') in ('GET', 'HEAD')
                and '.' not in path.rsplit('/', 1)[-1]
                and self.find_file(path) is None
            ):
                # Client-side route (e.g. /invoices/3): serve the app shell
                # and let the frontend router take over.
                environ = dict(environ, PATH_INFO='/')
            return super().__call__(environ, start_response)

    # autorefresh: uploaded media files must become visible without a server
    # restart; at this app's scale the per-request filesystem check is cheap.
    app = SpaWhiteNoise(
        _not_found_wsgi, root=str(dist), index_file='index.html', autorefresh=True
    )
    if media_root and Path(media_root).exists():
        app.add_files(str(media_root), prefix=media_url)
    return app


def _build_http_application():
    if not getattr(settings, 'SERVE_FRONTEND', False):
        return django_asgi_app
    dist = Path(settings.FRONTEND_DIST)
    if not (dist / 'index.html').exists():
        return django_asgi_app
    from asgiref.wsgi import WsgiToAsgi

    static_app = WsgiToAsgi(build_frontend_app(
        dist,
        media_root=settings.MEDIA_ROOT,
        media_url=settings.MEDIA_URL,
    ))

    async def http_application(scope, receive, send):
        if scope.get('path', '').startswith(DJANGO_PATH_PREFIXES):
            await django_asgi_app(scope, receive, send)
        else:
            await static_app(scope, receive, send)

    return http_application


application = ProtocolTypeRouter({
    'http': _build_http_application(),
    'websocket': AllowedHostsOriginValidator(URLRouter(websocket_urlpatterns)),
})
