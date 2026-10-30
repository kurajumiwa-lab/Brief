# The Business Desk — a guided purchase, not a catalogue

> **Status:** built on `arena/6596bb7d-brief`.
> **Backend:** `app/modules/catalog/{catalog,service,router,models}.py` + migration `0028_business_desk`.
> **Frontend:** `pages/storefront/{BusinessDeskPage,EnquiryInboxPage}.jsx`, `components/desk/*`.
> **Tests:** backend **477 passed** (11 new), frontend **365 passed** (14 storefront specs rewritten).
>
> As before, this file is two documents. **Part 1** is for the person who runs
> the business. **Part 2** is for the person who maintains it.

---

# PART 1 — For the business manager

## 1. What was on the screen

The storefront was one long, honest document: twelve offers with full scopes,
four account tiers, a trial disclosure, a BYOD comparison, an enquiry form and a
"how selling starts tomorrow" list. Everything on it was true.

It also asked the buyer to read all of it to find their own problem. A trader
who wanted a website had to walk past a membership-management pilot and a device
enrolment policy to discover that a website costs KSh 15,000–45,000.

**The information was right; the order was wrong.**

## 2. What the desk asks instead

One question, five answers:

> **What does your business need?**

| Need | One line | What is behind it |
|---|---|---|
| Digital services | Websites, branding, design and automation | 4 services, from KSh 2,500 |
| Business software | Business records, memberships and workspaces | 4 offers, from KSh 1,500/mo |
| Field operations | Field teams, mobile forms and reporting | 2 services, from KSh 3,000/mo |
| Device management | Android deployment and device administration | 2 deployments, quotation only |
| Custom business solutions | Tell us what your organisation needs | a form, and a human |

Five, not three. The catalogue has three *commercial* lines; a buyer has five
*buying* needs. Device work sits inside the field-operations line commercially,
but it is a different decision — a different budget, a different sign-off, a
different set of questions — so it gets its own door. The fifth door exists
because "none of the above" is the most common answer in a real first meeting,
and the only honest response to it is a conversation.

**The picker is a popup.** Pressing "Business desk" opens it — a bottom sheet on
a phone, a centred dialog on a desktop — rather than dropping the reader into a
long page. It opens once per visit; afterwards the same five doors sit on the
page itself, so a return visit is one tap, not a modal to dismiss.

## 3. What a buyer sees, in order

1. **The need.** Five rows, one line each, no prices, no paragraphs.
2. **The services for that need only.** Name, test price, turnaround, and the
   action allowed — nothing else. A pilot never appears under a "buy" heading.
3. **One service in full.** What your business gets · what we need from you ·
   what is not included · one next step.
4. **The request.** Organisation, a callback number, and what decides the price.
   No card field exists, anywhere.

A buyer who cannot name a category types it instead — *"Describe what your
business needs"* — and if nothing matches, the search says so and hands the
sentence to a human as a custom request. A search that returns nothing is a
useful answer; a search that pretends is not.

## 4. The rule that decides what a customer may do

This is the guard rail the interface is not allowed to override. It comes from
the server with each offer:

| Readiness | What the buyer may do | Why |
|---|---|---|
| **Live today** | Purchase or enquire | Operational now; a human confirms scope, then invoices |
| **Delivered as a service** | Request a quotation | Work by people — a written quotation fixes scope, dates and price |
| **Pilot** | Request pilot participation | Supervised rollout with a named scope; nothing charged until terms are agreed |
| **Scoped** (no public price) | Submit requirements | Hardware, licences and integrations decide the price — quoting a guess would be a lie |
| **Not yet live** | Register interest | Records a request; sells, charges and promises nothing |

No screen can add a checkout button to a pilot, because the button's label and
enquiry kind travel *with* the offer from the server.

## 5. Where a request lands

The desk is customer-facing. Requests land in **Enquiry management** — an inbox
that answers one question: *what came in that nobody has picked up?* Each row
carries the service, the desk it belongs to, the organisation, the note, and one
press to move it along `new → contacted → quoted → won/lost`.

Access is operator-only, enforced by the same configured market-ops roles the
rest of the console uses. A vendor who is not operations staff gets a plain
"enquiries are reviewed by operations staff" — not an empty table pretending
there are none.

Business orders (`/orders`) and performance (`/analytics`) already exist and are
untouched: the desk creates the request, it does not invent a second order
system.

## 6. What deliberately did not change

- **Prices are still test ranges**, labelled as such on every card and in the
  footer. No price became "verified" because it moved to a card.
- **The trial is still not live**, still shows an exact first-charge date and
  amount, and still refuses a request without the acknowledgement.
- **No card details are collected.** The only payment route is a human, a
  written quotation and an invoice on an existing verified channel.
- **Nothing was deleted.** Accounts, tiers, trial and the BYOD comparison are one
  press away under *Accounts & trial* — a buyer asking that question is asking a
  different one, and should not have to scroll past it to find a website.

## 7. How to know it is working

| Metric | What it tells you |
|---|---|
| Need picked ÷ desk opened | Is the first question the right one? Under ~60% means the five needs are not the buyer's words |
| Service viewed ÷ services listed | Is the middle screen doing its job, or is the list too long |
| Request sent ÷ service viewed | Is the scope clear enough to act on |
| Search with no match | The most valuable list on the desk: the needs we do not sell yet |
| `custom` requests ÷ all requests | How much of demand falls outside the current five |
| Enquiries untouched > 48 h | Anything but zero is a service failure, not a product metric |

---

# PART 2 — For the developer

## 1. File map

| Path | Role |
|---|---|
| `backend/app/modules/catalog/catalog.py` | `DESKS` (5), `Offer.desk`, `CTA_FOR_READINESS`, `ENQUIRY_KINDS`, `desk_for_offer`, `offers_for_desk` |
| `backend/app/modules/catalog/service.py` | `_desk_out` / `desks_payload`, `cta` + `desk` on every offer, extended enquiry validation, `inbox`, `set_status` |
| `backend/app/modules/catalog/router.py` | `desk_key` on `EnquiryIn`; `GET /enquiries`, `PATCH /enquiries/{id}` (ops only) |
| `backend/app/modules/catalog/models.py` | `desk_key` column, widened `ck_catalog_enquiry_kind` |
| `alembic/versions/0028_business_desk.py` | additive column + index, widened constraint, data-preserving downgrade |
| `frontend/src/pages/storefront/BusinessDeskPage.jsx` | the desk: picker → services → service → request; accounts view |
| `frontend/src/pages/storefront/EnquiryInboxPage.jsx` | operator inbox (lazy chunk) |
| `frontend/src/components/desk/{NeedPicker,ServiceCard,ServiceDetail,RequestForm}.jsx` | the four screens |
| `frontend/src/config/categoryTints.js` | `DESK_TINT` — desks reuse the category hues |
| `frontend/src/test/storefront.test.jsx` | 14 specs (rewritten from the v2.14 storefront specs) |
| `backend/tests/test_v215_business_desk.py` | 11 specs |

## 2. API

### `GET /api/catalog` — public, additive

The v2.14 payload is unchanged: still `lines` (3) and `offers` (12). Two
additions:

```jsonc
"desks": [
  {
    "key": "digital_services", "title": "Digital services",
    "blurb": "Websites, branding, design and automation.",
    "enquiry_only": false,
    "offers": [ /* same shape as body.offers */ ],
    "offer_count": 4,
    "starting_price_kes": 2500,      // null when every offer is quoted
    "lead_offer_key": "logo_brand_starter",
    "readiness": ["service"]
  }
]
```

and on every offer, in both lists:

```jsonc
"desk": "device_management",
"cta": {
  "kind": "requirements",
  "label": "Submit requirements",
  "note": "No public price: hardware, licences and integrations decide it."
}
```

`cta.kind` is one of `purchase | quotation | pilot | requirements | interest`,
always consistent with `readiness`. An unknown readiness falls back to
`interest` (the most conservative action), never to `purchase`.

### `POST /api/catalog/enquiries`

```jsonc
{
  "kind": "pilot",              // purchase|trial|quotation|discovery_call|pilot|requirements|interest
  "offer_key": "membership_management",
  "desk_key": "business_software",   // optional; an offer always wins
  "organisation_name": "...", "contact_phone": "...", "notes": "...",
  "acknowledged_first_charge": false // trial only, still required
}
```

Validation: `purchase | quotation | pilot | interest` require an offer or an
account tier; `requirements` and `discovery_call` do not (that is the custom
desk). The recorded `desk_key` is derived from the offer when there is one, so a
client cannot mis-file a request; otherwise the named desk is used, otherwise
`custom`.

### `GET /api/catalog/enquiries` (ops) · `PATCH /api/catalog/enquiries/{id}` (ops)

Both 403 for a vendor without a `MARKET_OPS_ROLES` entry of `admin` or `clerk`.
The list returns `items`, `count`, `unpicked`, `by_desk` and a `note`. The patch
takes `{"status": "contacted"}` and rejects anything outside
`new|contacted|quoted|won|lost`.

## 3. Why the five desks are a separate list from the three lines

The three lines are how the business is organised commercially (one-off digital
work, recurring software, setup-plus-monthly field work). The five desks are how
a buyer organises a decision. Keeping both means:

- existing invoices, tiers and analytics keep pointing at a line;
- one line can contain more than one buying decision (`device_management` is
  inside `field_operations`);
- the `/api/catalog` contract that other screens already read does not change.

`Offer.desk` is empty for most offers and means "same as the line". Set it only
where a need is narrower than the line — that is why only two offers declare it.

## 4. Frontend contract

URL state drives the whole desk, so Back walks the path the buyer took and a
service has a shareable link:

| URL | Screen |
|---|---|
| `/storefront` | the five needs (picker opens once per session) |
| `/storefront?desk=digital_services` | that desk's services |
| `/storefront?desk=…&offer=business_website` | one service + its permitted action |
| `/storefront?view=accounts` | tiers, trial, BYOD |
| `/storefront/inbox` | operator inbox (lazy chunk) |

Rules the components obey:

- **The CTA comes from `offer.cta`.** `ServiceDetail` renders `cta.label` and
  passes `cta.kind` to the form. There is no fallback that says "Buy".
- **The picker opens from `sessionStorage`, once per visit.** A refresh is the
  same visit; a new tab is not. If storage is unavailable it simply opens again —
  never an error.
- **Desk hues are borrowed, not invented** (`DESK_TINT` in `categoryTints.js`),
  so a colour means the same thing here as in Explore.
- **The request form has no card field**, by construction: the component cannot
  collect what it does not render.

## 5. Migration `0028_business_desk`

```sql
ALTER TABLE catalog_enquiries ADD COLUMN desk_key varchar(32);
CREATE INDEX ix_catalog_enquiries_desk_key ON catalog_enquiries (desk_key);
ALTER TABLE catalog_enquiries DROP CONSTRAINT ck_catalog_enquiry_kind;
ALTER TABLE catalog_enquiries ADD CONSTRAINT ck_catalog_enquiry_kind
  CHECK (kind IN ('purchase','trial','quotation','discovery_call',
                  'pilot','requirements','interest'));
```

The downgrade **remaps** `pilot | requirements | interest` to `quotation` before
re-tightening the constraint — an enquiry is a customer's request, and losing it
to a rollback is not an option. Verified with real rows: 3 new-kind enquiries
became 3 quotations and the old constraint re-applied cleanly.

Upgrade, downgrade and re-upgrade were exercised against a live Postgres, not
just in tests.

## 6. Tests

```bash
cd backend  && pytest -q tests/test_v215_business_desk.py   # 11 passed
cd backend  && pytest -q                                    # 477 passed
cd frontend && npx vitest run src/test/storefront.test.jsx   # 14 passed
cd frontend && npx vitest run                                # 365 passed
```

| Backend spec | Pins |
|---|---|
| `test_five_desks_each_answering_a_buying_need` | the taxonomy, and that every blurb is under 80 chars |
| `test_the_original_catalogue_contract_is_untouched` | additive means additive |
| `test_the_action_follows_readiness_not_the_screen` | the guard rail |
| `test_an_offer_decides_its_own_desk` | a client cannot mis-file a request |
| `test_a_custom_request_is_routable_with_no_offer_at_all` | the fifth door |
| `test_a_pilot_request_without_a_service_is_refused` | you must name something to pilot |
| `test_trial_disclosure_survives_the_desk` | the desk did not loosen the trial |
| `test_the_inbox_is_operator_work` | 403 for vendors, on both endpoints |
| `test_operators_see_every_request_grouped_by_desk` | routing + status transitions |

| Frontend spec | Pins |
|---|---|
| "opens the need picker instead of the long catalogue" | the popup, five needs, no prices on that screen |
| "does not re-open the popup on every return" | once per visit |
| "shows only the services that answer the chosen need" | the second screen changes |
| "turns the catch-all need into a form" | custom desk |
| "lets a buyer who cannot name a category describe the need" | search, and the no-match handoff |
| "offers the action the server allowed" | a pilot never reads "purchase" |
| "sends the request with the offer, its desk and the permitted kind" | the payload |
| "keeps the trial disclosure" | the trial promises survive |
| "says plainly that a non-operator cannot see the inbox" | a 403 is not an empty table |

## 7. Next steps, in order of leverage

1. **Read the no-match searches.** They are the product roadmap: every phrase
   the desk could not answer is a service we could sell or a word we got wrong.
2. **Response-time discipline before growth.** The desk makes it easy to ask;
   the only thing that makes it a business is an operator answering inside a day.
   Instrument time-to-first-contact, not enquiries received.
3. **Pilot → live promotions.** When a pilot graduates, flip the offer's
   readiness in `catalog.py` and the CTA becomes a quotation everywhere at once —
   no UI change, no release note needed.
4. **Prices are still test ranges.** The moment there are three paid customers
   per desk, replace the ranges with real ones and say so on the card.
5. **Not built, deliberately:** automated checkout. It waits for a verified
   recurring-payment provider and a written refund policy, the same condition the
   trial has been waiting on since v2.14.
