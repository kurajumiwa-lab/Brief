import { describe, expect, it } from "vitest";
import { providerToCard } from "@/pages/explore/ExplorePage";

const provider = {
  id: "v1",
  handle: "amina",
  name: "Amina Home Nursing",
  area: "Kondele, Kisumu",
  starting_price_kes: 800,
  starting_price_unit: "visit",
  service_count: 3,
  domains: ["healthcare_care"],
  is_bookable: true,
  owner: {
    id: "v1",
    handle: "amina",
    name: "Amina Home Nursing",
    physical_location: "Kondele, Kisumu",
    movements_completed: 2,
    confirmed_trade_proofs: 1,
    page_live: true,
  },
  offerings: [
    { name: "Home nursing", price_kes: 1500 },
    { name: "Wound dressing", price_kes: 800 },
    { name: "Postnatal visit", price_kes: 2000 },
  ],
};

describe("service provider card", () => {
  it("is one card for the provider, with every service inside it", () => {
    const card = providerToCard(provider);
    expect(card.kind).toBe("provider");
    expect(card.id).toBe("v1");
    expect(card.to).toBe("/p/amina");
    expect(card.title).toBe("Amina Home Nursing");
    expect(card.meta.service_count).toBe(3);
    expect(card.meta.service_names).toEqual(["Home nursing", "Wound dressing", "Postnatal visit"]);
    expect(card.price_kes).toBe(800);
    expect(card.location).toBe("Kondele, Kisumu");
    expect(card.owner.movements_completed).toBe(2);
  });

  it("does not invent a price or a handle when the provider has neither", () => {
    const card = providerToCard({ id: "v2", name: "New provider", offerings: [] });
    expect(card.to).toBe("#");
    expect(card.price_kes).toBeNull();
    expect(card.meta.service_count).toBe(0);
  });
});
