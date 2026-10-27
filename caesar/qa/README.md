# Mobile passes — evidence

Two passes, both driven in headless Chromium at **390×844** (Pixel 7 metrics, DPR
2, touch): one against the demo network in the browser, one against the real API.
Both write their raw measurements next to the screenshots.

Produced by driving the running dev server in headless Chromium at **390×844**
(Pixel 7 metrics, DPR 2, touch), then measuring the DOM. Not a design mock: these
are screenshots of the app as it renders.

| File | What it shows |
|---|---|
| `feed.png` | the feed, hero intact, reaction buttons at thumb size |
| `reactions.png` | support / dissent side by side, equal weight |
| `verdict.png` | the verdict sheet open, all four parts legible |
| `circles.png` | rules shown before the Join button |
| `compose.png` | the composer, data estimate, labelled samples |
| `profile.png` | contribution, not follower counts |
| `safety.png` | reports, blocks, mutes, the honesty list |
| `measure.png` | the six measures, retention refusing to answer |
| `report.json` | per-screen overflow, tap-target and font-size measurements (demo) |
| `live-feed.png` | the feed reading real rows: server score, server counts, `Live · @handle` |
| `live-join.png` | joining from the profile — a handle, no business account |
| `live-safety.png` | a real case number, and the blocked account named so it can be undone |
| `live-page-*.png` | all six routes after the live pass, at phone size |
| `live-report.json` | the 11 live assertions, per-page overflow and tap-target audit |

## Re-running it

```bash
npm i -D playwright-core @sparticuz/chromium   # Chromium ships in the package
npm run dev -- --port 5180 &
node qa/mobile-pass.mjs                        # writes into qa/
```

`@sparticuz/chromium` bundles its own Chromium, so this needs no browser
download — but it does need the NSS libraries (`libnspr4`, `libnss3`,
`libnssutil3`) on the host, which the package also ships in
`bin/al2023.tar.br` for glibc images. Extract that once and point the loader at
it:

```bash
node -e "const z=require('zlib'),f=require('fs');
f.writeFileSync('/tmp/al2023.tar', z.brotliDecompressSync(f.readFileSync('node_modules/@sparticuz/chromium/bin/al2023.tar.br')))"
mkdir -p /tmp/nsslibs && tar -xf /tmp/al2023.tar -C /tmp/nsslibs
LD_LIBRARY_PATH=/tmp/nsslibs/lib node qa/mobile-pass.mjs
```

## The live pass

`live-pass.mjs` needs the API, not just the dev server:

```bash
cd ../backend && python ../caesar/qa/serve-live.py &   # throwaway Postgres, :8000
cd ../caesar && npm run dev -- --port 5180
node qa/live-pass.mjs                                  # writes live-*.png + live-report.json
```

It checks each claim twice — in the DOM and against `/api/social/*` with the
browser's own token — because a client that agrees with itself proves nothing:
the feed's counts match the server's rows, a reaction is a row that comes back
after a reload, a report opens a case and leaves the post `published`, a block
hides the author from this reader only and the list names them, and a post
written in the prototype is returned by the API.

`serve-live.py` starts its own Postgres under `/tmp` and never touches a real
database; it is a harness, not part of the app.

## What it does not cover

Headless Chromium is not a phone. Still unverified by eye: iOS Safari (safe-area
insets, the `audio/mp4` recording path), real touch scrolling, and anything that
needs a camera or microphone — the preview environment blocks both.
