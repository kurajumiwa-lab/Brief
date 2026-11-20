# The Street Engine — calendar, tables, story guide

**Status:** shipped in the `arena/0e6590ee-brief` slice.
**Schema:** `0078_street_lobbies` (tables + members) and
`0079_street_broadcasts` (the scheduled stamp). No ledger.
**Routes:** `/api/street/*` and `/street`.

## Why this exists

Most local commerce already has a rhythm: the market day, the chamaa sitting,
the Friday run, the school-term restock. The missing layer was not another feed.
It was a way to (a) make the rhythm visible, (b) turn a live need into a small
group for the next two hours, and (c) hand the group to a conversation without
Brief renting a messaging API or touching money.

This is a light game frame, not a gambling or wagering product:

* a **season** is an economic quarter;
* a **script** is a weekday prompt, not an automatic post;
* a **table** is a TTL row with seats and a verification code;
* a **chapter** is a completed action, not a paid tier.

No purchase moves a chapter, a table, or a match score.

## 1. The calendar

`GET /api/street/calendar` is deterministic. It reads the clock; it does not
depend on a cron message having arrived.

| Surface | Rule |
|---|---|
| Season | Calendar quarter, local `Africa/Nairobi` |
| Today’s script | Weekday + local hour (Mon 07:00, Wed 12:00, Thu 16:00, Fri 15:00, Sat 06:30, Sun 18:00) |
| Upcoming | The next occurrence of each script, sorted |
| Timetable | The caller’s active `recurring_routines`, with the next real occurrence |
| Pulse | The existing `modules.pulse` payday / mid-month / weekend window |
| Official stamp | `street_broadcasts` row, written once per script per local day by `street_sweep` |

A missed sweep does not skip a Monday: the next call recomputes it. The
`recurring_routines` sweep still owns actual publication of dated activities.

### The scheduled pass

`app/modules/street/sweep.py` is registered by both scheduler owners
(`main.py` and `app/worker.py`), every `STREET_SWEEP_INTERVAL` seconds (60).
One pass does two things:

1. `expire_due` flips every open table whose `expires_at` has passed.
2. `publish_due` stamps the weekday script in `street_broadcasts` while its
   three-hour live window is open. A unique `(script_key, run_date)` makes a
   restart or a duplicate worker harmless.

A table is never *only* closed by the sweep: `list_lobbies` and `my_lobbies`
also compute expiry and flip due rows on read. The sweep is a convenience, not
a correctness dependency.

## 2. Matchmaking tables

`street_lobbies` holds one live need:

```
title, intent, zone, tags[], seats, joined_count,
opens_at, expires_at, handoff_channel, handoff_target,
verification_code, status
```

Intents: `co_buy`, `source`, `delivery`, `gig`, `meetup`.

**Invariants**

1. **The host is seat one.** `joined_count` starts at 1 and may never exceed
   `seats`.
2. **The last seat is atomic.** A join inserts a unique membership first, then
   increments only while `joined_count < seats` is still true. If the UPDATE
   loses, the membership is removed and the caller is told the seat went.
3. **One person, one seat.** A unique `(lobby_id, vendor_id)` makes a repeated
   tap idempotent and returns the same handoff.
4. **The contact is not public.** The list never selects `handoff_target`.
   Only a successful join builds the `wa.me` / `t.me` link.
5. **A table expires by itself.** Expired rows are filtered and marked on the
   next read; there is no scheduler requirement for correctness.

### Handoff

* WhatsApp: `https://wa.me/<normalised 254 number>?text=<encoded text>`
* Telegram: `https://t.me/<handle>` plus `share_text` carrying the code
* Code: 6 hexadecimal characters, stored on the table, also in the text.

The message says what the table is, the zone, who joined, and the code. Brief
does not send it; the person taps.

### Match reasons

`GET /api/street/lobbies` ranks open tables for the signed-in person by:

* same zone (text overlap, not GPS),
* overlap between their `business_categories` and the table’s tags,
* a closed-soon nudge,
* their own table first.

Every card carries the reasons it surfaced, so the ordering is inspectable.
Spend and plan tier are not inputs.

## 3. The story guide

`GET /api/street/guide` reads real records:

| Chapter | Evidence |
|---|---|
| Show your street | description + physical location + handle |
| Put one thing on the shelf | any `stock_items` row |
| Set a weekly rhythm | active `recurring_routines` |
| Open your first table | hosted or joined `street_lobbies` |
| Make one handshake | completed movements or confirmed trade proofs |

The response also carries a small persona (`Mtaa`, the street guide, with a
time-of-day line), the season script, the next four actions, a personal season
score and a level. **No public leaderboard is created here.** The
existing Hustle League has its own real-XP monthly standings; duplicating it
with a spend-weighted board would make visibility purchasable. Points here are
a private record of finished actions.

## 4. Frontend

* `/street` — season hero, today’s script (with an `Official broadcast`
  badge once the stamp exists), open tables, handoff, next seven days,
  recurring slots, chapters.
* Home (`TodayView`) — a static `StreetDoor` card links to `/street`; it makes
  no extra API call and adds no ninth navigation tab.
* Design: borderless `shelf-card` / `soft-card` surfaces; fixed dark poster
  colours for the season and handoff surfaces so both themes read the same.

## 5. What it deliberately does not do

* no custody, escrow, wallet or payout;
* no WhatsApp/Telegram API keys, bots or message sending;
* no scraping;
* no public phone numbers;
* no paid ranking or spend-based chapter progress;
* no automatic post from a script. The weekday prompt is a door, not a bot.
