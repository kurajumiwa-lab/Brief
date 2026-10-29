/**
 * ACTIVITY — the dashboard layout contract.
 *
 * These specs exist because the Activity screen is judged on what fits on one
 * phone screen, and "it looked right on my laptop" is not a test. jsdom cannot
 * measure pixels, so every assertion here is about the *rules* that decide the
 * layout:
 *
 *   · the three statistics are one grid row of three columns, and there is no
 *     horizontal scroller or carousel anywhere near them;
 *   · all seven filters exist as one non-wrapping row inside the only
 *     horizontally scrollable container on the page;
 *   · the heading is the short one, with no explanatory paragraph;
 *   · failure and emptiness are compact lines in the flow, not tall cards;
 *   · the numbers still come from the activity payload, and a filter still
 *     filters.
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
    { key: "events", count: 0, items: [] },
    { key: "trades", count: 0, items: [] },
    { key: "community", count: 0, items: [] },
    { key: "account", count: 0, items: [] },
  ],
  counts: { unread_notifications: 7, rooms: 4, rooms_active_today: 2, attending: 3 },
  preferences: { groups: [], muted_groups: [] },
};

const mocks = vi.hoisted(() => ({ activity: vi.fn(), watches: vi.fn(), bookings: vi.fn() }));

vi.mock("@/lib/api", () => ({
  apiError: (_e, fallback) => fallback,
  outsideAPI: { activity: mocks.activity },
}));

vi.mock("@/lib/ledgerApi", () => ({
  ledgerAPI: {
    listWatches: mocks.watches,
    myBookings: mocks.bookings,
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

const renderAt = (element) =>
  render(
    <MemoryRouter initialEntries={["/activity"]}>
      <Routes>
        <Route path="*" element={element} />
      </Routes>
    </MemoryRouter>,
  );

const ActivityPage = async () => (await import("@/pages/activity/ActivityPage")).default;

beforeEach(async () => {
  mocks.activity.mockReset().mockImplementation(() => ok(ACTIVITY));
  mocks.watches.mockReset().mockImplementation(() => ok({ items: [] }));
  mocks.bookings.mockReset().mockImplementation(() => ok({ items: [] }));
  const { useOutsideStore } = await import("@/stores/outsideStore");
  useOutsideStore.setState({ activity: null, activityStatus: "idle" });
});

describe("Activity — the three statistics", () => {
  it("puts all three in one three-column grid, with no carousel and no horizontal scroller", async () => {
    const Page = await ActivityPage();
    renderAt(<Page />);

    const stats = await screen.findByTestId("activity-stats");
    const classes = stats.className;

    expect(classes).toContain("grid-cols-3");
    expect(classes).toContain("grid");
    // The requirement in one assertion: a scroller here would mean the third
    // number is only reachable by swiping, which is not "shown".
    expect(classes).not.toContain("overflow-x-auto");
    expect(classes).not.toContain("overflow-x-scroll");
    expect(classes).not.toContain("snap-x");
    expect(classes).not.toContain("flex");
    expect(stats).not.toHaveAttribute("aria-roledescription");
    expect(stats.children).toHaveLength(3);
  });

  it("shows the real numbers and names each one", async () => {
    const Page = await ActivityPage();
    renderAt(<Page />);

    const rooms = await screen.findByTestId("activity-rooms");
    expect(rooms).toHaveTextContent("2");
    expect(rooms).toHaveTextContent(/Conversations/i);
    expect(rooms).toHaveTextContent(/active today/i);

    const events = screen.getByTestId("activity-attending");
    expect(events).toHaveTextContent("3");
    expect(events).toHaveTextContent(/Events/i);

    const unread = screen.getByTestId("activity-unread");
    expect(unread).toHaveTextContent("7");
    expect(unread).toHaveTextContent(/Notifications/i);
  });

  it("keeps every tile the same shape, whatever the count", async () => {
    const Page = await ActivityPage();
    renderAt(<Page />);
    const stats = await screen.findByTestId("activity-stats");

    const tiles = ["activity-rooms", "activity-attending", "activity-unread"].map((id) =>
      screen.getByTestId(id).firstElementChild
    );
    // The shared box, not the whole class string: two tiles are links and
    // carry a hover state the third does not, but the geometry must match or
    // the row stops reading as one band.
    for (const shared of ["min-h-[104px]", "rounded-2xl", "border", "p-2.5", "flex-col", "min-w-0"]) {
      expect(tiles.map((t) => t.className.includes(shared))).toEqual([true, true, true]);
    }
    expect(stats).toBeInTheDocument();
  });

  it("survives a zero-everywhere payload without collapsing", async () => {
    mocks.activity.mockImplementation(() =>
      ok({ ...ACTIVITY, counts: { unread_notifications: 0, rooms: 0, rooms_active_today: 0, attending: 0 } })
    );
    const Page = await ActivityPage();
    renderAt(<Page />);

    expect(await screen.findByTestId("activity-rooms")).toHaveTextContent("0");
    expect(screen.getByTestId("activity-stats").children).toHaveLength(3);
  });
});

describe("Activity — the compact header", () => {
  it("says Activity, and nothing else", async () => {
    const Page = await ActivityPage();
    renderAt(<Page />);

    const heading = await screen.findByRole("heading", { level: 1, name: "Activity" });
    expect(heading).toBeInTheDocument();
    expect(screen.queryByText(/what's waiting for you/i)).toBeNull();
    expect(screen.queryByText(/measured by real follow-through/i)).toBeNull();
    // A 24px page title is the compact end of the brief; the old one rendered
    // at `title-page` (28px) with an eyebrow above it.
    expect(heading.className).toContain("text-2xl");
  });
});

describe("Activity — neighbourhood watches", () => {
  it("is one compact row with the short description and an Add action", async () => {
    const Page = await ActivityPage();
    renderAt(<Page />);

    const panel = await screen.findByTestId("activity-watches-panel");
    expect(within(panel).getByRole("heading", { name: /neighbourhood watches/i })).toBeInTheDocument();
    expect(within(panel).getByText(/alerts for local needs, artisans and produce/i)).toBeInTheDocument();
    expect(within(panel).getByTestId("toggle-add-watch-btn")).toHaveTextContent(/^Add$/);
    expect(panel.className).toContain("p-3");
  });

  it("still opens the watch form and saves what was chosen", async () => {
    const Page = await ActivityPage();
    renderAt(<Page />);

    fireEvent.click(await screen.findByTestId("toggle-add-watch-btn"));
    fireEvent.change(screen.getByTestId("watch-keyword-input"), { target: { value: "fence" } });
    fireEvent.click(screen.getByTestId("save-watch-btn"));

    const { ledgerAPI } = await import("@/lib/ledgerApi");
    await waitFor(() => expect(ledgerAPI.createWatch).toHaveBeenCalled());
  });
});

describe("Activity — filters", () => {
  it("keeps all seven in one non-wrapping, horizontally scrollable row", async () => {
    const Page = await ActivityPage();
    renderAt(<Page />);

    const row = await screen.findByTestId("activity-filters");
    expect(row.className).toContain("flex-nowrap");
    expect(row.className).toContain("overflow-x-auto");

    const labels = ["Everything", "Invitations", "Events", "Replies", "Trades & Bookings", "Communities", "Account"];
    for (const label of labels) {
      expect(within(row).getByRole("button", { name: new RegExp(label.replace("&", "&"), "i") })).toBeInTheDocument();
    }
  });

  it("shows a category that came back empty, because the filter still exists", async () => {
    // The old code rendered filters from the server payload, so an empty
    // category silently vanished from the row.
    mocks.activity.mockImplementation(() =>
      ok({ ...ACTIVITY, groups: ACTIVITY.groups.map((g) => (g.key === "account" ? { key: "account", count: 0, items: [] } : g)) })
    );
    const Page = await ActivityPage();
    renderAt(<Page />);
    const row = await screen.findByTestId("activity-filters");
    expect(within(row).getByTestId("activity-group-account")).toBeInTheDocument();
  });

  it("still filters the feed when a pill is pressed", async () => {
    const Page = await ActivityPage();
    renderAt(<Page />);

    expect(await screen.findByTestId("activity-section-invitations")).toBeInTheDocument();
    expect(screen.getByTestId("activity-section-replies")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("activity-group-replies"));

    expect(screen.getByTestId("activity-group-replies")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("activity-section-invitations")).toBeNull();
    expect(screen.getByTestId("activity-section-replies")).toBeInTheDocument();
  });
});

describe("Activity — feed states", () => {
  it("states a failure in one compact line, with a working Try again", async () => {
    mocks.activity.mockImplementation(() => Promise.reject(new Error("boom")));
    const Page = await ActivityPage();
    renderAt(<Page />);

    const alert = await screen.findByTestId("activity-error");
    expect(alert).toHaveTextContent(/couldn't load activity/i);
    expect(alert.className).not.toContain("p-6");
    expect(alert.className).not.toContain("text-center");

    mocks.activity.mockImplementation(() => ok(ACTIVITY));
    fireEvent.click(within(alert).getByRole("button", { name: /try again/i }));

    await waitFor(() => expect(screen.getByTestId("activity-section-invitations")).toBeInTheDocument());
    expect(mocks.activity.mock.calls.length).toBeGreaterThan(1);
  });

  it("says you're all caught up without a wall of cards", async () => {
    mocks.activity.mockImplementation(() =>
      ok({ ...ACTIVITY, groups: ACTIVITY.groups.map((g) => ({ ...g, count: 0, items: [] })), counts: { unread_notifications: 0, rooms: 0, rooms_active_today: 0, attending: 0 } })
    );
    const Page = await ActivityPage();
    renderAt(<Page />);

    const empty = await screen.findByTestId("activity-empty");
    expect(empty).toHaveTextContent(/you're all caught up/i);
    expect(empty.className).not.toContain("p-6");
    // The old empty state was a bordered card with three door tiles; the point
    // of the new one is that it takes a line, not a screen.
    expect(within(empty).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("keeps loading, empty and failed as three different things", async () => {
    mocks.activity.mockImplementation(() => new Promise(() => {}));
    const Page = await ActivityPage();
    renderAt(<Page />);

    await waitFor(() => {
      expect(screen.getByTestId("activity-stats")).toBeInTheDocument();
    });
    // Nothing has failed and nothing is empty: no error line, no "caught up".
    expect(screen.queryByTestId("activity-error")).toBeNull();
    expect(screen.queryByTestId("activity-empty")).toBeNull();
  });
});

describe("Activity — bottom navigation clearance", () => {
  it("pads the scroll area by the tab bar plus the device safe area", async () => {
    const { default: Shell } = await import("@/components/layout/Shell");
    render(
      <MemoryRouter initialEntries={["/activity"]}>
        <Routes>
          <Route path="/" element={<Shell />}>
            <Route path="activity" element={<div>page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    const main = document.getElementById("main");
    expect(main.className).toContain("env(safe-area-inset-bottom)");
  });
});
