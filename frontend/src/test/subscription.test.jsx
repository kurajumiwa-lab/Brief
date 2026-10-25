import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SubscriptionPage from "@/pages/billing/SubscriptionPage";
import { billingAPI } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  billingAPI: { me: vi.fn(), subscribe: vi.fn(), cancel: vi.fn(), simulatePayment: vi.fn() },
  apiError: (_error, fallback) => fallback,
}));

const base = (overrides = {}) => ({
  billing: { live: false, provider: "mock", reason: "The mock payment provider accepts test events only." },
  subscription: null,
  invoices: [],
  plan: { tier: "starter", name: "Starter (Freemium)", price_kes_monthly: 0, price_kes_annual: 0 },
  catalogue: [
    { tier: "starter", name: "Starter (Freemium)", price_kes_monthly: 0, price_kes_annual: 0, max_seats: 1, max_watches: 10 },
    { tier: "readiness", name: "Readiness", price_kes_monthly: 2900, price_kes_annual: 29000, max_seats: 3, max_watches: 25 },
  ],
  terms: { trial_days: 14, grace_days: 7, lapse_policy: "A lapsed subscription returns the account to Starter." },
  ...overrides,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <SubscriptionPage />
    </MemoryRouter>
  );

describe("Subscription", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says recurring billing is not live instead of implying it is", async () => {
    billingAPI.me.mockResolvedValue({ data: base() });
    renderPage();
    expect(await screen.findByText("Recurring billing is not live")).toBeInTheDocument();
    expect(screen.getByText(/mock payment provider accepts test events only/i)).toBeInTheDocument();
    // Free starter is not offered as something to buy.
    expect(screen.queryByRole("button", { name: /Subscribe/ })).toBeInTheDocument(); // readiness only
    expect(screen.getByText("Readiness")).toBeInTheDocument();
  });

  it("shows a trial with its end date and does not promise renewal", async () => {
    billingAPI.me.mockResolvedValue({
      data: base({
        subscription: {
          id: "s1", plan_tier: "readiness", billing_period: "monthly", price_kes: 2900,
          status: "trialing", trial_ends_at: "2026-11-08T09:00:00",
          current_period_start: "2026-10-25T09:00:00", current_period_end: "2026-11-08T09:00:00",
          grace_until: null, cancel_at_period_end: false, cancelled_at: null,
        },
        plan: { tier: "readiness", name: "Readiness", price_kes_monthly: 2900, price_kes_annual: 29000 },
        invoices: [{ id: "i1", amount_kes: 2900, status: "pending", period_start: "2026-10-25T09:00:00",
          period_end: "2026-11-24T09:00:00", paid_at: null, failure_reason: null }],
      }),
    });
    renderPage();
    expect(await screen.findByText(/Trial ends/)).toBeInTheDocument();
    expect(screen.getByText(/awaiting provider/)).toBeInTheDocument();
    // A pending invoice is not a receipt; the mock affordance is labelled.
    expect(screen.getByRole("button", { name: /Simulate/ })).toBeInTheDocument();
  });

  it("surfaces a failed charge with its reason and the grace window", async () => {
    billingAPI.me.mockResolvedValue({
      data: base({
        subscription: {
          id: "s2", plan_tier: "readiness", billing_period: "monthly", price_kes: 2900,
          status: "past_due", trial_ends_at: null,
          current_period_start: "2026-09-25T09:00:00", current_period_end: "2026-10-25T09:00:00",
          grace_until: "2026-11-01T09:00:00", cancel_at_period_end: false, cancelled_at: null,
        },
        plan: { tier: "readiness", name: "Readiness", price_kes_monthly: 2900, price_kes_annual: 29000 },
        invoices: [{ id: "i2", amount_kes: 2900, status: "failed", period_start: "2026-09-25T09:00:00",
          period_end: "2026-10-25T09:00:00", paid_at: null, failure_reason: "Insufficient funds" }],
      }),
    });
    renderPage();
    expect(await screen.findByText("Insufficient funds")).toBeInTheDocument();
    expect(screen.getByText(/Grace period until/)).toBeInTheDocument();
  });

  it("subscribes only after the vendor chooses a paid plan", async () => {
    billingAPI.me.mockResolvedValue({ data: base() });
    billingAPI.subscribe.mockResolvedValue({ data: {} });
    renderPage();

    const button = await screen.findByRole("button", { name: /Subscribe/ });
    billingAPI.me.mockResolvedValue({ data: base() });
    fireEvent.click(button);
    await waitFor(() => expect(billingAPI.subscribe).toHaveBeenCalledWith("readiness"));
  });
});
