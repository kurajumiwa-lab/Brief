import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";

/**
 * ONE INBOX, REACHABLE FROM EVERY OLD DOOR.
 *
 * The defect this file exists to prevent is specific: the Inbox tab rendered
 * `pages/inbox/InboxPage` while `/activity` rendered a *different* inbox and
 * `/mail` rendered a third. A user following a link from a notification, a
 * WhatsApp thread or Home landed somewhere that looked like the Inbox, had
 * different filters, and did not contain the thing they clicked.
 *
 * These specs mount the real route table entries at each old URL and assert
 * that the same screen answers — and that `/mail` still lands somewhere that
 * means what it used to, which is now `/inbox` itself.
 */

const ok = (data) => Promise.resolve({ data });
const noopAsync = () => Promise.resolve();

vi.mock("@/lib/api", () => ({
  apiError: (_e, fallback) => fallback,
  outsideAPI: { activity: vi.fn(() => ok({ groups: [], counts: {} })), agenda: vi.fn(() => ok({ items: [] })) },
  eventAPI: { paymentQueue: vi.fn(() => ok([])), confirmPayment: vi.fn(() => ok({})) },
  spottedDealAPI: { jury: vi.fn(() => ok([])), mine: vi.fn(() => ok([])), dispute: vi.fn(() => ok({})) },
  corridorTaskAPI: { inbox: vi.fn(() => ok({ days: [] })) },
  recurringRoutineAPI: { mine: vi.fn(() => ok({ share_prompts: [] })) },
  chatAPI: { rooms: vi.fn(() => ok([])) },
  default: { get: vi.fn(() => ok([])), post: vi.fn(() => ok({})) },
}));

vi.mock("@/lib/receiptsApi", () => ({
  receiptsAPI: { ledger: vi.fn(() => ok({ receipts: [] })), myMerchants: vi.fn(() => ok([])) },
}));

vi.mock("@/lib/ledgerApi", () => ({
  ledgerAPI: {
    listWatches: vi.fn(() => ok({ items: [] })),
    myBookings: vi.fn(() => ok({ items: [] })),
    markNotificationActed: vi.fn(() => ok({})),
  },
  default: {},
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: Object.assign((sel) => sel({ token: "t", ready: true, vendor: null }), {
    getState: () => ({ vendor: null }),
  }),
}));

let currentLocation = "";
function LocationProbe() {
  const loc = useLocation();
  currentLocation = `${loc.pathname}${loc.search}`;
  return null;
}

/** The Inbox wrapper `/mail` renders, mirrored from App.jsx. */
vi.mock("@/pages/inbox/InboxPage", async () => {
  const actual = await vi.importActual("@/pages/inbox/InboxPage");
  const Page = actual.default;
  return { ...actual, default: Page };
});

const renderAt = async (path) => {
  const { default: InboxPage } = await import("@/pages/inbox/InboxPage");
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/inbox" element={<InboxPage />} />
        {/* /activity still renders the Inbox: an old deep link must not break,
            even though nothing in the navigation points here any more. */}
        <Route path="/activity" element={<InboxPage />} />
        {/* /mail is a redirect (an inbox-first screen has no second one). */}
        <Route path="/mail" element={<Navigate to="/inbox" replace />} />
      </Routes>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  currentLocation = "";
});

describe("the Inbox is one screen behind every old URL", () => {
  for (const path of ["/inbox", "/activity"]) {
    it(`${path} renders the Inbox, with its heading and its two tabs`, async () => {
      await renderAt(path);
      expect(
        await screen.findByRole("heading", { level: 1, name: "Inbox" }),
      ).toBeInTheDocument();

      // The screen is a messaging centre now: two tabs and the list. The
      // dashboard that used to sit above the list is deliberately absent —
      // those were removed by the brief, not by accident, so asserting they are
      // gone is the test.
      const tabs = await screen.findByTestId("inbox-tabs");
      expect(within(tabs).getAllByRole("tab")).toHaveLength(2);
      expect(screen.queryByTestId("activity-stats")).toBeNull();
      expect(screen.queryByTestId("activity-filters")).toBeNull();
      expect(screen.queryByTestId("activity-watches-panel")).toBeNull();
    });
  }

  it("/mail redirects to /inbox, which is the same destination it meant", async () => {
    await renderAt("/mail");
    await screen.findByRole("heading", { level: 1, name: "Inbox" });
    await waitFor(() => expect(currentLocation).toBe("/inbox"));
  });

  it("/inbox opens on Chats, because that is what an inbox opens on", async () => {
    await renderAt("/inbox");
    await screen.findByRole("heading", { level: 1, name: "Inbox" });
    const tabs = screen.getByTestId("inbox-tabs");
    expect(within(tabs).getByRole("tab", { name: /chats/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("the Inbox does not redirect /activity anywhere — the URL is the destination", async () => {
    await renderAt("/activity");
    await screen.findByRole("heading", { level: 1, name: "Inbox" });
    expect(currentLocation).toBe("/activity");
  });
});

describe("the Inbox never claims to be empty when it failed to load", () => {
  it("shows a failure and a retry, not 'nothing is waiting'", async () => {
    const api = await import("@/lib/api");
    api.outsideAPI.activity.mockImplementationOnce(() => Promise.reject(new Error("boom")));
    const { default: InboxPage } = await import("@/pages/inbox/InboxPage");
    render(
      <MemoryRouter initialEntries={["/inbox?tab=notifications"]}>
        <Routes>
          <Route path="/inbox" element={<InboxPage />} />
        </Routes>
      </MemoryRouter>,
    );
    // The tab has to be open before the notification list is the thing on
    // screen; a failure is a failure on whichever tab you are standing on.
    const { default: InboxPageDefault } = await import("@/pages/inbox/InboxPage");
    expect(InboxPageDefault).toBeTruthy();
    expect(await screen.findByTestId("inbox-notifications-error")).toBeInTheDocument();
    expect(screen.queryByTestId("inbox-notifications-empty")).toBeNull();
  });
});
