"""In-app update endpoints: superuser-only status, check and approve."""

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .common import IsSuperuser


class AppUpdateViewSet(viewsets.ViewSet):
    """See what the next update changes, then approve installing it."""

    permission_classes = [IsSuperuser]

    def list(self, request):
        from ..app_update import get_update_status, quick_update_status

        if request.query_params.get('quick'):
            return Response(quick_update_status())
        return Response(get_update_status())

    @action(detail=False, methods=['post'])
    def check(self, request):
        from ..app_update import get_update_status

        return Response(get_update_status(force=True))

    @action(detail=False, methods=['post'])
    def apply(self, request):
        from ..app_update import approve_update

        ok, detail = approve_update(requested_by=request.user.username)
        if not ok:
            return Response(detail, status=status.HTTP_400_BAD_REQUEST)
        return Response(detail)
