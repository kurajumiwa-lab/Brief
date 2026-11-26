import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

/**
 * THE HEADER CONTRACT — logo, search, bell, profile, one row.
 *
 * The brief asks for that arrangement on every screen, and the old header
 * broke it twice: it hid search on Home, which is where a person most often
 * knows exactly what they want, and it buried "something is waiting" inside
 * an account dropdown. Both are pinned here so they cannot regress quietly.
 *
 * There is one refinement the review forced, and it is pinned too:
 * "repeated search areas" was a complaint. Home and Explore each own a search
 * in the page, where the person is already looking — so on those two routes
 * the header stands down rather than printing a second field that answers the
 * same question. A search is never missing; on those screens it is the page's,
 * and it is the same component, writing to the same results.
 */

const activity = {
  groups: [
    { items: [{ is_read: false }, { is_read: false }, { is_read: true }] },
    { items: [{ is_read: false }] },
  ],
  counts: { rooms_active_today: 0 },
};

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector) => selector({
    vendor: { business_name: "Ogallo", vendor_handle: "ogallo", movements_completed: 1 },
  }),
}));

vi.mock("@/stores/outsideStore", () => ({
  useOutsideStore: (selector) => selector({
    activity,
    loadActivity: vi.fn(),
  }),
}));

vi.mock("@/stores/uiStore", () => ({
  useUIStore: (selector) => selector({
    setMobileSidebar: vi.fn(),
    mobileSidebarOpen: false,
  }),
}));

import AppHeader from "@/components/layout/AppHeader";

function renderAt(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppHeader />
    </MemoryRouter>,
  );
}

const searchFields = (container) =>
  container.querySelectorAll("[id^='global-search-']");

describe("the header", () => {
  it("keeps the app's one search field on every screen that does not own its own", () => {
    // The historic `global-search-` id is kept, so anything that reached for
    // the header field — including this spec — still finds it.
    for (const path of ["/inbox", "/you", "/settings", "/map"]) {
      const { container, unmount } = renderAt(path);
      expect(searchFields(container).length, `search on ${path}`).toBeGreaterThan(0);
      unmount();
    }
  });

  it("stands down on Home and Explore, where the page owns the one field", () => {
    // Not a missing search: Home's hero and Explore's toolbar render the same
    // `MarketplaceSearch`. Two fields on one screen was the complaint.
    for (const path of ["/", "/explore", "/regions"]) {
      const { container, unmount } = renderAt(path);
      expect(searchFields(container).length, `no duplicate search on ${path}`).toBe(0);
      unmount();
    }
  });

  it("gives anything waiting its own bell with a count and an inbox route", () => {
    renderAt("/");
    const bell = screen.getByRole("link", { name: /inbox, 3 waiting/i });
    expect(bell).toHaveAttribute("href", "/inbox");
    // The count is real: 3 unread across the groups. The Inbox tab badge shows
    // the same number, which is ordinary (a tab badge and a bell badge are the
    // same fact in two places), so scope this assertion to the bell itself.
    expect(bell.textContent).toContain("3");
  });

  it("still offers the drawer and the account on every screen", () => {
    renderAt("/regions");
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account" })).toBeInTheDocument();
  });
});
