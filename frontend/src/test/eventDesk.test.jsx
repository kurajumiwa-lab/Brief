import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  vendor: { id: "v-me", vendor_handle: "decor_maker", business_name: "Decor Maker", physical_location: "Kisumu" },
}));

const mocks = vi.hoisted(() => ({
  myRateCard: vi.fn(),
  saveRateCard: vi.fn(),
  savePackages: vi.fn(),
  publicRateCard: vi.fn(),
  openRequests: vi.fn(),
  myRequests: vi.fn(),
  createRequest: vi.fn(),
  request: vi.fn(),
  setRequestStatus: vi.fn(),
  submitQuote: vi.fn(),
  myQuotes: vi.fn(),
  setQuoteStatus: vi.fn(),
  mine: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@/stores/authStore", () => ({ useAuthStore: (selector) => selector(auth) }));
vi.mock("@/lib/eventDeskApi", () => ({ eventDeskAPI: mocks }));
vi.mock("@/lib/api", () => ({
  apiError: (_error, fallback) => fallback,
  eventAPI: { mine: mocks.mine },
}));
vi.mock("@/components/ui/Toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => mocks.confirm }));

import RateCardPage from "@/pages/events/RateCardPage";
import EventDeskPage from "@/pages/events/EventDeskPage";
import PublicRateCardPage from "@/pages/events/PublicRateCardPage";

const request = {
  id: "r1",
  title: "Decor and lighting for a garden wedding",
  category: "decor",
  brief: "We need an arch, aisle flowers and warm reception lighting.",
  budget_min_kes: 90000,
  budget_max_kes: 140000,
  payer: "organizer",
  requirements: { access_time: "From 6:00am", parking: "Two vans inside" },
  response_deadline: "2026-11-20T12:00:00",
  status: "open",
  quote_count: 0,
  my_quote: null,
  can_quote: true,
  event: {
    id: "e1", title: "Kisumu garden wedding", start_date: "2026-11-28T08:00:00",
    location: "Kisumu, Milimani", status: "upcoming",
  },
  organizer: { id: "o1", handle: "wedding_organiser", business_name: "Wedding Organiser" },
};

const card = {
  id: "c1",
  vendor: { id: "v-me", handle: "decor_maker", business_name: "Decor Maker", location: "Kisumu" },
  headline: "Garden weddings, set up before the first guest",
  summary: "Full decor and lighting for 120 guests.",
  event_categories: ["decor", "sound_lighting"],
  proof_links: [{ label: "Last wedding", url: "https://example.com/1", kind: "portfolio", verification: "self_reported" }],
  reach_claims: [{ platform: "TikTok", metric: "views", value: "48K", source: "self_reported" }],
  is_public: true,
  packages: [{
    id: "p1", name: "Ceremony decor", description: "Arch, aisle, chairs.", price_kes: 85000,
    price_unit: "per_event", inclusions: ["Arch", "Aisle flowers"], is_active: true, sort_order: 0,
  }],
  public_url: "/rate-card/decor_maker",
};

describe("Event vendor desk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.confirm.mockResolvedValue(true);
    mocks.myRateCard.mockResolvedValue({ data: { rate_card: null, packages: [] } });
    mocks.saveRateCard.mockResolvedValue({ data: { rate_card: { public_url: "/rate-card/decor_maker" } } });
    mocks.savePackages.mockResolvedValue({ data: { rate_card: { public_url: "/rate-card/decor_maker" } } });
    mocks.openRequests.mockResolvedValue({ data: { requests: [], categories: [] } });
    mocks.myRequests.mockResolvedValue({ data: { requests: [] } });
    mocks.myQuotes.mockResolvedValue({ data: { quotes: [] } });
    mocks.mine.mockResolvedValue({ data: [] });
  });

  it("builds and publishes a rate card in the three-step form", async () => {
    render(<MemoryRouter><RateCardPage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: /Build your rate card/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Headline/i), {
      target: { value: "Garden weddings, set up before the first guest" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Publish$/i }));

    await waitFor(() => expect(mocks.saveRateCard).toHaveBeenCalled());
    expect(mocks.saveRateCard.mock.calls[0][0].headline).toBe("Garden weddings, set up before the first guest");
    expect(mocks.savePackages).toHaveBeenCalled();
  });

  it("answers an open request with a quote", async () => {
    mocks.openRequests.mockResolvedValue({ data: { requests: [request], categories: [] } });
    mocks.myRateCard.mockResolvedValue({ data: { rate_card: card, packages: card.packages } });
    mocks.submitQuote.mockResolvedValue({ data: { quote: { id: "q1" } } });

    render(<MemoryRouter><EventDeskPage /></MemoryRouter>);

    expect(await screen.findByText("Decor and lighting for a garden wedding")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Quote$/i }));

    fireEvent.change(await screen.findByLabelText(/Your price/i), { target: { value: "105000" } });
    fireEvent.change(screen.getByLabelText(/What is included/i), { target: { value: "Arch, aisle flowers, delivery" } });
    fireEvent.click(screen.getByRole("button", { name: /Send quote/i }));

    await waitFor(() => expect(mocks.submitQuote).toHaveBeenCalled());
    expect(mocks.submitQuote.mock.calls[0][0]).toBe("r1");
    expect(mocks.submitQuote.mock.calls[0][1].amount_kes).toBe(105000);
    expect(mocks.submitQuote.mock.calls[0][1].inclusions).toEqual(["Arch", "aisle flowers", "delivery"]);
  });

  it("shows an organiser the quotes and records an acceptance", async () => {
    mocks.myRequests.mockResolvedValue({ data: { requests: [{ ...request, quote_count: 1, can_quote: false }] } });
    mocks.request.mockResolvedValue({
      data: {
        ...request,
        status: "open",
        quotes: [{
          id: "q1", request_id: "r1", amount_kes: 105000, status: "submitted",
          vendor: { id: "v1", handle: "decor_studio", business_name: "Decor Studio" },
          message: "We can do the whole setup.", inclusions: ["Arch", "Lighting"],
          vendor_contact: null,
        }],
      },
    });
    mocks.setQuoteStatus.mockResolvedValue({ data: { quote: { id: "q1", status: "accepted" } } });

    render(<MemoryRouter><EventDeskPage /></MemoryRouter>);
    await screen.findByRole("tab", { name: /My requests/i });
    fireEvent.click(screen.getByRole("tab", { name: /My requests/i }));
    fireEvent.click(await screen.findByRole("button", { name: /View quotes/i }));

    expect(await screen.findByText("Decor Studio")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Accept & book/i }));

    await waitFor(() => expect(mocks.setQuoteStatus).toHaveBeenCalledWith("q1", "accepted"));
    expect(mocks.confirm).toHaveBeenCalled();
  });

  it("reads a public rate card and labels reach as self-reported", async () => {
    mocks.publicRateCard.mockResolvedValue({ data: card });

    render(
      <MemoryRouter initialEntries={["/rate-card/decor_maker"]}>
        <Routes><Route path="/rate-card/:handle" element={<PublicRateCardPage />} /></Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: "Decor Maker" })).toBeInTheDocument();
    expect(screen.getByText("Ceremony decor")).toBeInTheDocument();
    expect(screen.getByText(/Self-reported means/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ask for a quote/i })).toBeInTheDocument();
  });
});
