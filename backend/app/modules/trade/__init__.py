"""trade — where needs become completed transactions.

Owns: business requests and offers (now); sourcing, movements, negotiations
and collective buying (as the migration waves land — see
docs/briefs/modular-architecture.md).

Charter:
    models.py    — the tables this module owns (migrations reference these)
    schemas.py   — wire shapes in and out
    service.py   — the rules; importable by other modules and by jobs
    router.py    — the HTTP adapter; the only place FastAPI appears

Public interface (stable for other modules):
    from app.modules.trade import service as trade_service
    trade_service.create_request / add_offer / accept_offer / cancel
"""
from app.modules.trade.router import router  # noqa: F401
