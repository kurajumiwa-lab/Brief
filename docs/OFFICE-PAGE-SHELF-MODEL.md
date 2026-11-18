# Home Office, Page and Shelf — one model

This document settles what each surface is for, so a new person can answer
"what do I do after opening a home office?" without guessing. It also records
the payment rule for events and the split between goods and services in
discovery.

## The four surfaces

| Surface | Who sees it | What it is | What it is **not** |
| --- | --- | --- | --- |
| **Home Office** (`/office`) | You and the people you invite | The private workroom: team roles, internal calendar, notices, partner offices | A public shop, a listing, or the place customers browse |
| **Your Page** (`/p/<handle>`) | Anyone with the link, signed in or not | Your public identity: name, area, bio, services, hours, credentials, payment tag | A private dashboard, or a second copy of the office |
| **Shelf** | Whoever the Page/shelf audience allows | What you can offer *now*: stock lines, bookable services, occasional home-shelf items | An archive of everything you have ever sold |
| **Discovery** (`/regions`) | Signed-in members | An index of Pages and their current shelf items, filtered by corridor | A dump of every record in the database |

### The relationship in one sentence

**The Home Office owns the work. The Page is the public face. The Shelf is
what is currently for sale. Discovery points at the Page.**

```
Home Office (private)
   ├── people / roles / internal calendar / notices
   └── owns ──► Page (public) ──► Shelf (current offer)
                                   ├── goods (stock lines)
                                   └── services (bookable work)
```

A person can have a Page without a team. An office can stay one person. A
shelf item never becomes public without a Page.

## After opening a home office: the next four steps

The office is not finished when it is created. The office page shows this
short checklist, in order, and each step links to the screen that does the
work:

1. **Finish your Page.** Name, area, a line about what you do, and whether it
   is a service, a shop or a host page. → `/you/page`
2. **Put something on the shelf.** A service with a duration and a price, or a
   stock line with a quantity. → `/calendar` (services) or `/stock` (goods)
3. **Set when you are open.** Availability windows for services, or visiting /
   pickup hours for a home shelf. → `/calendar`
4. **Say how customers pay you** (optional). Your own Till or Paybill is
   published on the Page. Home Office never holds the money.

Adding people is **optional** and comes after those four. The old screen led
with invites and a calendar, which made an office look like a staff registry.
It is a workroom, not a payroll.

## Why services are not mixed into merchandise

Goods and services are discovered differently:

- A **good** is a discrete, searchable item: a bag of maize, a crate of eggs,
  a used freezer. Quantity, unit and price per unit are the useful facts.
  Amazon/eBay-style search works because the inventory is countable.
- A **service provider** is continuous: the same nurse, barber, fundi or
  photographer is available next week and the week after. Showing one card per
  service, or per week, floods a goods feed with rows that a buyer who wants
  maize cannot use.

The system therefore has two doors:

- **Goods** — the existing stock/offer cards.
- **Services** — one card **per provider**, not per service. The card carries
  the provider's Page, area, starting price and the services they offer. The
  Page is where the full list and booking live.

`GET /api/service-providers?region_slug=&town=&q=&limit=` is the service
directory. It groups every active bookable service and B2B tool service by
provider, so a provider with eight services still occupies one row. It never
invents a provider: a row needs a Page handle and at least one live service.
Pages the owner hid from discovery, suspended Pages and Pages this viewer
blocked are omitted; a provider with no area is not assigned to a corridor.

The default discovery feed stays a mixed feed for community, rounds and
events. The Services door is the clean view for "I need a person to do
something", and it does not pretend to be a product search.

## Event payments: direct to the organiser, never through us

Home Office does not process money. An event that charges a fee must point at
the organiser's own rail:

| Method | What the guest sees | How the pass unlocks |
| --- | --- | --- |
| `TILL` | The organiser's Buy Goods Till number | Host confirms the submitted M-Pesa note |
| `PAYBILL` | Paybill number + account reference | Host confirms the submitted M-Pesa note |
| `POCHI` / `SEND_MONEY` | The organiser's phone number | Host confirms the submitted M-Pesa note |
| `CASH` | Pay the organiser in cash before the event | Host marks the cash received |
| `FREE` | No payment block | Pass is issued at booking |

Rules:

- A priced event (`entry_fee > 0`) **must** have one of the paid methods. It
  cannot be created with a price and no rail, and it cannot be edited into
  that state.
- If an older event has a price but no rail, booking is **closed** with a
  clear message until the organiser adds a rail. No free pass is issued.
- A user-declared M-Pesa SMS is evidence for the host to check, not proof from
  Daraja. The platform still does not call Daraja.
- Cash bookings hold a seat until the host confirms, exactly like a submitted
  M-Pesa note. The hold expires if nobody acts.

## Edge cases

- **One person, no team.** The office checklist still works; the team step is
  optional and never blocks publishing.
- **Service + goods on one Page.** The Page preset is a presentation choice;
  the shelf can hold both. Discovery uses the card kind, not the preset, to
  decide which door it belongs to.
- **No payment tag.** The Page still publishes. Only the payment line is
  absent; nothing claims a rail exists.
- **Priced event without a rail (legacy).** Guests cannot book; the API sends
  `payment_ready: false` and `payment_problem`, and the organiser can fix it
  with `PATCH /api/events/{id}/payment` from `/events`.
- **Cash event with no capacity.** Cash holds still occupy a seat until
  confirmed or expired.
- **Provider with eight services.** One discovery card, eight offerings on the
  Page. The card never multiplies by service count.
- **Provider outside the corridor.** Filtered by Page area, not by an invented
  GPS point.
- **Office member without an account.** They can read the internal calendar;
  they do not get a public Page of their own through the office.

## What changed in code

- `backend/app/modules/office/service.py` — `page_snapshot` and
  `setup_snapshot`; `GET /api/office/offices/{id}` returns `page` and `setup`
  (`page_ready`, `shelf_ready`, `hours_ready`, `payment_ready`, `team_ready`,
  `service_count`, `stock_count`, `event_count`, `hours_count`,
  `active_members`, `preset`). A host's shelf step counts public events; a
  service/shop step counts services and stock.
- `frontend/src/pages/office/OfficePage.jsx` — the model, the Page card, the
  four-step checklist, and people moved behind an optional disclosure.
  `OfficeFrontDoor` links `/p/<handle>` (or `/you/page` when missing);
  `OfficeNextSteps` is the 1/4-done checklist with `data-testid="office-step-*"`.
- `frontend/src/components/home/IdentityStrip.jsx` — labels the public Page
  and the private office as different things.
- `backend/app/modules/service_directory/router.py` — one row per provider,
  grouped from bookable services and tool services; mounted at
  `GET /api/service-providers` in `main.py`.
- `frontend/src/pages/explore/ExplorePage.jsx` — the Services door
  (`kind=service`) calls `serviceProviderAPI.list` and renders one
  `providerToCard` per provider instead of the mixed feed; `RegionsGrid` shows
  a service-count pill and `categoryArt` has the provider palette.
- `backend/app/models/events.py`, `app/services/event_payments.py`,
  `app/routes/events.py` — `PAYMENT_METHODS` now includes `CASH`;
  `payment_problem()` powers the `payment_ready` flag; `PATCH
  /api/events/{id}/payment` lets the organiser set a rail; the payment queue
  returns `cash_due` rows for live cash bookings.
- `frontend/src/components/forms/EventForm.jsx`,
  `frontend/src/components/events/EventPaymentCard.jsx`,
  `frontend/src/pages/events/EventsPage.jsx` — an explicit "Tickets & payment"
  section and an organiser payment editor.
- `frontend/src/components/page/PaymentTag.jsx` — the single public payment
  line, shown on any Page preset, with honest "we do not hold the money"
  micro-copy. It is rendered on both `/p/<handle>` (`PortfolioPage`) and the
  legacy `/page/<handle>` (`PublicPage`); `PresetContent` no longer renders a
  second copy.
- `0070_event_cash_payment` — adds `CASH` to the event payment methods
  (downgrade maps cash rows back to `FREE`).
- Tests: `backend/tests/test_service_directory.py`, `test_event_payments.py`,
  `test_page_editor.py`, `test_v40_office.py`;
  `frontend/src/test/{officePageModel,serviceProviders,eventFormPayment,
  eventPayments,presetContent}.test.*`.
