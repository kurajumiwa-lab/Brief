# The event wedge: broadcast → quote → booking

Status: implemented slice, pilot scope.

The event business is a scheduled commitment: a date, a place, a set of jobs,
and a person who has to show up. Today a Kisumu or Kisii wedding organiser
coordinates caterers, decorators, sound, photography and transport in WhatsApp
threads. The brief that decides who gets paid is a flyer photo, the "rate card"
is a rumour, and the only record of a cancellation is a deleted message.

This slice makes the commitment legible without taking custody of the money.

## What is in the product now

1. **Vendor rate card** — one public card per vendor, built from packages:
   a name, a price in KES, a unit (`per_event`, `per_day`, `per_person`,
   `per_hour`), what is included, plus links and reach claims. Links and reach
   are labelled **self-reported** until a separate verification flow exists.
   The card also shows how many quotes have been accepted on the desk.
2. **Event vendor request** — an organiser broadcasts a structured brief against
   one of their own events: category, budget band, response deadline, access
   time, power, parking, setup notes, who pays, and free-text requirements.
3. **Quote** — one vendor, one quote per request. The quote can reuse a rate-card
   package, but the amount and inclusions are stored on the quote so a later
   package edit does not rewrite history.
4. **Booking** — the organiser shortlists, accepts, or declines. Accepting one
   quote awards the request and declines the rest. The accepted quote opens the
   two parties' contact details. Payment happens directly between them.
   Editing a package keeps its id, so an existing quote keeps its reference.

## Deliberate limits

- No platform custody, escrow, float, or pooled cash. An accepted quote records
  an agreement; it does not move money.
- No fees in this slice. The pilot is free; a later fee record must be explicit
  and settle outside the platform.
- No scraping of social feeds. Reach claims are typed by the vendor and marked
  self-reported. A future verified badge needs its own evidence flow.
- No open public request board. Browsing requests requires a signed-in vendor;
  only the rate card is public.
- No goods delivery, no logistics competition. This is service coordination.
- Organiser reputation, cancellation complaints and reviews are the next slice;
  this one stores the participation facts they will attach to.

## API shape

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/event-desk/rate-card` | my rate card and packages |
| PUT | `/api/event-desk/rate-card` | create/update my card |
| PUT | `/api/event-desk/rate-card/packages` | replace packages |
| GET | `/api/event-desk/public/rate-cards/{handle}` | public card |
| GET | `/api/event-desk/requests` | open requests (signed in) |
| GET | `/api/event-desk/requests/mine` | my broadcasts |
| POST | `/api/event-desk/events/{event_id}/requests` | broadcast |
| GET | `/api/event-desk/requests/{id}` | detail; quotes only to the owner |
| POST | `/api/event-desk/requests/{id}/status` | close/cancel a broadcast |
| POST | `/api/event-desk/requests/{id}/quotes` | submit/update my quote |
| GET | `/api/event-desk/quotes/mine` | my quotes |
| POST | `/api/event-desk/quotes/{id}/status` | shortlist / accept / decline / withdraw |

## The three-step route

The UI is built as the route, not a directory:

- **Plan an event in 3 steps** — Events → Vendor desk → pick one of my events →
  broadcast a request.
- **Respond with a quote** — Vendor desk → open request → amount, package,
  inclusions.
- **Build a rate card in 3 steps** — Rate card → headline + categories → packages
  → publish.

## Next slice

Organiser reputation attached to the organiser profile: a review/complaint can
only be written by a registered attendee or a booked vendor of that event, stays
after the event is deleted, and carries an organiser reply plus an ops moderation
path.
