# Home is a command centre; Regions is the feed

Home and Regions used to answer the same question with different typography.
This change gives each one job.

## Home

In order, for a person who already has an account:

1. **Greeting and rung** — who this is and where they stand.
2. **Identity strip** — one box that merges "Your page" and "Home office". It
   shows `/p/<handle>`, the page's real counts, a WhatsApp share and a copy
   action, then the office the person belongs to. The two old boxes at the
   bottom of Home are gone.
3. **Next step** — the single ladder action, unchanged.
4. **Receipt rewards** — the scanner, plus the number of issued vouchers in the
   wallet and a direct link to `/receipts#voucher-wallet`.
5. **Happening soon** — a 220 px horizontal shelf of **dated** rounds and
   events only. The full region feed is not on Home.
6. **Inbox** — only when something is actually waiting.

### The shelf

- `GET /api/outside/search?kinds=scheduled,event` is the only discovery read
  Home makes. Rows are filtered again by the person's region and by a real
  `starts_at` within the last 12 hours / future.
- Each card has a 132 px visual header. If the creator uploaded a photo it is
  used; otherwise the category chooses a warm gradient and a line icon
  (groceries, trips, community, repairs, learning). There is no grey empty card.
- The date pill is `SAT • 10 AM`, `TODAY • 4 PM` or `OPEN ROUND`.
- The join counter is real:
  - events use `counts.attending` / `meta.capacity`;
  - local activities use `counts.booked` / `meta.capacity` (the feed now
    exposes `capacity` and `spots_left`);
  - with no capacity the card says `4 joined` or `Open to join`, never a made-up
    denominator.
- A thin progress bar is drawn only when a capacity exists.

## Regions

All browsing stays in Regions: people, offers, needs, every listing with its
full context. Home no longer repeats those rows.

## Inbox owns attendance

Joined rounds, bookings and event RSVPs live in the Inbox, not here. Home links
to the Inbox rather than pretending to track attendance; see
`docs/inbox-agenda.md` for the agenda and the shared Trade Pass.
