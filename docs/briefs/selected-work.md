# Selected work — the portfolio became a capability

> **Status:** built on `arena/6596bb7d-brief` (v2.16).
> **Backend:** `app/services/work_showcase.py`, column added in migration `0029_selected_work`,
> two new offers in `app/modules/catalog/catalog.py`.
> **Frontend:** `components/vendor/SelectedWork.jsx` on the shop front; `pages/portfolio/`
> and `config/portfolioData.js` deleted.
> **Tests:** backend **484 passed** (7 new), frontend **368 passed** (4 new).
>
> Same shape as `business-desk.md`: **Part 1** for the person running the
> business, **Part 2** for the person maintaining it.

---

# PART 1 — For the business manager

## 1. What was there

`/portfolio` — also reachable at `/studio`, from a card on Profile, and as a
mode toggle inside Tasks — was a **1,700-line website inside the app**. It had
its own sticky navigation, a personal hero ("I design brands that people
remember."), discipline filters, an editorial case-study reader with five
chapters per project, a price list of four services, a project-inquiry form, and
a "studio dashboard" that managed its own inquiry pipeline in localStorage.

It was well made. It was also **a second product**: a different price sheet, a
different enquiry queue, a different place to edit the same business identity,
and a set of placeholder case studies and testimonials that were labelled as
samples precisely because there was nothing real to put in them.

And almost none of it was something the app *does*. It was something the app
*displayed*.

## 2. What was actually a capability

Two things, and only two:

| Capability | Where it lived | Where it is now |
|---|---|---|
| **Show the work.** A buyer choosing a designer, printer or developer wants proof. | a card inside `/portfolio`, four taps from the shop front | **Selected work on the shop front** — the page the buyer is already on |
| **Sell the service.** Four services had a price, a turnaround and a scope. | a price list inside `/portfolio` | **Business Desk → Digital services** — one price sheet for the whole product |

Everything else was already provided somewhere better, or was decoration:

| What it was | Where it is now |
|---|---|
| Project inquiry form | the Business Desk request form (organisation, phone, what decides the price) |
| Inquiry pipeline (`new → booked → completed`) | **Enquiry inbox** — `new → contacted → quoted → won/lost` |
| Edit bio / identity | the shop front's own **Edit profile** drawer |
| "Marketplace UI → Creative Portfolio Hierarchy" table | deleted. It was an internal design note being shown to customers |
| Discipline filter chips, hero carousel, case-study chapters, testimonials | deleted. Twelve cards do not need a filter; a card does not need five chapters; and sample testimonials are worse than none |
| Prices per service | desk offers, with scope and exclusions — **the desk is now the only price sheet in the product** |

## 3. What a buyer sees now

On a business's shop front, under the identity and above the shelf:

> **Selected work** — *What this business has delivered, in their own words.*
>
> A grid of cards. Each card: a photo (or a plain title block), the kind of work,
> the year, a title, two lines about the job, and one line about what came of it.

No albums, no scroll-jacking, no "read the full case study". If a business has
published nothing, a visitor sees **nothing at all** — not an empty box, not a
"coming soon".

## 4. What an owner does

1. Open your shop front (Profile → *View my shop*).
2. **Add work** → a photo from your device (optional), a title, what it was, what
   came of it, the kind of work, the year.
3. It appears immediately, for every buyer who opens your profile.
4. Remove it from the card itself when it stops being your best work.

Twelve pieces maximum. That is not a technical limit, it is the point: a
showcase is a selection, and a buyer never reads past the third card anyway.

## 5. The rules that did not move

- **No prices on the shop front.** What a service costs belongs to the desk,
  where it comes with scope, exclusions and a readiness rule. This was the one
  place the two ideas were ever confused.
- **No payment details, anywhere.** A showcase is a showcase.
- **Nothing invented.** The old page shipped placeholder projects and placeholder
  testimonials, labelled as placeholders because they were not real. The new
  section starts empty and fills with what the business has actually done.
- **Nothing was silently lost.** `/portfolio` and `/studio` still resolve — they
  now redirect to Profile, where the shop front lives.

## 6. What this costs you

Nothing, and one thing: **the upkeep is yours.** An empty showcase is the same
as no showcase. But two cards — a photo and the sentence a customer said when
they paid — will out-perform a 40-chapter case study library that nobody updates.

---

# PART 2 — For the developer

## 1. File map

| Path | Role |
|---|---|
| `backend/app/services/work_showcase.py` | `WorkItem` model, `clean_work_items`, `public_work_items` — the only place the record's shape is decided |
| `backend/alembic/versions/0029_selected_work.py` | `vendor_profiles.work_items` (JSONB, NOT NULL, default `'[]'`) |
| `backend/app/routes/vendors.py` | `work_items` on `VendorOut`, `ProfileUpdate`, `_extended_profile_dict`, `vendor_by_handle` |
| `backend/app/modules/catalog/catalog.py` | `packaging_print_suite`, `motion_launch_pack` |
| `frontend/src/components/vendor/SelectedWork.jsx` | the section, the card, `AddWorkItemModal` |
| `frontend/src/lib/images.js` | `readGalleryPhoto` — moved out of `VendorProfile` (which re-exports it) |
| `frontend/src/pages/vendor/VendorProfile.jsx` | renders selected work between the header and the shop gallery |
| `backend/tests/test_v216_selected_work.py` | 7 specs |
| `frontend/src/test/pages.test.jsx` | 4 specs replacing the old portfolio spec |

**Deleted:** `frontend/src/pages/portfolio/CreativePortfolioPage.jsx` (1,693
lines), `frontend/src/config/portfolioData.js` (388 lines), the `/portfolio` and
`/studio` routes, the MePage "Creative portfolio" card, the `mode=portfolio`
toggle inside `TasksPortal`, and `/portfolio` + `/studio` from `ME_ROOTS`.

## 2. The data shape

```jsonc
// PUT /api/vendors/me/profile
{
  "work_items": [
    {
      "title": "Kibo Botanicals — identity system",   // required, ≤120
      "summary": "Wordmark, label architecture…",     // ≤280
      "outcome": "Twelve label formats at launch",    // ≤160
      "discipline": "Branding",                       // ≤40
      "year": "2026",                                 // ≤9
      "image_url": "https://…"                        // http(s), /api/, data:image/
    }
  ]
}
```

Enforced by Pydantic at the write boundary, not by the database:

- **`extra="forbid"`** — a public JSONB column will store anything a client
  sends it, so the shape *is* the contract. There is no HTML field and no
  rich-text field, so a work item cannot become a document.
- **Empty fields are dropped** rather than stored as `""`, so the database does
  not accumulate keys that mean nothing.
- **Sending without `work_items` never clears it.** An unrelated profile save
  (the drawer on the shop front) must not wipe the showcase. Sending `[]` does.
- **12 items maximum**, enforced by `max_length` on the field → `422`, not a
  silent truncation.

Read it back from `GET /api/vendors/{handle}` (public) or
`GET /api/vendors/me/profile` (own, freshest).

## 3. Why the offers went to the desk and not the other way round

A price list is a promise with a number in it. The desk already owns that
promise: every offer carries a readiness, a permitted action, exclusions and
what the customer must provide. A second price list on a second page had none of
that — it said "Custom quote · Scoped per project" and left the readiness rule
outside the building.

Two of the four services were already desk offers under other names (brand
identity → `logo_brand_starter`, web design → `business_website`). The other two
existed **only** on the portfolio:

| Key | Price (test) | Readiness | Permitted action |
|---|---|---|---|
| `packaging_print_suite` | 6,000–20,000 | `service` | Request a quotation |
| `motion_launch_pack` | 8,000–30,000 | `service` | Request a quotation |

Printing, foil stamping, voice talent and licensed music are **exclusions**, not
surprises on an invoice — the same rule the rest of the desk follows.

## 4. Migration `0029_selected_work`

```sql
ALTER TABLE vendor_profiles
  ADD COLUMN work_items jsonb NOT NULL DEFAULT '[]'::jsonb;
```

- Additive, no backfill (the server default *is* the empty showcase), no
  rewrite. Upgrade → downgrade → upgrade was run against live Postgres.
- The downgrade drops the column, and the showcase with it. That is the honest
  meaning of rolling the feature back: there is no second store to fall back to.
- The shape is deliberately **not** a database constraint. The rule lives in
  `work_showcase.py` so it can change without a migration — but the column is
  `NOT NULL` so code never has to defend against `null`.

## 5. The redirects

```jsx
<Route path="/portfolio" element={<Navigate to="/me" replace />} />
<Route path="/studio"    element={<Navigate to="/me" replace />} />
```

`replace`, not a render — a retired destination should not stay in history.
`ME_ROOTS` no longer lists either path, so the Profile tab highlights correctly
while the redirect resolves.

**Not migrated:** the old page persisted projects and inquiries in
`localStorage` (`ogallo_creative_*`). Those keys are now inert. Nothing was ever
stored server-side, so there is nothing to import — and nothing was fake-synced
into the new column to make the numbers look better.

## 6. Tests

```bash
cd backend  && pytest -q tests/test_v216_selected_work.py   # 7 passed
cd backend  && pytest -q                                    # 484 passed
cd frontend && npx vitest run src/test/pages.test.jsx        # 34 passed
cd frontend && npx vitest run                                # 368 passed
```

| Backend spec | Pins |
|---|---|
| `test_the_portfolio_price_list_now_lives_on_the_desk` | all four services are offers, with scope and a quotation CTA |
| `test_no_priced_service_is_only_reachable_from_a_portfolio` | every digital offer is inside a desk and states its scope |
| `test_a_vendor_publishes_selected_work_and_a_visitor_reads_it` | round-trip, empty fields dropped, public payload |
| `test_a_work_item_cannot_be_more_than_a_card` | no title / blank title / `javascript:` image / smuggled field / 13 items → 422 |
| `test_saying_nothing_keeps_the_work_and_an_empty_list_clears_it` | an unrelated profile save cannot wipe the showcase |
| `test_a_new_vendor_starts_with_an_empty_showcase` | no backfill, no nulls |
| `test_the_showcase_never_collects_payment_details` | `card_number` is refused by shape |

| Frontend spec | Pins |
|---|---|
| "shows a vendor's published work to a visitor" | cards, outcome, discipline — and no add control for a visitor |
| "shows a visitor nothing at all when the vendor has published no work" | no empty box |
| "lets the owner add a piece of work and take it down again" | add → `PUT` with one item; remove → `PUT` with none |
| "no longer sends people to a separate creative portfolio shelf" | no card on Profile; the shop-front card names the capability |

## 7. Next steps, in order of leverage

1. **Two real cards beat a library.** The section is only as good as the first
   two entries; a seeded "no work yet" state that nags on the shop front is more
   useful than more fields.
2. **Outcome, not process.** The old page asked for challenge / process /
   concepts / results. That produced essays. One result line is what a buyer
   repeats to someone else — keep the shape small.
3. **Reuse before rebuilding.** If a filtering need appears at twelve cards, the
   answer is to show fewer cards, not to bring back discipline filters.
4. **Testimonials can come back honestly** — one quote, attached to a work item,
   only after a completed trade. Not as sample copy.
5. **Watch the desk's digital line.** Adding print and motion makes six offers
   under one need. If it reaches ten, the desk needs a second question
   ("brand, website, or launch?"), not a longer list.
