import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import MarketOpportunitiesPage from "@/pages/market/MarketOpportunitiesPage";

const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), close: vi.fn(), directRoom: vi.fn() }));
vi.mock("@/lib/api", () => ({ marketOpportunitiesAPI: mocks, chatAPI: { directRoom: mocks.directRoom }, apiError: (_e, fallback) => fallback }));
const card = { id: "1", title: "Beans available", location: "Busia", quantity: "100", unit: "90 kg bag", price_kes: "5000", updated_at: "2026-11-27T10:00:00Z", seller: { id: "s1", name: "Amina", handle: "amina" }, is_owner: false };
function Probe() { const location = useLocation(); return <div>Chat {location.search}</div>; }
function renderPage() { return render(<MemoryRouter initialEntries={["/market-opportunities"]}><Routes><Route path="/market-opportunities" element={<MarketOpportunitiesPage />} /><Route path="/chat" element={<Probe />} /></Routes></MemoryRouter>); }
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue({ data: { items: [], next_offset: null } }); mocks.create.mockResolvedValue({ data: card }); mocks.directRoom.mockResolvedValue({ data: { room_id: "room-1" } }); });

describe("market opportunities", () => {
  it("publishes required fields and displays the returned quote", async () => {
    renderPage();
    await screen.findByText(/No opportunities found/);
    for (const [label, value] of [["Opportunity", "Beans available"], ["Market or town", "Busia"], ["Quantity available", "100"], ["Unit (what the price buys)", "90 kg bag"], ["Asking price per unit (KSh)", "5000"]]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    mocks.list.mockResolvedValue({ data: { items: [card], next_offset: null } });
    fireEvent.click(screen.getByRole("button", { name: "Publish opportunity" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ title: "Beans available", location: "Busia", quantity: "100", unit: "90 kg bag", price_kes: "5000" }));
    expect(await screen.findByText("Beans available")).toBeInTheDocument();
    expect(screen.getByText(/Seller quote, not independently verified/)).toBeInTheDocument();
  });
  it("opens a real direct chat when a buyer enquires", async () => {
    mocks.list.mockResolvedValue({ data: { items: [card], next_offset: null } }); renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Enquire in chat/ }));
    expect(await screen.findByText("Chat ?room=room-1")).toBeInTheDocument();
    expect(mocks.directRoom).toHaveBeenCalledWith("s1");
  });
});
