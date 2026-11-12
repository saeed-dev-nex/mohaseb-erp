"""First-run setup wizard endpoints.

Active ONLY while no superuser exists: status, PostgreSQL
configuration (reusing the staged migration machinery — the admin
account is created afterwards, so it lands in the final database)
and superuser creation. Once an administrator exists, every setup
endpoint closes with 403.
"""

from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .. import db_migration

User = get_user_model()


def _needs_setup():
    return not User.objects.filter(is_superuser=True).exists()


def _closed():
    return Response(
        {'detail': 'راه‌اندازی اولیه قبلاً انجام شده است.'}, status=403,
    )


class SetupStatusView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        db_status = db_migration.current_status()
        return Response({
            'needs_setup': _needs_setup(),
            'engine': db_status['engine'],
            'source': db_status['source'],
        })


class SetupTestDatabaseView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        if not _needs_setup():
            return _closed()
        try:
            params = db_migration.clean_params(request.data)
        except ValueError as error:
            return Response({'ok': False, 'detail': str(error)}, status=400)
        ok, error, _stats = db_migration.test_pg_connection(params)
        if not ok:
            return Response({'ok': False, 'detail': error}, status=400)
        return Response({'ok': True})


class SetupConfigureDatabaseView(APIView):
    """Stage the switch to PostgreSQL; a restart applies it."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        if not _needs_setup():
            return _closed()
        status = db_migration.current_status()
        if status['source'] == 'env':
            return Response(
                {'detail': 'پایگاه داده با متغیر محیطی DATABASE_URL مدیریت می‌شود و از داخل برنامه قابل تغییر نیست.'},
                status=400,
            )
        if status['engine'] == 'postgresql':
            return Response(
                {'detail': 'برنامه در حال حاضر روی PostgreSQL اجرا می‌شود.'},
                status=400,
            )
        try:
            params = db_migration.clean_params(request.data)
            counts = db_migration.start_migration(params)
        except ValueError as error:
            return Response({'detail': str(error)}, status=400)
        return Response({'started': True, 'counts': counts, 'restart_required': True})


class SetupCreateAdminView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        username = str(request.data.get('username') or '').strip()
        password = str(request.data.get('password') or '')
        password_confirm = str(request.data.get('password_confirm') or '')
        first_name = str(request.data.get('first_name') or '').strip()
        last_name = str(request.data.get('last_name') or '').strip()
        if not username:
            return Response({'detail': 'نام کاربری الزامی است.'}, status=400)
        if len(password) < 8:
            return Response({'detail': 'رمز عبور باید دست‌کم ۸ نویسه باشد.'}, status=400)
        if password != password_confirm:
            return Response({'detail': 'تکرار رمز عبور همخوان نیست.'}, status=400)
        with transaction.atomic():
            if not _needs_setup():
                return _closed()
            if User.objects.filter(username=username).exists():
                return Response(
                    {'detail': 'این نام کاربری قبلاً گرفته شده است.'}, status=400,
                )
            user = User.objects.create_superuser(
                username=username, password=password, email='',
                first_name=first_name, last_name=last_name,
            )
        return Response(
            {'created': True, 'username': user.username}, status=201,
        )
