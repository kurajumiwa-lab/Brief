import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ mine: vi.fn(), scouted: vi.fn() }));

vi.mock("@/lib/leadApi", () => ({ leadAPI: { ...mocks, record: vi.fn() } }));

import LeadLedgerPanel from "@/components/leads/LeadLedgerPanel";

describe("Lead ledger panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mine.mockResolvedValue({
      data: {
        month: "2026-11", verified_leads: 2, unique_people: 2, due_kes: 10,
        scout_bounty_kes: 1, scouts_credited: 1, by_target_kind: { vendor: 2 },
        note: "A verified handshake is 5 KES. Brief never holds either amount.",
        recent: [
          {
            id: "l1", target_label: "Kondele Gas", action: "call", fee_kes: 5,
            scout: { handle: "amina", business: "Amina" }, created_at: "2026-11-10T09:00:00",
          },
          {
            id: "l2", target_label: "Rooftop session", action: "quote", fee_kes: 5,
            scout: null, created_at: "2026-11-11T09:00:00",
          },
        ],
      },
    });
    mocks.scouted.mockResolvedValue({ data: { leads: 3, earned_kes: 3, month: "2026-11" } });
  });

  it("shows verified handshakes, the fair contribution and direct scout bounties", async () => {
    render(<LeadLedgerPanel />);

    expect(await screen.findByText("Lead ledger")).toBeInTheDocument();
    expect(screen.getByText("2026-11")).toBeInTheDocument();
    expect(screen.getByText("Verified handshakes")).toBeInTheDocument();
    expect(screen.getByText("Kondele Gas")).toBeInTheDocument();
    expect(screen.getByText(/spotted by @amina/)).toBeInTheDocument();
    expect(screen.getByText(/You also scout/)).toBeInTheDocument();
    expect(screen.getByText(/never holds/)).toBeInTheDocument();
  });
});
