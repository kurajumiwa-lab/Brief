# Event and bulk-buy share links

`/e/<slug>` gives crawlers server-rendered OpenGraph metadata and gives signed-in people the event booking drawer. Outside-created events without a slug use their event UUID. Signed-out visitors are returned to the link after sign-in. An event tied to a group or business list is intentionally not exposed by the public share shell.

Public group-sourcing activities use `/e/<activity UUID>` and open their activity detail, not the event payment flow. Their confirmed count and capacity come from the activity ledger; they do not currently have event payment tags or a waitlist. Private and community activities do not receive public cards.

`/api/og/events/<slug>.jpg` is a generated 1200×630 JPEG with a 120-second browser/shared-cache TTL. It reads the latest committed counts, includes active holds in filled capacity, and displays confirmed seats separately. Local media references are read through the existing storage service; missing or invalid images use the Home/Regions category palette. External image URLs are never fetched. The HTML has the same TTL. WhatsApp and other platforms may cache their own previews longer than these headers.

The Vercel rewrite sends social crawlers to the API and human visitors to the SPA, like profile links. Single-container deployments use FastAPI's public shell and built frontend. Apply migration `0061_event_payments` before deploying. The payment scheduler must run for automatic expiry and promotion. Payment notes are self-declared and never shown on public share cards.
