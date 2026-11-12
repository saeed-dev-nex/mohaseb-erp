"""Private media must be retrieved through module-gated API downloads only."""

import re
import tempfile
from pathlib import Path
from types import ModuleType

from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings
from django.urls import path
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from api.models import BusinessProfile, ChatMessage, Customer, Document, Invoice, UserModuleAccess
from api.serializers import DocumentSerializer
from api.tests.test_static_serving import call_wsgi
from core.asgi import build_frontend_app
from core.urls import serve_public_media


class PrivateMediaServingTests(SimpleTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.media = self.root / 'media'
        for folder in ('customer_docs', 'chat_files', 'logos'):
            (self.media / folder).mkdir(parents=True)
            (self.media / folder / 'sample.txt').write_text(folder, encoding='utf-8')
        self.dist = self.root / 'dist'
        self.dist.mkdir()
        (self.dist / 'index.html').write_text('APP SHELL', encoding='utf-8')

    def test_debug_media_routes_deny_private_files_but_serve_public_logos(self):
        # Use Django's actual development-media view with an isolated root.
        urls = ModuleType('isolated_media_urls')
        setattr(urls, 'urlpatterns', [
            path('media/<path:path>', serve_public_media, {'document_root': self.media}),
        ])
        with override_settings(DEBUG=True, ROOT_URLCONF=urls):
            for private in ('customer_docs/sample.txt', 'chat_files/sample.txt', 'public/../customer_docs/sample.txt'):
                with self.subTest(private=private):
                    self.assertEqual(self.client.get('/media/' + private).status_code, 404)
            public = self.client.get('/media/logos/sample.txt')
            self.assertEqual(public.status_code, 200)
            self.assertEqual(b''.join(public.streaming_content), b'logos')
            public.close()

    def test_production_media_denies_private_prefixes_including_spa_fallback(self):
        app = build_frontend_app(self.dist, media_root=self.media)
        for private in (
            'customer_docs/sample.txt', 'chat_files/sample.txt', 'customer_docs',
            'chat_files/missing', 'public/../customer_docs/sample.txt', 'CUSTOMER_DOCS/sample.txt',
        ):
            with self.subTest(private=private):
                status, body = call_wsgi(app, '/media/' + private)
                self.assertEqual(status, '404 Not Found')
                self.assertNotIn(b'APP SHELL', body)
                self.assertNotIn(b'customer_docs', body)
        self.assertEqual(call_wsgi(app, '/media/logos/sample.txt'), ('200 OK', b'logos'))

    def test_nginx_blocks_both_private_prefixes_before_public_alias(self):
        config = (Path(__file__).resolve().parents[3] / 'frontend' / 'nginx.conf').read_text(encoding='utf-8')
        rule = re.search(r'location\s+~\*\s+\^/media/\(customer_docs\|chat_files\)\(/\|\$\)\s*\{\s*return 404;', config)
        self.assertIsNotNone(rule)
        if rule is not None:
            self.assertLess(rule.start(), config.index('location /media/'))


class DocumentSecurityTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        settings = override_settings(MEDIA_ROOT=self.tmp.name)
        settings.enable()
        self.addCleanup(settings.disable)
        self.user = User.objects.create_user(username='document-operator')
        self.other_user = User.objects.create_user(username='other-operator')
        self.customer = Customer.objects.create(name='Synthetic customer')
        self.other_customer = Customer.objects.create(name='Other synthetic customer')
        self.invoice = Invoice.objects.create(customer=self.customer)
        self.doc = Document.objects.create(
            customer=self.customer, invoice=self.invoice, title='Synthetic PDF',
            file=SimpleUploadedFile('sample.pdf', b'%PDF-1.7\nsynthetic document'),
            file_path='/private/server/folder/sample.pdf',
        )

    def authenticate(self, user=None):
        token = AccessToken.for_user(user or self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

    def upload(self, name='note.txt', content=b'synthetic note', **extra):
        return self.client.post('/api/documents/', {
            'customer': self.customer.pk, 'title': 'Synthetic upload',
            'file': SimpleUploadedFile(name, content), **extra,
        }, format='multipart')

    def test_document_download_requires_authentication(self):
        self.assertEqual(self.client.get(f'/api/documents/{self.doc.pk}/download/').status_code, 401)

    def test_document_download_requires_customers_module(self):
        UserModuleAccess.objects.create(user=self.user, customers=False)
        self.authenticate()
        self.assertEqual(self.client.get(f'/api/documents/{self.doc.pk}/download/').status_code, 403)

    def test_authorized_document_download_and_no_physical_path_disclosure(self):
        self.authenticate()
        detail = self.client.get(f'/api/documents/{self.doc.pk}/').data
        self.assertTrue(detail['file_url'].endswith(f'/api/documents/{self.doc.pk}/download/'))
        self.assertIn(self.invoice.invoice_number, detail['file_name'])
        self.assertIn('Synthetic_PDF', detail['file_name'])
        self.assertTrue(detail['file_name'].endswith('.pdf'))
        self.assertNotIn('file', detail)
        self.assertNotIn('file_path', detail)
        response = self.client.get(f'/api/documents/{self.doc.pk}/download/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(b''.join(response.streaming_content), b'%PDF-1.7\nsynthetic document')
        self.assertIn('attachment;', response['Content-Disposition'])
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertEqual(response['X-Content-Type-Options'], 'nosniff')

    def test_invoice_document_uses_title_and_invoice_number_and_supports_inline_preview(self):
        self.authenticate()
        response = self.upload(
            name='receipt.png',
            content=b'\x89PNG\r\n\x1a\nsynthetic image',
            invoice=self.invoice.pk,
            title='رسید پرداخت',
        )
        self.assertEqual(response.status_code, 201, response.data)
        document = Document.objects.latest('id')
        self.assertIn(self.invoice.invoice_number, document.file.name)
        self.assertIn('رسید_پرداخت', document.file.name)
        self.assertTrue(response.data['is_image'])
        self.assertTrue(response.data['preview_url'].endswith(f'/api/documents/{document.pk}/preview/'))

        preview = self.client.get(f'/api/documents/{document.pk}/preview/')
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview['Content-Type'], 'image/png')
        self.assertTrue(preview['Content-Disposition'].startswith('inline'))
        self.assertEqual(b''.join(preview.streaming_content), b'\x89PNG\r\n\x1a\nsynthetic image')

    def test_document_title_is_required(self):
        self.authenticate()
        response = self.upload(title='   ')
        self.assertEqual(response.status_code, 400)
        self.assertIn('title', response.data)

    def test_missing_file_returns_404_without_path(self):
        self.authenticate()
        self.doc.file.delete(save=False)
        response = self.client.get(f'/api/documents/{self.doc.pk}/download/')
        self.assertEqual(response.status_code, 404)
        self.assertNotIn(self.tmp.name, str(response.data))

    def test_upload_and_patch_cannot_set_server_file_path(self):
        self.authenticate()
        response = self.upload(file_path='/arbitrary/server/file')
        self.assertEqual(response.status_code, 400)
        response = self.client.patch(f'/api/documents/{self.doc.pk}/', {'file_path': '/arbitrary/server/file'}, format='multipart')
        self.assertEqual(response.status_code, 400)
        self.doc.refresh_from_db()
        self.assertEqual(self.doc.file_path, '/private/server/folder/sample.pdf')

    def test_safe_upload_and_invoice_customer_match(self):
        self.authenticate()
        self.assertEqual(self.upload(invoice=self.invoice.pk).status_code, 201)
        other_invoice = Invoice.objects.create(customer=self.other_customer)
        response = self.upload(invoice=other_invoice.pk)
        self.assertEqual(response.status_code, 400)
        self.assertIn('invoice', response.data)
        response = self.client.patch(f'/api/documents/{self.doc.pk}/', {'customer': self.other_customer.pk}, format='multipart')
        self.assertEqual(response.status_code, 400)

    def test_safe_pdf_image_office_and_persian_text_uploads(self):
        from io import BytesIO
        from zipfile import ZipFile

        archive = BytesIO()
        with ZipFile(archive, 'w') as office:
            office.writestr('[Content_Types].xml', '<Types/>')
            office.writestr('word/document.xml', '<document/>')
        self.authenticate()
        for name, content in (
            ('safe.pdf', b'%PDF-1.7\nsynthetic document'),
            ('safe.png', b'\x89PNG\r\n\x1a\nsynthetic image'),
            ('safe.docx', archive.getvalue()),
            ('persian.txt', b'x' * 4095 + 'متن فارسی'.encode('utf-8')),
        ):
            with self.subTest(name=name):
                response = self.upload(name, content)
                self.assertEqual(response.status_code, 201, response.data)

    def test_upload_rejects_active_types_executables_and_renamed_files(self):
        self.authenticate()
        for name, content in (
            ('active.html', b'<html>active</html>'), ('active.svg', b'<svg/>'),
            ('program.exe', b'MZ executable'), ('renamed.pdf', b'<html>active</html>'),
            ('renamed.txt', b'<svg onload="alert(1)"/>'), ('renamed.csv', b'MZ executable'),
            ('renamed.jpg', b'<script>active</script>'), ('invalid.docx', b'not an office archive'),
        ):
            with self.subTest(name=name):
                response = self.upload(name, content)
                self.assertEqual(response.status_code, 400)
                self.assertIn('file', response.data)

    def test_upload_size_is_limited_without_allocating_a_large_file(self):
        uploaded = SimpleUploadedFile('large.txt', b'note')
        uploaded.size = 20 * 1024 * 1024 + 1
        serializer = DocumentSerializer(data={'customer': self.customer.pk, 'title': 'Large', 'file': uploaded})
        self.assertFalse(serializer.is_valid())
        self.assertIn('file', serializer.errors)

    def test_folder_listing_never_exposes_server_paths(self):
        self.authenticate()
        folder = Path(self.tmp.name) / f'{self.customer.pk}_{self.customer.name}'
        folder.mkdir()
        (folder / 'synthetic.txt').write_text('synthetic', encoding='utf-8')
        profile = BusinessProfile.load()
        profile.customer_documents_path = self.tmp.name
        profile.save()
        response = self.client.get('/api/documents/customer_folder_files/', {'customer': self.customer.pk})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('folder', response.data)
        self.assertNotIn('path', response.data['files'][0])
        self.assertNotIn(self.tmp.name, str(response.data))

    def test_chat_download_remains_participant_and_module_authorized(self):
        private = ChatMessage.objects.create(
            sender=self.user, recipient=self.other_user,
            file=SimpleUploadedFile('chat.txt', b'synthetic chat'),
        )
        url = f'/api/chat/{private.pk}/download/'
        self.assertEqual(self.client.get(url).status_code, 401)
        outsider = User.objects.create_user(username='chat-outsider')
        self.authenticate(outsider)
        self.assertEqual(self.client.get(url).status_code, 404)
        self.authenticate(self.other_user)
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(b''.join(response.streaming_content), b'synthetic chat')
        UserModuleAccess.objects.create(user=self.other_user, chat=False)
        self.assertEqual(self.client.get(url).status_code, 403)
