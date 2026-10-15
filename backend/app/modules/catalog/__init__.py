"""Storefront catalogue, account tiers and enquiries (v2.14).

Packages existing spending into offers a business can understand and
buy: digital services (one-off, people-delivered), business software
(subscriptions on what is operational), and field operations (setup +
monthly, BYOD-first). Prices are test ranges, readiness is stated per
offer, and the Junior→Enterprise ladder never sells or implies
verification.

Public interface:

    from app.modules.catalog import service, catalog
    service.catalogue_payload()        # lines, offers, tiers, trial, BYOD
    service.account_tier_for_plan("starter")   # → Junior — Free account
"""

from app.modules.catalog import catalog, models, router, service  # noqa: F401

__all__ = ["catalog", "models", "router", "service"]
