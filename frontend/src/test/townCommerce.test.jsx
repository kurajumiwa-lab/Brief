import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  token: "token-1",
  vendor: { id: "v-me", vendor_handle: "me", business_name: "Me", physical_location: "Kisumu" },
}));

const mocks = vi.hoisted(() => ({
  scanText: vi.fn(),
  scanPhoto: vi.fn(),
  captureReceipt: vi.fn(),
  publicListings: vi.fn(),
  listings: vi.fn(),
  mine: vi.fn(),
  shareListing: vi.fn(),
  claimListing: vi.fn(),
  createListing: vi.fn(),
  merchantDashboard: vi.fn(),
  buyCredit: vi.fn(),
  setRewardPolicy: vi.fn(),
  subscribeAnalytics: vi.fn(),
}));

vi.mock("@/stores/authStore", () => ({ useAuthStore: (selector) => selector(auth) }));
vi.mock("@/lib/townApi", () => ({ townAPI: mocks }));
vi.mock("@/lib/api", () => ({ apiError: (_error, fallback) => fallback }));
vi.mock("@/components/ui/Toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import ReceiptRewardsPage from "@/pages/town/ReceiptRewardsPage";
import ReferralIndexPage from "@/pages/town/ReferralIndexPage";
import MerchantCommercePage from "@/pages/town/MerchantCommercePage";

const draft = {
  merchant_name: "Kisumu Chemist",
  merchant_pin: "P051234567X",
  invoice_no: "INV-778812",
  issued_at: new Date(Date.now() - 4 * 60000).toISOString(),
  total_kes: 500,
  items_total_kes: 500,
  engine: "text",
  confidence: 84,
  line_count: 8,
  warnings: [],
  items: [
    { description: "Paracetamol 500mg", quantity: 2, unit_price_kes: 250, total_price_kes: 500, confidence: 88 },
  ],
};

const listing = {
  id: "l1", provider: "Uber", category: "ride_hailing", title: "Uber driver sign-up, Kisumu",
  description: "New driver accounts only.", region_slug: "nyanza", bounty_kes: 200,
  trust_level_required: 1, verification_status: "unverified", sponsored: false,
  stats: { clicks: 2, verified: 0 }, eligible: true, referral_code: "UBER-KSM-9",
};

describe("Town commerce", () => {
  beforeEach(() => {
    auth.token = "token-1";
    vi.clearAllMocks();
    mocks.scanText.mockResolvedValue({ data: { available: true, engine: "text", draft, warnings: [] } });
    mocks.captureReceipt.mockResolvedValue({
      data: {
        points_awarded: 10, calculated_points: 10, funded_points: 10, unfunded_points: 0,
        priority: true, freshness: "fresh", fraud_flags: ["priority_15_min"],
        note: "Points are redeemable only when a merchant prepaid credit.",
        receipt: { id: "r1" },
      },
    });
    mocks.publicListings.mockResolvedValue({
      data: {
        sponsored: [{ ...listing, id: "s1", provider: "Sponsored Co", title: "Sponsored ride offer", sponsored: true }],
        results: [listing],
        ranking: {
          sponsored_slots: 3, sponsored_label: "Sponsored",
          organic_order: "verified first, then highest bounty, then newest",
        },
      },
    });
    mocks.mine.mockResolvedValue({ data: { listings: [], conversions: [] } });
    mocks.listings.mockResolvedValue({
      data: {
        sponsored: [{ ...listing, id: "s1", provider: "Sponsored Co", title: "Sponsored ride offer", sponsored: true }],
        results: [listing],
        ranking: {
          sponsored_slots: 3, sponsored_label: "Sponsored",
          organic_order: "verified first, then highest bounty, then newest",
        },
      },
    });
    mocks.merchantDashboard.mockResolvedValue({
      data: {
        merchant: { id: "m1", name: "Kisumu Chemist", region: "nyanza", claim_status: "verified" },
        viewer_trust: { level: 4, level_name: "Trading" },
        credits: { available_kes: 900, spent_kes: 100, outstanding_kes: 40, expired_kes: 0 },
        policy: {
          points_per_100_kes: 2, max_points_per_receipt: 500, priority_bonus_pct: 10,
          explanation: "A KES 100 receipt earns 2 points.",
        },
        totals: { receipts: 4, sales_kes: 4000, customers: 3 },
        period: { receipts: 2, sales_kes: 2000, customers: 2 },
        redemptions: { redemptions: 1, open_vouchers: 1, expired_vouchers: 0 },
        analytics: { premium: false, price_kes: 500, locked_reason: "Premium analytics shows item-level demand." },
        recent_receipts: [{ id: "r1", total_kes: 500, points: 10, funded_kes: 10, scanned_at: "2026-11-17T10:00:00Z", flags: [] }],
        listings: [],
        obligations_note: "Outstanding customer rewards and expired credit are obligations, not revenue.",
      },
    });
  });

  it("reads a pasted receipt and shows funded versus calculated points", async () => {
    render(<MemoryRouter><ReceiptRewardsPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Paste text/i }));
    fireEvent.change(screen.getByPlaceholderText(/KISUMU CHEMIST/i), { target: { value: "Kisumu Chemist\nTOTAL 500.00" } });
    fireEvent.click(screen.getByRole("button", { name: /Read receipt/i }));

    expect(await screen.findByText("Check the draft")).toBeInTheDocument();
    expect(screen.getByText(/Priority 15 min/i)).toBeInTheDocument();
    expect(screen.getByText("Paracetamol 500mg")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Submit receipt/i }));
    expect(await screen.findByText(/10 points funded/i)).toBeInTheDocument();
    expect(mocks.captureReceipt).toHaveBeenCalledWith(expect.objectContaining({
      total_kes: 500,
      source: "text",
      merchant_pin: "P051234567X",
      items: [expect.objectContaining({ description: "Paracetamol 500mg", quantity: 2 })],
    }));
  });

  it("labels a sponsored referral and keeps the organic result separate", async () => {
    render(<MemoryRouter><ReferralIndexPage /></MemoryRouter>);
    expect(await screen.findByText("Uber driver sign-up, Kisumu")).toBeInTheDocument();
    expect(screen.getByText("Sponsored ride offer")).toBeInTheDocument();
    expect(screen.getAllByText("Sponsored").length).toBeGreaterThan(0);
    expect(screen.getByText(/Sponsored Co/)).toBeInTheDocument();
    expect(screen.getByText(/paid placements, capped at 3/i)).toBeInTheDocument();
  });

  it("keeps premium analytics locked and shows obligations separately", async () => {
    render(<MemoryRouter><MerchantCommercePage /></MemoryRouter>);
    expect(await screen.findByText("Kisumu Chemist")).toBeInTheDocument();
    expect(screen.getByText("Outstanding")).toBeInTheDocument();
    expect(screen.getByText("Locked")).toBeInTheDocument();
    expect(screen.getByText(/obligations, not revenue/i)).toBeInTheDocument();
    await waitFor(() => expect(mocks.merchantDashboard).toHaveBeenCalled());
  });
});
