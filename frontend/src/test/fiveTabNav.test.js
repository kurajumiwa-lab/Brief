import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

async function load(env = {}) {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import("@/config/navigation");
}

afterEach(() => vi.unstubAllEnvs());

/**
 * There used to be two tab shapes behind VITE_FIVE_TAB_NAV_ENABLED, and the
 * tests pinned both. The redesign removes the flag: one shape, five
 * destinations, and the old names now describe a product that no longer exists.
 * These tests pin the shape and the fact that flags cannot change it.
 */
describe("five destinations, one shape", () => {
  it("is the same five whether or not old flags are set", async () => {
    const off = await load();
    const on = await load({ VITE_FIVE_TAB_NAV_ENABLED: "true", VITE_DESK_ENABLED: "true" });
    expect(off.PRIMARY_TABS.map((t) => t.label)).toEqual(["Home", "Regions", "Create", "Inbox", "You"]);
    expect(on.PRIMARY_TABS.map((t) => t.label)).toEqual(off.PRIMARY_TABS.map((t) => t.label));
    expect(on.PRIMARY_TABS.map((t) => t.to)).toEqual(off.PRIMARY_TABS.map((t) => t.to));
  });

  it("does not move the Home tab when the old Brief landing flag is on", async () => {
    const nav = await load({ VITE_BRIEF_LANDING_ENABLED: "true" });
    expect(nav.PRIMARY_TABS[0]).toMatchObject({ to: "/", label: "Home" });
  });

  it("lights exactly one tab per path", async () => {
    const nav = await load();
    const active = (p) => nav.PRIMARY_TABS.filter((t) => nav.isPrimaryActive(t, p, "someone")).map((t) => t.label);

    expect(active("/")).toEqual(["Home"]);
    expect(active("/home")).toEqual(["Home"]);
    expect(active("/regions")).toEqual(["Regions"]);
    expect(active("/regions/nyanza")).toEqual(["Regions"]);
    expect(active("/markets")).toEqual(["Regions"]);
    expect(active("/mall")).toEqual(["Regions"]);
    expect(active("/create")).toEqual(["Create"]);
    expect(active("/inbox")).toEqual(["Inbox"]);
    expect(active("/orders/123")).toEqual(["Inbox"]);
    expect(active("/chat")).toEqual(["Inbox"]);
    expect(active("/you")).toEqual(["You"]);
    expect(active("/@someone")).toEqual(["You"]);
    expect(active("/more")).toEqual(["You"]);
  });

  it("every tab target has a real route in App.jsx (no dead tabs)", async () => {
    const app = fs.readFileSync(path.resolve("src/App.jsx"), "utf8");
    const nav = await load();
    for (const tab of nav.PRIMARY_TABS) {
      const route = tab.to === "/" ? 'path="/" element' : `path="${tab.to}"`;
      expect(app.includes(route), `no route for ${tab.label} (${tab.to})`).toBe(true);
    }
  });

  it("keeps the Mail screen reachable when flagged, without a tab of its own", async () => {
    const nav = await load({ VITE_MAIL_ENABLED: "true" });
    expect(nav.PRIMARY_TABS.map((t) => t.label)).not.toContain("Mail");
    // /mail still lights Inbox, because that is where a message waits now.
    const inbox = nav.PRIMARY_TABS.find((t) => t.label === "Inbox");
    expect(nav.isPrimaryActive(inbox, "/mail")).toBe(true);
  });
});
