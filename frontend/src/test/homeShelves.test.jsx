import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/receiptsApi", () => ({
  receiptsAPI: {
    vouchers: vi.fn().mockResolvedValue({ data: { vouchers: [] } }),
    offers: vi.fn().mockResolvedValue({ data: { offers: [] } }),
  },
}));

import TodayView from "@/components/home/TodayView";
import NearbyShelf from "@/components/home/NearbyShelf";
import FeaturedDealsShelf from "@/components/home/FeaturedDealsShelf";
import { rankFor } from "@/config/identity";
import { REGION_BY_SLUG } from "@/config/regions";

const region = REGION_BY_SLUG.nyanza;

const trade = [
  {
    id: "l-1", kind: "listing", to: "/listing/l-1", title: "Maize flour 2kg",
    category: "bulk groceries", location: "Kisumu central", price_kes: 500, distance_km: 2.1,
  },
  {
    id: "r-1", kind: "rental", to: "/rentals/r-1", title: "Tent hire for a round",
    category: "rentals", location: "Kondele", price_kes: 1500, distance_km: 4.1,
  },
  {
    id: "s-1", kind: "service", to: "/tools?listing=s-1", title: "School uniform tailoring",
    category: "repairs", location: "Kisumu", price_kes: null, distance_km: 3.4,
  },
];

const future = new Date(Date.now() + 3 * 86400000).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();

const deals = [
  {
    id: "d-1", feed_kind: "SPOTTED_DEAL", title: "Unga offer on the shelf",
    merchant_name: "Milimani Cereals", discount_summary: "50 kg at 4,200",
    expires_at: future,
  },
  {
    id: "d-2", feed_kind: "SPOTTED_DEAL", title: "Yesterday's offer",
    merchant_name: "Closed Shop", discount_summary: "anything",
    expires_at: past,
  },
];

function wrap(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("Home step 6 — nearby goods, services and rentals", () => {
  it("renders one shelf covering all three trade kinds", () => {
    wrap(<NearbyShelf items={trade} region={region} />);
    const shelf = screen.getByTestId("nearby-shelf");
    expect(within(shelf).getByRole("heading", { name: "Goods, services and rentals" })).toBeInTheDocument();
    expect(within(shelf).getAllByTestId("nearby-card")).toHaveLength(3);
  });

  it("prints a seller's real price and says Open when there is none", () => {
    wrap(<NearbyShelf items={trade} region={region} />);
    const shelf = screen.getByTestId("nearby-shelf");
    // A real price is shown as the seller set it.
    expect(within(shelf).getByText("KSh 500")).toBeInTheDocument();
    // No price is "Open". The card never invents a figure to fill the space.
    expect(within(shelf).getByText("Open")).toBeInTheDocument();
  });

  it("renders nothing at all when the shelf is empty", () => {
    const { container } = wrap(<NearbyShelf items={[]} region={region} />);
    // An empty carousel above the fold is furniture; it must not ship.
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Home step 7 — featured deals", () => {
  it("shows a live deal with its merchant's own wording", () => {
    wrap(<FeaturedDealsShelf deals={deals} />);
    const shelf = screen.getByTestId("deals-shelf");
    expect(within(shelf).getByText("Unga offer on the shelf")).toBeInTheDocument();
    expect(within(shelf).getByText("50 kg at 4,200")).toBeInTheDocument();
    expect(within(shelf).getByText("Milimani Cereals")).toBeInTheDocument();
  });

  it("drops an expired deal rather than featuring yesterday's offer", () => {
    wrap(<FeaturedDealsShelf deals={deals} />);
    expect(screen.queryByText("Yesterday's offer")).not.toBeInTheDocument();
  });

  it("never invents a was/now pair the deal did not carry", () => {
    // The deal has no was-price. The rail must not compute a discount.
    wrap(<FeaturedDealsShelf deals={deals} />);
    expect(screen.queryByText(/was\s/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/%\s*off/i)).not.toBeInTheDocument();
  });

  it("renders nothing when there are no live deals", () => {
    const { container } = wrap(<FeaturedDealsShelf deals={[deals[1]]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Home steps 6, 7 and 8 in sequence", () => {
  function renderHome() {
    const rank = rankFor({
      vendor: { business_name: "Ogallo", vendor_handle: "ogallo", movements_completed: 1 },
      identity: { contact: { phone: "0712000111" } },
    });
    return render(
      <MemoryRouter>
        <TodayView
          name="Ogallo"
          firstName="Ogallo"
          rank={rank}
          region={region}
          happening={[{
            id: "e1", kind: "event", to: "/events?event=e1", title: "Saturday brunch",
            category: "trip", location: "Kisumu", starts_at: future, price_kes: null,
            counts: { attending: 3 }, meta: { capacity: 12 },
          }]}
          nearby={trade}
          deals={deals}
          page={{ published: true, url: "/p/ogallo", href: "/p/ogallo", counts: {} }}
        />
      </MemoryRouter>,
    );
  }

  it("puts nearby trade, then deals, then dated rounds in that order", () => {
    renderHome();
    const nearby = screen.getByTestId("nearby-shelf");
    const dealsRail = screen.getByTestId("deals-shelf");
    const happening = screen.getByTestId("happening-shelf");

    // The brief numbers these 6, 7, 8. Document order is the promise.
    expect(nearby.compareDocumentPosition(dealsRail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dealsRail.compareDocumentPosition(happening) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the no-paid-placement promise visible on the shelf", () => {
    renderHome();
    const nearby = screen.getByTestId("nearby-shelf");
    // The line is split across elements by its icon, so assert on the block.
    expect(nearby.textContent).toMatch(/Nothing here is paid placement/i);
  });
});
