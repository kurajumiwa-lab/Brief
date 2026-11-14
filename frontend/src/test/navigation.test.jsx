import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  BROWSE_NAV, CREATE_NAV, CREATE_TYPES, PRIMARY_NAV, SEARCH_SCOPES, SECTION_GROUPS,
  isInboxPath, isPrimaryActive, isRegionPath, isYouPath,
} from "@/config/navigation";
import { NAV_BRIEF } from "@/components/layout/Sidebar";

/**
 * THE NEW MAP (v5): five destinations, seven drawer links, one identity.
 *
 * The contract these tests pin is smaller than the old one on purpose:
 *
 *   · exactly five tabs, one of which is Create;
 *   · Regions is the only discovery tab, and it absorbs Local network, Mall,
 *     Explore, Markets, Map and Browse;
 *   · Inbox absorbs everything waiting on a person;
 *   · You absorbs the workspace, the page and the settings;
 *   · the drawer is a short list, never a second copy of the tabs, and Home
 *     office is in it;
 *   · no path ever highlights two tabs.
 */
describe("v5 navigation map", () => {
  it("keeps the legacy Brief inventory as a non-rendered record", () => {
    expect(NAV_BRIEF.map(({ to }) => to)).toEqual(["/tasks", "/analytics", "/pos"]);
  });

  it("defines five destinations, with Create as the one prominent action", () => {
    expect(PRIMARY_NAV.map(({ label }) => label)).toEqual([
      "Home", "Regions", "Create", "Inbox", "You",
    ]);
    expect(PRIMARY_NAV.map(({ to }) => to)).toEqual([
      "/", "/regions", "/create", "/inbox", "/you",
    ]);
    expect(PRIMARY_NAV.filter(({ action }) => action)).toHaveLength(1);
    expect(PRIMARY_NAV.find(({ action }) => action).label).toBe("Create");
    expect(CREATE_NAV.to).toBe("/create");
    for (const item of PRIMARY_NAV) {
      expect(item.label.length).toBeLessThanOrEqual(8);
      expect(item.icon).toBeTruthy();
    }
  });

  it("cuts the drawer to seven links in three groups", () => {
    const items = SECTION_GROUPS.flatMap((group) => group.items);
    expect(items).toHaveLength(7);
    expect(SECTION_GROUPS.map(({ title }) => title)).toEqual([
      "Your office", "Learn & meet", "Everything else",
    ]);
    expect(items.map(({ to }) => to)).toEqual([
      "/office", "/orders", "/calendar", "/learn", "/groups", "/events", "/more",
    ]);
    // Home office is first because it is a place you belong to, not a tool.
    expect(items[0].label).toBe("Home office");
  });

  it("never repeats a primary destination in the drawer", () => {
    const drawer = SECTION_GROUPS.flatMap((group) => group.items.map((item) => item.to));
    for (const tab of PRIMARY_NAV) {
      expect(drawer).not.toContain(tab.to);
    }
    expect(drawer.some((to) => to === "/" || to === "/me")).toBe(false);
  });

  it("absorbs every discovery surface into Regions — including the retired markets", () => {
    for (const path of [
      "/regions", "/regions/nyanza", "/explore", "/browse", "/network",
      "/nearby/food", "/map", "/markets", "/markets/ki-1", "/mall", "/news",
      "/search/goods", "/listing/item-7", "/place/p-1", "/feed", "/events",
      "/groups", "/lists",
    ]) {
      expect(isRegionPath(path), path).toBe(true);
    }
    expect(isRegionPath("/orders")).toBe(false);
    // The old areas still answer to their old helpers.
    expect(isPrimaryActive(PRIMARY_NAV[1], "/network")).toBe(true);
	expect(isPrimaryActive(PRIMARY_NAV[1], "/markets")).toBe(true);
  });

  it("absorbs Work, Mail, chat and the bell into Inbox", () => {
    for (const path of ["/inbox", "/activity", "/work", "/orders", "/chat", "/tasks", "/locks", "/tools", "/mail"]) {
      expect(isInboxPath(path), path).toBe(true);
      expect(isPrimaryActive(PRIMARY_NAV[3], path), path).toBe(true);
    }
    expect(isInboxPath("/regions")).toBe(false);
  });

  it("keeps the page, the workspace and the long tail under You", () => {
    for (const path of ["/you", "/you/page", "/you/identity", "/you/rank", "/me", "/stock",
      "/analytics", "/pos", "/passport", "/growth", "/enterprise", "/office", "/more"]) {
      expect(isYouPath(path), path).toBe(true);
      expect(isPrimaryActive(PRIMARY_NAV[4], path), path).toBe(true);
    }
    expect(isPrimaryActive(PRIMARY_NAV[4], "/@mama_mboga", "mama_mboga")).toBe(true);
    expect(isPrimaryActive(PRIMARY_NAV[4], "/@another_vendor", "mama_mboga")).toBe(false);
  });

  it("never highlights two tabs for the same path", () => {
    const paths = ["/", "/home", "/regions", "/regions/nyanza", "/create", "/inbox", "/you",
      "/work", "/orders", "/chat", "/stock", "/office", "/more", "/map", "/@someone"];
    for (const path of paths) {
      const active = PRIMARY_NAV.filter((item) => isPrimaryActive(item, path, "mama_mboga"));
      expect(active.length, `${path} → ${active.map((a) => a.label).join(",")}`).toBeLessThanOrEqual(1);
    }
  });

  it("retires markets from the browse rail and from search", () => {
    expect(BROWSE_NAV.map(({ label }) => label)).not.toContain("Markets");
    expect(SEARCH_SCOPES.map(({ value }) => value)).not.toContain("markets");
    expect(SEARCH_SCOPES.find((scope) => scope.value === "vendors").to("rice")).toBe("/regions?search=rice");
  });

  it("pins /markets and /mall to a redirect, so old links still land", () => {
    const app = fs.readFileSync(path.resolve("src/App.jsx"), "utf8");
    expect(app).toContain('path="/markets" element={<Navigate to="/regions" replace />}');
    expect(app).toContain('path="/mall" element={<Navigate to="/regions" replace />}');
    expect(app).toContain('path="/explore" element={<Navigate to="/regions" replace />}');
  });

  it("keeps the six creation types behind the one Create tab", () => {
    expect(CREATE_TYPES.map(({ value }) => value).sort()).toEqual(
      ["collection", "community", "event", "listing", "opportunity", "post"],
    );
  });
});
