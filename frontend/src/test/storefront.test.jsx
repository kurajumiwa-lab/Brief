/**
 * THE BUSINESS DESK — a guided purchase, not a catalogue to read.
 *
 * These specs replace the v2.14 storefront specs. The old page was one long
 * document: twelve offers, four tiers, a trial, a BYOD comparison and an
 * enquiry form, all visible at once. Everything in it was true, and it asked a
 * buyer to find their own problem inside our product structure.
 *
 * The promises that survive, and the new ones:
 *
 *   1. the first thing asked is "what does your business need" — five needs,
 *      one line each, no prices on that screen;
 *   2. picking one shows ONLY that need's services (the second screen changes);
 *   3. a service shows its own scope and exactly one permitted next step, which
 *      the server decides from readiness — a pilot is never sold as a purchase;
 *   4. prices are still test ranges, the trial is still not live, and no card
 *      is ever collected;
 *   5. nothing was deleted: accounts, tiers, trial and BYOD are one press away;
 *   6. a buyer who does not know their category can describe the need instead.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.setConfig({ testTimeout: 20000 });

const ok = (data) => Promise.resolve({ data });

const offer = (over = {}) => ({
  key: "business_website",
  line: "digital_services",
  desk: "digital_services",
  name: "Business website",
  price_min_kes: 15000,
  price_max_kes: 45000,
  price_unit: "one_off",
  readiness: "service",
  readiness_note: "Productised studio service.",
  turnaround: "2–4 weeks",
  deliverables: ["Up to 5 pages", "Mobile-friendly build"],
  exclusions: ["E-commerce checkout"],
  customer_must_provide: ["Text, prices and photos"],
  revisions: "Two revision rounds per milestone.",
  cta: { kind: "quotation", label: "Request a quotation", note: "A written quotation fixes scope." },
  ...over,
});

const DESKS = [
  { key: "digital_services", title: "Digital services", blurb: "Websites, branding, design and automation.", enquiry_only: false, offer_count: 2, offers: [] },
  { key: "business_software", title: "Business software", blurb: "Business records, memberships and workspaces.", enquiry_only: false, offer_count: 1, offers: [] },
  { key: "field_operations", title: "Field operations", blurb: "Field teams, mobile forms and reporting.", enquiry_only: false, offer_count: 1, offers: [] },
  { key: "device_management", title: "Device management", blurb: "Android deployment and device administration.", enquiry_only: false, offer_count: 1, offers: [] },
  { key: "custom", title: "Custom business solutions", blurb: "Tell us what your organisation needs.", enquiry_only: true, offer_count: 0, offers: [] },
];

const OFFERS = [
  offer(),
  offer({ key: "logo_brand_starter", name: "Logo and brand starter package", price_min_kes: 2500, price_max_kes: 8000, turnaround: "3–5 working days", cta: { kind: "quotation", label: "Request a quotation", note: "" } }),
  offer({ key: "membership_management", desk: "business_software", name: "Membership management", price_min_kes: 5000, price_max_kes: 15000, price_unit: "monthly", readiness: "pilot", cta: { kind: "pilot", label: "Request pilot participation", note: "Sold as a supervised pilot." } }),
  offer({ key: "agent_workflow_management", desk: "field_operations", name: "Agent workflow management", price_min_kes: 3000, price_max_kes: 10000, price_unit: "monthly", readiness: "pilot", cta: { kind: "pilot", label: "Request pilot participation", note: "" } }),
  offer({ key: "android_device_enrolment", desk: "device_management", name: "Android device enrolment and configuration", price_min_kes: null, price_max_kes: null, price_unit: "scoped", readiness: "scoped", cta: { kind: "requirements", label: "Submit requirements", note: "No public price." } }),
];

const catalogue = {
  price_honesty: "All prices are test ranges to validate with buyers.",
  verification_note: "Verification is a separate state and is never sold or bundled with a paid tier.",
  sell_tomorrow: ["Publish three offers first"],
  desks: DESKS.map((d) => ({ ...d, offers: OFFERS.filter((o) => o.desk === d.key) })),
  offers: OFFERS,
  trial: {
    status: "not_yet_live",
    status_note: "No card is asked for and no charge is made.",
    card_rules: ["Never collect card details directly — provider-hosted checkout or provider tokenisation only"],
    alternative_to_test: "Test a shorter capped trial.",
    example: { first_charge_amount_kes: 6500, first_charge_date: "2026-11-13", trial_days: 30, reminder_days_before_charge: 3, amount_basis: "Business tier test price." },
  },
  byod_vs_managed: [
    { key: "byod", name: "Bring Your Own Device (BYOD)", headline: "Officers use their own phones.", includes: ["Work profile"], limits: ["The whole device can never be wiped"] },
    { key: "fully_managed", name: "Fully managed, company-owned devices", headline: "Central controls.", includes: ["Remote lock through the EMM"], limits: ["Hardware quoted separately"] },
  ],
  account_tiers: [
    { key: "junior", name: "Junior", label: "Junior — Free account", price_min_kes: 0, price_max_kes: 0, purpose: "Marketplace supply." },
    { key: "business", name: "Business", label: "Business account", price_min_kes: 3000, price_max_kes: 10000, purpose: "Active businesses." },
    { key: "enterprise", name: "Enterprise", label: "Enterprise account", price_min_kes: null, price_max_kes: null, purpose: "Larger contracts." },
  ],
};

const mocks = vi.hoisted(() => ({
  catalogue: vi.fn(),
  createEnquiry: vi.fn(),
  myEnquiries: vi.fn(),
  inbox: vi.fn(),
  setEnquiryStatus: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiError: (e, f = "Error") => e?.message || f,
  catalogAPI: {
    catalogue: mocks.catalogue,
    createEnquiry: mocks.createEnquiry,
    myEnquiries: mocks.myEnquiries,
    inbox: mocks.inbox,
    setEnquiryStatus: mocks.setEnquiryStatus,
  },
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector) => selector({ token: "tok" }),
}));

beforeEach(() => {
  // Each spec starts a fresh "visit", so the picker's once-per-session rule is
  // explicit rather than an accident of test order.
  try { sessionStorage.clear(); } catch { /* no storage in this env */ }
  mocks.catalogue.mockReset().mockImplementation(() => ok(catalogue));
  mocks.createEnquiry.mockReset().mockImplementation(() => ok({ id: "e1", next_step: "No payment has been taken" }));
  mocks.myEnquiries.mockReset().mockImplementation(() => ok([]));
  mocks.inbox.mockReset().mockImplementation(() => ok({ items: [], count: 0, by_desk: [], unpicked: 0, note: "An enquiry is a lead." }));
  mocks.setEnquiryStatus.mockReset().mockImplementation((id, status) => ok({ id, status }));
});

async function renderDesk(path = "/storefront") {
  const { default: BusinessDeskPage } = await import("@/pages/storefront/BusinessDeskPage");
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/storefront" element={<BusinessDeskPage />} />
        <Route path="/storefront/inbox" element={<div>inbox route</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("1 · the desk asks what the business needs", () => {
  it("opens the need picker instead of the long catalogue", async () => {
    await renderDesk();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/what does your business need/i)).toBeInTheDocument();

    // Five needs, one line each, and NOT a wall of prices on the first screen.
    for (const desk of DESKS) {
      expect(within(dialog).getByTestId(`desk-${desk.key}`)).toBeInTheDocument();
      expect(within(dialog).getByText(desk.blurb)).toBeInTheDocument();
    }
    expect(within(dialog).queryByText(/KSh/)).not.toBeInTheDocument();
  });

  it("does not re-open the popup on every return inside the session", async () => {
    // Second visit: the flag the first visit set is still there.
    try { sessionStorage.setItem("brief.desk.pickerSeen", "1"); } catch { /* ignore */ }
    await renderDesk();
    await screen.findByRole("heading", { name: /what does your business need/i });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // ...and the same five doors are still on the page underneath.
    expect(screen.getByTestId("desk-digital_services")).toBeInTheDocument();
    expect(screen.getByTestId("desk-custom")).toBeInTheDocument();
  });
});

describe("2 · the second screen changes with the choice", () => {
  it("shows only the services that answer the chosen need", async () => {
    await renderDesk("/storefront?desk=digital_services");

    const section = await screen.findByTestId("desk-services");
    expect(section).toHaveAttribute("data-desk", "digital_services");
    expect(within(section).getByTestId("service-business_website")).toBeInTheDocument();
    expect(within(section).getByTestId("service-logo_brand_starter")).toBeInTheDocument();
    // A pilot from another desk is not offered on this one.
    expect(within(section).queryByTestId("service-membership_management")).not.toBeInTheDocument();
  });

  it("turns the catch-all need into a form, not an empty list", async () => {
    await renderDesk("/storefront?desk=custom");
    const section = await screen.findByTestId("desk-services");
    expect(within(section).getByTestId("desk-request-form")).toBeInTheDocument();
    expect(within(section).queryByTestId("service-business_website")).not.toBeInTheDocument();
  });

  it("lets a buyer who cannot name a category describe the need", async () => {
    await renderDesk();
    const search = await screen.findByTestId("desk-search");
    fireEvent.change(search, { target: { value: "website" } });

    await waitFor(() => expect(screen.getByTestId("desk-match-business_website")).toBeInTheDocument());

    fireEvent.change(search, { target: { value: "solar fridge financing" } });
    await waitFor(() => expect(screen.getByTestId("desk-no-match")).toBeInTheDocument());
    expect(screen.getByText(/send it to a human/i)).toBeInTheDocument();
  });
});

describe("3 · a service shows its own scope and ONE next step", () => {
  it("prints what you get, what we need and what is excluded", async () => {
    await renderDesk("/storefront?desk=digital_services&offer=business_website");

    const detail = await screen.findByTestId("service-detail");
    expect(detail).toHaveAttribute("data-offer", "business_website");
    expect(within(detail).getByRole("heading", { name: "Business website" })).toBeInTheDocument();
    expect(within(detail).getByText("What your business gets")).toBeInTheDocument();
    expect(within(detail).getByText("What we need from you")).toBeInTheDocument();
    expect(within(detail).getByText("Not included")).toBeInTheDocument();
    expect(within(detail).getByText("E-commerce checkout")).toBeInTheDocument();
    expect(within(detail).getByText("KSh 15,000–45,000")).toBeInTheDocument();
  });

  it("offers the action the server allowed, not a generic buy button", async () => {
    await renderDesk("/storefront?desk=business_software&offer=membership_management");
    const cta = await screen.findByTestId("service-cta");
    // A pilot cannot be purchased: the label is the pilot's own.
    expect(cta).toHaveTextContent(/request pilot participation/i);
    expect(cta).not.toHaveTextContent(/purchase/i);
  });

  it("asks for requirements when there is no published price", async () => {
    await renderDesk("/storefront?desk=device_management&offer=android_device_enrolment");
    expect(await screen.findByTestId("service-cta")).toHaveTextContent(/submit requirements/i);
    // "Scoped quotation" appears on the price line and on the readiness chip —
    // both say the same thing, which is the point.
    expect(screen.getAllByText(/scoped quotation/i).length).toBeGreaterThan(0);
  });

  it("sends the request with the offer, its desk and the permitted kind", async () => {
    await renderDesk("/storefront?desk=digital_services&offer=business_website");
    fireEvent.click(await screen.findByTestId("service-cta"));

    const form = await screen.findByTestId("desk-request-form");
    fireEvent.change(within(form).getByTestId("desk-organisation"), { target: { value: "Milimani Cereals" } });
    fireEvent.change(within(form).getByTestId("desk-notes"), { target: { value: "Five pages, English and Kiswahili." } });
    fireEvent.click(within(form).getByTestId("desk-submit"));

    await waitFor(() => expect(mocks.createEnquiry).toHaveBeenCalledTimes(1));
    expect(mocks.createEnquiry.mock.calls[0][0]).toMatchObject({
      kind: "quotation",
      offer_key: "business_website",
      desk_key: "digital_services",
      organisation_name: "Milimani Cereals",
    });
  });
});

describe("4 · the guarantees did not move", () => {
  it("still says the prices are test ranges and no card is collected", async () => {
    await renderDesk("/storefront?desk=digital_services");
    expect(await screen.findByText(/prices are test ranges, not commitments/i)).toBeInTheDocument();
    expect(screen.getAllByText(/test price/i).length).toBeGreaterThan(0);
  });

  it("keeps the trial disclosure and refuses to pretend it is live", async () => {
    await renderDesk("/storefront?view=accounts");
    const view = await screen.findByTestId("desk-accounts");
    expect(within(view).getByText(/not yet live — trial requests only/i)).toBeInTheDocument();
    expect(within(view).getAllByText(/KSh 6,500/).length).toBeGreaterThan(0);
    expect(within(view).getByText("2026-11-13")).toBeInTheDocument();
    // The BYOD limit is still printed, not softened.
    expect(within(view).getByText("The whole device can never be wiped")).toBeInTheDocument();
    expect(within(view).getByText("Junior — Free account")).toBeInTheDocument();
  });

  it("never offers a checkout, only a request", async () => {
    await renderDesk("/storefront?desk=digital_services&offer=business_website");
    fireEvent.click(await screen.findByTestId("service-cta"));
    const form = await screen.findByTestId("desk-request-form");
    expect(within(form).queryByText(/pay now|checkout|card number/i)).not.toBeInTheDocument();
    expect(within(form).getByText(/no card, no charge/i)).toBeInTheDocument();
  });
});

describe("5 · the operator side is separate from the customer side", () => {
  it("shows a request in the inbox with its desk and moves it along", async () => {
    mocks.inbox.mockResolvedValue(ok({
      items: [{
        id: "e1", offer_key: "business_website", offer_name: "Business website",
        desk_key: "digital_services", desk_title: "Digital services",
        kind: "quotation", status: "new", vendor_handle: "milimani",
        vendor_business: "Milimani Cereals", organisation_name: "Milimani Cereals",
        notes: "Five pages.",
      }],
      count: 1, by_desk: [{ key: "digital_services", title: "Digital services", count: 1 }],
      unpicked: 1, note: "An enquiry is a lead with the offer's fixed scope attached — never a payment.",
    }));

    const { default: EnquiryInboxPage } = await import("@/pages/storefront/EnquiryInboxPage");
    render(
      <MemoryRouter initialEntries={["/storefront/inbox"]}>
        <Routes><Route path="/storefront/inbox" element={<EnquiryInboxPage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Business website")).toBeInTheDocument();
    expect(screen.getByText("Digital services")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "contacted" }));
    await waitFor(() => expect(mocks.setEnquiryStatus).toHaveBeenCalledWith("e1", "contacted"));
  });

  it("says plainly that a non-operator cannot see the inbox", async () => {
    mocks.inbox.mockRejectedValue({ response: { status: 403 } });

    const { default: EnquiryInboxPage } = await import("@/pages/storefront/EnquiryInboxPage");
    render(
      <MemoryRouter initialEntries={["/storefront/inbox"]}>
        <Routes><Route path="/storefront/inbox" element={<EnquiryInboxPage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("inbox-forbidden")).toBeInTheDocument();
    // Not an empty table pretending there are no enquiries.
    expect(screen.queryByTestId("inbox-empty")).not.toBeInTheDocument();
  });
});
