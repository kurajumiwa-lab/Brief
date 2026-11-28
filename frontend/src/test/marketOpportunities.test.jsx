import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import MarketOpportunitiesPage from "@/pages/market/MarketOpportunitiesPage";

const mocks = vi.hoisted(() => ({ list: vi.fn(), mine: vi.fn(), metrics: vi.fn(), create: vi.fn(), edit: vi.fn(), renew: vi.fn(), status: vi.fn(), enquiry: vi.fn() }));
vi.mock("@/lib/api", () => ({ marketOpportunitiesAPI: mocks, apiError: (_e, fallback) => fallback }));
const card = { id: "1", title: "Beans available", location: "Busia", quantity: "100", unit: "90 kg bag", price_kes: "5000", updated_at: "2026-11-27T10:00:00Z", seller: { id: "s1", name: "Amina", handle: "amina" }, is_owner: false, status: "available", visible_to_others: true };
function Probe() { const location = useLocation(); return <div>Chat {location.search}<p>{location.state?.opportunityDraft?.text}</p></div>; }
function renderPage(path = "/market-opportunities") { return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/market-opportunities" element={<MarketOpportunitiesPage />} /><Route path="/chat" element={<Probe />} /></Routes></MemoryRouter>); }
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue({ data: { items: [], next_offset: null } }); mocks.mine.mockResolvedValue({ data: { items: [], next_offset: null } }); mocks.metrics.mockResolvedValue({ data: { items: [] } }); mocks.create.mockResolvedValue({ data: card }); mocks.enquiry.mockResolvedValue({ data: { room_id: "room-1", opportunity: card } }); });

describe("market opportunities", () => {
  it("publishes required fields and displays the returned quote in My opportunities", async () => {
    renderPage(); await screen.findByText(/No opportunities found/);
    for (const [label, value] of [["Opportunity", "Beans available"], ["Market or town", "Busia"], ["Quantity available", "100"], ["Unit (what the price buys)", "90 kg bag"], ["Asking price per unit (KSh)", "5000"]]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    mocks.mine.mockResolvedValue({ data: { items: [{ ...card, is_owner: true }], next_offset: null } });
    fireEvent.click(screen.getByRole("button", { name: "Publish opportunity" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ title: "Beans available", location: "Busia", quantity: "100", unit: "90 kg bag", price_kes: "5000" }));
    expect(await screen.findByText("Beans available")).toBeInTheDocument();
    expect(screen.getByText(/Seller quote, not independently verified/)).toBeInTheDocument();
  });
  it("opens a chat with an unsent, current opportunity draft", async () => {
    mocks.list.mockResolvedValue({ data: { items: [card], next_offset: null } }); renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Enquire in chat/ }));
    expect(await screen.findByText("Chat ?room=room-1")).toBeInTheDocument();
    expect(screen.getByText(/Beans available in Busia.*KSh 5,000/)).toBeInTheDocument();
    expect(mocks.enquiry).toHaveBeenCalledWith("1");
  });
  it("filters by market, and lets the owner edit and explicitly renew expired quotes", async () => {
    const owner = { ...card, is_owner: true, stale: true, status: "unavailable", visible_to_others: false };
    mocks.mine.mockResolvedValue({ data: { items: [owner], next_offset: null } });
    mocks.renew.mockResolvedValue({ data: { ...owner, status: "available", stale: false, visible_to_others: true } });
    renderPage(); await screen.findByText(/No opportunities found/);
    fireEvent.change(screen.getByLabelText("Filter by market or town"), { target: { value: "Busia" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith({ q: "", market: "Busia" }));
    fireEvent.click(screen.getByRole("button", { name: "My opportunities" }));
    const listing = await screen.findByTestId("market-opportunity-card");
    expect(within(listing).getByText(/Expired/)).toBeInTheDocument();
    fireEvent.click(within(listing).getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Asking price per unit (KSh)")).toHaveValue(5000);
    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));
    fireEvent.click(within(listing).getByRole("button", { name: "Confirm & renew" }));
    expect(mocks.renew).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, confirm and renew" }));
    await waitFor(() => expect(mocks.renew).toHaveBeenCalledWith("1"));
    expect(await within(listing).findByText("Available")).toBeInTheDocument();
  });
  it("saves an edited quote and changes reservation without renewing the price", async () => {
    const owner = { ...card, is_owner: true, stale: false };
    mocks.mine.mockResolvedValue({ data: { items: [owner], next_offset: null } });
    mocks.edit.mockResolvedValue({ data: { ...owner, price_kes: "5500" } });
    mocks.status.mockResolvedValue({ data: { ...owner, price_kes: "5500", status: "reserved" } });
    renderPage("/market-opportunities?view=mine");
    let listing = await screen.findByTestId("market-opportunity-card");
    fireEvent.click(within(listing).getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Asking price per unit (KSh)"), { target: { value: "5500" } });
    mocks.mine.mockResolvedValue({ data: { items: [{ ...owner, price_kes: "5500" }], next_offset: null } });
    fireEvent.click(screen.getByRole("button", { name: "Save and confirm details" }));
    await waitFor(() => expect(mocks.edit).toHaveBeenCalledWith("1", expect.objectContaining({ price_kes: "5500" })));
    listing = await screen.findByTestId("market-opportunity-card");
    fireEvent.click(within(listing).getByRole("button", { name: "Mark reserved" }));
    await waitFor(() => expect(mocks.status).toHaveBeenCalledWith("1", "reserved"));
    expect(await within(listing).findByText("Reserved")).toBeInTheDocument();
    expect(mocks.renew).not.toHaveBeenCalled();
  });

});
