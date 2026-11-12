"""Opt-in pagination for list endpoints.

The frontend was built against plain JSON arrays, so pagination must not
change existing responses. It activates only when the client asks for it
with ``?page=`` or ``?page_size=``; larger screens and future clients can
then page through big lists instead of downloading everything at once.
"""

from rest_framework.pagination import PageNumberPagination


class OptionalPageNumberPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 200

    def paginate_queryset(self, queryset, request, view=None):
        if 'page' not in request.query_params and 'page_size' not in request.query_params:
            return None
        return super().paginate_queryset(queryset, request, view=view)
