/**
 * v3 — the rebuilt core loop: browse → listing → order.
 *
 * These specs do not test new mechanics. They test that the SAME mechanics
 * survived the move out of the Stock Room's tabs:
 *   · network stock comes from GET /stock/network-stock, never a new endpoint
 *   · sourcing still POSTs { quantity, proposed_price, notes } to /stock/{id}/source
 *   · a movement still advances confirm → ship → receive, role-gated
 *   · available = in_stock − reserved is what a buyer may order
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

const ok = (data) => Promise.resolve({ data });

const ITEM = {
  id: "s1",
  vendor_id: "v2",
  vendor_handle: "gikomba_textiles",
  vendor_business_name: "Gikomba Textiles",
  name: "Kitenge 6-yard",
  sku: "KIT-6",
  category: "Textiles",
  description: "Wax print, six-yard piece.",
  quantity_in_stock: 40,
  quantity_reserved: 10,
  quantity_available: 30,
  unit_of_measure: "piece",
  unit_price: 1200,
  min_order_quantity: 2,
  visible_to_network: true,
  tags: ["wax", "bulk"],
  images: [],
  quality_status: "self_declared",
  batch_number: "B-77",
  origin_country: "Tanzania",
  vendor_fulfillment_rate: 0.92,
  vendor_network_score: 71,
  vendor_parasitism_index: 0.3,
  updated_at: "2026-01-02T08:00:00Z",
};

const MOVEMENT = {
  id: "m1",
  direction: "outgoing",
  status: "pending",
  stock_id: "s1",
  stock_name: "Kitenge 6-yard",
  quantity: 5,
  unit_price: 1200,
  total_value: 6000,
  from_vendor_handle: "mama_mboga",
  to_vendor_handle: "kibanda_kitchen",
  to_vendor_business_name: "Kibanda Kitchen",
  from_vendor_business_name: "Mama Mboga Fresh",
  created_at: "2026-01-02T08:00:00Z",
  hold_expires_at: null,
  notes: "",
};

const sourced = [];
const advanced = [];

vi.mock("@/lib/api", () => {
  const apiError = (e, f = "Something went wrong") => e?.message || f;
  return {
    apiError,
    stockAPI: {
      network: vi.fn((params) => ok([{ ...ITEM, _params: params }])),
      get: vi.fn((id) => ok({ ...ITEM, id })),
      alternatives: vi.fn(() => ok([])),
      categories: vi.fn(() => ok(["Textiles", "Produce"])),
      movements: vi.fn(() => ok([MOVEMENT])),
      source: vi.fn((id, payload) => {
        sourced.push({ id, payload });
        return ok({ message: "Sourcing request sent", movement_id: "m9" });
      }),
      advance: vi.fn((id, action) => {
        advanced.push({ id, action });
        return ok({ ...MOVEMENT, status: action === "confirm" ? "confirmed" : MOVEMENT.status });
      }),
      mine: vi.fn(() => ok([])),
      patronVerify: vi.fn(() => ok(ITEM)),
    },
    vendorAPI: {
      byHandle: vi.fn(() => ok({ id: "v2", handle: "gikomba_textiles", business_name: "Gikomba Textiles" })),
    },
    chatAPI: { rooms: vi.fn(() => ok([])) },
  };
});

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector) =>
    selector({
      vendor: { id: "v1", handle: "mama_mboga", business_name: "Mama Mboga Fresh", is_patron: false, role: "selling" },
      token: "tok",
      ready: true,
    }),
}));

import BrowsePage from "@/pages/browse/BrowsePage";
import ListingPage from "@/pages/listing/ListingPage";
import OrdersPage from "@/pages/orders/OrdersPage";
import { useStockStore } from "@/stores/stockStore";
import { stockAPI } from "@/lib/api";

const at = (entry, pattern, ui) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path={pattern} element={ui} />
        <Route path="*" element={<div data-testid="elsewhere">elsewhere</div>} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  sourced.length = 0;
  advanced.length = 0;
  useStockStore.setState({ mine: [], network: [], movements: [], categories: [] });
});

describe("Browse — the network tab, promoted to a destination", () => {
  it("reads filters from the URL and passes them to the existing network endpoint", async () => {
    at("/browse?search=kitenge&category=Textiles", "/browse", <BrowsePage />);
    await waitFor(() =>
      expect(stockAPI.network).toHaveBeenCalledWith(expect.objectContaining({ search: "kitenge", category: "Textiles" }))
    );
  });

  it("lists network stock as cards that link to the listing page", async () => {
    at("/browse", "/browse", <BrowsePage />);
    const title = await screen.findByRole("link", { name: /Kitenge 6-yard/i });
    expect(title).toHaveAttribute("href", "/listing/s1");
  });

  it("offers sourceable quantity, never raw in-stock", async () => {
    at("/browse", "/browse", <BrowsePage />);
    await screen.findByRole("link", { name: /Kitenge 6-yard/i });
    expect(screen.getByText(/30/)).toBeInTheDocument();
    expect(screen.queryByText(/^40 piece/)).not.toBeInTheDocument();
  });
});

describe("Listing — one page per item, with the order panel on it", () => {
  it("sends the same sourcing payload the dialog always sent", async () => {
    at("/listing/s1", "/listing/:id", <ListingPage />);
    await screen.findAllByText(/Kitenge 6-yard/);

    fireEvent.click(screen.getByRole("button", { name: /send sourcing request/i }));

    await waitFor(() => expect(sourced).toHaveLength(1));
    expect(sourced[0].id).toBe("s1");
    expect(sourced[0].payload).toEqual(
      expect.objectContaining({ quantity: expect.any(Number), proposed_price: null, notes: null })
    );
    // minimum order quantity is respected out of the box
    expect(sourced[0].payload.quantity).toBe(2);
  });

  it("will not let a buyer order more than is available", async () => {
    at("/listing/s1", "/listing/:id", <ListingPage />);
    await screen.findAllByText(/Kitenge 6-yard/);
    const qty = screen.getByLabelText("Quantity");
    fireEvent.change(qty, { target: { value: "999" } });
    fireEvent.blur(qty);
    await waitFor(() => expect(Number(qty.value)).toBeLessThanOrEqual(30));
  });
});

describe("Orders — movements, promoted out of a tab", () => {
  it("honours ?direction=incoming", async () => {
    at("/orders?direction=incoming", "/orders", <OrdersPage />);
    await waitFor(() => expect(stockAPI.movements).toHaveBeenCalledWith({ direction: "incoming" }));
  });

  it("surfaces the one movement waiting on me and advances it", async () => {
    at("/orders", "/orders", <OrdersPage />);
    const row = await screen.findByText("Kitenge 6-yard");
    expect(screen.getAllByText(/needs you/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
    await waitFor(() => expect(advanced).toEqual([{ id: "m1", action: "confirm" }]));
    expect(row).toBeInTheDocument();
  });

  it("shows the four-step pipeline so a trader knows what happens next", async () => {
    at("/orders", "/orders", <OrdersPage />);
    await screen.findByText("Kitenge 6-yard");
    const scope = within(document.body);
    ["Requested", "Confirmed", "Shipped", "Received"].forEach((step) =>
      expect(scope.getAllByText(step).length).toBeGreaterThan(0)
    );
  });
});
