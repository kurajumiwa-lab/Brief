# Mobile pass — evidence

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
| `report.json` | per-screen overflow, tap-target and font-size measurements |

## Re-running it

```bash
npm i -D playwright-core @sparticuz/chromium   # Chromium ships in the package
npm run dev -- --port 5180 &
node qa/mobile-pass.mjs                        # writes into qa/
```

`@sparticuz/chromium` bundles its own Chromium, so this needs no browser
download — but it does need the NSS libraries (`libnspr4`, `libnss3`,
`libnssutil3`) on the host, which the package also ships in
`bin/al2023.tar.br` for glibc images.

## What it does not cover

Headless Chromium is not a phone. Still unverified by eye: iOS Safari (safe-area
insets, the `audio/mp4` recording path), real touch scrolling, and anything that
needs a camera or microphone — the preview environment blocks both.
