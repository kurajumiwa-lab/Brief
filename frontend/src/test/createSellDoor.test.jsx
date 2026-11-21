import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CreatePage from "@/pages/create/CreatePage";

vi.mock("@/lib/api", () => ({
  outsideAPI: { create: vi.fn() },
  fileAPI: { upload: vi.fn() },
  corridorAPI: { priceHint: vi.fn().mockResolvedValue({ data: null }) },
  officeAPI: { mine: vi.fn().mockResolvedValue({ data: { offices: [] } }) },
  apiError: (_e, fallback) => fallback,
}));

vi.mock("@/stores/outsideStore", () => ({
  useOutsideStore: (selector) => {
    const state = { location: null, loadLocation: vi.fn() };
    return selector ? selector(state) : state;
  },
  locationLabel: () => "",
}));

vi.mock("@/components/receipts/ReceiptScanner", () => ({ default: () => null }));
vi.mock("@/components/routines/RepeatWeeklyCard", () => ({ default: () => null }));
vi.mock("@/components/prices/CorridorPriceHint", () => ({ default: () => null }));

const renderCreate = () =>
  render(
    <MemoryRouter>
      <CreatePage />
    </MemoryRouter>,
  );

describe("'something you sell' is a door, not a hunt", () => {
  it("offers the three kinds of offer and says where each one goes", () => {
    renderCreate();
    const door = screen.getByTestId("create-sell-door");
    expect(door).toHaveTextContent(/Something you sell/i);
    expect(door.querySelector('a[href="/desk?new=service"]')).toBeTruthy();
    expect(door.querySelector('a[href="/desk?new=goods"]')).toBeTruthy();
    expect(door.querySelector('a[href="/desk?new=tool"]')).toBeTruthy();
  });

  it("explains the difference between a post and an offer in the copy", () => {
    renderCreate();
    const door = screen.getByTestId("create-sell-door");
    expect(door).toHaveTextContent(/does not expire like a post/i);
    expect(door).toHaveTextContent(/duration and a price/i);
  });
});
