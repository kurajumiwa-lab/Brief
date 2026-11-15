import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/receiptsApi", () => ({
  receiptsAPI: {
    vouchers: vi.fn(),
    offers: vi.fn(),
    claimOffer: vi.fn(),
    voucher: vi.fn(),
    myMerchants: vi.fn(),
    redeem: vi.fn(),
  },
}));

vi.mock("@/lib/api", () => ({
  apiError: (err, fallback) => err?.response?.data?.detail || fallback,
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector) => selector({ token: "test-token" }),
}));

import { receiptsAPI } from "@/lib/receiptsApi";
import { useReceiptStore } from "@/stores/receiptStore";
import VoucherWallet from "@/components/receipts/VoucherWallet";
import VoucherRedeemCard from "@/components/receipts/VoucherRedeemCard";

const active = {
  id: "v1",
  merchant_name: "Kisumu Fresh Mart",
  merchant_pin: "P051234567X",
  value_kes: 100,
  points_cost: 10,
  status: "issued",
  issued_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 86400000).toISOString(),
  redeemed_at: null,
  code: "HO-84K",
  confirmation: null,
};

const used = {
  ...active,
  id: "v2",
  status: "redeemed",
  code: null,
  redeemed_at: new Date().toISOString(),
  merchant_name: "Milimani Chemist",
  confirmation: {
    code: "HO-7QM",
    value_kes: 50,
    reward: "KES 50 off",
    merchant_name: "Milimani Chemist",
    customer: { id: "c1", name: "Ogallo", handle: "ogallo" },
    redeemed_at: new Date().toISOString(),
    verified_trades: 3,
  },
};

describe("voucher redemption at the counter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useReceiptStore.setState({ vouchers: [] });
    receiptsAPI.vouchers.mockResolvedValue({
      data: { vouchers: [active, used], balance: { available: 15 } },
    });
    receiptsAPI.offers.mockResolvedValue({ data: { offers: [] } });
    receiptsAPI.myMerchants.mockResolvedValue({
      data: { merchants: [{ id: "m1", name: "Milimani Chemist", verified: true }] },
    });
  });

  it("opens a fixed six-character code and shows the same receipt after the shop redeems it", async () => {
    render(<VoucherWallet region="nyanza" />);

    expect(await screen.findByTestId("voucher-card")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("voucher-use-now"));

    const panel = screen.getByTestId("voucher-active-code");
    expect(within(panel).getByText("HO-84K")).toBeInTheDocument();
    // The screen hides after five minutes, but the code itself does not expire.
    expect(within(panel).getByText(/screen hides in 5:00/i)).toBeInTheDocument();
    expect(within(panel).getByText(/code stays valid until/i)).toBeInTheDocument();

    const receipt = await screen.findByTestId("voucher-confirmation");
    expect(within(receipt).getByText("VOUCHER CONFIRMED")).toBeInTheDocument();
    expect(within(receipt).getByText("HO-7QM")).toBeInTheDocument();
    expect(within(receipt).getByText(/Ogallo/)).toBeInTheDocument();
    expect(within(receipt).getByText(/3 verified trades/i)).toBeInTheDocument();
  });

  it("still opens the cached code when the wallet cannot reach the server", async () => {
    useReceiptStore.setState({ vouchers: [active] });
    receiptsAPI.vouchers.mockRejectedValue(new Error("offline"));
    receiptsAPI.offers.mockRejectedValue(new Error("offline"));

    render(<VoucherWallet />);
    fireEvent.click(await screen.findByTestId("voucher-use-now"));

    expect(screen.getByTestId("voucher-active-code")).toHaveTextContent("HO-84K");
    expect(screen.getByTestId("voucher-error")).toHaveTextContent(/could not be refreshed/i);
  });

  it("only offers deals from shops this person has actually paid", async () => {
    useReceiptStore.setState({
      vouchers: [active],
      receipts: [{ id: "r1", pin: "P051234567X", merchant: "Kisumu Fresh Mart" }],
    });
    receiptsAPI.offers.mockResolvedValue({
      data: {
        offers: [
          { id: "o1", merchant_pin: "P051234567X", merchant_name: "Kisumu Fresh Mart", title: "KES 50 off", discount_kes: 50, points_cost: 10 },
          { id: "o2", merchant_pin: "P099999999Z", merchant_name: "A Stranger Shop", title: "KES 500 off", discount_kes: 500, points_cost: 10 },
        ],
      },
    });
    receiptsAPI.claimOffer.mockResolvedValue({
      data: { voucher: { ...active, id: "v9", code: "HO-9AA" }, balance: { available: 5 } },
    });

    render(<VoucherWallet />);
    const offers = await screen.findAllByTestId("voucher-offer");
    expect(offers).toHaveLength(1);
    expect(within(offers[0]).getByText(/Kisumu Fresh Mart/)).toBeInTheDocument();

    fireEvent.click(within(offers[0]).getByTestId("voucher-claim"));
    await waitFor(() => expect(receiptsAPI.claimOffer).toHaveBeenCalledWith("o1"));
    expect(await screen.findAllByTestId("voucher-card")).toHaveLength(2);
  });

  it("lets a verified shop confirm a code and shows the customer the same card", async () => {
    receiptsAPI.redeem.mockResolvedValue({
      data: { redeemed: true, voucher: used, confirmation: used.confirmation },
    });

    render(<VoucherRedeemCard />);
    const input = await screen.findByTestId("voucher-redeem-code");
    fireEvent.change(input, { target: { value: "ho-7qm" } });
    fireEvent.click(screen.getByTestId("voucher-redeem-submit"));

    await waitFor(() => expect(receiptsAPI.redeem).toHaveBeenCalledWith({ code: "HO-7QM" }));
    const receipt = await screen.findByTestId("voucher-confirmation");
    expect(within(receipt).getByText("HO-7QM")).toBeInTheDocument();
    expect(within(receipt).getByText("KES 50 off")).toBeInTheDocument();
    expect(within(receipt).getByText(/Milimani Chemist/)).toBeInTheDocument();
    expect(screen.getByTestId("voucher-redeem-another")).toBeInTheDocument();
  });

  it("refuses a wrong code without pretending a trade was logged", async () => {
    receiptsAPI.redeem.mockRejectedValue({
      response: { data: { detail: "That code is not valid at this shop." } },
    });

    render(<VoucherRedeemCard />);
    fireEvent.change(await screen.findByTestId("voucher-redeem-code"), {
      target: { value: "HO-ZZZ" },
    });
    fireEvent.click(screen.getByTestId("voucher-redeem-submit"));

    expect(await screen.findByTestId("voucher-redeem-error")).toHaveTextContent(
      /not valid at this shop/i,
    );
    expect(screen.queryByTestId("voucher-confirmation")).not.toBeInTheDocument();
  });
});
