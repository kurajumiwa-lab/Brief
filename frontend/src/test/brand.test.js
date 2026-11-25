import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import BRAND, { pageTitle } from "@/config/brand";

/**
 * ONE PRODUCT, ONE NAME.
 *
 * The repository had four names in flight at once: "Byway" in nine root
 * documents and a rendered notice-board heading, "My Shop App" at the top of the
 * README, "Home Office" in `config/brand.js` and 24 rendered strings, and "Brief"
 * — with a stray underscore — in the rest of the interface. A user could read a
 * different product name on almost every screen.
 *
 * The name is **Wasta**. This test is what stops a sixth from appearing.
 *
 * ── Why this is not a blanket substring search ──────────────────────────────
 *
 * "Brief" is still a correct English word in this product. Three uses must
 * survive a rebrand, and a naive `includes("Brief")` would delete them:
 *
 *   · **Morning Brief** — a *feature*: the read-only daily summary. It is a
 *     different noun from the product name, and `config/brand.js` says so.
 *   · **`/brief`** — a *route*. It already redirects to `/me`. Renaming it
 *     breaks links that live in WhatsApp threads.
 *   · **`label="Brief"`** on the event form (EventDeskPage) — a short
 *     description of a post. That is the everyday English noun.
 *
 * ── Two defects this test was rebuilt to catch ──────────────────────────────
 *
 * 1. **Case.** The old check compared `"Home Office"` against source that says
 *    `"Home office"`. A case-sensitive substring test never matched anything, so
 *    the guard passed while thirteen files printed the retired name. Every
 *    retired name is now matched case-insensitively.
 *
 * 2. **Artwork.** The old check only walked `.js/.jsx/.html`. `logo.svg` carried
 *    `<text><tspan>HOME</tspan> OFFICE</text>` — the largest word on the splash
 *    screen — and no test ever looked at it. SVG files are now scanned, with
 *    XML comments stripped first so a comment may still explain the history.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

/**
 * Names that must not reach a user, in any casing.
 * `deferred` means the case is recorded and owned elsewhere — see the note.
 */
const RETIRED_NAMES = [
  {
    name: "Home Office",
    why: "renamed, but the nav label rename is deferred pending a decision",
    // The label is live on /office and in the drawer. It is deliberately still
    // there (owner decision: defer). So it is banned in artwork and in the
    // brand core, which is where it was a *defect*, not where it is a pending
    // design decision.
    scold: "artwork-or-core",
  },
  { name: "My Shop App", why: "never a product name; a repository title", scold: "everywhere" },
  { name: "Byway", why: "a codename from an earlier implementation", scold: "everywhere" },
  {
    name: "Brief_",
    why: "a stray underscore from an old mark",
    // Case-SENSITIVE on purpose. Lowercased it matches two internal identifiers
    // this rebrand must preserve: BRIEF_LANDING_ENABLED (a feature flag) and
    // brief_stock_template.csv (a download filename). The rule is about the
    // rendered mark, not the SCREAMING_SNAKE constant.
    caseSensitive: true,
    scold: "everywhere",
  },
];

/**
 * Files that carry the product name and were converted in Phase 1.
 * These must not contain a retired product name at all, outside comments.
 */
const BRAND_CORE = [
  "config/brand.js",
  "lib/i18n.js",
  "lib/failure.js",
  "components/system/BootSplash.jsx",
  "pages/storefront/BusinessDeskPage.jsx",
];

/** Images that ship as part of the identity. Their *accessible* text counts. */
const ARTWORK = ["logo.svg", "favicon.svg"];

/**
 * Legitimate, load-bearing uses of "Brief" that a rebrand must NOT touch.
 * Matched against the trimmed line, so these are exact exceptions, not fuzzy
 * ones.
 */
const LEGITIMATE_BRIEF = [
  /^\{\/\*.*\*\/\}$/, // a JSX comment explaining history or a route
  /\bMorning Brief\b/, // the feature
  /\/brief\b/, // the route, or a link to it
  /label="Brief"/, // the English noun on a form field
  /brief:.*label:/, // the route key in a nav inventory
];

/**
 * Phase 2 backlog: user-facing product strings still carrying "Brief".
 * Recorded by file and count so the rebrand cannot silently regress. This is a
 * ceiling, not a target — Phase 2 removes these rows.
 */
const PHASE_2_BACKLOG = {};

/**
 * Phase 2 is complete. The backlog above is now empty, and that is a claim the
 * test below proves rather than assumes: it compares this map against a live
 * scan of every rendered source file and fails on any file that is not listed
 * at a high enough count. An empty backlog therefore means "zero product
 * references remain", and a single regression re-opens the failure immediately.
 *
 * The map stays here — with its ceiling semantics intact — so the next stray
 * reference is caught by the same rule, not by a new test written after the
 * fact.
 */

function walk(dir, exts, skipTests) {
  const out = [];
  (function inner(d) {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) {
        if (!(skipTests && entry === "test")) inner(p);
      } else if (exts.test(p)) {
        out.push(p);
      }
    }
  })(dir);
  return out;
}

const sourceFiles = (dir) => walk(dir, /\.(jsx?|html)$/, true);

/** XML/JS block comments may explain the history; only rendered text counts. */
const stripSvgComments = (src) => src.replace(/<!--[\s\S]*?-->/g, "");

const isComment = (line) => /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line);
const isLegitimate = (line) => LEGITIMATE_BRIEF.some((re) => re.test(line.trim()));

/** Lines mentioning "Brief" that are neither a comment nor a known exception. */
function brandHits(file) {
  const rel = file.replace(root + "/", "");
  const hits = [];
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (!/\bBrief\b/.test(line)) return;
      if (isComment(line) || isLegitimate(line)) return;
      hits.push(`${rel}:${i + 1}`);
    });
  return hits;
}

/** Retired names present in a file's rendered content, in any casing. */
function retiredHits(body) {
  return RETIRED_NAMES.filter(({ name, caseSensitive }) =>
    caseSensitive ? body.includes(name) : body.toLowerCase().includes(name.toLowerCase()),
  ).map(({ name }) => name);
}

describe("product identity", () => {
  it("is one name in configuration", () => {
    expect(BRAND.name).toBe("Wasta");
    expect(BRAND.wordmark).toBe("Wasta");
    expect(BRAND.short).toBe("Wasta");
    expect(BRAND.tagline).toBe("The power of the right connections.");
    expect(pageTitle()).toBe("Wasta — The power of the right connections.");
  });

  it("keeps the parent attribution it grew out of", () => {
    // Real shopfront boards and receipts carried this name. A rebrand is not a
    // reason to make those strangers.
    expect(BRAND.parent).toBe("Ogallo");
  });

  it("has a splash line that fits its own container", () => {
    // The splash renders `shortLine` at text-2xs inside max-w-xs with px-8.
    expect(BRAND.shortLine).toBe("The right connections.");
    expect(BRAND.shortLine.length).toBeLessThanOrEqual(24);
    expect(BRAND.tagline.length).toBeGreaterThan(BRAND.shortLine.length);
  });

  it("does not print a domain the deployment does not own", () => {
    // `vendorworld.ke` was display-only: never registered, never referenced by
    // a `VITE_PAGE_DOMAIN`. `pageAddress()` now falls back to `/p/{handle}`.
    expect(BRAND.domain).toBe("");
  });

  it("is the same name in the document title and social metadata", () => {
    const html = readFileSync(resolve(root, "../index.html"), "utf8");
    const title = html.match(/<title>([^<]*)<\/title>/)[1];
    expect(title).toBe(pageTitle());
    expect(html).not.toMatch(/\bBrief\b/);
    expect(html.toLowerCase()).not.toContain("home office");
    const ogTitle = html.match(/property="og:title" content="([^"]*)"/)[1];
    expect(ogTitle).toBe(pageTitle());
  });

  it("does not use a retired name in any rendered source file", () => {
    const offenders = [];
    for (const file of sourceFiles(root)) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          // A comment may explain the history; rendered code may not repeat it.
          if (isComment(line)) return;
          for (const { name, scold, caseSensitive } of RETIRED_NAMES) {
            if (scold !== "everywhere") continue;
            const hit = caseSensitive
              ? line.includes(name)
              : line.toLowerCase().includes(name.toLowerCase());
            if (hit) {
              offenders.push(`${file.replace(root + "/", "")}:${i + 1} → ${name}`);
            }
          }
        });
    }
    expect(
      offenders,
      `retired product names still reachable in the UI:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("leaves no old product name in the brand-core files", () => {
    const offenders = [];
    for (const rel of BRAND_CORE) {
      // Comments may explain the history; only code that runs counts.
      const body = readFileSync(join(root, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const name of retiredHits(body)) {
        offenders.push(`${rel} → ${name}`);
      }
    }
    expect(
      offenders,
      `a retired product name survived in a brand-core file:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("carries no retired product name in the artwork", () => {
    // The defect this exists for: `logo.svg` drew `HOME OFFICE` as <text> and
    // <tspan>, which no JSX scan could see, so the splash announced a retired
    // name on the first screen a person ever sees.
    const offenders = [];
    for (const name of ARTWORK) {
      const file = resolve(root, "../public", name);
      const body = stripSvgComments(readFileSync(file, "utf8"));
      for (const hit of retiredHits(body)) offenders.push(`public/${name} → ${hit}`);
      if (/\bBrief\b/i.test(body)) offenders.push(`public/${name} → Brief`);
    }
    expect(
      offenders,
      `retired product branding is still drawn into the artwork:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("does not grow the Phase 2 backlog", () => {
    // Phase 1 converted the brand core. The rest is approved Phase 2 work; this
    // asserts nobody *adds* to it while it waits, and lets it shrink freely.
    const actual = {};
    for (const file of sourceFiles(root)) {
      const rel = file.replace(root + "/", "");
      const n = brandHits(file).length;
      if (n > 0) actual[rel] = n;
    }
    const regressions = {};
    for (const [rel, n] of Object.entries(actual)) {
      const allowed = PHASE_2_BACKLOG[rel] ?? 0;
      if (n > allowed) regressions[rel] = { allowed, found: n };
    }
    expect(
      regressions,
      `old product name appeared in files outside the approved backlog:\n  ${JSON.stringify(regressions, null, 2)}`,
    ).toEqual({});
  });
});
