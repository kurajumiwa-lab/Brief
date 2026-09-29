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
`BRIEF_PASSWORD`, `BRIEF_API`, `BRIEF_TOKEN` in the environment).

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
