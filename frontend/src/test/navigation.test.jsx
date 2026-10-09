import { describe, expect, it } from "vitest";
import { BROWSE_NAV, PRIMARY_NAV, SEARCH_SCOPES, SECTION_GROUPS, isPrimaryActive } from "@/config/navigation";
import { NAV_BRIEF } from "@/components/layout/Sidebar";

describe("Ogallo navigation map", () => {
  it("retains the legacy Brief workspace inventory without rendering it in the drawer", () => {
    expect(NAV_BRIEF.map(({ to }) => to)).toEqual(["/tasks", "/analytics", "/pos"]);
  });

  it("defines five distinct primary destinations", () => {
    expect(PRIMARY_NAV.map(({ label }) => label)).toEqual(["Home", "Browse", "Orders", "Inbox", "Me"]);
    expect(new Set(PRIMARY_NAV.map(({ to }) => to)).size).toBe(5);
  });

  it("keeps Browse surfaces together without duplicating them in Home", () => {
    expect(BROWSE_NAV.map(({ label }) => label)).toEqual(["Stock", "Suppliers", "Around you", "Map", "Markets", "News"]);
    expect(isPrimaryActive(PRIMARY_NAV[1], "/network")).toBe(true);
    expect(isPrimaryActive(PRIMARY_NAV[1], "/nearby/food")).toBe(true);
    expect(isPrimaryActive(PRIMARY_NAV[1], "/listing/item-7")).toBe(true);
    expect(isPrimaryActive(PRIMARY_NAV[1], "/orders")).toBe(false);
  });

  it("routes each search scope into the screen that owns its query", () => {
    const destination = (scope) => SEARCH_SCOPES.find((item) => item.value === scope).to("rice");
    expect(destination("stock")).toBe("/browse?search=rice");
    expect(destination("vendors")).toBe("/network?search=rice");
    expect(destination("markets")).toBe("/markets?tab=all&search=rice");
    expect(destination("rentals")).toBe("/tools?search=rice");
  });

  it("marks business screens as Me and never adds Home to the secondary drawer", () => {
    for (const path of ["/me", "/stock", "/analytics", "/pos", "/tasks", "/tools", "/groups", "/events", "/lists", "/locks"]) {
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
