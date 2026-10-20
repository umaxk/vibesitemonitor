FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    MONITOR_CONFIG_PATH=/app/data/config.json \
    MONITOR_LOG_PATH=/app/data/monitor.log \
    MONITOR_DB_PATH=/app/data/monitor.db

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY static/ ./static/

EXPOSE 1485

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:1485/healthz', timeout=3)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "1485"]
