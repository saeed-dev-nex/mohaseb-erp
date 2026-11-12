"""Production single-process serving: the WhiteNoise frontend app must
serve the SPA build, fall back to index.html for client-side routes, keep
real 404s for missing files, and serve uploaded media."""

import io
import tempfile
from pathlib import Path
from wsgiref.util import setup_testing_defaults

from django.test import SimpleTestCase

from core.asgi import build_frontend_app


def call_wsgi(app, path):
    environ = {}
    setup_testing_defaults(environ)
    environ['REQUEST_METHOD'] = 'GET'
    environ['PATH_INFO'] = path
    environ['wsgi.input'] = io.BytesIO(b'')
    captured = {}

    def start_response(status, headers, exc_info=None):
        captured['status'] = status

    body = b''.join(app(environ, start_response))
    return captured['status'], body


class FrontendServingTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        cls.dist = root / 'dist'
        (cls.dist / 'assets').mkdir(parents=True)
        (cls.dist / 'index.html').write_text('<html>APP SHELL</html>', encoding='utf-8')
        (cls.dist / 'assets' / 'app-abc123.js').write_text('console.log(1)', encoding='utf-8')
        cls.media = root / 'media'
        (cls.media / 'docs').mkdir(parents=True)
        (cls.media / 'docs' / 'note.txt').write_text('MEDIA FILE', encoding='utf-8')
        cls.app = build_frontend_app(cls.dist, media_root=cls.media, media_url='/media/')

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()
        super().tearDownClass()

    def test_root_serves_app_shell(self):
        status, body = call_wsgi(self.app, '/')
        self.assertEqual(status, '200 OK')
        self.assertIn(b'APP SHELL', body)

    def test_spa_route_falls_back_to_app_shell(self):
        status, body = call_wsgi(self.app, '/invoices/3')
        self.assertEqual(status, '200 OK')
        self.assertIn(b'APP SHELL', body)

    def test_hashed_asset_is_served(self):
        status, body = call_wsgi(self.app, '/assets/app-abc123.js')
        self.assertEqual(status, '200 OK')
        self.assertIn(b'console.log(1)', body)

    def test_missing_file_keeps_real_404(self):
        status, _body = call_wsgi(self.app, '/assets/missing.png')
        self.assertEqual(status, '404 Not Found')

    def test_media_file_is_served(self):
        status, body = call_wsgi(self.app, '/media/docs/note.txt')
        self.assertEqual(status, '200 OK')
        self.assertIn(b'MEDIA FILE', body)
