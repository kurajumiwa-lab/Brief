import { describe, expect, it } from "vitest";
import { BROWSE_NAV, PRIMARY_NAV, SEARCH_SCOPES, SECTION_GROUPS, isPrimaryActive } from "@/config/navigation";
import { NAV_BRIEF } from "@/components/layout/Sidebar";

describe("Ogallo navigation map", () => {
  it("retains the legacy Brief workspace inventory without rendering it in the drawer", () => {
    expect(NAV_BRIEF.map(({ to }) => to)).toEqual(["/tasks", "/analytics", "/pos"]);
  });

  it("defines five distinct primary destinations, organised around jobs", () => {
    expect(PRIMARY_NAV.map(({ label }) => label)).toEqual(["Home", "Browse", "Work", "Inbox", "Business"]);
    expect(new Set(PRIMARY_NAV.map(({ to }) => to)).size).toBe(5);
  });

  it("organises Browse around the four business jobs, with map and markets as context", () => {
    expect(BROWSE_NAV.map(({ label }) => label)).toEqual(
      ["Goods", "People", "Services", "Equipment", "Map", "Markets", "News"]);
    // Every job view is the same results system, one URL contract.
    for (const { to } of BROWSE_NAV.slice(0, 4)) expect(to.startsWith("/browse?type=")).toBe(true);
  });

  it("keeps Browse surfaces together without duplicating them in Home", () => {
    // The old destinations are still reachable — as views and context, not doors.
    expect(BROWSE_NAV.map(({ to }) => to)).toContain("/map");
    expect(BROWSE_NAV.map(({ to }) => to)).toContain("/markets");
    expect(isPrimaryActive(PRIMARY_NAV[1], "/network")).toBe(true);
    expect(isPrimaryActive(PRIMARY_NAV[1], "/nearby/food")).toBe(true);
    expect(isPrimaryActive(PRIMARY_NAV[1], "/listing/item-7")).toBe(true);
    expect(isPrimaryActive(PRIMARY_NAV[1], "/orders")).toBe(false);
    expect(isPrimaryActive(PRIMARY_NAV[1], "/work")).toBe(false);
  });

  it("routes each search scope into the one results system", () => {
    const destination = (scope) => SEARCH_SCOPES.find((item) => item.value === scope).to("rice");
    expect(destination("stock")).toBe("/browse?type=goods&search=rice");
    expect(destination("vendors")).toBe("/network?search=rice");
    expect(destination("people")).toBe("/browse?type=people&search=rice");
    expect(destination("markets")).toBe("/markets?tab=all&search=rice");
    expect(destination("rentals")).toBe("/browse?type=equipment&search=rice");
  });

  it("marks business screens as Business and work screens as Work", () => {
    // Work owns the flows you owe or are owed.
    for (const path of ["/work", "/orders", "/tasks", "/locks", "/tools"]) {
      expect(isPrimaryActive(PRIMARY_NAV[2], path)).toBe(true);
    }
    expect(isPrimaryActive(PRIMARY_NAV[2], "/browse")).toBe(false);
    // Business keeps the workspace inventory (minus what moved to Work).
    for (const path of ["/me", "/stock", "/analytics", "/pos", "/groups", "/lists"]) {
      expect(isPrimaryActive(PRIMARY_NAV[4], path)).toBe(true);
    }
    expect(isPrimaryActive(PRIMARY_NAV[4], "/@mama_mboga", "mama_mboga")).toBe(true);
    expect(isPrimaryActive(PRIMARY_NAV[4], "/@another_vendor", "mama_mboga")).toBe(false);

    const secondary = SECTION_GROUPS.flatMap((group) => group.items);
    expect(secondary.map(({ to }) => to)).toEqual(["/groups", "/events", "/ops"]);
    expect(secondary.some((item) => item.to === "/" || item.label.toLowerCase() === "home")).toBe(false);
    expect(secondary.some((item) => ["/orders", "/chat", "/stock", "/analytics", "/tasks", "/lists", "/locks", "/tools", "/pos", "/feed", "/governance"].includes(item.to))).toBe(false);
  });
});
