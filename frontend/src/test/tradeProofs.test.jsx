import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/receiptsApi", () => ({
  receiptsAPI: {
    tradeProofs: vi.fn(),
    confirmTrade: vi.fn(),
    disputeTrade: vi.fn(),
  },
}));

vi.mock("@/components/ui/Toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { receiptsAPI } from "@/lib/receiptsApi";
import TradeProofsPage from "@/pages/trades/TradeProofsPage";

const base = {
  role: "seller",
  merchant_name: "Milimani Chemist",
  merchant_pin: "P051234567X",
  amount: 800,
  created_at: new Date().toISOString(),
  buyer: { id: "b1", name: "Achieng Household", handle: "achieng" },
  seller: { id: "s1", name: "Milimani Chemist", handle: "milimani" },
  receipt: { id: "r1", total: 800, scanned_at: new Date().toISOString(), status: "verified" },
};

const proofs = [
  { ...base, id: "p1", status: "pending", can_confirm: true, can_dispute: true },
  {
    ...base, id: "p2", status: "pending", role: "buyer", can_confirm: false, can_dispute: false,
    seller: { id: "s2", name: "Kondele Hardware", handle: "kondele" },
    merchant_name: "Kondele Hardware",
  },
  {
    ...base, id: "p3", status: "unmatched", role: "buyer", can_confirm: false, can_dispute: false,
    seller: null, merchant_name: "A Shop Not On The App",
  },
  {
    ...base, id: "p4", status: "confirmed", can_confirm: false, can_dispute: false,
    confirmed_at: new Date().toISOString(),
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <TradeProofsPage />
    </MemoryRouter>,
  );
}

describe("receipt-backed trades", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    receiptsAPI.tradeProofs.mockResolvedValue({
      data: {
        proofs,
        summary: { pending_for_me: 1, waiting_for_shop: 1, confirmed: 1, unmatched: 1 },
        confirmed_trade_proofs: 1,
      },
    });
    receiptsAPI.confirmTrade.mockResolvedValue({
      data: {
        proof: { ...proofs[0], status: "confirmed", can_confirm: false, can_dispute: false },
        confirmed_trade_proofs: { mine: 2, buyer: 1 },
      },
    });
    receiptsAPI.disputeTrade.mockResolvedValue({
      data: {
        proof: {
          ...proofs[0], status: "disputed", can_confirm: false, can_dispute: false,
          dispute_reason: "Not our receipt",
        },
      },
    });
  });

  it("shows a shop what is waiting and turns confirmation into a completed trade", async () => {
    renderPage();

    expect(await screen.findByTestId("trade-proofs")).toBeInTheDocument();
    const rows = await screen.findAllByTestId("trade-proof-row");
    expect(rows).toHaveLength(4);

    const incoming = rows.find((row) => within(row).queryByTestId("trade-proof-confirm"));
    expect(incoming).toBeTruthy();
    expect(within(incoming).getByText(/Achieng Household/)).toBeInTheDocument();

    fireEvent.click(within(incoming).getByTestId("trade-proof-confirm"));
    await waitFor(() => expect(receiptsAPI.confirmTrade).toHaveBeenCalledWith("p1"));
    await waitFor(() => {
      const updated = screen.getAllByTestId("trade-proof-row")
        .find((row) => within(row).queryByText("Milimani Chemist"));
      expect(within(updated).getByText("Confirmed")).toBeInTheDocument();
    });
  });

  it("lets the shop question a receipt instead of silently accepting it", async () => {
    renderPage();
    const rows = await screen.findAllByTestId("trade-proof-row");
    const incoming = rows.find((row) => within(row).queryByTestId("trade-proof-dispute"));

    fireEvent.click(within(incoming).getByTestId("trade-proof-dispute"));
    fireEvent.change(within(incoming).getByLabelText(/why is this not your shop/i), {
      target: { value: "Not our receipt" },
    });
    fireEvent.click(within(incoming).getByRole("button", { name: /send question/i }));

    await waitFor(() => expect(receiptsAPI.disputeTrade).toHaveBeenCalledWith("p1", "Not our receipt"));
    await waitFor(() => expect(screen.getByText(/Questioned: Not our receipt/)).toBeInTheDocument());
  });

  it("turns an unmatched shop into a WhatsApp invite rather than a fake trade", async () => {
    renderPage();
    const rows = await screen.findAllByTestId("trade-proof-row");
    const unmatched = rows.find((row) => within(row).queryByTestId("trade-proof-unmatched"));
    expect(within(unmatched).getByText(/not on Home Office yet/i)).toBeInTheDocument();
    expect(within(unmatched).getByTestId("trade-proof-unmatched")).toHaveAttribute(
      "href", expect.stringMatching(/^https:\/\/wa\.me\/\?text=/),
    );
    expect(within(unmatched).getByTestId("trade-proof-unmatched").getAttribute("href"))
      .toContain(encodeURIComponent("/invite/a-shop-not-on-the-app"));
  });
});
