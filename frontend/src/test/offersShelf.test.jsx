import { beforeEach, describe, expect, it, vi } from "vitest";
import { SHELVES } from "@/config/homeShelves";
import { offersAPI } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal()),
  offersAPI: { confirmed: vi.fn(), mine: vi.fn() },
}));

const offer = (over = {}) => ({
  id: "o1", name: "Grade A Maize", category: "produce", unit_price: 3200, wholesale_price: 3000,
  unit: "bag", quantity_available: 40, min_order_quantity: 2, images: [],
  status: "confirmed", seller: { id: "v1", handle: "maize_co", name: "Maize Co" }, ...over,
});

describe("confirmed offers shelf", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is the first shelf on the home feed", () => {
    expect(SHELVES[0].key).toBe("offers");
    expect(SHELVES[0].group).toBe("discovery");
  });

  it("shows only confirmed offers that have stock, and names the seller", async () => {
    offersAPI.confirmed.mockResolvedValue({
      data: { offers: [offer(), offer({ id: "o2", status: "listed" }), offer({ id: "o3", quantity_available: 0 })] },
    });
    const shelf = SHELVES[0];
    const items = await shelf.load();
    expect(items.map((i) => i.id)).toEqual(["o1"]);
    expect(items[0]).toMatchObject({
      kind: "product", to: "/listing/o1", title: "Grade A Maize", price: 3200, quantity: 40,
      vendorName: "Maize Co", owner: { id: "v1", handle: "maize_co", name: "Maize Co" },
    });
  });

  it("is an empty shelf, not a crash, when the API fails", async () => {
    offersAPI.confirmed.mockRejectedValue(new Error("offline"));
    await expect(SHELVES[0].load()).resolves.toEqual([]);
  });
});
