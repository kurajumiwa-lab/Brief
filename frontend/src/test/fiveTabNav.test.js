import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Each case re-imports the config so the flag is read from the stubbed environment.
async function load(env = {}) {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import("@/config/navigation");
}

afterEach(() => vi.unstubAllEnvs());

describe("five-tab navigation (flagged, Phase 2)", () => {
  it("is off by default: the tabs are exactly the current five", async () => {
    const nav = await load();
    expect(nav.PRIMARY_TABS).toBe(nav.PRIMARY_NAV);
    expect(nav.PRIMARY_TABS.map((t) => t.label))
      .toEqual(["Home", "Local network", "Mall", "Connect", "My World"]);
  });

  it("with the flag on: Desk, Nearby, Mail, Search, Me, in that order", async () => {
    const nav = await load({ VITE_FIVE_TAB_NAV_ENABLED: "true" });
    expect(nav.PRIMARY_TABS.map((t) => t.label)).toEqual(["Desk", "Nearby", "Mail", "Search", "Me"]);
    expect(nav.PRIMARY_TABS.map((t) => t.to)).toEqual(["/", "/explore", "/activity", "/search", "/me"]);
  });

  it("Desk goes to /desk only when the desk screen is on, so the tab is never dead", async () => {
    const off = await load({ VITE_FIVE_TAB_NAV_ENABLED: "true" });
    expect(off.PRIMARY_TABS[0].to).toBe("/");
    const on = await load({ VITE_FIVE_TAB_NAV_ENABLED: "true", VITE_DESK_ENABLED: "true" });
    expect(on.PRIMARY_TABS[0].to).toBe("/desk");
  });

  it("Nearby and Search never both light up on /search", async () => {
    const nav = await load({ VITE_FIVE_TAB_NAV_ENABLED: "true" });
    const active = (p) => nav.PRIMARY_TABS.filter((t) => nav.isPrimaryActive(t, p, "someone")).map((t) => t.label);
    expect(active("/search")).toEqual(["Search"]);
    expect(active("/search/people")).toEqual(["Search"]);
    expect(active("/explore")).toEqual(["Nearby"]);
    expect(active("/map")).toEqual(["Nearby"]);
    expect(active("/activity")).toEqual(["Mail"]);
    expect(active("/orders/123")).toEqual(["Mail"]);
    expect(active("/me")).toEqual(["Me"]);
    expect(active("/@someone")).toEqual(["Me"]);
  });

  it("Mall is not a tab in this shape, but stays in the drawer", async () => {
    const on = await load({ VITE_FIVE_TAB_NAV_ENABLED: "true" });
    expect(on.PRIMARY_TABS.map((t) => t.label)).not.toContain("Mall");
    const drawer = on.SECTION_GROUPS.flatMap((g) => g.items.map((i) => i.to));
    expect(drawer).toContain("/mall");
    const off = await load();
    const offDrawer = off.SECTION_GROUPS.flatMap((g) => g.items.map((i) => i.to));
    expect(offDrawer).not.toContain("/mall");
  });

  it("every tab target has a real route in App.jsx (no dead tabs)", async () => {
    const app = fs.readFileSync(path.resolve("src/App.jsx"), "utf8");
    const nav = await load({ VITE_FIVE_TAB_NAV_ENABLED: "true", VITE_DESK_ENABLED: "true" });
    for (const tab of nav.PRIMARY_TABS) {
      const route = tab.to === "/" ? 'path="/" element' : `path="${tab.to}"`;
      expect(app.includes(route), `no route for ${tab.label} (${tab.to})`).toBe(true);
    }
  });
});
