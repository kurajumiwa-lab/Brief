import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

async function renderBar(path) {
  vi.resetModules();
  vi.stubEnv("VITE_FIVE_TAB_NAV_ENABLED", "true");
  const { default: MobileTabBar } = await import("@/components/layout/MobileTabBar");
  return render(<MemoryRouter initialEntries={[path]}><MobileTabBar /></MemoryRouter>);
}

afterEach(() => vi.unstubAllEnvs());

describe("mobile tab bar with the five-tab shape", () => {
  it("shows Desk, Nearby, Mail, Search and Me, and no Mall or Connect", async () => {
    await renderBar("/search");
    const nav = screen.getByRole("navigation", { name: "Primary mobile" });
    const links = within(nav).getAllByRole("link").map((a) => a.textContent.trim());
    expect(links).toEqual(["Desk", "Nearby", "Mail", "Search", "Me"]);
  });

  it("marks only the current tab as the page", async () => {
    await renderBar("/search");
    const nav = screen.getByRole("navigation", { name: "Primary mobile" });
    const current = within(nav).getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent.trim())).toEqual(["Search"]);
  });
});
