# Sprint 01: seller-reported market opportunities

## Shipped locally

Home leads with a live market briefing, followed by the existing Home tools. Signed-in members can publish an opportunity with a title, town/market, quantity, unit and asking price in KSh. The seller's own account is the source and contact; enquiries open the existing direct chat and the buyer must send their own message. Cards show when the seller published, not a verified market observation or completed sale. A seller can close an active card.

Browse and search show active quotes from the past seven days. Stale cards are hidden rather than represented as current; to update one, publish a fresh card and close the old one. Discoverability settings, blocked accounts and fraud suspension are respected for other viewers. There is no reporter-on-behalf-of-seller workflow, editing, independent price verification, category or location following, offer-specific chat context, transport matching, delivered-cost calculation, trade record, or impact analytics yet. Home's recent cards are network-wide, not a market-specific feed. A Brief account is required; business registration is not required by this feature.

## Deployment

Migration `0084_market_opportunities` must be applied before the new backend/frontend are deployed. Check the production Alembic revision and all pending migrations, take a backup and review the rollout. A local migration upgrade/downgrade smoke test was run against a minimal Postgres schema stamped at `0083_merit`; this is not a production migration or proof that all earlier production migrations have been applied.

## Pilot decision

Treat this as a seller-quote pilot, not proof of market demand. Recruit a small group in one market; record consent-based counts of published complete quotes, enquiries that became actual conversations, and participants who return within seven days. Manually check whether quotes were current and useful. Decide whether to build editing/renewal or a richer reporter workflow based on observed use and data quality; do not treat chat openings as completed deals.
