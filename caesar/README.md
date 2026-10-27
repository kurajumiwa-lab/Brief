# Caesar — the community decides

A working prototype of the first release described in the brand brief: the
**home feed**, the **reaction system ("The Balanced Verdict")**, and **Circles**.
Everything else in the brief is either here in thin form (profile, safety centre,
compose, data saving, offline) or named as not built yet.

```bash
cd caesar
npm install
npm run dev      # http://localhost:5180
npm test         # 147 specs
npm run build
```

It runs in **two modes**, and says which one it is on the feed:

- **Demo** (default) — no server, no account, no network calls. State lives in
  `localStorage` under `caesar.prototype`, so the prototype behaves the same
  after a reload. "Reset the prototype" in the Safety centre puts the starting
  network back.
- **Live** — the same screens against the Brief API (`/api/social/*`). Joining
  needs a handle and nothing else: no shop, no business name, no vendor account.
  A vendor's existing Brief login works too, and the server gives it a social
  identity rather than a second one. The feed's order and every count on a card
  then come from rows in Postgres, not from this device.

```bash
# live mode, locally
python qa/serve-live.py &        # throwaway Postgres + the API on :8000
npm run dev -- --port 5180      # /api is proxied to :8000
```

The token is kept under `caesar.session` (not inside the prototype snapshot), so
resetting the demo data never signs anyone out of a real account.

This folder is self-contained and is **not** wired into the Brief app: `vercel.json`
builds `backend` and `frontend` only, so nothing here deploys or runs in CI for
the Brief services.

---

## The name

The brief is blunt about this: **no emperors here — Caesar is the crowd.** The
mark carries no ruler and no laurel, only a verdict held in balance. The line is
printed on the feed rather than buried in a brand book, because a name that
glorifies empire and a product that says "the community decides" cannot both be
true.

The alternatives the brief names — **Baraza, Jenga, Sankofa, Kesho** — are not
adopted here. Choosing between them is a naming study with real speakers of the
languages they come from, which is research, not code. The prototype is built so
the decision stays cheap: the name appears in `Logo.jsx`, the two `<title>`
elements and the seed's circle copy, and nowhere else.

---

## What was built, against the brief's MVP list

| MVP item | State |
|---|---|
| 1. Account creation and profiles | Profile screen with reputation; no auth — the prototype has one viewer (`@amina`) |
| 2. Text-first posts and a lightweight feed | **Built** — text, illustration, voice (a labelled sample), ranked feed |
| 3. Thumbs-up and thumbs-down reactions | **Built** — equal-weight buttons, withdrawable, queued offline |
| 4. Basic Circles and community moderation | **Built** — six circles, rules before joining, report → case |
| 5. Transparent content ranking | **Built** — the score and its four parts are printed in the app |
| 6. Reporting, blocking and appeals | Reports + block + mute + a stated appeals path; the appeal *queue* is not built |
| 7. Data-saving controls and offline composition | **Built** — data saver, per-post cost, offline queue that survives reload |
| 8. A small initial set of supported languages | **Built for 3** (English, Kiswahili, French); the next six are listed as not built |

Explicitly **not** built, and not faked: monetisation (M-Pesa / MoMo / Airtel
tips and subscriptions), SMS/USSD, notifications, image upload, a real
moderator console, and the remaining languages.

---

## Measuring the six things the brief asks for

The brief ends with a rule: judge the product on retention, data consumption,
content quality, fairness, language participation and moderation outcomes — *not
engagement alone*. That rule has a screen of its own at `/measure`, linked from
the rail.

Five of the six are computed from real state: the seed network plus whatever the
person using the prototype has done. Retention refuses to answer, and says why:

| Measure | On `/measure` | Where it comes from |
|---|---|---|
| Retention | **Not measurable here** | needs accounts and a second day; the prototype has neither |
| Data consumption | Total KB for the whole feed; the split between text, photographs and voice; what data saver withholds; the heaviest single post | the same per-post byte estimates the cards print |
| Content quality | Share of posts that reached *useful* (5+ reactions, 60% confidence) | `reputation.js`, the published definition |
| Fairness | Contested posts visible / contested posts; posts hidden for disagreement (**always 0**); dissent as a share of all reactions | `ranking.js` verdicts |
| Language participation | Posts per language tag, and the share not written in the interface language | each author's own tag |
| Moderation outcomes | Reports by status, blocked and muted counts | the Safety centre's own records |

The design rule behind that screen: every number is derived from the state the
interface is showing, never stored separately. A metric that can disagree with
the product is a metric that will.

---

## The three things that had to be got right

### 1. The ranking is visible, because that was the whole promise

"The community decides" is easy to say and easy to betray with a black box. So
the score is four published numbers:

```
score = 0.50 × confidence      Wilson lower bound of support (95%)
      + 0.20 × participation   log-scaled weighted reactions, capped at 40
      + 0.15 × recency         half-life of 12 hours
      + 0.15 × circle fit      1 if the post is in one of your circles, else 0.35
```

`src/lib/ranking.js` produces both the ordering and the explanation, from the
same call — the Verdict panel cannot drift from the feed. Every card carries one
line of its own reasoning; tapping it opens the four parts, the weights, the
final score, and anything the system flagged.

**Why Wilson and not "likes minus dislikes".** With a raw share, two friends
agreeing is 100% support and outranks a post 34 people backed. The Wilson lower
bound asks "how sure can we be *given how few people have spoken*": 2/2 scores
0.34, 34/37 scores 0.79. The feed therefore waits for a community instead of
being decided by whoever arrives first. The copy says this out loud on the card.

### 2. Disagreement lowers reach; it never removes speech

Three separate mechanisms, deliberately not merged:

| Action | Who owns it | Effect |
|---|---|---|
| Downvote | the community | lowers ranking. Nothing else. No report, no hide, no mark on the author |
| Report | you, about a rule | opens a case. Does not hide the post, does not tell the author |
| Block / mute | you alone | changes what *you* see. Changes nothing for anyone else |

A post is called **contested** at 8+ reactions with a third or more against it.
Contested posts keep a published floor of 0.25 so they cannot be pushed out of
the feed by disagreement alone — they stay, ranked lower, labelled, with a link
to the argument. Only a moderator decision removes anything, and that is a
separate process with a case number and an appeal.

### 3. Coordinated bursts are damped, not banned

If a third of a post's reactions arrive inside 60 seconds from accounts with no
history, those reactions count at **half weight** and the panel says so. Nobody
is banned, nothing is deleted, and the post stays exactly where it was. An
honest crowd that simply arrived at once loses very little.

The seed data contains a real instance of this (`p-packaging`: five supporters
over a day, then eighteen fresh accounts inside one minute), so the behaviour is
visible in the app rather than only in a test.

---

## Circles

Six seeded communities — two market/trade, two learning, one civic, one coastal.
Each states its **rules before the join button**, because a rule you only meet
after being punished is a trap. A circle has its own moderators and its posts use
the same ranking as the home feed; a circle is not a different product, just a
narrower one.

## Data, offline and language

- **Data saver** hides images *and voice notes* until asked, printing what each
  would have cost — including in the composer before sending. Voice is gated
  because the measurement screen showed it was 90% of this feed's bytes; one
  42-second note outweighed every text post combined.
- **Offline** is a visible state, not an optimistic lie: reactions and posts are
  marked *Queued*, listed in the Safety centre, stored, and cleared on reconnect
  with a count of what was sent.
- **Three languages** for the whole interface, switched from the top bar; posts
  carry their own language tag and are **never** machine-translated here. The
  six next languages are listed in the UI as not built.

## Brand implementation

- Tokens for Deep Green `#0B3D2E`, Gold `#F2C14E`, Terracotta `#E07A5F`, Ivory
  `#FFF8E7`, plus a full dark theme (`ivory on green`, gold and terracotta kept
  to signals rather than surfaces).
- Sora for the brand, Inter for the interface — as specified, self-hosted from
  `@fontsource-variable` and subset by `unicode-range` (≈82 KB of woff2 for the
  Latin interface). No `fonts.googleapis.com` request, so the typography also
  works in the offline state the app advertises.
- The same geometry is the **app icon**: the symbol only, no wordmark, inlined as
  one data URI in `index.html` — which is what the brief asks an app icon to be.
- The **Balanced Verdict mark** is drawn as vector (`src/components/Logo.jsx`):
  a green badge, a gold thumbs-up and a terracotta thumbs-down of identical size
  and mirrored position, with Africa at the centre. Symmetry is the argument:
  agreement and disagreement are equal citizens in a verdict.
- Tones: gold = support, terracotta = disagreement. Terracotta rather than red
  because disagreement is not an alarm.

## Where things live

```
src/lib/ranking.js       the Balanced Verdict: weights, Wilson, burst damping, scoring
src/lib/reputation.js    what "useful contribution" means, defined in one place
src/lib/selectors.js     the only visibility rules (blocks, mutes, moderation status)
src/store/appStore.js    the demo network: one store, localStorage, the offline queue
src/store/session.js     which account this interface is speaking as (demo or live)
src/store/live.js        the server's answers, and the two ways a request can fail
src/lib/api.js           the API client; fetch is injected, so it is testable offline
src/lib/liveFeed.js      server rows → the entry shape every card already renders
src/lib/useSocial.js     one set of actions, routed to whichever mode is active
src/data/seed.js         fourteen posts covering every state the feed must handle
src/components/          PostCard, VerdictSheet, Logo, Nav, TopBar, Toasts, Avatar
src/lib/metrics.js       the six measures, derived from state, never stored
src/pages/               Feed, Circles, Circle, Compose, Profile, Safety, Measure
```

## Tests

147 specs across nine files (`npm test`):

- `ranking.test.js` (20) — small samples cannot decide, contested posts are never
  dropped and hold the floor, bursts are damped and nobody is banned, published
  weights sum to 1 and are the ones applied, determinism.
- `reputation.test.js` (9) — the contribution definition, disagreement never
  lands on the author, only upheld reports do.
- `feed.test.jsx` (12) — ordering by the published score, both reactions as
  peers, withdrawing and swapping, the panel printing the same score the feed
  used, and the brand line on the feed.
- `controls.test.jsx` (26) — report ≠ hide, block/mute/unblock, offline queueing,
  data saver, language, theme, composer validation, circle join/leave, profile,
  the dialog's focus handling, the honesty list of what is not built, and the
  composer labelling its media as samples.
- `storage.test.js` (11) — old payloads, unparseable payloads, a browser that
  refuses to store, write-through, reset.
- `metrics.test.js` (12) — each of the six measures agrees with the state it
  summarises, retention stays unmeasured, and a moderator removal is counted.
- `shell.test.jsx` (14) — the skip link is first in tab order, the document
  title names the screen, focus follows a navigation but is never stolen on
  first paint, and `/measure` prints all six.
- `live.test.jsx` (16) — the client against a stubbed edge: the server's sentence
  is shown rather than a generic failure, a dead token signs the person out, an
  unanswered network is not reported as a refusal, the pressed button comes from
  the server's `my_reaction` and survives a reload, an optimistic reaction is
  rolled back when refused, a reaction you already gave withdraws instead of
  doubling, the adapter invents no numbers, and demo mode never calls `fetch`.

## Mobile pass

Driven in real Chromium at 390×844 (Pixel 7 metrics) against the dev server:
every screen screenshotted, console checked, and the DOM measured for
horizontal overflow, tap-target size and text below 12px. The screenshots and
the raw measurements are in `qa/mobile/` at the repository root.

Five defects were found this way and fixed in the same commit:

| Defect | Cause | Fix |
|---|---|---|
| Page 423px wide on a 390px screen | a `1fr` grid track has an automatic minimum of its content | `minmax(0, 1fr)` on the shell and tab bar, `min-width: 0` on grid items |
| Language control pushed the top bar 15px off-screen, 17px tall | a native `<select>` sizes to its longest option | ISO code in a 44px control, full name in the label |
| Feed loaded 57px scrolled, hero title clipped by the sticky bar | `focus()` on the main region scrolls it into view | `focus({ preventScroll: true })` |
| Every card flush to the screen edge | a stray `}` killed `.container`'s padding | brace removed, 16px gutter restored |
| Reaction buttons 34px tall | designed to look right, not to be hit | 44px target |

All screens now report **zero** horizontal overflow and no console errors. Every
interactive control meets WCAG 2.5.8 (24×24); the reaction buttons, the top-bar
controls and the switches meet 44×44. Chips and inline links are 30px tall — the
44px pass counts them and prints the numbers instead of hiding them.

## Live pass

`qa/live-pass.mjs` drives the same phone against the real API and checks every
screen **twice** — in the DOM and against the API with the same token. It joins
without a vendor account, compares each card's counts with the server's rows,
reacts and reloads to prove `my_reaction` came back, files a report and checks
the post is still `published`, blocks and unblocks, and writes a post that the
API then returns. Latest run: 11 assertions, 0 failures, 0 overflow, 0 console
errors. Evidence and the raw report are in [`qa/`](qa/).

## Sensible next steps

1. ~~A real backend with the same public shape~~ — **done** (`/api/social/*`,
   migration `0025`). The ranking now runs server-side against real rows; the
   client kept the same entry shape, so the verdict panel explains a live post
   with the same function it uses on the demo network.
2. A moderator console and an appeal queue (the appeal *path* is stated, the
   tool is not built).
3. Real media: camera and microphone capture with compression before storage,
   since the data cost is the whole product's constraint. Planned in
   [`docs/media-capture-plan.md`](docs/media-capture-plan.md).
4. The next languages, done properly with translators rather than machine output.
5. Only after retention and fairness are measured: tips and subscriptions via a
   PSP, with the same rule that no automated system moves money without a human
   confirmation.
