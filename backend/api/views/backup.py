"""Backup configuration, download and restore endpoints."""

from rest_framework import viewsets, status, filters
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import BasePermission, IsAuthenticated, IsAdminUser
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from django.db.models import Sum, Count, Q, OuterRef, Subquery, DecimalField, Value, Case, When, F, ExpressionWrapper
from django.db.models.functions import Coalesce
from django.db import transaction, connection
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from datetime import timedelta, date
from django.http import JsonResponse, HttpResponse
from django.http import FileResponse
from django.core.paginator import Paginator, EmptyPage
from django.shortcuts import get_object_or_404
from django.contrib.auth.models import User
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
import json, calendar, os, shutil
from zoneinfo import ZoneInfo

from ..models import (
    Customer, Service, Invoice, InvoiceEditRequest, InvoicePayment, AuditLog, Document,
    BusinessProfile, ExpenseCategory, Expense, Staff, VehicleType, BackupConfig,
    Cheque, InvoiceSettings, ChatMessage, ChatNotification, ChatPresence,
    WelcomeSettings, UserWelcomeMessage, WelcomeMessageShown, SocialNetwork
)
from ..serializers import (
    CustomerListSerializer, CustomerDetailSerializer,
    ServiceSerializer, InvoiceSerializer, DocumentSerializer,
    BusinessProfileSerializer, ExpenseCategorySerializer,
    ExpenseSerializer, StaffSerializer, VehicleTypeSerializer,
    UserSerializer, BackupConfigSerializer, InvoiceSettingsSerializer, ChequeSerializer, InvoicePaymentSerializer, AuditLogSerializer, ChatMessageSerializer, SocialNetworkSerializer
)
from ..audit import snapshot, record_audit, is_invoice_content_version
from .common import IsSuperuser




class BackupConfigViewSet(viewsets.ViewSet):
    """Backup configuration and on-demand backup execution"""
    permission_classes = [IsSuperuser]

    def list(self, request):
        cfg = BackupConfig.load()
        return Response(BackupConfigSerializer(cfg).data)

    @action(detail=False, methods=['put', 'patch'])
    def update_config(self, request):
        cfg = BackupConfig.load()
        serializer = BackupConfigSerializer(cfg, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def browse_folders(self, request):
        """List server folders for the superuser backup destination picker."""
        requested_path = request.query_params.get('path', '').strip()
        if os.name == 'nt':
            if requested_path:
                current_path = os.path.abspath(requested_path)
                if not os.path.isdir(current_path):
                    return Response({'detail': 'پوشهٔ سرور پیدا نشد.'}, status=status.HTTP_400_BAD_REQUEST)
                roots = [os.path.splitdrive(current_path)[0] + os.sep]
            else:
                roots = [f'{letter}:\\' for letter in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' if os.path.isdir(f'{letter}:\\')]
                current_path = ''
        else:
            current_path = os.path.abspath(requested_path or os.sep)
            if not os.path.isdir(current_path):
                return Response({'detail': 'پوشهٔ سرور پیدا نشد.'}, status=status.HTTP_400_BAD_REQUEST)
            roots = [os.sep]

        if not current_path:
            return Response({'path': '', 'parent': None, 'roots': roots, 'folders': []})

        folders = []
        try:
            with os.scandir(current_path) as entries:
                for entry in entries:
                    try:
                        if entry.is_dir():
                            folders.append({'name': entry.name, 'path': entry.path})
                    except OSError:
                        continue
        except OSError:
            return Response({'detail': 'امکان خواندن این پوشه وجود ندارد.'}, status=status.HTTP_400_BAD_REQUEST)

        folders.sort(key=lambda folder: folder['name'].casefold())
        parent_path = os.path.dirname(os.path.normpath(current_path))
        if parent_path == current_path or (os.name == 'nt' and parent_path == os.path.splitdrive(current_path)[0]):
            parent_path = None
        return Response({'path': current_path, 'parent': parent_path, 'roots': roots, 'folders': folders})

    @action(detail=False, methods=['post'])
    def run_backup(self, request):
        """Save to an explicit server path or return a downloadable backup.

        An optional ``passphrase`` encrypts the backup (AES-256-GCM) both for
        download and for server-path saves. Scheduled backups are encrypted
        with the stored backup passphrase when one is configured (and stay
        plain otherwise).
        """
        cfg = BackupConfig.load()
        backup_path = (request.data.get('path') or '').strip()
        from ..backup_utils import build_backup, encrypt_backup
        try:
            backup = build_backup()
        except ValueError as error:
            # Invalid attachment paths and unreadable media are expected
            # backup failures; report them to the caller instead of returning
            # an unhandled 500 response.
            return Response({'detail': str(error)}, status=status.HTTP_400_BAD_REQUEST)
        json_str = json.dumps(backup, ensure_ascii=False, indent=2, default=str)
        passphrase = (request.data.get('passphrase') or '').strip()
        if passphrase:
            try:
                json_str = json.dumps(encrypt_backup(json_str, passphrase), ensure_ascii=False, indent=2)
            except ValueError as error:
                return Response({'detail': str(error)}, status=status.HTTP_400_BAD_REQUEST)
        filename = f"mohaseb_backup_{timezone.now().strftime('%Y%m%d_%H%M%S')}.json"

        if backup_path:
            if not os.path.isdir(backup_path):
                return Response(
                    {'detail': 'پوشهٔ انتخاب‌شده روی سرور وجود ندارد.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return self._save_backup_to_path(cfg, backup_path, filename, json_str)

        # Otherwise return as downloadable JSON
        from django.http import HttpResponse
        response = HttpResponse(json_str, content_type='application/json; charset=utf-8')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response

    def _save_backup_to_path(self, cfg, backup_path, filename, json_str):
        dest = os.path.join(backup_path, filename)
        temp_dest = dest + '.tmp'
        try:
            with open(temp_dest, 'w', encoding='utf-8') as backup_file:
                backup_file.write(json_str)
                backup_file.flush()
                os.fsync(backup_file.fileno())
            os.replace(temp_dest, dest)
        except OSError as error:
            return Response(
                {'detail': f'ذخیرهٔ بکاپ در مسیر سرور انجام نشد: {error}'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        cfg.last_backup_at = timezone.now()
        cfg.last_backup_path = dest
        cfg.save()
        # Best-effort cloud copy: a cloud failure must never undo the local backup.
        cloud = None
        try:
            from ..cloud_backup import upload_local_backup
            cloud = upload_local_backup(cfg, dest, filename)
        except Exception:
            cloud = {'uploaded': False, 'reason': 'خطای داخلی در آپلود ابری'}
        return Response({'saved': True, 'path': dest, 'filename': filename, 'cloud': cloud})

    def _cloud_error_response(self, error):
        from ..cloud_backup import CloudBackupError
        if isinstance(error, CloudBackupError):
            detail = str(error)
        else:
            detail = f'خطای ابری: {str(error)[:300]}'
        return Response({'detail': detail}, status=status.HTTP_400_BAD_REQUEST)

    def _cloud_config_or_error(self, cfg, overrides=None):
        """Stored cloud config, optionally overridden (for test-before-save)."""
        from ..cloud_backup import is_configured
        candidate = BackupConfig(
            cloud_endpoint=((overrides or {}).get('cloud_endpoint') or cfg.cloud_endpoint or '').strip(),
            cloud_bucket=((overrides or {}).get('cloud_bucket') or cfg.cloud_bucket or '').strip(),
            cloud_access_key=((overrides or {}).get('cloud_access_key') or cfg.cloud_access_key or '').strip(),
            cloud_secret_key=((overrides or {}).get('cloud_secret_key') or cfg.decrypted_cloud_secret_key() or '').strip(),
        )
        if not is_configured(candidate):
            return None, Response(
                {'detail': 'پیکربندی ابری کامل نیست؛ نقطهٔ پایانی، باکت و کلیدها را وارد کنید.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return candidate, None

    @action(detail=False, methods=['post'])
    def test_cloud(self, request):
        """Check endpoint/bucket/credentials without saving them."""
        from ..cloud_backup import test_connection
        cfg = BackupConfig.load()
        candidate, error = self._cloud_config_or_error(cfg, request.data)
        if error is not None:
            return error
        try:
            test_connection(candidate)
        except Exception as error:
            return self._cloud_error_response(error)
        return Response({'ok': True})

    @action(detail=False, methods=['get'])
    def list_cloud(self, request):
        """Newest-first list of backup objects in the configured bucket."""
        from ..cloud_backup import get_s3_client, list_backups
        cfg = BackupConfig.load()
        candidate, error = self._cloud_config_or_error(cfg)
        if error is not None:
            return error
        try:
            backups = list_backups(get_s3_client(candidate), candidate.cloud_bucket)
        except Exception as error:
            return self._cloud_error_response(error)
        return Response({'backups': backups})

    @action(detail=False, methods=['post'])
    def upload_latest(self, request):
        """Upload the last server-side backup file to the cloud now."""
        from ..cloud_backup import upload_local_backup
        cfg = BackupConfig.load()
        if not cfg.last_backup_path or not os.path.isfile(cfg.last_backup_path):
            return Response(
                {'detail': 'آخرین بکاپ روی سرور پیدا نشد.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        result = upload_local_backup(
            cfg, cfg.last_backup_path, os.path.basename(cfg.last_backup_path))
        if not result.get('uploaded'):
            return Response({'detail': result.get('reason', 'آپلود ابری ناموفق بود.')},
                            status=status.HTTP_400_BAD_REQUEST)
        return Response(result)

    @action(detail=False, methods=['post'])
    def restore_cloud(self, request):
        """Download one cloud backup and restore it (two-step, like restore).

        Without ``confirm_replace`` this only validates and returns counts;
        with it, the current data is replaced, exactly like a file restore.
        """
        from ..cloud_backup import download_object, get_s3_client
        from ..backup_utils import decrypt_backup_with_fallbacks, is_encrypted_backup, restore_backup, validate_backup
        cfg = BackupConfig.load()
        key = (request.data.get('key') or '').strip()
        if not key:
            return Response({'detail': 'کلید بکاپ ابری مشخص نشده است.'},
                            status=status.HTTP_400_BAD_REQUEST)
        candidate, error = self._cloud_config_or_error(cfg)
        if error is not None:
            return error
        try:
            raw = download_object(get_s3_client(candidate), candidate.cloud_bucket, key)
            backup = json.loads(raw.decode('utf-8'))
            passphrase_source = None
            if is_encrypted_backup(backup):
                # Cloud backups are encrypted with the stored backup
                # passphrase, so it is the natural default: no typing
                # needed while it is unchanged. A typed passphrase (the
                # one from when the file was made) is tried first.
                typed = (request.data.get('passphrase') or '').strip()
                backup, matched = decrypt_backup_with_fallbacks(
                    backup,
                    [typed, cfg.decrypted_cloud_passphrase()],
                )
                passphrase_source = 'typed' if typed and matched == typed else 'stored'
            counts = validate_backup(backup)
            if request.data.get('confirm_replace') is not True:
                return Response({'valid': True, 'counts': counts, 'requires_confirmation': True, 'passphrase_source': passphrase_source})
            restore_backup(backup, fallback_user_id=request.user.pk)
            return Response({'valid': True, 'restored': True, 'counts': counts, 'passphrase_source': passphrase_source})
        except Exception as error:
            return Response({'detail': str(error) or 'بازیابی از بکاپ ابری انجام نشد.'},
                            status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'], permission_classes=[IsSuperuser])
    def check_auto(self, request):
        """Superuser fallback; never disclose server paths or internal errors."""
        from ..scheduler import run_due_backup
        result = run_due_backup()
        return Response({'ran': bool(result.get('ran')), 'saved': bool(result.get('saved'))})

class BackupViewSet(viewsets.ViewSet):
    """Backup and restore all data"""
    permission_classes = [IsSuperuser]

    @action(detail=False, methods=['get', 'post'])
    def download(self, request):
        """Download full backup as JSON; POST with ``passphrase`` encrypts it."""
        from ..backup_utils import build_backup, encrypt_backup
        from django.http import HttpResponse
        json_str = json.dumps(build_backup(), ensure_ascii=False, indent=2, default=str)
        passphrase = (request.data.get('passphrase') or '').strip() if request.method == 'POST' else ''
        if passphrase:
            try:
                envelope = encrypt_backup(json_str, passphrase)
            except ValueError as error:
                return Response({'detail': str(error)}, status=400)
            json_str = json.dumps(envelope, ensure_ascii=False, indent=2)
        response = HttpResponse(
            json_str,
            content_type='application/json; charset=utf-8'
        )
        response['Content-Disposition'] = f'attachment; filename="mohaseb_backup_{timezone.now().strftime("%Y%m%d_%H%M%S")}.json"'
        return response

    @action(detail=False, methods=['post'])
    def restore(self, request):
        if not request.user.is_superuser:
            return Response({'detail': 'بازیابی نسخهٔ پشتیبان فقط برای مدیر ارشد مجاز است.'}, status=403)
        backup = request.data.get('backup')
        try:
            if request.data.get('backup_json'):
                backup = json.loads(request.data['backup_json'])
            from ..backup_utils import decrypt_backup_with_fallbacks, is_encrypted_backup, restore_backup, validate_backup
            passphrase_source = None
            if is_encrypted_backup(backup):
                # Recovery: the typed passphrase wins, but the stored
                # backup passphrase is tried too — scheduler and cloud
                # backups are made with it, and it may have been what
                # encrypted this file even if the user typed another.
                stored = BackupConfig.load().decrypted_cloud_passphrase()
                typed = (request.data.get('passphrase') or '').strip()
                backup, matched = decrypt_backup_with_fallbacks(
                    backup,
                    [typed, stored],
                )
                passphrase_source = 'typed' if typed and matched == typed else 'stored'
            counts = validate_backup(backup)
            if request.data.get('confirm_replace') is not True:
                return Response({'valid': True, 'counts': counts, 'requires_confirmation': True, 'passphrase_source': passphrase_source})
            restore_backup(backup, fallback_user_id=request.user.pk)
            return Response({'valid': True, 'restored': True, 'counts': counts, 'passphrase_source': passphrase_source})
        except Exception as error:
            return Response({'detail': str(error) or 'بازیابی نسخهٔ پشتیبان انجام نشد.'}, status=400)
