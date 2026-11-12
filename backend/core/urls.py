"""
URL configuration for core project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.http import Http404
from django.views.static import serve
import posixpath


def serve_public_media(request, path, **kwargs):
    # Normalize before checking: static.serve also resolves dot segments.
    normalized = posixpath.normpath('/' + path.replace('\\', '/')).lstrip('/')
    if normalized.split('/', 1)[0].lower() in {'customer_docs', 'chat_files'}:
        raise Http404
    return serve(request, path, **kwargs)

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('api.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, view=serve_public_media, document_root=settings.MEDIA_ROOT)
