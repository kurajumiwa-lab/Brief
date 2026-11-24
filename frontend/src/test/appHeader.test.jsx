import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

/**
 * THE HEADER CONTRACT — logo, search, bell, profile, one row.
 *
 * The brief asks for that arrangement on every screen. The old header hid the
 * search field on Home, which is the screen where a person most often already
 * knows what they want, and buried "something is waiting" inside an account
 * dropdown. Both are pinned here so they cannot regress quietly.
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

describe("the header", () => {
  it("keeps the search field on Home, where people arrive knowing what they want", () => {
    const { container } = renderAt("/");
    // The md+ field is the one that stays in the row. It must be present on
    // every route, Home included.
    const fields = container.querySelectorAll("#global-search-, [id^='global-search-']");
    expect(fields.length).toBeGreaterThan(0);
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
