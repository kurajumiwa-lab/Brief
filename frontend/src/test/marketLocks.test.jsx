import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import MarketLocks from "@/pages/locks/MarketLocks";

vi.mock("@/lib/api", () => ({
  locksAPI: {
    home: vi.fn(), submitPick: vi.fn(), assignZone: vi.fn(), withdrawPick: vi.fn(), opsBoard: vi.fn(),
  },
  apiError: (error, fallback) => error?.message || fallback,
}));

import { locksAPI } from "@/lib/api";

const makeHome = () => {
  const now = Date.now();
  return {
    vendor_zone: { id: "zone-1", name: "Gikomba A", city: "Nairobi", walkable_ring: "1 km walkable ring" },
    can_change_zone: true,
    zone_change_available_at: null,
    zones: [{ id: "zone-1", name: "Gikomba A", city: "Nairobi" }],
    catalog: [{ id: "product-1", name: "Tomatoes", unit_of_measure: "crates", supplier_count: 2, minimum_to_bid: 9 }],
    windows: [{
      id: "window-1", local_date: new Date().toISOString().slice(0, 10),
      opens_at: new Date(now - 60_000).toISOString(), closes_at: new Date(now + 60 * 60_000).toISOString(),
      delivery_at: new Date(now + 2 * 60 * 60_000).toISOString(), status: "open", roll_count: 0, clusters: [],
    }],
    market_ops_role: null,
  };
};

describe("Market Locks vendor desk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    locksAPI.home.mockResolvedValue({ data: makeHome() });
    locksAPI.submitPick.mockResolvedValue({ data: { message: "saved" } });
  });

  it("shows the vendor's local zone, threshold information, and submits a quantity", async () => {
    render(<MarketLocks />);

    expect(await screen.findByText("Market Locks")).toBeInTheDocument();
    expect(screen.getByText("Gikomba A")).toBeInTheDocument();
    expect(screen.getByText(/lowest configured 85% MOQ threshold is 9 crates/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Quantity (crates)"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: /Lock request/i }));
    await waitFor(() => expect(locksAPI.submitPick).toHaveBeenCalledWith("window-1", {
      product_id: "product-1", quantity: 4,
    }));
  });
});
