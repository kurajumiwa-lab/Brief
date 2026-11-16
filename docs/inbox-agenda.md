# Inbox: the week first, the messages second

The Inbox used to be one flat list. It could tell you who spoke last; it could
not tell you where you had to be on Saturday. The top of the page is now the
week, built from records the server already owns.

## What is on the agenda

`GET /api/outside/agenda` returns three kinds of real record:

| Kind | Source | Appears as |
| --- | --- | --- |
| `event` | `EventRegistration` (`registered` / `confirmed`) for an upcoming/active event | Event pass |
| `booking` | participant `ActivityBooking` (`agreed`, `in_progress`, `organizer_completed`, `participant_completed`) | Trade pass / Confirm |
| `round` | `ActivityResponse` (`group_pledge`, `round_stop_request`, `learning_enrolment`) not yet converted to a booking | Joined round / Waiting confirmation |

A booking supersedes its pledge, so a bulk buy cannot appear twice. Declined,
withdrawn, completed and cancelled records are not returned.

### No invented attendance

- A submitted pledge is **Waiting confirmation**, not *joined*, and has no pass.
- A booking the organiser has marked complete is **Waiting on you** and offers
  the real `confirm-completion` call, not a decorative button.
- Capacity is `LocalActivity.capacity`; the counter is `spots_confirmed`. With
  no capacity the row says `3 joined`, never `3/10`.
- The seven-day strip marks only days that have a record with a real date.
  Undated records stay in `All`; they are not given a fake day.

## The pass

`TradePassModal` handles an event seat and a confirmed booking with the same
card. It shows:

- a QR that points at the record (`?pass=HO-84K`);
- the fixed `HO-84K`-shaped reference, derived server-side from the record id
  and the app secret — it does not change between reloads and needs no signal;
- member page, counterparty and the record reference;
- WhatsApp share through the same `wa.me/?text=` link used on Home.

It is labelled **Reference**, not *cryptographically verified*. The host still
confirms the code against the member's name on the registration/booking. We did
not add a shopkeeper camera or a paid SMS step.

## Week strip

- Local dates, not UTC slices (`format(date, "yyyy-MM-dd")`).
- Today first, then six real days.
- A dot means at least one dated record; empty days have no dot.
- Tapping a day filters the agenda; tapping it again or `All` returns.

## Still open

- Showing the pass immediately after an event join or voucher redemption, in
  addition to opening it from Inbox.
- A host-side list that reads the same reference back, so the match is a lookup
  rather than a visual check.
