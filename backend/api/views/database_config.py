"""Database configuration endpoints: status + PostgreSQL wizard."""

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .. import db_migration
from .common import IsSuperuser


class DatabaseConfigViewSet(viewsets.ViewSet):
    """Superuser-only: see the active database and migrate to PostgreSQL."""

    permission_classes = [IsSuperuser]

    def list(self, request):
        return Response(db_migration.current_status())

    @action(detail=False, methods=['post'])
    def test_connection(self, request):
        try:
            params = db_migration.clean_params(request.data)
        except ValueError as error:
            return Response({'ok': False, 'detail': str(error)}, status=400)
        ok, error, _stats = db_migration.test_pg_connection(params)
        if not ok:
            return Response({'ok': False, 'detail': error}, status=400)
        return Response({'ok': True})

    @action(detail=False, methods=['post'])
    def start_migration(self, request):
        status = db_migration.current_status()
        if status['source'] == 'env':
            return Response(
                {
                    'detail': 'پایگاه داده با متغیر محیطی DATABASE_URL مدیریت '
                    'می‌شود و از داخل برنامه قابل تغییر نیست.'
                },
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
        return Response(
            {'started': True, 'counts': counts, 'restart_required': True}
        )

    @action(detail=False, methods=['post'])
    def rollback(self, request):
        if db_migration.connection_source() == 'env':
            return Response(
                {
                    'detail': 'پایگاه داده با متغیر محیطی DATABASE_URL مدیریت '
                    'می‌شود و از داخل برنامه قابل تغییر نیست.'
                },
                status=400,
            )
        db_migration.cancel_or_rollback()
        return Response({'ok': True, 'restart_required': True})
