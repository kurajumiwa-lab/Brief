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
];

const communityItems = [
  {
    id: "p-1", kind: "post", to: "/feed/p-1", title: "Water is back on in Kibera",
    location: "Kibera", created_at: new Date(Date.now() - 3600000).toISOString(),
    counts: { reply: 3 },
  },
  {
    id: "w-1", kind: "wanted", to: "/activities/w-1", title: "Anyone with a wheelbarrow?",
    location: "Kisumu", created_at: new Date(Date.now() - 7200000).toISOString(),
  },
];

function renderHome(overrides = {}) {
  return render(
    <MemoryRouter>
      <TodayView
        name="Amina"
        firstName="Amina"
        region={region}
        nearby={trade}
        community={communityItems}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe("Home opens on discovery", () => {
  it("leads with where you are and what you are looking for", () => {
    renderHome();
    const location = screen.getByTestId("home-location");
    expect(location).toHaveAttribute("href", "/regions");
    expect(location).toHaveTextContent(/Looking around/i);
    expect(location).toHaveTextContent(region.name || region.hub);
    // The search is the largest control on the screen, and it is the app's own.
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });

  it("says plainly when no area has been chosen, instead of naming one", () => {
    renderHome({ region: null });
    const location = screen.getByTestId("home-location");
    expect(location).toHaveTextContent(/No area chosen/i);
    expect(location).toHaveTextContent(/Choose your area/i);
  });

  it("offers the four marketplace categories as doors, not as a list of types", () => {
    renderHome();
    const doors = [
      ["/discover?kind=listing", "Goods"],
      ["/discover?kind=service", "Services"],
      ["/discover?kind=rental", "Rentals"],
      ["/discover?kind=event", "Events"],
    ];
    const band = within(screen.getByTestId("discovery-band"));
    for (const [href, label] of doors) {
      const link = band.getByRole("link", { name: new RegExp(label, "i") });
      expect(link.getAttribute("href")).toBe(href);
    }
  });

  it("offers the map as a door that counts only what it really has", () => {
    renderHome();
    const map = screen.getByTestId("map-discovery");
    expect(within(map).getByText("2 listings near you")).toBeInTheDocument();
    // The areas are the real ones the records carry.
    expect(within(map).getByText("Kisumu central")).toBeInTheDocument();
    expect(within(map).getByText("Kondele")).toBeInTheDocument();
    expect(screen.getByTestId("map-discovery-open")).toHaveAttribute("href", "/map");
  });

  it("never claims a count it does not have", () => {
    renderHome({ nearby: [] });
    const map = screen.getByTestId("map-discovery");
    expect(within(map).getByText("Nothing on the map yet")).toBeInTheDocument();
    expect(within(map).queryByText(/listings near you/)).not.toBeInTheDocument();
  });

  it("gives community activity its own section, apart from the trade shelves", () => {
    renderHome();
    const shelf = screen.getByTestId("community-shelf");
    expect(within(shelf).getByRole("heading", { name: /Around the neighbourhood/i })).toBeInTheDocument();
    const rows = within(shelf).getAllByTestId("community-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Water is back on in Kibera")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Notice")).toBeInTheDocument();
    expect(within(rows[0]).getByText("3 replies")).toBeInTheDocument();
  });

  it("does not ship an empty community rail", () => {
    renderHome({ community: [] });
    expect(screen.queryByTestId("community-shelf")).not.toBeInTheDocument();
  });

  it("orders the page: hero, categories, map, trade, community, then the secondary doors", () => {
    renderHome();
    const hero = screen.getByTestId("home-location");
    const map = screen.getByTestId("map-discovery");
    const nearby = screen.getByTestId("nearby-shelf");
    const community = screen.getByTestId("community-shelf");

    expect(hero.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(map.compareDocumentPosition(nearby) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nearby.compareDocumentPosition(community) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Rewards are real, and they are last: the page is a marketplace first.
    const rewards = screen.getByRole("heading", { name: /Explore your town/i });
    expect(community.compareDocumentPosition(rewards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
