# Mohaseb Pro backend — Django + Daphne (ASGI, serves the chat WebSocket too)
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN chmod +x docker-entrypoint.sh && mkdir -p /data/media

EXPOSE 8000
ENTRYPOINT ["./docker-entrypoint.sh"]
