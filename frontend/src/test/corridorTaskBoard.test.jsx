import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn().mockResolvedValue({ data: {} }),
  approve: vi.fn().mockResolvedValue({
    data: {
      payment_tag: { method: "SEND_MONEY", number: "0712 345 678", name: "Achieng" },
      payment_instruction: "Pay KSh 250 on M-Pesa Send Money. The platform never holds this money.",
    },
  }),
  inbox: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  corridorTaskAPI: {
    claim: mocks.claim,
    approve: mocks.approve,
    create: vi.fn(),
    submitProof: vi.fn(),
  },
  fileAPI: { upload: vi.fn() },
  apiError: (_error, fallback) => fallback,
}));

vi.mock("@/components/ui/Toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import CorridorTaskBoard from "@/components/tasks/CorridorTaskBoard";

const data = {
  days: [{ date: "2026-11-18", available: 1, claimed: 0 }],
  earnings: { earned_kes: 750, pending_kes: 250, platform_fees_recorded_kes: 12.5, note: "Completed tasks add no standing credit." },
  tasks: [
    {
      id: 7,
      task_type: "DELIVERY_HANDOFF",
      type_label: "Delivery",
      town: "Kondele",
      title: "Deliver a parcel to Kondele",
      worker_payout_kes: 250,
      status: "OPEN",
      status_label: "Open",
      due_at: "2026-11-18T15:00:00Z",
      is_creator: false,
      is_assignee: false,
      can_claim: true,
      can_submit_proof: false,
      can_approve: false,
      claim_blocked_reason: null,
    },
    {
      id: 8,
      task_type: "DEAL_SPOT_CHECK",
      type_label: "Shop check",
      town: "Oginga Odinga St",
      title: "Check the bale price at the shop",
      worker_payout_kes: 300,
      status: "PROOF_SUBMITTED",
      status_label: "Proof submitted",
      due_at: "2026-11-19T12:00:00Z",
      is_creator: true,
      is_assignee: false,
      can_claim: false,
      can_submit_proof: false,
      can_approve: true,
      claim_blocked_reason: null,
    },
  ],
};

function renderBoard() {
  return render(
    <MemoryRouter>
      <CorridorTaskBoard data={data} onChanged={vi.fn()} />
    </MemoryRouter>,
  );
}

describe("Inbox work board", () => {
  it("shows the type, town and bold net payout on one line", () => {
    renderBoard();
    expect(screen.getByText(/Delivery • Kondele/)).toBeInTheDocument();
    expect(screen.getByText("Earn KSh 250")).toBeInTheDocument();
    expect(screen.getByText("Earn KSh 300")).toBeInTheDocument();
  });

  it("claims a task with one tap", async () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: /claim task/i }));
    await waitFor(() => expect(mocks.claim).toHaveBeenCalledWith(7));
  });

  it("approving reveals the worker's M-Pesa tag and says the platform holds nothing", async () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: /approve & pay/i }));
    expect(await screen.findByTestId("corridor-payment-tag")).toHaveTextContent("Send Money: 0712 345 678");
    expect(screen.getByTestId("corridor-payment-tag")).toHaveTextContent(/never holds this money/i);
    expect(mocks.approve).toHaveBeenCalledWith(8);
  });

  it("keeps the creator's M-Pesa tag reachable after a reload", () => {
    render(
      <MemoryRouter>
        <CorridorTaskBoard
          data={{
            days: [],
            earnings: null,
            tasks: [{
              id: 9,
              task_type: "MERCHANT_ONBOARD",
              type_label: "Merchant onboard",
              town: "Kisumu",
              title: "Onboard the shop on Oginga Odinga St",
              worker_payout_kes: 400,
              status: "COMPLETED",
              status_label: "Completed",
              due_at: "2026-11-18T15:00:00Z",
              is_creator: true,
              is_assignee: false,
              can_claim: false,
              can_submit_proof: false,
              can_approve: false,
              payment_tag: { method: "SEND_MONEY", number: "0712 345 678" },
            }],
          }}
          onChanged={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Pay Send Money: 0712 345 678")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy number/i })).toBeInTheDocument();
  });

  it("never claims the work is verified or awards standing", () => {
    renderBoard();
    expect(screen.getByText(/add no standing credit/i)).toBeInTheDocument();
    expect(screen.getByText(/signals, not platform verification/i)).toBeInTheDocument();
  });
});
