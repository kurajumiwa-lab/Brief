# Brief as the connector layer for Kenyan businesses (plan, not built)

Status: proposal for discussion. No new code. Nothing here changes the approved MarketTrust scope,
the empty services catalogue, or the rule that points are not money.

## 1. The reframe

Brief is not a marketplace and should not try to become one. The product is a **routine and
connection layer** for small businesses:

- one place to plan what to post, sell and message, and when;
- connectors to the tools they already use (WhatsApp, TikTok, Instagram, Facebook, M-Pesa, delivery);
- measurement in plain numbers, so the owner knows what to repeat;
- a trust layer (verified shops, till-code reviews) that makes the rest believable.

The long-term goal you described (media reach that Safaricom and banks buy) is an
**advertising and distribution business**. It needs audience reach that is real, consented to,
and measurable. That is the target to build toward, but it cannot be bought or faked into existence.

## 2. Three limits from the research (these shape everything below)

1. **TikTok publishing needs an audit.** The Content Posting API restricts unaudited apps to private
   posts. Audit timing is not published, and TikTok's guidelines reject tools built only for the
   owner's own account. Plan on draft/inbox handoff and link-out first, direct posting later.
   Scheduling through the official API is allowed; bypass automation is not.
2. **WhatsApp outbound needs opt-in and approved templates.** Marketing, utility and service
   messages are billed per message, and the number of free service messages changed on
   1 October 2026. No purchased lists. Opt-in must be recorded (the ODPC requires a lawful basis).
   Sources disagree on per-message prices (roughly KES 3.5 to 5.2 for marketing), so price the
   connector from Meta's own rate card, not from a blog.
3. **Followers cannot be moved off TikTok.** A TikTok follower stays on TikTok. Brief can reach the
   same people on WhatsApp (with consent), on a Brief shop page, and through a shareable calendar.
   It cannot make followers open Brief instead of TikTok.

## 3. The non-negotiable line: no fake followers

"Feel they are getting followers" can only be delivered honestly. The plan rules out:

- bought or bot followers, likes, or views;
- automation that bypasses a platform's controls (banned by TikTok and Meta, and it gets accounts removed);
- purchased contact lists or unsolicited broadcast.

What is allowed: a predictable schedule of real posts, opt-in audiences that grow through a QR code
or shop link, reviews from real till codes, and clear reporting of real reach. The product should
make the routine feel reliable without promising a follower count.

## 4. Connector model

Each connector declares what it can do. Brief never assumes more than the platform allows:

| Connector | Now (no approval) | Later (needs approval or contract) |
|---|---|---|
| WhatsApp | Share kit: copy, image, link, time; opt-in QR for a shop | Cloud API: opt-in broadcast with approved templates; service replies |
| TikTok | Share kit and link-out; a draft handed to the creator | Content Posting API after audit: direct, scheduled posts |
| Instagram / Facebook | Share kit and link-out | Graph API publishing after Meta app review |
| M-Pesa | Nothing new (Brief holds no money) | Only through the shop's own payment provider |
| Pickup Mtaani / riders | Delivery links from `docs/marketTrust/DELIVERY-LINKING-PLAN.md` | Partner APIs where they offer them |

Each connector has the same shape: `capabilities`, `auth`, `publish_mode` (`share_kit`, `draft`,
`direct`), `status`, and an audit trail. Adding a platform means adding one adapter, not changing the core.

## 5. Routines and scheduling (what "predictable" means)

- A **routine** is a repeating plan: for example "Tuesday and Friday, 18:30, product photo, price
  line, link to the shop." It is saved, editable, and repeats until the owner stops it.
- A **calendar** shows every planned post across connectors in one view, with status
  (planned, ready to share, shared, posted, failed).
- **Predictions are about the schedule, not the audience.** Brief can say "5 of 6 planned posts
  this week were shared on time." It must not predict reach or virality as a promise.
- Every shared or posted item records what was sent, to which connector, and when. That is the
  auditable record the owner and any partner can check.

## 6. Teams and clubs (not one person's shop)

The unit becomes an **organisation** with members and roles:

- roles: owner, editor (writes and schedules), approver (signs off), member (sees the calendar);
- a club or chama can have several shops, several pages, and shared routines;
- approvals before anything is shared or messaged to customers;
- the existing membership and group-order work is the starting point, not a new account model.

## 7. Phased plan

| Phase | Scope | Gate to leave the phase |
|---|---|---|
| P0 | This plan agreed. Teams and roles designed. Connector interface written. | You approve the plan and the answers in section 8 |
| P1 | Organisations with roles; routine + calendar; share kit for WhatsApp, TikTok, Instagram; shop opt-in QR | Real owners use it for two weeks; the schedule-adherence number is reported |
| P2 | WhatsApp Cloud API opt-in broadcasts with approved templates; consent records; opt-out | Meta business verification; template approval; ODPC-ready consent log |
| P3 | TikTok draft handoff, then Content Posting API direct posting if TikTok grants the audit | Audit passed (or stay on drafts) |
| P4 | Reach and conversion reporting; a partner programme for banks and telcos | Consented, measured audience; a compliance review of any financial promotion |

Nothing in P2 to P4 starts without a separate approval from you.

## 8. Decisions I need from you

1. **Teams first, or the connectors first?** I recommend teams and roles (P1), because every connector needs an owner and an approver.
2. **TikTok:** accept draft and share-kit handoff until the audit is passed? (I recommend yes.)
3. **WhatsApp:** should Brief become a Meta Business Solution Provider, or stay a customer of an existing one? Becoming one is a larger, regulated step.
4. **"Online access codes with business output":** what do you mean? Examples: a code that unlocks a routine template, or a code that gives a shop a paid service. Either way, it needs its own design and the points rule still applies.
5. **Banks and Safaricom:** this is P4. Do you want that path, given that financial promotions in Kenya need compliance review? I'd treat it as a later decision.
6. **Newspaper and TV ambition:** do you want Brief to offer its own content (a local news feed for shops), or only distribute what the shops make? Owning content is a different company from distributing it.

## 9. What I would not build

- Follower or engagement sellers, or any automation that imitates a person.
- Scraping of TikTok, Instagram or WhatsApp accounts.
- Money holding, lending, or any product that moves customer funds.
- Public claims of guaranteed reach, income or "wealth" for users.
