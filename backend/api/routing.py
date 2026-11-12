from django.urls import path

from .consumers import AlertsConsumer, ChatConsumer


websocket_urlpatterns = [
    path('ws/chat/', ChatConsumer.as_asgi()),
    path('ws/alerts/', AlertsConsumer.as_asgi()),
]
