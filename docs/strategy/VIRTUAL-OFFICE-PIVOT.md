# Pivot: the home network for any venture (plan, not built)

Status: proposal for discussion. No code. Builds on what is already merged (MarketTrust, delivery
links, the Home feed) and on `CONNECTOR-PLAN.md`.

## 1. The idea in one line

Brief becomes the **home network** for any family or professional venture: a place where a team
runs its daily work, invites people it already knows, finds nearby services, and keeps its calendar.
It starts as a productivity tool for one team and can grow into a larger network that carries
advertising, so that small local businesses can reach clients close to home.

Examples of ventures it should serve: a family business, a salon, a laundry, a home food delivery
service, a clinic, a law firm, a farm co-op, a chama, a freelancer, a tailor, a boda rider group.

## 2. Who it is for, and how it grows

- **Start:** one team or family runs its work here (a calendar, shared tasks, bookings, its own page).
- **Grow by invitation:** a team invites people it already knows and who are already registered.
  People are not targeted to join. Joining is always optional, and leaving is one tap.
- **Grow by neighbourhood:** a business is found by the area it serves (estate, town, ward),
  and by the address, email or phone number it already uses. Customers can find a salon or a laundry
  near them without a full account.
- **Grow into a network:** enough active teams make the network large enough to sell placements
  and, later, advertising.

## 3. Modules

1. **Team home.** The venture states what it is, who is in the team and their roles (owner, editor,
   approver, member), when it is open, where it works, and what help it needs.
2. **Invites.** Only to people already registered and only with the invitee's acceptance. Each
   invite and each accept or decline is logged.
3. **Offers and bookings.** Lists what is offered nearby and sorts it: best deal, favourites,
   trending, nearest, most reviewed. Every sort states its basis.
4. **Secretary.** Drafts replies, proposes bookings and reminders, and acts only with approval.
   Every action is recorded.
5. **Calendar linked to activities.** Events belong to an activity ("Saturday: home delivery
   run", "Doctors' forum"). Export to ICS or Google/Outlook.
6. **Local discovery.** Businesses are listed by area and reached by their address, email or
   phone. A customer is never added to a list without consent.
7. **Network needs.** A team posts what it needs ("a rider for Friday", "a locum for two
   Saturdays") and the network answers through the trust layer (verified shops, till-code reviews).

## 4. Paid placement and ads (allowed, with rules)

You have said paid placement is allowed. The plan keeps it honest:

- A paid placement is **labelled** as an ad or "featured". It never looks like an organic result.
- "Best deal" and "trending" state their basis. Paid placement is never counted as organic ranking.
- Advertisers pay Brief for placements, and Brief holds no customer money (unchanged rule).
  Payments go through the advertiser's own provider, not through Brief's accounts.
- Local ads are targeted by area the business serves, not by personal data. Targeting on home
  location or personal details needs a separate decision and consent.
- Kenya's Consumer Protection Act 2012 covers misleading claims. Counsel should confirm the labels
  and wording before launch.

## 5. The path from productivity tool to network

| Stage | What it is | Gate to the next stage |
|---|---|---|
| S1 | One team's home: calendar, tasks, bookings, team page | A set of real teams use it every week |
| S2 | Invites to registered people; local discovery by area | Invites accepted at a healthy rate; complaints handled |
| S3 | Paid, labelled placements for local businesses | Clear labels; advertisers are verified |
| S4 | Advertising for larger brands (banks, telcos) | Enough active users and an audit of targeting and consent |

S4 is only reached if S1 to S3 prove real use. I would not promise it earlier.

## 6. Rules that do not change

- **Opt-in and opt-out:** a person can leave any team or network at any time, and their data is
  removed from it when they do. Opt-out is easy to find.
- **Contact data:** a phone number or email is used only for what the person agreed to. Unsolicited
  messages are not sent. The Data Protection Act 2019 applies; ODPC consent must be recorded.
- **Health and other sensitive areas:** Brief does not give medical advice. Licensed practitioners
  must be verified, and health data needs legal and clinical review before any such feature.
- **Money:** Brief holds no customer funds and does not lend.
- **No fake signals:** no bought followers, reviews or rankings.

## 7. Decisions (answered by the owner)

1. **Invites:** acceptance every time. Nobody is added without agreeing.
2. **Listing without joining:** yes, a business can be shown before it joins, but only as an
   **external listing**: the owner (or a verified outside source such as a TikTok ad or an
   institution) is shown with what is publicly known. Details are shown only when there is enough
   evidence to be more than speculation (for example a verified account, a registered business
   number, or a claim by the business). Brief does not earn from these listings, so they are shown
   as listings, not placements.
3. **Placements:** local only first. The network must fill with real businesses in the same area.
4. **Onboarding is open.** The creator can be one person. A profile is created first (for example a
   barber's home office). Team members are added later by:
   - a **link** sent to an unregistered person, with a stated function;
   - an **invite** to a person who already has a profile, to join as a partner.
   The role can be as low as staff. A solo profile is visible in the network from day one, for home
   visits or shop bookings, before any engagement.
5. **Calendar:** Google Calendar or whatever is easiest, starting with ICS export.

### Rules these decisions add

- **Reviews after a real trade.** Brief does not take payment. A "real trade from the site" is
  proven by a one-time till code or receipt reference from the business (the MarketTrust mechanism).
  Only then is the buyer asked how the business did. A good review (per the trust rules) moves the
  business to "present and available" in the network.
- **Exact location for home visits.** A barber or delivery service shows its area. The exact
  address is shared only after a booking is confirmed by both sides.
- **Contact details.** Phone and email are shown only where the owner chose to show them.
- **External listings need a claim path.** A listed business can see its listing, correct it, and
  ask for removal. A listing is never used to contact the business.

## 8. First build slice (S1) — proposal, awaiting approval

Smallest useful piece, in order:

1. **Solo profile.** Create a home office for one person: name, nature of work, area served, hours,
   a public-safe contact choice. No team needed.
2. **Team roles and invite links.** Add a member by link (unregistered, with a stated function) or by
   invite (registered, accepts to join as partner). Roles: owner, editor, approver, member, partner.
3. **Calendar.** Events under an activity; export to ICS.
4. **Review prompt.** After a till code is redeemed, ask the buyer for a review (reuses MarketTrust).

Not in S1: placements, external listings, ads, medical features.

Each step gets tests and an audit trail, and each is a separate commit for review.

## 9. What I would not build

- Mass invites, or adding people who have not agreed.
- Selling a person's contact details or buying contact lists.
- Hidden paid rankings, or fake reviews.
- Medical advice, lending, or anything that holds customer money.
