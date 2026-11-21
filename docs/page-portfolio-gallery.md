# The page portfolio — photos, listings and a seeded demo

A page is judged before it is read. The first version of `/p/:handle` had a
name, a town, one line of About, a text-only work list and two buttons pointing
at a region feed. That is enough to *have* a page and not enough to *use* one:
a stranger cannot tell what the trade looks like, what it costs, or whether the
finished job was any good.

This adds the two surfaces that answer those questions, plus a script that fills
them so a deployment reads like a working business on day one.

---

## 1. The gallery board

`vendor_profiles.gallery_items` — a JSONB list of
`{image_url, caption, tag}`. It sits **beside** `work_items`, not in place of it:

| | answers | shape |
|---|---|---|
| `work_items` | *what have you delivered?* | title, summary, outcome, discipline, year, image |
| `gallery_items` | *what does it look like?* | image, caption, one tag |

### Rules, enforced in `app/services/gallery_showcase.py`

* **A photograph is the record.** `image_url` is required and must be an
  uploaded path (`/static/…`), an `uploads/…` key, or http(s). `data:` and
  `blob:` are refused by name — they draw only in the tab that made them.
* **One tag, from a fixed list.** `work`, `before-after`, `premises`, `team`,
  `product`, `event`, `other`. An unknown tag is filed as `other`; a blank tag
  as `work`. Free text would give three spellings of "cleaning" and a chip row
  that filters nothing.
* **Capped at 30.** Thirty is a portfolio; three hundred is a camera roll read
  on a phone.
* **Silence does not wipe.** Omitting `gallery_items` leaves the board alone;
  sending `[]` clears it. Same contract as `work_items`.
* **Unknown fields are refused.** The record is public and vendor-written, so
  the shape is the contract.

### API

```
GET  /api/vendors/{handle}        → gallery_items: [...], gallery_tags: {work: 4, …}
GET  /api/vendors/me/profile      → the owner's own board
PUT  /api/vendors/me/profile      → { "gallery_items": [{ image_url, caption, tag }] }
```

`gallery_tags` is the chip row's counts, computed by the server so the UI never
has to guess whether a chip has anything under it.

### UI

* `components/you/GalleryBoard.jsx` — a masonry board (CSS columns) where each
  photo keeps **its own** aspect ratio. `Media` grew a `fit` prop for this: the
  frame is set from `naturalWidth / naturalHeight` once the file arrives, so a
  tall before-and-after is tall and a wide premises shot is wide, neither
  cropped to a shape it never had. Chips filter by tag with real counts; tap
  opens a keyboard-navigable lightbox.
* `components/you/PageOffers.jsx` — the page's **own listings** from
  `/api/offerings/of/:handle`: service prices and duration, goods quantities,
  tool day rates. `ask_me` reads "Ask for a price"; a zero is never invented.
* The hero shows a six-photo strip and the number of photos, so the first screen
  already reads as a portfolio.

The owner gets an **Add photos** button (many files at once, one caption and one
tag for the batch, because a batch is usually the same kind of thing), and can
remove a single photo from the board. Both write the whole list through
`PUT /api/vendors/me/profile` and re-read the page afterwards — optimistic in the
UI, truthful in the end state. Visitors never see either control.

---

## 2. Seeding it: `backend/seed_showcase.py`

```
cd backend
python seed_showcase.py                    # against http://localhost:8000
BASE_URL=https://brief.example.com python seed_showcase.py
```

Creates `@glow_cleaning` (password `Brief-demo-2026`) and fills it:

* **8 photos** across `team`, `work`, `before-after` and `other`
* **3 selected-work cards** with outcomes ("Deposit returned in full")
* **5 offers** — two services with prices, an `ask_me` service, a goods pack and
  a hire item, each with a demo photo

Everything goes through the **public API** — the same endpoints the owner's own
screen calls — so the script doubles as a check that the API can actually do it.
It is idempotent: existing photos and cards are left alone, and an offering whose
title is already on the account is skipped. Photos are read from
`frontend/public/photos/`, the same files the design preview uses.

Images in `frontend/public/photos/` are demo content. Replace them with the
business's own photographs before showing the page to a real customer — the
whole point of the board is that the photos are the evidence.

---

## 3. Where to change the vocabulary

| what | file |
|---|---|
| photo tags, offer kinds, price wording | `frontend/src/config/showcase.js` |
| tag validation, caps, public shape | `backend/app/services/gallery_showcase.py` |
| the board and the lightbox | `frontend/src/components/you/GalleryBoard.jsx` |
| the listings block | `frontend/src/components/you/PageOffers.jsx` |
| the page itself | `frontend/src/components/you/PortfolioView.jsx` |

Adding a tag means adding it to **both** lists; the backend files anything it
does not recognise under `other`, so a half-finished change degrades quietly
instead of showing a chip nobody else has.

---

## 4. Tests

* `backend/tests/test_v218_page_gallery.py` — the record contract: displayable
  images only, the fixed vocabulary, the cap, silence-vs-empty, public counts,
  and that the board and the showcase never edit each other.
* `frontend/src/test/portfolioLanding.test.jsx` — the board's chips and counts,
  the lightbox and Escape, no empty board for a visitor, the owner's add/remove
  saving the whole list, and prices (including "ask").
* `frontend/src/test/previewShowcase.test.jsx` — the `/preview` page renders the
  same board and listings from fixtures, and every fixture photo is a real file.

---

## 5. Migration

`alembic/versions/0081_page_gallery.py` adds `vendor_profiles.gallery_items`
(`JSONB NOT NULL DEFAULT '[]'::jsonb`). No backfill: an empty board is a valid
board, and a page with no photographs shows no board at all rather than an empty
frame.
