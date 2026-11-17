vi.mock("@/lib/receiptsApi", () => ({ receiptsAPI: { ledger: vi.fn().mockResolvedValue({ data: { receipts: [] } }) } }));
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const agenda = {
    items: [{
      id: "booking:b1", kind: "booking", record_id: "b1",
      title: "Bulk maize delivery", starts_at: new Date().toISOString(),
      place: "Kisumu", price_kes: 500, capacity: 10, joined: 4,
      state: "confirmed", status_label: "Booking confirmed",
      counterparty: { name: "Kisumu Growers", handle: "growers" },
      to: "/activities/1", passable: true, pass_code: "HO-84K",
    }],
  };
  return {
    agenda,
    outsideState: { activity: { groups: [] }, activityStatus: "ready", loadActivity: vi.fn() },
  };
});

vi.mock("@/stores/outsideStore", () => ({
  useOutsideStore: (selector) => selector(mocks.outsideState),
}));
vi.mock("@/stores/chatStore", () => ({
  useChatStore: (selector) => selector({ rooms: [], fetchRooms: vi.fn().mockResolvedValue({}) }),
}));
vi.mock("@/stores/stockStore", () => ({
  useStockStore: (selector) => selector({ movements: [], fetchMovements: vi.fn().mockResolvedValue({}) }),
}));
vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector) => selector({ vendor: { vendor_handle: "ogallo" }, token: null }),
}));
vi.mock("@/lib/api", () => ({
  spottedDealAPI: { jury: vi.fn().mockResolvedValue({ data: [] }), mine: vi.fn().mockResolvedValue({ data: [] }) },
  eventAPI: { paymentQueue: vi.fn().mockResolvedValue({ data: [] }) },
  outsideAPI: { agenda: vi.fn().mockResolvedValue({ data: mocks.agenda }) },
  apiError: (_error, fallback) => fallback,
}));
vi.mock("@/lib/ledgerApi", () => ({
  default: { confirmCompletion: vi.fn().mockResolvedValue({ data: {} }) },
}));

import InboxPage from "@/pages/inbox/InboxPage";

describe("Inbox page agenda", () => {
  it("renders the week's real booking and opens its pass without a second click", async () => {
    render(
      <MemoryRouter>
        <InboxPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Bulk maize delivery")).toBeInTheDocument();
    expect(screen.getByTestId("inbox-timeline")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /pass/i }));
    expect(screen.getByTestId("trade-pass")).toBeInTheDocument();
    expect(screen.getByTestId("trade-pass-code")).toHaveTextContent("HO-84K");
  });
});
