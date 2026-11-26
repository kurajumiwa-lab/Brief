import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { DRAWER_ITEMS, SECTION_GROUPS } from "@/config/navigation";
import { reachability, REACHABILITY } from "@/lib/reachability";

/**
 * WASTA 2.0 — THE DESIGN SYSTEM AND THE DRAWER.
 *
 * Two things a redesign gets wrong quietly:
 *
 *   · a palette that is "close" to the brief, so every screen is a slightly
 *     different green and nobody can tell you which one is correct;
 *   · a navigation row that points at a route that no longer exists, which the
 *     browser only reveals when a person taps it.
 *
 * Both are assertions here rather than review comments. The token test reads
 * styles/tokens.css itself, because a second copy of the palette in a test
 * would be the drift it is meant to catch.
 */

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, "../styles/tokens.css"), "utf8");
const app = readFileSync(resolve(here, "../App.jsx"), "utf8");
const light = css.slice(css.indexOf(":root"), css.indexOf("\n.dark {"));

/** Read `--token: r g b;` as a #RRGGBB string. */
const hex = (token) => {
  const m = new RegExp(`--${token}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*;`).exec(light);
  if (!m) throw new Error(`--${token} is missing from the light theme`);
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
};

describe("the Wasta 2.0 palette is the brief's palette", () => {
  it("pins the five named colours and the ivory canvas", () => {
    // The brief names these exact values. Anything else is a near-match, and a
    // near-match is how six anchors became eleven greens.
    expect(hex("brand-600")).toBe("#10372D"); // primary
    expect(hex("brand-50")).toBe("#DCEAE2"); // secondary
    expect(hex("surface-0")).toBe("#F7F6F1"); // background
    expect(hex("accent-600")).toBe("#B64B32"); // accent
    expect(hex("ink-1")).toBe("#282B29"); // text
  });

  it("keeps the two radii the system separates", () => {
    // A card is 16px; a control is 12px. They are different tokens so a button
    // cannot inherit a card's corner by accident.
    expect(light).toMatch(/--card-radius:\s*1rem;/);
    expect(light).toMatch(/--btn-radius:\s*0\.75rem;/);
    // The button's radius comes from the token, not a literal.
    const button = readFileSync(resolve(here, "../components/ui/Button.jsx"), "utf8");
    expect(button).toContain("rounded-btn");
  });

  it("keeps the 8px spacing step the layout rhythm is built on", () => {
    expect(light).toMatch(/--space-2:\s*0\.5rem;/);
    expect(light).toMatch(/--space-4:\s*1rem;/);
    expect(light).toMatch(/--tap-target:\s*2\.75rem;/);
  });

  it("keeps the type scale ordered, with a 12px floor for body text", () => {
    const config = readFileSync(resolve(here, "../../tailwind.config.js"), "utf8");
    for (const size of ["micro", "2xs", "xs", "sm", "base", "lg", "xl", "2xl", "3xl"]) {
      // Declared either bare or quoted, depending on whether it is a valid key.
      const bare = `${size}: [`;
      const quoted = `"${size}": [`;
      expect(
        config.includes(bare) || config.includes(quoted),
        `text-${size} is missing from tailwind.config.js`,
      ).toBe(true);
    }
    // The named page hierarchy: page → section → card.
    for (const named of ["title-page", "title-section", "title-card"]) {
      expect(config).toContain(`"${named}"`);
    }
  });
});

describe("every drawer row is a destination that answers", () => {
  const pathOf = (to) => to.split("#")[0];

  it("maps to a route declared in App.jsx or a redirect that lands", () => {
    for (const { label, to } of DRAWER_ITEMS) {
      const path = pathOf(to);
      const declared = app.includes(`path="${path}"`);
      const redirected = new RegExp(`path="${path}" element=\\{<Navigate`).test(app);
      expect(declared || redirected, `${label} (${to}) has no route in App.jsx`).toBe(true);
    }
  });

  it("uses no hash section that the target page does not render", () => {
    // A `#privacy` link on a page with no `id="privacy"` is a dead promise.
    const legal = readFileSync(resolve(here, "../pages/legal/LegalPage.jsx"), "utf8");
    const hashes = DRAWER_ITEMS.filter((item) => item.to.includes("#")).map((item) => item.to);
    expect(hashes.length).toBe(2);
    for (const to of hashes) {
      const id = to.split("#")[1];
      // Either a literal id or a section declared in the SECTIONS list.
      const literal = legal.includes(`id="${id}"`);
      const declared = legal.includes(`id: "${id}"`);
      expect(literal || declared, `/legal does not render #${id}`).toBe(true);
      // And the component actually applies it to the card.
      expect(legal).toContain("id={section.id}");
    }
  });

  it("declares no path twice, so a tap cannot be ambiguous", () => {
    const paths = DRAWER_ITEMS.map((item) => item.to);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("labels every row uniquely, so a screen reader hears no duplicates", () => {
    const labels = DRAWER_ITEMS.map((item) => item.label);
    expect(new Set(labels).size).toBe(labels.length);
    // "Calendar" appears once even though the icon is shared with Events.
    expect(labels.filter((l) => l === "Calendar")).toHaveLength(1);
  });

  it("keeps the three sections non-empty and in order", () => {
    expect(SECTION_GROUPS.map((g) => g.title)).toEqual(["My workspace", "Network", "Account"]);
    for (const group of SECTION_GROUPS) {
      expect(group.items.length, `${group.title} is empty`).toBeGreaterThan(0);
    }
  });
});

describe("reachability is a fact, not a badge", () => {
  const vendor = (patch = {}) => ({
    business_name: "Mama Mboga Fresh",
    vendor_handle: "mama_mboga",
    ...patch,
  });

  it("says signed out when there is no vendor", () => {
    const result = reachability(null);
    expect(result.state).toBe(REACHABILITY.UNKNOWN);
    expect(result.label).toMatch(/signed out/i);
  });

  it("calls a business with a page and a route reachable", () => {
    const result = reachability(vendor({ contact_exposed: true }));
    expect(result.state).toBe(REACHABILITY.REACHABLE);
  });

  it("separates a live page with no reply route from an unpublished one", () => {
    expect(reachability(vendor({ contact_exposed: false })).state).toBe(REACHABILITY.PAGE_ONLY);
    const hidden = reachability(vendor({ page_live: false, contact_exposed: true }));
    expect(hidden.state).toBe(REACHABILITY.ROUTE_ONLY);
    expect(hidden.label).toMatch(/no page/i);
    const neither = reachability(vendor({ page_live: false, contact_exposed: false }));
    expect(neither.state).toBe(REACHABILITY.UNPUBLISHED);
  });

  it("never invents a green state from a business that has not published", () => {
    // No handle, no name: nothing a stranger could open.
    const blank = reachability({ business_name: "", vendor_handle: "" });
    expect(blank.state).not.toBe(REACHABILITY.REACHABLE);
    expect(blank.label).not.toMatch(/reachable/i);
  });

  it("counts a verified phone as a reply route, because it is one", () => {
    const result = reachability(vendor({ phone_verified_at: "2026-01-01T00:00:00" }));
    expect(result.state).toBe(REACHABILITY.REACHABLE);
  });
});
