# Brief_ POS sync daemon — runs beside the till (or in the prod compose stack)
# and pushes a CSV / manual / Square / Shopify stock feed to the vendor network.
#
#   docker build -t brief-pos-daemon pos-extension
#   docker run --rm -v $PWD/exports:/data -e BRIEF_API=https://brief.example \
#       -e BRIEF_EMAIL=@mama_mboga -e BRIEF_PASSWORD=... brief-pos-daemon \
#       --connection <id> --adapter csv --file /data/stock.csv --interval 60
FROM python:3.11-slim

WORKDIR /daemon
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN useradd --create-home daemon && mkdir -p /data && chown -R daemon /data /daemon
USER daemon
VOLUME ["/data"]

ENV BRIEF_STATE_FILE=/data/.brief-sync-state.json \
    BRIEF_HEALTH_FILE=/data/.brief-sync-health.json \
    PYTHONUNBUFFERED=1

# healthy when the last pass (or the last 3 intervals) succeeded
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import json,sys; sys.exit(0 if json.load(open('/data/.brief-sync-health.json')).get('ok') else 1)"

ENTRYPOINT ["python", "sync_daemon.py"]
CMD ["--help"]
