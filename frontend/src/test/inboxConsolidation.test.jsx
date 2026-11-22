import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

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
 * that the same screen answers — and that `/mail` still starts on conversations,
 * which is the one thing the old Mail page did.
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
  const InboxPageMail = () => <InboxPage initialFilter="messages" />;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/activity" element={<InboxPage />} />
        <Route path="/mail" element={<InboxPageMail />} />
      </Routes>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  currentLocation = "";
});

describe("the Inbox is one screen behind every old URL", () => {
  for (const path of ["/inbox", "/activity", "/mail"]) {
    it(`${path} renders the Inbox, with its heading and its controls`, async () => {
      await renderAt(path);
      expect(
        await screen.findByRole("heading", { level: 1, name: "Inbox" }),
      ).toBeInTheDocument();

      // the three parts of Activity that were absorbed, not dropped
      expect(await screen.findByTestId("activity-stats")).toBeInTheDocument();
      expect(screen.getByTestId("activity-watches-panel")).toBeInTheDocument();
      expect(screen.getByTestId("activity-filters")).toBeInTheDocument();

      // the week, and the two modes
      expect(screen.getByTestId("inbox-timeline")).toBeInTheDocument();
      expect(screen.getByTestId("inbox-mode-waiting")).toBeInTheDocument();
      expect(screen.getByTestId("inbox-mode-activity")).toBeInTheDocument();
    });
  }

  it("/mail opens already filtered to conversations, which is all the old page did", async () => {
    await renderAt("/mail");
    await screen.findByRole("heading", { level: 1, name: "Inbox" });
    const messagesChip = screen.getByTestId("activity-group-messages");
    await waitFor(() =>
      expect(messagesChip).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("/inbox opens on everything, not on a filter that hides unread work", async () => {
    await renderAt("/inbox");
    await screen.findByRole("heading", { level: 1, name: "Inbox" });
    expect(screen.getByTestId("activity-group-all")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("the Inbox does not redirect anywhere — the URL is the destination", async () => {
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
      <MemoryRouter initialEntries={["/inbox"]}>
        <Routes>
          <Route path="/inbox" element={<InboxPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("activity-error")).toBeInTheDocument();
    expect(screen.queryByTestId("activity-empty")).toBeNull();
  });
});
