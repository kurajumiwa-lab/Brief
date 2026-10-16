import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const catalogue = vi.hoisted(() => ({
  price_honesty: "All prices are test ranges to validate with buyers.",
  verification_note: "Verification is a separate state and is never sold or bundled with a paid tier.",
  sell_tomorrow: ["Publish three offers first"],
  trial: {
    status: "not_yet_live",
    status_note: "No card is asked for and no charge is made.",
    card_rules: ["Never collect card details directly — provider-hosted checkout only"],
    alternative_to_test: "Test it against a shorter, capped trial without a card.",
    example: { first_charge_amount_kes: 6500, first_charge_date: "2026-11-13", trial_days: 30, reminder_days_before_charge: 3, amount_basis: "Test price for the Business tier." },
  },
  byod_vs_managed: [
    { key: "byod", name: "Bring Your Own Device (BYOD)", headline: "Officers use their own phones.", includes: ["Work profile"], limits: ["The whole device can never be wiped"] },
    { key: "fully_managed", name: "Fully managed, company-owned devices", headline: "Central controls.", includes: ["Remote lock through the EMM"], limits: ["Hardware quoted separately"] },
  ],
  account_tiers: [
    { key: "junior", name: "Junior", label: "Junior — Free account", price_min_kes: 0, price_max_kes: 0, purpose: "Marketplace supply.", includes: ["One basic public profile"], excludes: ["No team management"] },
    { key: "professional", name: "Professional", label: "Professional account", price_min_kes: 500, price_max_kes: 1500, purpose: "Discovery.", includes: ["Enquiry tracking"], excludes: [] },
    { key: "business", name: "Business", label: "Business account", price_min_kes: 3000, price_max_kes: 10000, purpose: "Active businesses.", includes: ["Private workspace"], excludes: [] },
    { key: "enterprise", name: "Enterprise", label: "Enterprise account", price_min_kes: null, price_max_kes: null, purpose: "Larger contracts.", includes: ["Field-agent management"], excludes: [] },
  ],
  lines: [
    {
      key: "digital_services", title: "A. Digital services", badge: "Sell immediately", terms: "One-off purchases",
      note: "Delivered as productised services.",
      offers: [{ key: "business_website", name: "Business website", price_min_kes: 15000, price_max_kes: 45000, price_unit: "one_off", readiness: "service", readiness_note: "Productised studio service.", turnaround: "2–4 weeks", deliverables: ["Up to 5 pages"], exclusions: ["E-commerce checkout"], customer_must_provide: ["Text and photos"], revisions: "Two rounds." }],
    },
    {
      key: "business_software", title: "B. Business software", badge: "Recurring revenue", terms: "Subscriptions",
      note: "Only what is operational is self-serve.",
      offers: [{ key: "membership_management", name: "Membership management", price_min_kes: 5000, price_max_kes: 15000, price_unit: "monthly", readiness: "pilot", readiness_note: "Workspace register is built.", turnaround: "3 working days", deliverables: ["Member register"], exclusions: ["Bulk SMS"], customer_must_provide: ["Member list"] }],
    },
    {
      key: "field_operations", title: "C. Field operations", badge: "Setup + monthly fee", terms: "Field teams",
      note: "Hardware charged separately.",
      offers: [{ key: "agent_workflow_management", name: "Agent workflow management", price_min_kes: 3000, price_max_kes: 10000, price_unit: "monthly", readiness: "pilot", readiness_note: "BYOD-first.", turnaround: "5 working days", deliverables: ["Supervisor dashboard"], exclusions: ["Officer salaries"], customer_must_provide: ["Officer list"] }],
    },
  ],
  offers: [],
}));
catalogue.offers = catalogue.lines.flatMap((l) => l.offers);

const apiMocks = vi.hoisted(() => ({
  catalogue: vi.fn(() => Promise.resolve({ data: catalogue })),
  createEnquiry: vi.fn(() => Promise.resolve({ data: {} })),
  myEnquiries: vi.fn(() => Promise.resolve({ data: [] })),
}));

vi.mock("@/lib/api", () => ({
  apiError: (e, f = "Error") => e?.message || f,
  catalogAPI: apiMocks,

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
  useAuthStore: (selector) => selector({ token: null }),
}));

describe("StorefrontPage", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("renders the three lines, test prices, Junior tier and honest trial", async () => {
    const { default: StorefrontPage } = await import("@/pages/storefront/StorefrontPage");
    render(
      <MemoryRouter>
        <StorefrontPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: /sell what businesses already buy/i })).toBeInTheDocument();
    expect(screen.getByText("A. Digital services")).toBeInTheDocument();
    expect(screen.getByText("B. Business software")).toBeInTheDocument();
    expect(screen.getByText("C. Field operations")).toBeInTheDocument();
    expect(screen.getAllByText(/KSh 15,000–45,000/).length).toBeGreaterThan(0);
    expect(screen.getByText("Junior — Free account")).toBeInTheDocument();
    expect(screen.getByText(/never sold/i)).toBeInTheDocument();
    // Trial: exact example disclosure, and it is not live yet.
    expect(screen.getByText(/KSh 6,500/)).toBeInTheDocument();
    expect(screen.getByText("2026-11-13")).toBeInTheDocument();
    expect(screen.getByText(/Not yet live — trial requests only/)).toBeInTheDocument();
    // BYOD limits are printed, not hidden.
    expect(screen.getByText("The whole device can never be wiped")).toBeInTheDocument();
    // Signed out: the enquiry route asks for sign-in rather than faking checkout.
    expect(screen.getByRole("button", { name: /sign in to enquire/i })).toBeInTheDocument();
  });

  it("honours a deep link to one offer from a home shelf card", async () => {
    const { default: StorefrontPage } = await import("@/pages/storefront/StorefrontPage");
    render(
      <MemoryRouter initialEntries={["/storefront?offer=business_website"]}>
        <Routes>
          <Route path="/storefront" element={<StorefrontPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // the offer the feed linked to is the one already chosen — every other one is not
    await screen.findByRole("heading", { name: /sell what businesses already buy/i });
    const pressed = (name) =>
      screen
        .getAllByRole("button", { name })
        .filter((b) => b.getAttribute("aria-pressed") === "true").length;
    expect(pressed(/business website/i)).toBe(1);
    expect(pressed(/membership management/i)).toBe(0);
  });
});
