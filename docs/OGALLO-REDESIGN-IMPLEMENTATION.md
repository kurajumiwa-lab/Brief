# Ogallo redesign — implementation report

**Date:** 2026-10-09

**Audit and navigation map:** [`OGALLO-REDESIGN-AUDIT.md`](./OGALLO-REDESIGN-AUDIT.md)

## Completed

- **Five distinct primary destinations** now use the same information architecture on desktop and mobile: Home, Browse, Orders, Inbox, and Me. Browse discovery gets a contextual rail for Stock, Suppliers, Around you, Map, Markets, and News. The secondary drawer no longer repeats Home, primary trade tabs, or the operating-mode selector.
- **Home is a trading feed, not a directory.** It has a personalized editorial hero, one prominent search, live product categories from the stock API, live network stock, supplier recommendations, up to three movements needing action, and a recent-trade preview. Search goes to the existing Browse workflow; market and rental queries are preserved. Failed live-stock requests offer a retry instead of leaving a skeleton in place.
- **Onboarding gets out of the way.** Completed checklist steps disappear; completion or dismissal replaces the checklist with a business pulse derived from shelf visibility, open movements, supplier links and recorded fulfilment.
- **Me is the business dashboard and workspace.** It groups the vendor's shop front, inventory, analytics, POS Bridge, Tasks, vendor lists, Market Locks, Our Network and Surfaces. The legacy `/brief` route redirects here rather than opening a second dashboard/feed. The hamburger drawer contains only unique secondary destinations (Groups, Events and admin tools); workspace routes are not duplicated there. The profile dropdown shows account information and keeps the sole profile-settings/mode/theme/sign-out controls.
- **One operating-mode control** lives in the account menu and continues to call the existing server-backed role switch. Home and Me display the current mode, so it stays visible without exposing duplicate controls.
- **Route compatibility and permissions are retained.** Existing auth gates, data stores, API contracts and vendor records are unchanged. `/brief` and `/profile` remain useful aliases to Me; old stock network/movement links route to Browse and Orders; listing, shop-front, chat and order deep links remain available.
- **Shared visual system updated** with warm paper surfaces, forest-green trade actions, gold price accents, orchid identity accents, dark-theme tokens, reusable navigation/section styles and an Ogallo shelf-mark. The Home hero image is a JPEG (~197 KB) rather than a multi-megabyte PNG.
- **No new inert buttons or prototype flows** were added. New entry points lead to existing working pages and actions.

## Deferred / deliberately not claimed

- **No backend or trading protocol changes.** Sourcing, deal negotiation, chat, order state transitions, roles and trust calculations continue to use the existing APIs and permissions.
- **No new comparable-price index, automated sourcing/reorder recommendations, configurable stock alerts, or low-data/offline cache** was introduced. The existing vendor-stated prices, stock comparison, analytics and notification flows remain available; expanding them is separate product work.
- **No new trust-score formula or self-entered reputation.** The Me summary exposes existing recorded fulfilment/network fields only; trust is still based on the current backend records.
- **No separate account-settings application or payments/disputes workflow** was added. Shop-profile editing, theme, operating mode and sign-out remain in their existing places.
- **Recent trade preview is intentionally compact:** it shows up to three received/cancelled movements. Active work appears separately under “Needs your action”; full history remains in Orders.

## Tests and build

- `npm test -- --reporter=dot` — **10 test files, 98 tests passed**.
- `npm run build` — **passed** (Vite production build).
- Coverage added or updated for primary-route ownership, unique secondary destinations, the Brief compatibility inventory, AccountMenu identity/mode/profile settings, Me workspace destinations, onboarding-to-insights handoff, live Home categories/search/trust/recent-trade behavior, and market/rental query routing.
- `npm run lint` — **not runnable in the current frontend package**: the script invokes `eslint`, but ESLint is not installed or declared in `frontend/package.json` (`sh: eslint: not found`). No repository-wide lint result is claimed.

## Known limitations

- Existing tests emit React Router future-flag notices and asynchronous `act(...)` warnings in Home/setup and chat tests; these did not fail the suite. A chat render also reports an existing missing-key warning.
- This turn verifies behavior with Vitest and production compilation, not a full browser/device or screen-reader audit. Live feed content requires the existing authenticated API/backend; Home can retry failed stock loading, while optional supplier suggestions are omitted if unavailable.
- The redesign reorganizes existing capability; it does not claim delivery of the deferred roadmap items above.
