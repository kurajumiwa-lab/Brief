import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

/**
 * THE HEADER CONTRACT — logo, search, Chats, Notifications, profile.
 *
 * The brief asks for that arrangement on every screen. A combined Inbox badge
 * was retired: it could not tell a person whether a message needed a reply or
 * an alert needed reading. These specs pin two permanent shortcuts with two
 * real counts, and the one-search rule that keeps the bar compact.
 */

const activity = {
  groups: [
    { items: [{ is_read: false }, { is_read: false }, { is_read: true }] },
    { items: [{ is_read: false }] },
  ],
  counts: { rooms_active_today: 7 },
};

const rooms = [
  { id: "r-1", unread_count: 2 },
  { id: "r-2", unread_count: 0 },
];

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

vi.mock("@/stores/chatStore", () => ({
  useChatStore: (selector) => selector({
    rooms,
    fetchRooms: vi.fn(() => Promise.resolve(rooms)),
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
    for (const path of ["/inbox", "/you", "/settings", "/map"]) {
      const { container, unmount } = renderAt(path);
      expect(searchFields(container).length, `search on ${path}`).toBeGreaterThan(0);
      unmount();
    }
  });

  it("stands down on Home and Explore, where the page owns the one field", () => {
    for (const path of ["/", "/explore", "/regions"]) {
      const { container, unmount } = renderAt(path);
      expect(searchFields(container).length, `no duplicate search on ${path}`).toBe(0);
      unmount();
    }
  });

  it("keeps Chats and Notifications one tap away, with separate unread counts", () => {
    renderAt("/");
    const chats = screen.getByRole("link", { name: /chats, 2 unread messages/i });
    const notifications = screen.getByRole("link", { name: /notifications, 3 unread/i });
    expect(chats).toHaveAttribute("href", "/inbox?tab=chats");
    expect(notifications).toHaveAttribute("href", "/inbox?tab=notifications");
    // `rooms_active_today: 7` is activity, not unread mail. It must not be
    // added to either number and silently become a wrong count.
    expect(chats.textContent).toContain("2");
    expect(notifications.textContent).toContain("3");
    expect(screen.queryByText("7")).not.toBeInTheDocument();
  });

  it("keeps both shortcuts on a screen with no search of its own", () => {
    renderAt("/regions");
    expect(screen.getByTestId("header-chats")).toBeInTheDocument();
    expect(screen.getByTestId("header-notifications")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Workspace menu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account" })).toBeInTheDocument();
  });
});
