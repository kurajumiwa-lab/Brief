import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CampaignMarketplacePage from "@/pages/campaigns/CampaignMarketplacePage";
import { campaignsAPI } from "@/lib/api";
vi.mock("@/stores/chatStore", () => ({ useChatStore: (selector) => selector({ openDirect: vi.fn() }) }));
vi.mock("@/lib/api", () => ({ campaignsAPI: { browse: vi.fn(), myOffers: vi.fn(), detail: vi.fn(), create: vi.fn(), offer: vi.fn(), close: vi.fn(), action: vi.fn() }, apiError: (_e, fallback) => fallback }));
const campaign = { id: "c1", title: "Promote bags", brief: "Two videos", location: "Nairobi", budget_kes: 5000, status: "open", is_owner: false, owner: { id: "v1", name: "Shop", handle: "shop" } };
beforeEach(() => { vi.clearAllMocks(); campaignsAPI.browse.mockResolvedValue({ data: { items: [campaign], next_offset: null } }); campaignsAPI.myOffers.mockResolvedValue({ data: { items: [] } }); campaignsAPI.detail.mockResolvedValue({ data: { campaign, offers: [] } }); });
describe("marketing marketplace", () => {
  it("allows a creator to review and submit a priced proposal", async () => {
    campaignsAPI.offer.mockResolvedValue({ data: {} });
    render(<MemoryRouter><CampaignMarketplacePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Promote bags" }));
    expect(await screen.findByText("Two videos")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Proposal and deliverables/), { target: { value: "Two edited videos" } });
    fireEvent.change(screen.getByLabelText(/Your price/), { target: { value: "4500" } });
    fireEvent.click(screen.getByRole("button", { name: "Send offer" }));
    await waitFor(() => expect(campaignsAPI.offer).toHaveBeenCalledWith("c1", { message: "Two edited videos", price_kes: 4500 }));
  });
  it("posts a campaign only on explicit submit", async () => {
    campaignsAPI.create.mockResolvedValue({ data: { id: "c1" } });
    render(<MemoryRouter><CampaignMarketplacePage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Campaign title/), { target: { value: "Launch" } });
    fireEvent.change(screen.getByLabelText(/What do you need/), { target: { value: "A video" } });
    fireEvent.change(screen.getByLabelText(/Location or online/), { target: { value: "Kisumu" } });
    fireEvent.change(screen.getByLabelText(/Budget/), { target: { value: "3000" } });
    expect(campaignsAPI.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Post campaign" }));
    await waitFor(() => expect(campaignsAPI.create).toHaveBeenCalledWith({ title: "Launch", brief: "A video", location: "Kisumu", budget_kes: 3000 }));
  });
});
