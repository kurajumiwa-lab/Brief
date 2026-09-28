# Wairo Blue Avenue opening

The production entry is `preview/src/main.jsx`. Startup has one identity:

1. Immediate HTML lockup: existing Wairo blue/green knot, **Wairo / Blue Avenue**, on the app's `#F7F8FA` canvas. The title, favicon, manifest, PNG install icons and React loading fallback agree. No black-and-gold or Brief interstitial.
2. Two animated editorial brand cards, loading the actual application in parallel.
   - **Small starts. Big possibilities.** — Spaces, Work, Community.
   - **Good people. Great plans.** — Parties, Trips, Wanderly.
3. Home, or the original destination. A failed application chunk offers a reload rather than an endless loader. A failed initial script download reveals a recovery link after 12 seconds.

## Behaviour

- 4.6 seconds per card; Skip, Next, Enter, Pause/Play and numbered navigation.
- Pauses while hidden, hovered or keyboard-focused; resumes with a fresh reading interval.
- Reduced-motion preference disables animation and autoplay; cards remain manually navigable.
- The hidden application is not a second visible or keyboard-accessible surface. Focus moves into it when the intro finishes.
- Plays once per tab at `/` or `/#home`; uses only the `wairo.brand-intro.v1` session flag. Blocked storage never blocks entry.
- Event, shop, group, admin and other deep links bypass it. Navigation during playback cancels the intro without overwriting that URL.
- `/intro`, `/intro/` and `/intro/index.html` replay the same component. The old standalone compiled marketing demo is removed. No demo statistics, contact form or third-party video remains there.
- Service-worker cache version `wairo-*-v3` retires the old cached shell. Both `/ingest` and `/api/` are excluded from caching. Existing authentication and economic storage keys are unchanged.

## Artwork

`preview/src/assets/brand/wairo-build.webp` and `wairo-go.webp` are original AI-generated **graphic illustrations**, not photographs or depictions of real places/people. They use architectural cut-paper forms, a blue avenue, green/teal, amber, coral and lilac. No faces, portraits, close-up product photography, logos or generated lettering. All brand text is accessible HTML, not baked into an image. Artwork is bundled locally as hashed assets, around **77 KB combined**. The knot remains the existing Wairo brand geometry.

## Checks

```sh
npm run test:typecheck
npm run build
bash run-suites.sh brandlaunch dukabook wanderly adminwiring compacthome
npx playwright test tests/brand-launch.spec.js
```

`brandlaunch.jsx` tests policy, timers, visibility, reduced motion, keyboard, skipping, replay, focus, session/blocked storage, branding and assets. Playwright covers the production page on desktop and mobile, real artwork loading, automatic and manual handoff, reload and deep links.
