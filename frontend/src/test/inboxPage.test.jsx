vi.mock("@/lib/receiptsApi", () => ({ receiptsAPI: { ledger: vi.fn().mockResolvedValue({ data: { receipts: [] } }) } }));
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    routineMine: vi.fn().mockResolvedValue({ data: { routines: [], share_prompts: [] } }),
    routineMarkShared: vi.fn().mockResolvedValue({ data: {} }),
    windowOpen: vi.fn(),
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
  corridorTaskAPI: { inbox: vi.fn().mockResolvedValue({ data: { days: [], tasks: [], earnings: null } }) },
  recurringRoutineAPI: { mine: mocks.routineMine, markShared: mocks.routineMarkShared },
  fileAPI: {},
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

  it("drops a one-tap WhatsApp share for this week's published round", async () => {
    mocks.routineMine.mockResolvedValue({
      data: {
        routines: [],
        share_prompts: [{
          instance_id: "i1",
          occurrence_date: "2026-11-21",
          title: "Saturday deliveries",
          share_path: "/activities/a1",
          share_text: "Saturday deliveries — Sat 21 Nov in Kisumu. This week's round is live; message me to book.",
          shared_at: null,
        }],
      },
    });
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    vi.stubGlobal("open", mocks.windowOpen);

    render(<MemoryRouter><InboxPage /></MemoryRouter>);

    expect(await screen.findByText("Share this week's round")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /whatsapp/i }));
    await waitFor(() => expect(mocks.windowOpen).toHaveBeenCalled());
    expect(mocks.windowOpen.mock.calls[0][0]).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(mocks.routineMarkShared).toHaveBeenCalledWith("i1");
  });
});
