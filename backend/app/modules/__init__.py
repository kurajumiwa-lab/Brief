"""Modules — the domain boundaries of Brief_.

Each module owns its business rules, its data access and its HTTP adapter.
Modules talk to each other only through the service layer of the target
module — never by reaching into another module's tables or routers.
Infrastructure that serves everyone (database session, auth tokens, rate
limits, metrics, storage) stays in its platform homes: app/database.py,
app/middleware/, app/services/ for pure infrastructure.
"""
