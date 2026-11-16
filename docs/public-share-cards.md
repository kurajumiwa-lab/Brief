# Public share cards

A link in a WhatsApp group is the growth channel. A WhatsApp crawler does not
run React, so these two addresses are answered by FastAPI before the SPA
catch-all:

| Address | What it is |
| --- | --- |
| `/p/<handle>` | A member's portfolio page, with real `og:*` tags for crawlers. |
| `/invite/<shop-slug>` | A shop with no page yet, and the claim invitation. |

A signed-out browser that opens `/p/<handle>` is sent to the public mini-site
at `/page/<handle>` instead of a login wall, so the link a stranger taps from a
group still opens something real.

Both return the built `index.html` with the existing title/canonical/OG tags
removed and the generated ones injected. A browser still hydrates the same
React app; a crawler reads the head and stops. If the API runs without a built
frontend (Vercel service mode, local `uvicorn` beside `vite dev`), a small
standalone HTML document is returned instead.

## Images

`/og/p/<handle>.jpg` and `/og/invite/<shop-slug>.jpg` are 1200 × 630 JPEGs drawn
with Pillow. A flat card lands around 45 KB, far below WhatsApp's 300 KB ceiling.
No Cloudinary, Satori service or paid image API is involved. Responses carry
`Cache-Control: public, max-age=3600, stale-while-revalidate=86400`.

The profile card shows:

- the name, with initials instead of a fetched avatar;
- the rung the **server** can prove: Present, Reachable, Trading or Trusted;
- the region taken from `physical_location`;
- completed trades (`movements_completed + confirmed_trade_proofs`);
- categories from the real profile.

It does **not** say "verified by KRA" or "verified trader" unless a separate
verification field exists. The client ladder also counts device-local contact
and institution claims; the share card never claims a rung the server cannot
prove.

The invite card shows:

- the number of **verified** receipts on record, not every scan;
- the shop name, region and claim state;
- a free-claim call to action.

It never shows a buyer, an invoice number, a basket amount or a phone number.

## Invite resolution

`/invite/<shop-slug>` accepts either a KRA PIN or a readable name slug
(`kisumu-fresh-mart`). The slug is matched after the same normalisation used by
the frontend (`merchantSlug`). If the name is not unique, the first
unclaimed/pending match wins; a stored slug column is the next step at scale.

Public JSON exists for the SPA landing page:
`GET /api/receipts/invites/<slug>`. It is a public GET, registered in
`PUBLIC_READ_PREFIXES`; a claim remains authenticated and reviewed by an
operator. There is no SMS and no paid verification step.

## Deployment note

The single-container Docker image (the Railway deployment) builds `frontend/dist`
and serves it from FastAPI, so the injected shell and the SPA are the same
origin. On the split Vercel deployment, `/og/*` is proxied to the backend for
every request, and `/p/*` and `/invite/*` are proxied to the backend when the
`user-agent` matches a social crawler (WhatsApp, Facebook, Twitter, Telegram,
LinkedIn, Slack, Discord, Pinterest). An ordinary browser still reaches the Vite
app. The backend also has a standalone HTML fallback for service mode, but that
fallback is not the React app, so the bot condition must stay narrow.

If a crawler still receives the Vite `index.html`, test with the exact user-agent
and check that the rewrite wins over the frontend catch-all:

```sh
curl -A "WhatsApp/2.23.20.0" -sI https://<host>/p/<handle>
curl -A "WhatsApp/2.23.20.0" -s https://<host>/p/<handle> | grep 'og:'
```

## Tests

`backend/tests/test_public_share.py` asserts the metadata, absolute image URL,
1200 × 630 shape, JPEG content type, cache headers, sub-150 KB size, the absence
of buyer/invoice/amount data from invites, and 404 behaviour. The frontend has
`src/test/publicShare.test.jsx` for the invite landing page and claim hand-off.
