# Home, and the screens behind it

*v2.8 — the hub → secondary-screen refactor.*

## 1. What was wrong

Two things, both the same disease: a screen that was also the whole journey.

**The home was a list, not a door.** `/` rendered `LocalHome` — a radius
selector, a category strip, and a list of businesses. Behind a row there was
nothing: tapping a public business navigated to `/map`, which shows you where
something *is* and never what it is. A list on a home screen cannot have
children, which is exactly why the near-you list had none.

**The repository already knew better.** `ShopHome.jsx` — the shelf the README
describes ("Home is a shelf — News, Suppliers, Stock, Rentals, Groups,
Events") — was built, complete with real counts, and **routed nowhere**. An
orphan file, waiting for the home screen to become what it described.

Meanwhile the sections that did have depth kept it inline: markets did
register / data / pace-note / leave in the list rows; news and search held
their sub-views in local state, so a category or a tab could not be linked to,
refreshed, or returned to.

## 2. The rule

> A top-level surface is a **hub**. Everything on a hub is a **door**. A door
> opens a **secondary screen**, and a secondary screen may open a **detail**.
> Where a surface cannot be a hub, it is **rewired** into a capability that
> belongs somewhere that can — not duplicated, and not left as a dead end.

Concretely: filters that are *screens* live in the URL (`/nearby/retail`,
`/news/stock`, `/search/suppliers`); filters that are *views of the same
screen* stay in local state (radius, search term) because they don't answer
"where am I", they answer "how much of this do I want".

## 3. The map of screens

```
/ (hub — the shelf)
├── /nearby                 Around you (the old home, now with somewhere to go)
│   ├── /nearby/{group}     one category's screen — retail, fresh, food…
│   ├── /place/{id}         a public (OSM) business, on its own screen
│   └── /@{handle}          a member's shop front
├── /map                    find something to buy near you
├── /news                   Market News
│   └── /news/{kind}        one kind's screen — stock, movement, event…
├── /network · /stock · /tools · /groups · /events
├── /search
│   └── /search/{tab}       products · suppliers · markets · news · places
├── /markets
│   └── /markets/{id}       one market: registered / mapped / claimed
└── /tasks (hub)
    ├── /tasks/squad        the Hustle League (was the unlisted /squad)
    └── /tasks/brief        → the Brief workspace, which already owns itself
```

Ten tiles on the hub, each with a live count, and every tile opens one of
those. A count of zero reads `—`; it never reads as importance and it never
hides the door.

## 4. Where the pattern did not fit, and what happened instead

This was the second half of the brief — "clone this where it's not applicable
rewire in a fitting capability".

| Surface | It didn't fit because… | Rewired into |
|---|---|---|
| A public (OSM) business | It has no shop front of its own — no vendor, no stock, no chat. Bouncing it to `/map` told you where it was and nothing else. | `/place/{id}`: the fields the source actually gave (phone, hours, website, address), the ODbL credit, when the source last confirmed it, and the one real action on an unclaimed row — *claim it*, which moves the row into the network. |
| `ShopHome.jsx` | Built, real, routed nowhere. | *It became the hub.* Not cloned into it — promoted into it, with two doors added (Around you, Map). |
| `/squad` | A 618-line league reachable only from inside Tasks and listed in no nav. | `/tasks/squad` — a track of the Tasks hub. The old URL redirects, so existing links keep working. |
| Brief workspace | Already a surface with routes of its own (`/brief`, `/stock`, `/analytics`…). Cloning it under Tasks would be two copies of one workspace. | `/tasks/brief` hands over to `/brief`. The track exists; the workspace is not duplicated. |
| News kinds, Search tabs | Sub-views held in local state: unlinkable, and lost on refresh. | Each kind/tab is a URL. Typing stays local — a term filters the screen you are on. |
| Market rows | Every action (register, data, pace note, leave) was inline in a list that was the section's only screen. | `/markets/{id}`: the three numbers a vendor acts on, the pace note, register/leave, and the door to the map. The list keeps the one-tap *register*. |

## 5. One bug fixed along the way

Building the frontend (`npm run build`) creates `backend/../frontend/dist`,
which mounts the SPA catch-all in `main.py` — and that catch-all was answering
every unmatched path, **including `/api/*`**, with `index.html` and a `200`.
So `GET /api/surface/map`, retired in the previous pass, appeared to come back
to life: 200, HTML, to a client expecting JSON.

Fixed where it should be: unknown `/api/*` paths now raise a JSON `404`
(`{"detail": "Not found: /api/..."}`). The SPA catch-all still covers every
non-API path, so a refresh on `/nearby/retail` or `/place/{id}` works.

## 6. What is asserted

`frontend/src/test/homeSurfaces.test.jsx` — 13 tests:

- the hub renders one door per section, and a zero count reads `—`
- a tile navigates instead of expanding in place
- `/nearby/{group}` filters from the URL, and the breadcrumb names the category
- a member row goes to `/@handle`; a public row goes to `/place/{id}`
- public-data rows still say "Open data" and carry the ODbL credit
- `/place/{id}` loads the row it was opened on and offers the claim
- `/markets/{id}` names an unworked market (places > 0, members 0) and registers you
- `/tasks/squad` renders the league; `/tasks/brief` lands in the workspace

Two pre-existing failures in `pages.test.jsx` are fixed as part of this: the
nav assertion now checks against `NAV` itself (so adding a section cannot rot
it) and the stock-form test matches the quick-add form that actually renders
(`Quantity` + a required price + *Add to my stock*).

Suite: **frontend 77 passed · backend 142 passed.**
