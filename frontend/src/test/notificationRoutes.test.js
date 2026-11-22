import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { NOTIFICATION_ROUTES } from "@/config/constants";

/**
 * A NOTIFICATION THAT GOES NOWHERE IS A BROKEN PROMISE.
 *
 * Three classes of defect this file exists to prevent, all of which shipped:
 *
 *   1. `event_payment_submitted` and `event_payment_confirmed` pointed at
 *      `/inbox` — the page the notification is displayed on. Tapping it did
 *      nothing at all.
 *   2. Nineteen notification types the backend emits had no entry here, so
 *      they fell through to a default. Whatever the default was, it was not
 *      the thing the notification was about.
 *   3. Destinations were typed as strings with no check that a route existed,
 *      so a rename in `App.jsx` silently orphaned a notification type.
 *
 * All three are cheap to test and invisible in review, which is exactly the
 * shape of bug that needs a test rather than a convention.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

// ── the real route table ────────────────────────────────────────────────
const appSource = readFileSync(join(root, "App.jsx"), "utf8");
const routePaths = [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);

/** Does a concrete URL match one of the app's route patterns? */
function routeExists(url) {
  const path = url.split("?")[0].split("#")[0];
  return routePaths.some((pattern) => {
    if (pattern === path) return true;
    // "/orders/:id" matches "/orders/42"
    const asRe = new RegExp(`^${pattern.replace(/:[a-zA-Z]+/g, "[^/]+")}$`);
    return asRe.test(path);
  });
}

// ── every notification type the backend can emit ────────────────────────
const modelSource = readFileSync(
  resolve(root, "../../backend/app/models/notification.py"),
  "utf8",
);
// Scope to the enum's own body: the file also contains `__tablename__ =
// "notifications"`, which a naive scan picks up as a notification type.
const enumStart = modelSource.indexOf("class NotificationType");
const enumBody = modelSource.slice(enumStart, modelSource.indexOf("\nclass ", enumStart + 10));
const backendTypes = [...enumBody.matchAll(/=\s*"([a-z_]+)"/g)].map((m) => m[1]);

describe("notification destinations", () => {
  it("knows about every type the backend can emit", () => {
    const missing = backendTypes.filter((t) => !(t in NOTIFICATION_ROUTES));
    expect(
      missing,
      `these notification types have no destination and would fall through to a default: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("only maps types the backend can emit", () => {
    const legacy = new Set(["parasitism_milestone"]); // renamed to `parasitism`
    const unknown = Object.keys(NOTIFICATION_ROUTES).filter(
      (t) => !backendTypes.includes(t) && !legacy.has(t),
    );
    expect(unknown, `mapped but never emitted: ${unknown.join(", ")}`).toEqual([]);
  });

  it("sends every type to a route that exists", () => {
    const broken = Object.entries(NOTIFICATION_ROUTES)
      .filter(([, to]) => !routeExists(to))
      .map(([type, to]) => `${type} → ${to}`);
    expect(broken, `destinations with no matching <Route>: ${broken.join("; ")}`).toEqual([]);
  });

  it("never sends a notification to the Inbox it is already displayed in", () => {
    // This is the specific defect that was reported: tapping an event-payment
    // notification reloaded the same list. A destination that cannot show
    // anything new is worse than no link, because it looks like a failure.
    const selfReferential = Object.entries(NOTIFICATION_ROUTES)
      // `system` is deliberately excluded: it is the generic account notice,
      // not an action, and Home is the only honest landing for it.
      .filter(([type, to]) => type !== "system" && ["/inbox", "/activity", "/mail", "/"].includes(to))
      .map(([type, to]) => `${type} → ${to}`);
    expect(selfReferential, `notifications pointing back at the Inbox: ${selfReferential.join("; ")}`).toEqual([]);
  });
});

describe("no user-facing link to a route that does not exist", () => {
  it("every literal in-app link in a component resolves", () => {
    // This replaces a narrower check against `config/homeShelves.js`, which was
    // part of the abandoned Home and is gone. Widening it is the point: a
    // literal `to="/somewhere"` is the cheapest broken link to create and the
    // cheapest to catch, and `/notices` was exactly that — a "See all" on a
    // shelf pointing at a route nobody had ever registered.
    const files = [];
    (function walk(dir) {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) {
          if (entry !== "test") walk(p);
        } else if (/\.jsx?$/.test(p)) files.push(p);
      }
    })(root);

    const broken = new Map();
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      // only string literals, not expressions: `to={x}` cannot be checked here
      for (const m of src.matchAll(/(?:to|href)="(\/[^"$]*)"/g)) {
        const target = m[1];
        if (!routeExists(target)) {
          broken.set(target, `${file.replace(root + "/", "")} → ${target}`);
        }
      }
    }
    expect(
      [...broken.values()],
      `in-app links with no matching <Route>:\n  ${[...broken.values()].join("\n  ")}`,
    ).toEqual([]);
  });

  it("every primary navigation tab resolves", async () => {
    const nav = readFileSync(join(root, "config/navigation.js"), "utf8");
    const navBlock = nav.slice(nav.indexOf("PRIMARY_NAV"), nav.indexOf("PRIMARY_NAV_FIVE"));
    const targets = [...navBlock.matchAll(/to:\s*"(\/[^"]*)"/g)].map((m) => m[1]);
    const broken = targets.filter((to) => !routeExists(to));
    expect(broken, `navigation tabs with no route: ${broken.join(", ")}`).toEqual([]);
  });

  it("has no duplicate route paths", () => {
    // `/brief` was declared twice in one <Routes> block: the Morning Brief
    // first, then a redirect to /me. The second one won.
    const counts = {};
    for (const p of routePaths) counts[p] = (counts[p] || 0) + 1;
    const dupes = Object.entries(counts).filter(([, n]) => n > 1).map(([p]) => p);
    expect(dupes, `paths declared more than once: ${dupes.join(", ")}`).toEqual([]);
  });
});
