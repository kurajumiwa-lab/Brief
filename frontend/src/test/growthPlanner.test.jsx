import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const blueprintFixture = vi.hoisted(() => ({
  vendor_id: "v-1",
  vendor_handle: "mama_mboga",
  business_name: "Mama Mboga Fresh",
  current_role: "both",
  pulse: {
    visible_listings: 4,
    total_listings: 5,
    open_trades: 2,
    completed_movements: 12,
    cancelled_movements: 1,
    supplier_links: 6,
    fulfillment_rate: 92.3,
    fulfillment_mark: {
      key: "l2",
      label: "Level 2",
      completed_movements: 12,
      fulfillment_rate: 92.3,
      hint: "85%+ fulfilment across 10 or more completed movements",
    },
    verified_claims: 3,
    documented_claims: 1,
    declared_claims: 0,
    expired_claims: 0,
    active_watches: 2,
    total_watches: 2,
    watch_limit: 10,
    seats_used: 1,
    seats_limit: 1,
    plan_tier: "starter",
    network_score: 74.5,
    parasitism_index: 0.82,
  },
  motions: {
    stock_motion: {
      label: "Gear 1 · Stock & Shelf Motion",
      visible_listings: 4,
      total_listings: 5,
      available_units: 120,
      reserved_units: 15,
      open_movements: 2,
      completed_movements: 12,
      certified_listings: 2,
      self_declared_listings: 1,
    },
    collective_motion: {
      label: "Gear 2 · Collective & Flash Lock Motion",
      groups_joined: 2,
      collective_organized: 1,
      active_pledges: 2,
      pledged_units: 40,
      market_zone_locked: true,
      network_lists_available: 3,
    },
    tools_logistics_motion: {
      label: "Gear 3 · Physical Tools & Courier Motion",
      tool_listings: 1,
      tool_bookings: 2,
      shipments: 4,
    },
    opportunity_motion: {
      label: "Gear 4 · Opportunity, Fit & Squad Motion",
      open_requests: 1,
      offers_submitted: 3,
      active_watches: 2,
      watch_limit: 10,
    },
    capital_custody_motion: {
      label: "Gear 5 · Capital, Custody & Chama Motion",
      finance_mode: "conventional",
      payment_intents: 3,
      completed_payments: 2,
      payment_delivery_independent: true,
    },
  },
  entitlements: {
    tier: "starter",
    name: "Starter (Freemium)",
    max_seats: 1,
    max_watches: 10,
    verification_guardrail:
      "Payment unlocks seats, watch capacity and queue SLA priority — it never automatically verifies your account or approves compliance claims.",
  },
  seats: {
    owner_handle: "mama_mboga",
    seats_used: 1,
    seats_limit: 3,
    seats_remaining: 2,
    members: [
      {
        id: "seat-1",
        member_email: "finance@mamamboga.co.ke",
        member_handle: "mboga_fin",
        role: "finance",
        status: "active",
      },
    ],
  },
  program_status: {
    active: true,
    enabled: true,
    end_date: "2027-04-12",
    preserve_existing_records: true,
    allow_outstanding_obligations: true,
    notice: "Six-month rollout window is active.",
  },
  inverted_pyramid: [
    {
      layer: 1,
      stage: "Vertex (1-to-1)",
      name: "The Verified Anchor",
      acquisition_mechanic: "Register @handle, publish visible Stock Room SKUs, and verify core Business Passport claims.",
      earning_mechanic: "Direct B2B shelf sourcing margin and buyer readiness eligibility.",
      route: "/passport",
      active: true,
      live_metric: "4 visible SKU(s) · 3 verified claim(s)",
    },
    {
      layer: 4,
      stage: "Ecosystem & Institutional Pull (Many-to-Ecosystem)",
      name: "Automated Watches, Shortlists & Cooperative Capital",
      acquisition_mechanic: "RequestWatch radars auto-match your verified passport to inbound buyer requests.",
      earning_mechanic: "Institutional contract fulfillment and cooperative trade finance.",
      route: "/work",
      active: true,
      live_metric: "2/10 watch radar(s) · 3 offer(s)",
    },
  ],
  plans: [
    {
      key: "starter",
      name: "Starter (Freemium)",
      price_kes_monthly: 0,
      audience: "Any business getting started",
      max_seats: 1,
      max_watches: 10,
      priority_verification_queue: false,
      features: ["1 seat with @handle"],
      is_current: true,
    },
    {
      key: "readiness",
      name: "Readiness",
      price_kes_monthly: 2900,
      audience: "Suppliers with dated compliance",
      max_seats: 3,
      max_watches: 25,
      priority_verification_queue: true,
      features: ["3 team seats sharing one Business Passport"],
      is_current: false,
    },
  ],
  verified_mark_families: [
    {
      family: "passport_claims",
      title: "Business Passport & Standing Marks",
      source: "modules/standing · VerifiedFacts.jsx",
      marks: [{ key: "verified", label: "Verified", rule: "Named human verifier checked evidence." }],
    },
  ],
  hard_coded_rules: [
    {
      id: "verification",
      title: "Verification cannot be bought",
      rule: "Only authorized human reviewers can approve compliance claims.",
      enforced_in: "app/modules/standing/router.py",
    },
  ],
  six_month_rollout: [
    {
      month: 1,
      window: "Oct–Nov",
      title: "Anchor and stock",
      summary: "Audit current models, implement event logging and idempotent movement transitions.",
      milestone_active: true,
    },
  ],
  acceptance_gates: [
    {
      id: "idempotent_receipt",
      label: "Retrying a received event cannot debit or credit inventory twice.",
    },
  ],
}));

const apiMocks = vi.hoisted(() => ({
  blueprint: vi.fn(() => Promise.resolve({ data: blueprintFixture })),
  changePlan: vi.fn(() => Promise.resolve({ data: { tier: "readiness" } })),
  addSeat: vi.fn(() => Promise.resolve({ data: {} })),
  removeSeat: vi.fn(() => Promise.resolve({ data: {} })),
}));

vi.mock("@/lib/api", () => ({
  apiError: (e, f = "Error") => e?.message || f,
  growthAPI: apiMocks,

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

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector) =>
    selector({
      vendor: { id: "v-1", vendor_handle: "mama_mboga", business_name: "Mama Mboga Fresh" },
      fetchVendor: vi.fn(),
    }),
}));

describe("GrowthPlannerPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the live Business Pulse, Inverted Pyramid, 5-Gear Motions, Plans and Rules", async () => {
    const { default: GrowthPlannerPage } = await import("@/pages/growth/GrowthPlannerPage");
    render(
      <MemoryRouter>
        <GrowthPlannerPage />
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: /business planner & growth engine/i })).toBeInTheDocument();
    expect(screen.getByText("Level 2")).toBeInTheDocument();
    expect(screen.getByText("The Verified Anchor")).toBeInTheDocument();
    expect(screen.getByText("Gear 1 · Stock & Shelf Motion")).toBeInTheDocument();
    expect(screen.getByText("Verification cannot be bought")).toBeInTheDocument();
    expect(screen.getByText("Anchor and stock")).toBeInTheDocument();
    expect(screen.getByText(/retrying a received event cannot debit or credit inventory twice/i)).toBeInTheDocument();

    // Switch to Readiness tier
    fireEvent.click(screen.getByRole("button", { name: /switch to readiness/i }));
    await waitFor(() => expect(apiMocks.changePlan).toHaveBeenCalledWith("readiness"));

    // Add a team seat
    fireEvent.change(screen.getByLabelText(/team member email/i), {
      target: { value: "clerk@mamamboga.co.ke" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add team seat/i }));
    await waitFor(() =>
      expect(apiMocks.addSeat).toHaveBeenCalledWith(
        expect.objectContaining({ member_email: "clerk@mamamboga.co.ke", role: "clerk" })
      )
    );
  });
});
