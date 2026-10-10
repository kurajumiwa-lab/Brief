import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const api = vi.hoisted(() => ({
  getOrder: vi.fn(),
  supportDisputes: vi.fn(),
  resolveDispute: vi.fn(),
  selectQuote: vi.fn(),
  setPickup: vi.fn(),
  requestQuote: vi.fn(),
  createReceiptCode: vi.fn(),
  receive: vi.fn(),
  pay: vi.fn(),
  openDispute: vi.fn(),
  orderRoom: vi.fn(),
  couriers: vi.fn(),
  advance: vi.fn(),
  tracking: vi.fn(),
  shipmentStatus: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiError: (error, fallback = "Something went wrong") => error?.response?.data?.detail || fallback,
  ordersAPI: {
    get: api.getOrder,
    supportDisputes: api.supportDisputes,
    resolveDispute: api.resolveDispute,
    selectDeliveryQuote: api.selectQuote,
    setPickup: api.setPickup,
    requestDeliveryQuote: api.requestQuote,
    createReceiptCode: api.createReceiptCode,
    receive: api.receive,
    pay: api.pay,
    openDispute: api.openDispute,
    orderRoom: api.orderRoom,
    deliveryInbox: vi.fn(),
    answerDeliveryQuote: vi.fn(),
    tracking: api.tracking,
  },
  stockAPI: { advance: api.advance },
  chatAPI: { orderRoom: api.orderRoom },
  toolAPI: { couriers: api.couriers, shipmentStatus: api.shipmentStatus },
}));

import OrderDetailPage from "@/pages/orders/OrderDetailPage";
import OrderSupportInbox from "@/pages/orders/OrderSupportInbox";
import { useAuthStore } from "@/stores/authStore";

const buyerOrder = {
  id: "order-1",
  status: "confirmed",
  direction: "incoming",
  created_at: "2026-10-10T10:00:00",
  stock_name: "Test produce",
  sku: "TST-1",
  quantity: 2,
  unit_of_measure: "crate",
  unit_price: 1200,
  product_total_ksh: 2400,
  supplier: { id: "supplier-1", business_name: "Supplier shop", handle: "supplier_shop", location: "Market", is_verified: true, allow_direct_calls: false, call_phone: null },
  buyer: { id: "buyer-1", business_name: "Buyer shop", handle: "buyer_shop", location: "Town", is_verified: false, allow_direct_calls: false, call_phone: null },
  terms: { product_amount_ksh: 2400, delivery_amount_ksh: null, platform_fee_ksh: 7, total_amount_ksh: null, delivery_mode: null, destination_address: null, currency: "KES" },
  pickup: { address: "Market, stall 12", hours: "Supplier hours", instructions: "Ask at the stall", ready_for_collection: true, ready_at: "2026-10-10T10:00:00" },
  selected_quote_id: null,
  delivery_quotes: [{ id: "quote-pickup", provider_type: "self_pickup", provider_name: "Supplier shop", provider_vendor_id: "supplier-1", provider_verified: true, price_ksh: 0, eta_text: null, pickup_address: "Market, stall 12", destination_address: null, ready_for_collection: true, note: null, status: "offered", expires_at: null }],
  delivery_requests: [],
  tracking: { updates: [], shipments: [] },
  payment: { status: "unpaid", intent_id: null, amount_ksh: null, reference: null, receipt: null, failure_reason: null, refunded_amount_ksh: 0, refund_pending_amount_ksh: 0, refunds: [], availability: { enabled: false, reason: "Mock payments cannot move real money." } },
  settlement: { status: "not_started", payouts: [] },
  events: [],
  disputes: [],
};

function renderOrder(order = buyerOrder) {
  useAuthStore.setState({ vendor: { id: order.direction === "fulfillment" ? "courier-1" : "buyer-1" } });
  return render(
    <MemoryRouter initialEntries={[`/orders/${order.id}`]}>
      <Routes><Route path="/orders/:id" element={<OrderDetailPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getOrder.mockResolvedValue({ data: buyerOrder });
  api.couriers.mockResolvedValue({ data: [] });
  api.selectQuote.mockResolvedValue({ data: { ...buyerOrder, selected_quote_id: "quote-pickup" } });
  api.setPickup.mockResolvedValue({ data: {} });
  api.requestQuote.mockResolvedValue({ data: {} });
  api.advance.mockResolvedValue({ data: {} });
});

afterEach(() => cleanup());

describe("live order detail", () => {
  it("shows transaction-backed amounts, readiness and provider state", async () => {
    renderOrder();
    expect(await screen.findByRole("heading", { name: "Test produce" })).toBeInTheDocument();
    expect(screen.getByText("Recorded order amounts")).toBeInTheDocument();
    expect(screen.getByText(/Supplier marked ready/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm option" })).toBeInTheDocument();
    expect(screen.getByText(/mock payments cannot move real money/i)).toBeInTheDocument();
    expect(screen.getByText("Not paid")).toBeInTheDocument();
    expect(api.getOrder).toHaveBeenCalledWith("order-1");
  });

  it("asks the customer to confirm a real quote before payment", async () => {
    renderOrder();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm option" }));
    await waitFor(() => expect(api.selectQuote).toHaveBeenCalledWith("order-1", "quote-pickup"));
    expect(screen.getByText(/total is shown after the customer confirms an option/i)).toBeInTheDocument();
  });

  it("does not expose product or payment amounts on a selected-provider view", async () => {
    const providerOrder = {
      ...buyerOrder,
      direction: "fulfillment",
      selected_quote_id: "quote-courier",
      terms: { ...buyerOrder.terms, product_amount_ksh: null, platform_fee_ksh: null, total_amount_ksh: null, delivery_amount_ksh: 325 },
      delivery_quotes: [{ ...buyerOrder.delivery_quotes[0], id: "quote-courier", provider_type: "courier", provider_vendor_id: "courier-1", price_ksh: 325, status: "selected" }],
      payment: { ...buyerOrder.payment, status: "paid", intent_id: null, amount_ksh: null, reference: null, availability: null },
    };
    api.getOrder.mockResolvedValue({ data: providerOrder });
    renderOrder(providerOrder);
    expect(await screen.findByRole("heading", { name: "Test produce" })).toBeInTheDocument();
    expect(screen.getByText("Paid · provider verified")).toBeInTheDocument();
    expect(screen.queryByText("KSh 2,400")).not.toBeInTheDocument();
    expect(screen.getByText(/The total is shown after the customer confirms an option/i)).toBeInTheDocument();
  });

  it("lets configured support request a provider-verified refund with a recorded note", async () => {
    const supportCase = {
      id: "case-1",
      movement_id: "order-1",
      category: "payment_problem",
      description: "Review the payment callback and receipt.",
      status: "open",
      outcome: null,
      created_at: "2026-10-10T10:00:00",
      opened_by: { business_name: "Buyer shop", handle: "buyer_shop" },
      order: {
        status: "confirmed", stock_name: "Test produce", sku: "TST-1", quantity: 2,
        unit_of_measure: "crate", supplier: { business_name: "Supplier shop", handle: "supplier_shop" },
        buyer: { business_name: "Buyer shop", handle: "buyer_shop" }, product_amount_ksh: 2400,
        delivery_amount_ksh: 0, platform_fee_ksh: 0, total_amount_ksh: 2400,
        delivery_mode: "self_pickup", settlement_status: "blocked_by_dispute",
      },
      payment: { status: "completed", amount_ksh: 2400, reference: "provider-ref", refunded_amount_ksh: 0, refund_pending_amount_ksh: 0, remaining_refundable_ksh: 2400 },
      payout_started: false,
    };
    api.supportDisputes.mockResolvedValueOnce({ data: [supportCase] }).mockResolvedValueOnce({ data: [] });
    api.resolveDispute.mockResolvedValue({ data: { outcome: "refund_pending", refund_amount_ksh: 2400, refund_status: "pending" } });
    render(<OrderSupportInbox />);
    expect(await screen.findByText("Review the payment callback and receipt.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Resolution"), { target: { value: "refund" } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Provider callback reviewed." } });
    fireEvent.click(screen.getByRole("button", { name: "Request provider refund" }));
    await waitFor(() => expect(api.resolveDispute).toHaveBeenCalledWith("order-1", "case-1", {
      outcome: "refund", resolution_note: "Provider callback reviewed.",
    }));
  });
});
