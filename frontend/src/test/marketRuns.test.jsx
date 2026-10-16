import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const apiMocks = vi.hoisted(() => ({
  runTemplates: vi.fn(() => Promise.resolve({
    data: {
      templates: [
        { key: "Ruiru_fresh", title: "Run A — Ruiru Fresh Market", market_name: "Ruiru Fresh Market", market_city: "Ruiru", run_kind: "fresh_market", schedule_label: "Scheduled morning buying", audience: "Families + shops", products: ["Chicken", "Fish"], cold_chain_required: true, cold_chain_plan: "Insulated boxes with ice.", funding_note: "Start with advance confirmation." },
        { key: "daraja_consolidated", title: "Daraja Mbili — supply & collection hub", market_name: "Daraja Mbili", market_city: "Kisumu", run_kind: "consolidated_supply", schedule_label: "Consolidated supply order", audience: "Shops + families, including customers outside the walkable ring", products: ["Rice", "Sugar"], cold_chain_required: false, cold_chain_plan: null, funding_note: "A request is never a confirmed order." },
      ],
    },
  })),
  runs: vi.fn(() => Promise.resolve({
    data: [{ id: "run-1", title: "Daraja Mbili — supply & collection hub", market_name: "Daraja Mbili", run_date: "2026-10-16", status: "open", funding_model: "mixed_open", buyer_handle: "buyer_boss", funding_note: "Each order records its own funding.", cold_chain_required: false }],
  })),
  runLedger: vi.fn(() => Promise.resolve({
    data: {
      id: "run-1", title: "Daraja Mbili — supply & collection hub", market_name: "Daraja Mbili", run_date: "2026-10-16", status: "open",
      funding_model: "mixed_open", buyer_handle: "buyer_boss", cold_chain_required: false,
      orders: [{
        id: "o-1", product_name: "Sugar", quantity: 2, quantity_allocated: null, unit_of_measure: "kg",
        package_size: "2 kg packet", vendor_handle: "family_wanjiku", participant_type: "family",
        status: "requested", payment_method: "cash_on_delivery", money_responsibility: "customer",
        delivery_area: "Migosi — outside the ring", repack_required: true,
        final_amount_kes: 360, amount_paid_kes: 0, balance_due_kes: 360, payment_status: "unpaid",
        deposit_recommended: false,
      }],
      ledger: {
        products: [{ product_name: "Sugar", unit_of_measure: "kg", total_pooled_demand: 22, confirmed_purchasing_demand: 20, family_quantity: 2, shop_quantity: 20, wholesale_threshold: 17, threshold_reached: true, purchase: null }],
        totals: { selling_revenue_kes: 124000, supplier_cost_kes: 130000, run_expenses_kes: 3000, amount_collected_kes: 0, balance_outstanding_kes: 124000, estimated_profit_kes: -9000, profit_formula: "Selling revenue − supplier cost − run expenses." },
        fulfilment: { received_and_paid_rate: 0 },
        money_note: "Payments are recorded, not held in platform custody.",
      },
    },
  })),
  createRun: vi.fn(), createRunOrder: vi.fn(), confirmRunOrder: vi.fn(),
  allocateRunOrder: vi.fn(), recordRunPayment: vi.fn(), handoverRunOrder: vi.fn(),
  recordRunPurchase: vi.fn(), recordRunExpense: vi.fn(), setRunStatus: vi.fn(),
  myRunOrders: vi.fn(() => Promise.resolve({ data: [] })),
}));

vi.mock("@/lib/api", () => ({
  apiError: (e, f = "Error") => e?.message || f,
  locksAPI: apiMocks,

  commercialAPI: {
    feed: vi.fn(() => Promise.resolve({ data: { posts: [] } })),
    shelf: vi.fn(() => Promise.resolve({ data: { shelf: [] } })),
    get: vi.fn(() => Promise.resolve({ data: {} })),
    create: vi.fn(() => Promise.resolve({ data: {} })),
    save: vi.fn(() => Promise.resolve({ data: {} })),
    unsave: vi.fn(() => Promise.resolve({ data: {} })),
    share: vi.fn(() => Promise.resolve({ data: { share_url: "" } })),
    joinInterest: vi.fn(() => Promise.resolve({ data: {} })),
    interests: vi.fn(() => Promise.resolve({ data: { interests: [] } })),
    stats: vi.fn(() => Promise.resolve({ data: {} })),
    categories: vi.fn(() => Promise.resolve({ data: { categories: [] } })),
  },
}));

describe("MarketRunsSection", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("shows open ordering, customer-chosen payment and the three ledger figures", async () => {
    const { default: MarketRunsSection } = await import("@/components/locks/MarketRunsSection");
    render(
      <MemoryRouter>
        <MarketRunsSection currentHandle="family_wanjiku" />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Run A — Ruiru Fresh Market")).toBeInTheDocument();
    expect(screen.getByText(/outside the walkable ring/i)).toBeInTheDocument();
    expect(screen.getByText(/your registered zone and walkable ring never block an order/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/How will you pay/i)).toBeInTheDocument();
    expect(screen.getByText("Cash on delivery")).toBeInTheDocument();
    // Three figures, never merged.
    expect(await screen.findByText("Pooled demand")).toBeInTheDocument();
    expect(screen.getByText("Confirmed (buying list)")).toBeInTheDocument();
    expect(screen.getByText("Wholesale threshold")).toBeInTheDocument();
    // The family order is a request until its owner confirms it.
    expect(screen.getByText(/Migosi — outside the ring/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm order/i })).toBeInTheDocument();
    expect(screen.getByText(/not held in platform custody/i)).toBeInTheDocument();
  });
});
