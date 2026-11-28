# Public portfolio and opportunity conversation tracking

## Public portfolio

`/p/:handle` renders the same portfolio/gallery view for signed-out visitors using the new read-only `/api/profiles/:handle` projection. It deliberately omits private account details, private addresses, tax identifiers, coordinates and unpublished contacts. Published work and gallery go through the existing sanitizers; public offerings and the professional page are loaded independently. Owner-only controls and device-local identity claims remain private. Availability of media and optional sections depends on their existing endpoints and production configuration.

## Tracking

Each buyer/offer pair has its own direct room, isolated from ordinary direct conversations. Opening a room is not an enquiry. The first buyer message is counted as an enquiry; the first seller message after that counts as a reply. Text, stock/deal messages and voice messages are counted when their chat transaction commits; system messages and messages sent before a room is associated are not retroactively attributed. Aggregate counts are available only to the seller, per opportunity. We do not inspect message bodies for analytics.

Either participant can report a sale in the opportunity conversation after an enquiry; the other participant can independently confirm or disagree by not confirming. Either can withdraw their own report. A sale is counted only while both reports exist, and is described as mutually reported, not proof of payment, delivery, amount or a verified transaction. One buyer/offer pair can record at most one mutually reported sale; multiple separate sales require separate opportunities. There is no retroactive conversion attribution for rooms created before this feature. No viewing/impression or return-visit metrics are implemented.

## Deployment

Apply pending migrations in order, including `0084_market_opportunities`, `0085_market_reservation`, and `0086_opportunity_conversations`, after checking the production revision and taking a backup. The chat backend now reads the new table even for ordinary rooms, so the migration must precede deployment. Local tests and a minimal-schema upgrade/downgrade smoke test do not establish production migration status. No deployment or production migration was performed.

## Brief2 migration status

At the user's direction, the connected Brief2 database was migrated from `0084_market_opportunities` to `0086_opportunity_conversations` in a guarded transaction without a verified backup. The revision, new column, table, RLS and indexes were checked afterward. The `0086` migration enables RLS on the new tracking table without public policies; the backend DB role must have owner or bypass-RLS access. The application changes and migration files remain unmerged on this branch, so deployments or Alembic runs from an older code revision may not recognize the database revision. No application deployment was performed.

Security finding: Brief2's existing `chat_rooms` and `chat_messages` tables have RLS disabled and the `anon` database role has SELECT privilege. Whether they are reachable via exposed APIs was not verified; investigate and remediate before relying on chat privacy. These existing tables were not changed by this migration.
