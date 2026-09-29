# pos-extension — the POS Bridge, shop side

Square and Shopify can be pulled by the server on a schedule (store the token
in the connection and the API does the rest). Everything else — a CSV export
from the till, a spreadsheet, a home-grown system — is **pushed** from the shop
computer by this daemon.

```bash
pip install -r requirements.txt

# 1. On the POS Bridge page, connect a "CSV export" (or manual / custom API).
#    Copy the connection id.
# 2. Push once:
python sync_daemon.py --api https://your-brief.example \
    --connection 6a23f3ea-4c22-429a-ba9e-62f5f472060b \
    --adapter csv --file exports/stock.csv --once
# 3. Or keep it running; it re-pushes whenever the export changes:
python sync_daemon.py --api https://your-brief.example --connection <id> \
    --adapter csv --file exports/stock.csv --interval 60
```

Sign in with `--token <jwt>` or `--email/--password` (or `BRIEF_EMAIL`,
`BRIEF_PASSWORD`, `BRIEF_API`, `BRIEF_TOKEN` in the environment). With
email/password the daemon re-logs in when the token expires; with a fixed
token it exits with a clear error instead.

## Running it unattended

* Each pass fingerprints the export and only pushes when something changed
  (`--force` overrides). `--state-file` keeps that fingerprint across restarts.
* Failures back off exponentially up to `--max-backoff` seconds (default 600);
  an expired token triggers a re-login when credentials are available.
* `--health-file` writes `{"ok", "at", "rows", "changed", "added", "updated",
  "errors" | "error", "failures"}` after every pass — the container
  `HEALTHCHECK` reads it; point a cron or monitor at it on bare metal.
* SIGTERM / SIGINT finish the current pass and exit cleanly.
* Pushes are idempotent on the server (rows match on `pos_item_id`, then `sku`),
  so re-running after a crash never duplicates stock.

Container: `docker-compose.prod.yml --profile pos up -d pos-daemon` builds
`pos-extension/Dockerfile`, mounts `./pos-data` at `/data` and pushes
`/data/stock.csv` to `POS_DAEMON_CONNECTION` every `POS_DAEMON_INTERVAL`
seconds (see `.env.example`).

## Adapters

| adapter   | reads                                                          |
|-----------|----------------------------------------------------------------|
| `csv`     | any CSV with name / sku / quantity / price-ish headers (see `adapters/csv_adapter.py` for the aliases) |
| `manual`  | a JSON file `[{"name":..., "sku":..., "quantity":..., "unit_price":...}]` |
| `square`  | Square catalog + inventory counts, token stays on this machine |
| `shopify` | Shopify Admin REST products/variants/inventory                 |

Rows are matched to your shelf by `pos_item_id`, then by `sku`; unmatched rows
create new stock lines. Quantities from the till **replace** the shelf count
(reserved quantity is left alone). Set `exclude_sku` / `min_stock` in the
connection's sync rules to keep lines off the network.

## custom_api

No daemon needed — your system posts the same payload itself:

```
POST /api/pos/{connection_id}/push
Authorization: Bearer <vendor jwt>
{"items": [{"name": "Sukuma wiki", "sku": "SUK-1", "quantity": 80, "unit_price": 30}]}
```
