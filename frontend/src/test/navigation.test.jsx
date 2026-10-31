import { describe, expect, it } from "vitest";
import {
  BROWSE_NAV, CREATE_TYPES, EXPLORE_NAV, PRIMARY_NAV, SEARCH_SCOPES, SECTION_GROUPS,
  isActivityPath, isExplorePath, isPrimaryActive,
} from "@/config/navigation";
import { NAV_BRIEF } from "@/components/layout/Sidebar";

/**
 * OUTSIDE NAVIGATION MAP (v4).
 *
 * These specs are the contract for the information architecture. They changed
 * deliberately from the v3 map (Home · Browse · Work · Inbox · Business):
 * Outside is organised around what a *person* is doing, because trading is now
 * one content type among six rather than the reason the app exists.
 *
 * The invariant that did NOT change: every v3 URL still resolves and still
 * highlights exactly one tab. Nothing was deleted to get here — the areas below
 * absorbed the old destinations. See `docs/outside/01-route-map.md`.
 */
describe("Outside navigation map", () => {
  it("retains the legacy Brief workspace inventory without rendering it in the drawer", () => {
    expect(NAV_BRIEF.map(({ to }) => to)).toEqual(["/tasks", "/analytics", "/pos"]);
  });

  it("defines five Outside destinations with exactly one prominent create action", () => {
    expect(PRIMARY_NAV.map(({ label }) => label))
      .toEqual(["Home", "Discover", "Create", "Connect", "My World"]);
    expect(new Set(PRIMARY_NAV.map(({ to }) => to)).size).toBe(5);
    // Create is the one visually distinct tab, and it is a tab — not a
    // floating button competing with the content it exists to serve.
    expect(PRIMARY_NAV.filter(({ action }) => action).map(({ to }) => to)).toEqual(["/create"]);
    expect(PRIMARY_NAV.filter(({ action }) => action)).toHaveLength(1);
    // Every tab has a short label and an icon. (lucide icons are forwardRef
    // objects, not functions — so assert presence, not callable-ness.)
    for (const item of PRIMARY_NAV) {
      expect(item.label.length).toBeLessThanOrEqual(8);
      expect(item.icon).toBeTruthy();
    }
  });

  it("publishes all six content types from the single creation entry point", () => {
    expect(CREATE_TYPES.map(({ value }) => value).sort()).toEqual(
      ["collection", "community", "event", "listing", "opportunity", "post"]);
    for (const type of CREATE_TYPES) expect(type.hint.length).toBeGreaterThan(0);
  });

  it("keeps Explore one results system with the map, markets and news as context views", () => {
    expect(EXPLORE_NAV.map(({ to }) => to)).toContain("/map");
    expect(EXPLORE_NAV.map(({ to }) => to)).toContain("/markets");
    expect(EXPLORE_NAV.map(({ to }) => to)).toContain("/news");
    // Every content-type door is the same URL contract.
    for (const { to } of EXPLORE_NAV.filter((i) => i.to.includes("kind="))) {
      expect(to.startsWith("/explore?kind=")).toBe(true);
    }
  });

  it("absorbs every v3 Browse surface into Explore", () => {
    for (const path of ["/explore", "/browse", "/network", "/nearby/food", "/map",
      "/markets", "/news", "/search/goods", "/listing/item-7", "/place/p-1",
      "/feed", "/events", "/groups", "/lists"]) {
      expect(isExplorePath(path), path).toBe(true);
    }
    expect(isExplorePath("/orders")).toBe(false);
    expect(isExplorePath("/work")).toBe(false);
    // The v3 helper names still work for anything importing them.
    expect(isPrimaryActive(PRIMARY_NAV[1], "/network")).toBe(true);
    expect(isPrimaryActive(PRIMARY_NAV[1], "/listing/item-7")).toBe(true);
    expect(isPrimaryActive(PRIMARY_NAV[1], "/orders")).toBe(false);
    // The v3 job tiles and browse map are retained, not deleted.
    expect(BROWSE_NAV.map(({ label }) => label)).toEqual(
      ["Goods", "People", "Services", "Equipment", "Map", "Markets", "News"]);
  });

  it("absorbs Work and Inbox into Activity", () => {
    for (const path of ["/activity", "/work", "/orders", "/chat", "/tasks", "/locks", "/tools"]) {
      expect(isActivityPath(path), path).toBe(true);
      expect(isPrimaryActive(PRIMARY_NAV[3], path), path).toBe(true);
    }
    expect(isActivityPath("/explore")).toBe(false);
    expect(isActivityPath("/me")).toBe(false);
  });

  it("keeps the workspace under Profile, and only your own handle highlights it", () => {
    for (const path of ["/me", "/stock", "/analytics", "/pos", "/brief", "/passport",
      "/growth", "/enterprise", "/governance", "/ops"]) {
      expect(isPrimaryActive(PRIMARY_NAV[4], path), path).toBe(true);
    }
    expect(isPrimaryActive(PRIMARY_NAV[4], "/@mama_mboga", "mama_mboga")).toBe(true);
    expect(isPrimaryActive(PRIMARY_NAV[4], "/@another_vendor", "mama_mboga")).toBe(false);
  });

  it("never highlights two tabs for the same path", () => {
    const paths = ["/", "/explore", "/create", "/activity", "/me", "/browse", "/orders",
      "/chat", "/stock", "/events", "/groups", "/tasks", "/map", "/listing/x"];
    for (const path of paths) {
      const active = PRIMARY_NAV.filter((item) => isPrimaryActive(item, path, "mama_mboga"));
      expect(active.length, `${path} → ${active.map((a) => a.label).join(",")}`)
        .toBeLessThanOrEqual(1);
    }
  });

  it("routes each search scope into the one results system", () => {
    const destination = (scope) => SEARCH_SCOPES.find((item) => item.value === scope).to("rice");
    expect(destination("stock")).toBe("/browse?type=goods&search=rice");
    expect(destination("vendors")).toBe("/network?search=rice");
    expect(destination("people")).toBe("/browse?type=people&search=rice");
    expect(destination("markets")).toBe("/markets?tab=all&search=rice");
    expect(destination("rentals")).toBe("/browse?type=equipment&search=rice");
  });

  it("keeps the long tail out of the primary tabs and out of Home", () => {
    // v4.1 regrouped the drawer: the long tail is now organised (community &
    // network, workspace tools, administration) instead of being a two-item
    // list. The rule that still has to hold is the one that matters — nothing
    // in the drawer is a primary destination, and nothing in it is Home.
    const secondary = SECTION_GROUPS.flatMap((group) => group.items);
    const primaryTargets = PRIMARY_NAV.map((item) => item.to);

    expect(secondary.some((item) => item.to === "/" || item.label.toLowerCase() === "home")).toBe(false);
    expect(secondary.every((item) => !primaryTargets.includes(item.to))).toBe(true);

    // The three groups exist, in the order a person looks for them.
    expect(SECTION_GROUPS.map((group) => group.title)).toEqual([
      "Community & network", "Workspace tools", "Administration",
    ]);
    // And the routes the drawer has always carried are still reachable.
    expect(secondary.map(({ to }) => to)).toEqual(expect.arrayContaining(["/groups", "/events", "/ops"]));
  });
});
