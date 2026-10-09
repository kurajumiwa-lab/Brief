# Ogallo UX redesign — audit and navigation map

**Audit date:** 2026-10-09

**Scope:** React/Vite client navigation, Home, Browse, Orders, Inbox, business workspace, shared identity/mode controls, and visual tokens.

## Audit findings

The product already has a strong trading core: network stock browse, shareable listing pages, stock source requests, role-gated order movements, deal rooms, direct/group chat, and supplier trust data. Those flows are implemented and should be preserved. The main issue is information architecture, not feature volume.

### Current experience

- The header has a five-link desktop row (Home, Browse, Orders, Inbox, My shelf), a persistent ten-link discovery rail, global search, notifications, and an account menu.
- The mobile bar has Home, Browse, Orders, Inbox, and Me; Me currently opens the public shop profile rather than a business workspace.
- The “All sections” drawer repeats the primary trade links, a second Home entry, a second mode switcher, and a long list of discovery and business links.
- The profile menu repeats My shelf, Dashboard, Analytics, POS Bridge, and profile editing. Mode switching therefore appears in two menus.
- Home has search, actionable movements, a ten-door feature grid, fresh stock, and supplier recommendations. The feature grid duplicates the category rail and drawer.
- `/brief` is a dashboard with its own network activity feed, so Home and the dashboard both behave like feeds.
- Browse stock, Suppliers, Nearby, Map, Markets, and News have useful existing screens, but are exposed as peer destinations rather than one Browse area.
- Existing route compatibility matters: notifications and older shared links still point to `/stock?tab=movements`, `/stock?tab=network`, `/brief`, `/network`, and other legacy routes.

## Navigation map

### As-is (simplified)

```text
Header: Home · Browse · Orders · Inbox · My shelf
        + persistent discovery rail: Around you · Map · News · Suppliers · Stock · Rentals · Markets · Groups · Events · Tasks
        + Search · Notifications · Account
Mobile: Home · Browse · Orders · Inbox · Me (currently public profile)
Drawer: repeated trade links + Home + discovery + community + business links + mode switch
Profile: public identity + second mode switch + shelf/dashboard/analytics/POS/profile links
Home: search + activity + ten destination tiles + fresh stock + recommendations
/brief: dashboard metrics + a second activity feed
```

### Target (implemented in this redesign)

```text
Primary navigation — same five useful destinations on desktop and mobile
├── Home       /            Personalised feed: search, live categories, action items, listings, suppliers and activity
├── Browse     /browse      Discovery workspace with one secondary browse rail
│   ├── Stock                 /browse
│   ├── Suppliers              /network
│   ├── Around you             /nearby
│   ├── Map                    /map
│   ├── Markets                 /markets
│   └── News                   /news
├── Orders     /orders      Incoming/outgoing, action-needed, open and completed movements
├── Inbox      /chat        Direct, group, order-linked and deal-room conversations
└── Me         /me          Business dashboard/workspace; storefront, shelf, insights and settings
    ├── Shop front            /@handle
    ├── My shelf               /stock
    ├── Analytics              /analytics
    ├── Tasks                  /tasks
    ├── Vendor lists           /lists
    ├── Market Locks           /locks
    ├── POS Bridge             /pos
    ├── Rentals & logistics    /tools
    ├── Our Network            /governance
    └── Surfaces                /feed

Brief's legacy `/brief` route redirects to Me; no second dashboard/feed is exposed. Secondary drawer has only unique secondary destinations — Groups & collectives, Events and admin tools. Workspace links stay canonical in Me; Browse surfaces stay in its contextual rail.
Account menu: account identity, one operating-mode selector, profile settings, theme and sign out.
Notifications: bell only; no duplicate general notification feed in navigation.
```

## Implementation stages and guardrails

1. **Audit and map** — this document records the current duplication, destination ownership, and desired hierarchy.
2. **Navigation consolidation** — one five-destination primary configuration; Browse's secondary rail appears only in discovery; Me becomes a real workspace; menus stop repeating Home and operating mode.
3. **Screen hierarchy and visual system** — Home becomes a trading feed rather than a navigation grid; Me no longer repeats Home's feed; warm editorial surfaces and green/purple/gold semantic tokens differentiate action, identity, and price.
4. **Verification** — retain legacy routes/deep links and backend calls; run frontend tests and production build; exercise browse/listing/source, messaging, order state changes, and operating-mode persistence.

### Data and behavior that must not change

- No changes to API contracts, auth/permissions, persisted vendor identity, inventory, notification records, or role-switch endpoint.
- Listing prices remain vendor-stated; available stock is not replaced with raw on-hand quantity; zero/no-data states remain honest.
- Source requests, deal rooms, chat, and order state transitions continue using their existing stores/components and role checks.
- Existing deep links remain supported, including `/stock?tab=network`, `/stock?tab=movements`, `/brief`, `/network`, `/nearby`, `/map`, `/news`, and vendor storefront URLs.
- Any future-only idea not backed by an existing flow will be labelled as a prototype rather than presented as an active control.
