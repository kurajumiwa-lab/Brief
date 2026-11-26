/**
 * THE INBOX — an inbox-first contract.
 *
 * This file used to pin the opposite design. It asserted a three-column grid of
 * statistics, a neighbourhood-watches row above the list, and all seven filter
 * pills in one horizontally-scrollable row — the dashboard that made the Inbox
 * unusable for reading messages. Those assertions were correct for that screen
 * and are wrong for this one, so they have been replaced rather than deleted:
 * the requirement did not disappear, it inverted.
 *
 * What is pinned now, because each one is a thing a future edit could quietly
 * take back:
 *
 *   · two permanent tabs, both always present, each carrying its own count;
 *   · no statistics row, no filter row, no watches panel, no explanatory
 *     paragraph — the seven pieces of furniture the brief names;
 *   · notifications are one chronological list with one-line bodies, not seven
 *     headed groups with a description under each;
 *   · opening ONE notification marks exactly that one read, and no other;
 *   · opening a chat marks no notification read at all;
 *   · loading, empty and failed are three visibly different states.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.setConfig({ testTimeout: 20000 });

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const ok = (data) => Promise.resolve({ data });

const ME = {
  id: "v-me", business_name: "Achieng Groceries", vendor_handle: "achieng",
  current_role: "both", physical_location: "Kondele, Kisumu",
};

const ACTIVITY = {
  groups: [
    {
      key: "invitations", count: 1,
      items: [{
        id: "n-1", type: "group_invite", group: "invitations",
        title: "Kisumu Hikers invited you", body: "Come along on Sunday", data: {},
        is_read: false, created_at: "2026-10-16T10:00:00",
      }],
    },
    {
      key: "replies", count: 1,
      items: [{
        id: "n-2", type: "reply", group: "replies",
        title: "Otieno answered your question", body: "Still 240 a crate", data: {},
        is_read: true, created_at: "2026-10-15T09:00:00",
      }],
    },
    {
      key: "trades", count: 1,
      items: [{
        id: "n-3", type: "movement", group: "trades",
        title: "Sukuma wiki moved", body: "Kibanda Kitchen confirmed", data: { movement_id: "m-9" },
        is_read: false, created_at: "2026-10-17T08:00:00",
      }],
    },
    { key: "events", count: 0, items: [] },
    { key: "community", count: 0, items: [] },
    { key: "account", count: 0, items: [] },
  ],
  counts: { unread_notifications: 2, rooms: 4, rooms_active_today: 2, attending: 3 },
  preferences: { groups: [], muted_groups: [] },
};

const ROOMS = [
  {
    id: "r-1", name: "Nyabere", room_type: "direct", unread_count: 2,
    last_message: { body: "Are you available for the Kisii trip?" },
    last_message_at: "2026-10-17T10:32:00",
  },
  {
    id: "r-2", name: "Wakulima Sourcing", room_type: "group", unread_count: 0,
    last_message: { body: "Fresh this morning" },
    last_message_at: "2026-10-16T09:00:00",
  },
];

const mocks = vi.hoisted(() => ({
  activity: vi.fn(),
  rooms: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiError: (_e, fallback) => fallback,
  outsideAPI: { activity: mocks.activity, agenda: vi.fn(() => ok({ items: [] })) },
  chatAPI: { rooms: mocks.rooms },
  notificationAPI: { markRead: mocks.markRead, markAllRead: mocks.markAllRead },
  eventAPI: { paymentQueue: vi.fn(() => ok([])), confirmPayment: vi.fn(() => ok({})) },
  spottedDealAPI: { jury: vi.fn(() => ok([])), mine: vi.fn(() => ok([])), dispute: vi.fn(() => ok({})) },
  corridorTaskAPI: { inbox: vi.fn(() => ok({ days: [] })) },
  recurringRoutineAPI: { mine: vi.fn(() => ok({ share_prompts: [] })) },
  default: {},
}));

vi.mock("@/lib/receiptsApi", () => ({
  receiptsAPI: { ledger: vi.fn(() => ok({ receipts: [] })), myMerchants: vi.fn(() => ok([])) },
}));

vi.mock("@/lib/ledgerApi", () => ({
  ledgerAPI: {
    listWatches: vi.fn(() => ok({ items: [] })),
    myBookings: vi.fn(() => ok({ items: [] })),
    createWatch: vi.fn(() => ok({})),
    deleteWatch: vi.fn(() => ok({})),
    markNotificationActed: vi.fn(() => ok({})),
  },
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: Object.assign((selector) => selector({ token: "t", ready: true, vendor: ME }), {
    getState: () => ({ vendor: ME }),
  }),
}));

const renderAt = (element, path = "/inbox") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={element} />
      </Routes>
    </MemoryRouter>,
  );

const InboxPage = async () => (await import("@/pages/inbox/InboxPage")).default;

beforeEach(async () => {
  mocks.activity.mockReset().mockImplementation(() => ok(ACTIVITY));
  mocks.rooms.mockReset().mockImplementation(() => ok(ROOMS));
  mocks.markRead.mockReset().mockImplementation(() => ok({}));
  mocks.markAllRead.mockReset().mockImplementation(() => ok({}));
  const { useOutsideStore } = await import("@/stores/outsideStore");
  useOutsideStore.setState({ activity: null, activityStatus: "idle" });
  const { useChatStore } = await import("@/stores/chatStore");
  useChatStore.setState({ rooms: [], activeRoom: null, messages: [] });
  document.body.innerHTML = "";
});

describe("Inbox — two permanent tabs", () => {
  it("always shows both, and lands on Chats", async () => {
    const Page = await InboxPage();
    renderAt(<Page />);

    const tabs = await screen.findByTestId("inbox-tabs");
    const chats = within(tabs).getByRole("tab", { name: /chats/i });
    const notifications = within(tabs).getByRole("tab", { name: /notifications/i });

    expect(chats).toHaveAttribute("aria-selected", "true");
    expect(notifications).toHaveAttribute("aria-selected", "false");
    // Neither tab is ever absent — a tab that vanishes when empty reads as a
    // feature that was removed.
    expect(within(tabs).getAllByRole("tab")).toHaveLength(2);
  });

  it("keeps a count on each tab, including the one you are not on", async () => {
    const Page = await InboxPage();
    renderAt(<Page />);

    const tabs = await screen.findByTestId("inbox-tabs");
    // Chats: 2 unread in r-1. Notifications: 2 unread in the payload.
    const chats = within(tabs).getByRole("tab", { name: /chats/i });
    const notifications = within(tabs).getByRole("tab", { name: /notifications/i });

    expect(within(chats).getByLabelText(/2 unread chats/i)).toHaveTextContent("2");
    // The count for the tab you are NOT on is the whole point: it is how the
    // screen tells you something arrived elsewhere.
    expect(within(notifications).getByLabelText(/2 unread notifications/i)).toHaveTextContent("2");
  });

  it("switches to Notifications and back without losing either list", async () => {
    const Page = await InboxPage();
    renderAt(<Page />);

    const tabs = await screen.findByTestId("inbox-tabs");
    fireEvent.click(within(tabs).getByRole("tab", { name: /notifications/i }));

    expect((await screen.findAllByTestId("inbox-notification-row")).length).toBeGreaterThan(0);
    expect(within(tabs).getByRole("tab", { name: /notifications/i })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(within(tabs).getByRole("tab", { name: /chats/i }));
    expect((await screen.findAllByTestId("inbox-chat-row")).length).toBeGreaterThan(0);
  });

  it("opens on Notifications when the URL says so, so the tab survives a reload", async () => {
    const Page = await InboxPage();
    renderAt(<Page />, "/inbox?tab=notifications");

    const tabs = await screen.findByTestId("inbox-tabs");
    expect(within(tabs).getByRole("tab", { name: /notifications/i })).toHaveAttribute(
      "aria-selected", "true",
    );
  });
});

describe("Inbox — the furniture the brief removed", () => {
  it("has no statistics row, filter row or watches panel", async () => {
    const Page = await InboxPage();
    renderAt(<Page />);
    await screen.findByTestId("inbox-tabs");

    // Each of these was a real element of the old screen, and each is named in
    // the brief as something to remove rather than relocate.
    expect(screen.queryByTestId("activity-stats")).toBeNull();
    expect(screen.queryByTestId("activity-filters")).toBeNull();
    expect(screen.queryByTestId("activity-watches-panel")).toBeNull();
    expect(screen.queryByTestId("toggle-add-watch-btn")).toBeNull();
  });

  it("says Inbox and nothing under it", async () => {
    const Page = await InboxPage();
    renderAt(<Page />);

    const heading = await screen.findByRole("heading", { level: 1, name: "Inbox" });
    expect(heading.className).toContain("text-2xl");
    // No eyebrow above it and no introductory sentence below it.
    expect(screen.queryByText(/^now$/i)).toBeNull();
    expect(screen.queryByText(/your week first/i)).toBeNull();
    expect(screen.queryByText(/only a reply that is actually waiting/i)).toBeNull();
  });

  it("has no 'Waiting on a reply' or 'Everything else' heading", async () => {
    const Page = await InboxPage();
    renderAt(<Page />, "/inbox?tab=notifications");
    await screen.findByTestId("inbox-tabs");

    expect(screen.queryByText(/waiting on a reply/i)).toBeNull();
    expect(screen.queryByText(/everything else/i)).toBeNull();
  });

  it("offers search and settings as the only header actions", async () => {
    const Page = await InboxPage();
    renderAt(<Page />);

    expect(await screen.findByRole("link", { name: /^search$/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^settings$/i })).toHaveAttribute("href", "/more");
  });
});

describe("Inbox — Chats", () => {
  it("shows sender, preview, time and an unread count on one row", async () => {
    const Page = await InboxPage();
    renderAt(<Page />);

    const row = (await screen.findAllByTestId("inbox-chat-row"))[0];
    expect(within(row).getByText("Nyabere")).toBeInTheDocument();
    expect(within(row).getByText("Are you available for the Kisii trip?")).toBeInTheDocument();
    expect(within(row).getByLabelText(/2 unread/i)).toBeInTheDocument();
    expect(row).toHaveAttribute("href", "/chat?room=r-1");
  });

  it("says so honestly when there are no conversations", async () => {
    mocks.rooms.mockImplementation(() => ok([]));
    const Page = await InboxPage();
    renderAt(<Page />);

    expect(await screen.findByTestId("inbox-chats-empty")).toBeInTheDocument();
    expect(screen.getByText(/no conversations yet/i)).toBeInTheDocument();
  });
});

describe("Inbox — Notifications", () => {
  const openNotifications = async () => {
    const Page = await InboxPage();
    renderAt(<Page />, "/inbox?tab=notifications");
    await screen.findByTestId("inbox-tabs");
  };

  it("is one chronological list, newest first, with no group headings", async () => {
    await openNotifications();

    const rows = await screen.findAllByTestId("inbox-notification-row");
    // n-3 (17 Oct), n-1 (16 Oct), n-2 (15 Oct) — order is by time, not by group,
    // which is why a reply from an hour ago cannot sit under an invitation from
    // last week. Asserted by title, because the destination of each row is
    // `destinationFor`'s business and has its own test file.
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Sukuma wiki moved"),
      expect.stringContaining("Kisumu Hikers invited you"),
      expect.stringContaining("Otieno answered your question"),
    ]);

    // The seven grouped headings and their blurbs are gone.
    expect(screen.queryByText(/requests to join, invites and approvals/i)).toBeNull();
    expect(screen.queryByText(/trades & bookings/i)).toBeNull();
  });

  it("clamps the body to one line instead of printing a paragraph", async () => {
    await openNotifications();
    const [first] = await screen.findAllByTestId("inbox-notification-row");

    const body = within(first).getByText("Kibanda Kitchen confirmed");
    expect(body.className).toContain("line-clamp-1");
  });

  it("marks exactly one notification read, and never mark-all", async () => {
    await openNotifications();

    const rows = await screen.findAllByTestId("inbox-notification-row");
    // n-3 is unread; opening it must mark that one.
    fireEvent.click(rows[0]);

    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledWith("n-3"));
    expect(mocks.markRead).toHaveBeenCalledTimes(1);
    // The brief forbids the blunt instrument, and it is the one the old screen
    // would have reached for.
    expect(mocks.markAllRead).not.toHaveBeenCalled();
  });

  it("does not mark a read notification again", async () => {
    await openNotifications();

    const rows = await screen.findAllByTestId("inbox-notification-row");
    // n-2 is already read.
    fireEvent.click(rows[2]);

    await waitFor(() => expect(mocks.rooms).toHaveBeenCalled());
    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it("marks no notification read when a chat is opened", async () => {
    const Page = await InboxPage();
    renderAt(<Page />);

    const [firstChat] = await screen.findAllByTestId("inbox-chat-row");
    fireEvent.click(firstChat);
    expect(mocks.markRead).not.toHaveBeenCalled();
    expect(mocks.markAllRead).not.toHaveBeenCalled();
  });

  it("says you're caught up without a wall of cards", async () => {
    mocks.activity.mockImplementation(() => ok({ groups: [], counts: {} }));
    await openNotifications();

    expect(await screen.findByTestId("inbox-notifications-empty")).toBeInTheDocument();
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
  });

  it("states a failure in place, with a way to retry", async () => {
    mocks.activity.mockImplementation(() => Promise.reject(new Error("offline")));
    await openNotifications();

    const alert = await screen.findByTestId("inbox-notifications-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(within(alert).getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("keeps loading and empty as different states", async () => {
    // A promise that never settles: the skeleton shows, the empty state does not.
    mocks.activity.mockImplementation(() => new Promise(() => {}));
    await openNotifications();

    expect(await screen.findByTestId("inbox-notifications-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("inbox-notifications-empty")).toBeNull();
  });
});

describe("Inbox — bottom navigation clearance", () => {
  it("pads the scroll area by the tab bar plus the device safe area", async () => {
    const { default: Shell } = await import("@/components/layout/Shell");
    render(
      <MemoryRouter initialEntries={["/inbox"]}>
        <Routes>
          <Route path="/" element={<Shell />}>
            <Route path="inbox" element={<div>page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    const main = document.getElementById("main");
    expect(main.className).toContain("env(safe-area-inset-bottom)");
  });
});
