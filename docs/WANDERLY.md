# Wanderly and consolidated surfaces

## One home per capability

- **Home**: three quick actions (Discover, Wanderly, Work), up to five real activity rows, collapsed groups/errands. No duplicate Work banner or local create-space modal. Events open the full plan directly.
- **Spaces**: owned spaces, Orders & selling, Shared with you. Space rows open their workspace directly, not a preview sheet first. Escrow records sit within commerce. `SpacesLanding` delegates to this same implementation.
- **You**: one profile row and three collapsed groups: Activity & connections, Money, Settings & help. Details replace the list inline and keep URL/back navigation. Following is owned here, not repeated in Spaces. Orders/Selling link to Spaces.
- **Menu**: eight secondary destinations in two groups, plus existing capability-gated administration/moderation and the area editor. No duplicated You settings/money, Storefront/Home, or Elevate subpages. Wholesale/source-direct remain in the marketplace picker; Elevate’s subpages remain within Elevate.

## Wanderly: parties & trips

`preview/src/features/wanderly/WanderlyPage.tsx` is the unified product. It retains Wanderly's teal palette, DM Serif Display/Inter typography, rounded cards, editorial hero and filter sidebar, with an East African focus. Mobile filters collapse initially. Destination inspiration is explicitly not a bookable package; experience cards come only from published campaign rows. No demo Tokyo itinerary, invented reviews, referral income or pretend publish actions remain.

Routes:

| URL | Destination |
|---|---|
| `#wanderly` | Published experiences; place/category/date filters; soonest first |
| `#wanderly/trips` | Multi-day filter (at least 24 hours, derived from stated dates) |
| `#wanderly/experience/:slug` | Full event/trip detail |
| `/c/:slug` | The same Wanderly product, opening that public detail |
| `#wanderly/host` | Account-gated inline hosting form |
| `#wanderly/hosting` | Your plans and publishing saved drafts |
| `#wanderly/tickets` | Your existing ticket wallet, current versioned codes, gifts and calendar |

Old `#events`, `#city/events`, `#discover/events`, Tokyo/destination hashes and `#host` remain aliases. Old `#you/orders` and `#you/selling` redirect to `#spaces/orders` and `#spaces/selling`.

### Existing APIs, not a second event system

- Browse reads `/api/events` and `/api/events/categories`. Only these exact **GET** routes are now anonymous: the existing allowlisted public listing projection, not authoring, attendees or private host records. Unlisted plans are excluded from browse, related, host and series results; their direct links still work.
- Hosting uses `createCampaign → publish`, with KES/UGX/TZS/RWF/USD, capacity, recurrence, unlisted links, and optional festival/itinerary details. A failed publish retains the saved ID; retry updates/publishes the same draft rather than creating another campaign. Device-local form times are sent as ISO instants.
- Full detail lives in `ExperiencePage.tsx`; the old EventShowcase import is a compatibility export. Host-stated line-up, zones, schedules, inclusions, music, sponsors and FAQ remain. Empty sections do not appear; duplicate page chrome and end-of-page ticket promotions were removed.
- Festival ticket-tier descriptions remain **informational**. The registration API supports the campaign price, not purchasable tier IDs. A single usable registration form displays that price regardless of whether tiers exist.
- Wanderly asks for sign-in before registering so tickets belong to the account. A random, account-and-plan-scoped session-storage reference makes same-tab retries/reloads idempotent without using guessable contacts as retrieval keys. The legacy anonymous registration API is unchanged.
- Free, account-bound registrations now issue the existing admission-ticket row immediately. The public registration response uses its versioned scan code. Paid registrations remain `started` until the existing confirmation/settlement flow; the UI does not present pending codes as admission. **No new ledger writes, payment provider, balance counters or resale flow.** D6 resale restrictions remain intact.
- My tickets is session-gated and discards private content on account changes. The ticket wallet owns current admission codes; the confirmation page links there rather than keeping a potentially stale QR.

## Verification

```sh
npm run test:typecheck
npm run build
bash run-suites.sh wanderly compacthome doorways backdoors mine yousurface youposition eventcard eventdetail eventactions resale session adminwiring admin membersdesk
node server/test/run.js
node server/test/decisions.mjs
```

`preview/wanderly.jsx` mounts the real production AppShell and Wanderly against an isolated real server/store: aliases, anonymous browsing, filters, errors/retries, unlisted privacy, registration/sign-in, pending payment/capacity, publishing retries/currency/dates, ticket ownership/session invalidation and consolidated You/Spaces navigation. No preview data or real user roles are changed by the suite.
