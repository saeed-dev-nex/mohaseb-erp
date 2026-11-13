# Mohaseb ERP backend — Django + Daphne (ASGI, serves the chat WebSocket too)
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# The app runs as an unprivileged user; docker-entrypoint.sh starts as
# root only to fix ownership of the data volume, then drops to appuser.
RUN groupadd --system appuser && useradd --system --gid appuser appuser \
    && chmod +x docker-entrypoint.sh serve.sh \
    && mkdir -p /data/media \
    && chown -R appuser:appuser /app /data

EXPOSE 8000
ENTRYPOINT ["./docker-entrypoint.sh"]
