# Discovery and Page editor: local implementation status

This working tree is not a launch sign-off. Nothing was deployed or migrated on Railway.

## Implemented locally

* Regions uses one URL-backed category strip with independent All/Offers/Wanted intent. The Page editor saves name, town, Kenyan mobile number, WhatsApp consent and discovery settings; its preview uses the actual RegionCard profile data, not an actual active offer.
* Scheduled activities require a start; migration `0064_activity_expiry` backfills expiry for existing dated scheduled activities. Create converts local timestamps to UTC and has offer-expiry presets. Outside, network search, stock and tools browsing, event browsing and ledger search have expiry/discoverability filtering. Direct links and owner/history flows are deliberately separate.
* Shop and host presets show selected public offers, catalog, upcoming events, aggregate counts and optional unverified payment tags, not voucher codes or named rosters.
* Migration `0065_handle_redirects` adds a 30-day handle cooldown and alias table on the existing `vendors` accounts. Namespace changes and signup share a PostgreSQL transaction advisory lock; changing a handle also locks its vendor row. Old names remain reserved and owned aliases can be reclaimed. The editor updates the session handle. Backend `/p/old` returns 301 and the public Page API and authenticated vendor API resolve aliases. Legacy handles may contain underscores and be longer than newly valid handles.
* Outside source SQL uses a base64 JSON keyset cursor ordered by effective deadline, creation time and UUID, with source-table name as a final collision tiebreaker. A bounded scan continues past filtered candidates. Scores remain informational, not the ordering. Mixed deadlines, paging and an item expiring after a page were tested locally. Key mutations between requests cannot provide snapshot semantics.
* Geo, nearby, onboarding radar and portions of the legacy surface feed were additionally audited and filtered, including private events and hidden owners. The WhatsApp crawler integration test seeds a real voucher, unverified non-opted-in phone and event attendee, verifies OG metadata and absence of those private values, and verifies the old-handle 301.

## Remaining gaps and rollout risks

* Vercel sends crawler `/p/*` requests to the backend, but ordinary browsers receive the SPA. Browser-side code resolves aliases and navigates to the canonical address; it is **not an HTTP 301 for browsers**. A deployment routing solution that can return 301 for aliases and still serve the SPA for canonical pages remains necessary, along with end-to-end deployment verification.
* Universal discovery hiding is not established. Legacy surface movement/aggregate cards, other independent Home and profile/listing sources, and ledger recommendations still need an endpoint-by-endpoint privacy and expiry audit with tests. Spotted sales remain a separate Regions query; see `docs/spotted-deals-status.md`.
* Outside pagination scans at most 20 bounded windows per request and can return a continuation even for an empty page. Source exceptions are currently suppressed by the existing adapter design, so failures may omit content. More integration tests are needed for mixed-source UUID collisions, long filtered runs, simultaneous changes and each public endpoint. Cursor behavior assumes ordering keys of remaining records do not change between requests.
* Scheduled expiry override, actual live-offer preview, frontend handle-editor interaction coverage, and complete timezone/boundary coverage remain incomplete. Spotted Deals has additional unresolved launch work documented separately.

## Tests and deployment

Local targeted run: 86 backend tests passed (Outside, Page, handle redirects/crawler, migrations, event/share and Spotted policy/API/schema); 25 frontend tests passed (Regions, Page presets/portfolio, Spotted); Vite production build passed with a chunk-size warning. These tests do not cover all remaining gaps above.

After merge, operators must inspect the production Alembic revision and pending migrations, take a backup, and manually apply the required migrations in order, including `0064_activity_expiry` and `0065_handle_redirects`, before deploying the dependent frontend/backend. Migrations `0061`–`0063` are also present locally and their production status is unknown. No Railway migration was attempted.
