import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SpottedDealCard } from "@/components/spotted/SpottedDealUI";
import CorridorJuryCard from "@/components/spotted/CorridorJuryCard";
vi.mock("@/lib/api", () => ({ apiError: () => "error", fileAPI: {}, spottedDealAPI: { seen: vi.fn().mockResolvedValue({}), vote: vi.fn().mockResolvedValue({}) } }));
vi.mock("@/lib/receiptsApi", () => ({ receiptsAPI: { ledger: vi.fn().mockResolvedValue({data:{receipts:[]}}) } }));
vi.mock("@/components/ui/Toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("spotted deals", () => {
  it("labels receipt links honestly and records a seen tap", async () => {
    const refresh=vi.fn();
    render(<MemoryRouter><SpottedDealCard onChanged={refresh} deal={{id:"1",status:"RECEIPT_LINKED",image_url:"/photo",title:"Sale",merchant_name:"Shop",town:"Kisumu",seen_in_store_count:1,expires_at:"2030-01-01T00:00:00Z"}} /></MemoryRouter>);
    expect(screen.getByText("Parsed Receipt Linked")).toBeInTheDocument();
    expect(screen.getByText(/Not KRA-verified; awards no standing credit/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Seen in store (1)"));
    await waitFor(()=>expect(refresh).toHaveBeenCalled());
  });
  it("shows per-decision tallies and deadline rather than votes-cast progress", () => {
    render(<CorridorJuryCard assignment={{deal_id:"1",title:"Sale",merchant_name:"Shop",town:"Kisumu",deal_image_url:"/x",review_deadline:"2030-01-01T00:00:00Z",redacted_receipt:{merchant_record_matched:true,issued_after_opt_out:true},votes:{uphold_opt_out:1,uphold_deal:0}}} onChanged={vi.fn()} />);
    expect(screen.getByText(/Remove: 1\/2 · Restore: 0\/2/)).toBeInTheDocument();
    expect(screen.getByText(/does not prove a transaction/)).toBeInTheDocument();
  });
});
