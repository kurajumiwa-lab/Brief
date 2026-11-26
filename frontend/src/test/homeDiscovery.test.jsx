import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/receiptsApi", () => ({
  receiptsAPI: {
    vouchers: vi.fn().mockResolvedValue({ data: { vouchers: [] } }),
    offers: vi.fn().mockResolvedValue({ data: { offers: [] } }),
  },
}));

import TodayView from "@/components/home/TodayView";
import { useOutsideStore } from "@/stores/outsideStore";
import { REGION_BY_SLUG } from "@/config/regions";

const region = REGION_BY_SLUG.nyanza;

const trade = [
  {
    id: "l-1", kind: "listing", to: "/listing/l-1", title: "Maize flour 2kg",
    category: "bulk groceries", location: "Kisumu central", price_kes: 500, distance_km: 2.1,
    owner: { id: "v-1", name: "Milimani Cereals", movements_completed: 3 },
  },
  {
    id: "r-1", kind: "rental", to: "/rentals/r-1", title: "Tent hire for a round",
    category: "rentals", location: "Kondele", price_kes: 1500, distance_km: 4.1,
    owner: { id: "v-2", name: "Kondele Hire" },
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

beforeEach(() => {
  // The location store is real, but it must not reach the network in a unit
  // test: the Home page only needs to know what the app would be told.
  useOutsideStore.setState({
    location: null,
    locationStatus: "idle",
    loadLocation: vi.fn(),
  });
});

function renderHome(overrides = {}) {
  return render(
    <MemoryRouter>
      <TodayView
        name="Amina"
        firstName="Amina"
        region={region}
        nearby={trade}
        community={communityItems}
        page={{ published: true, href: "/p/amina", counts: { offers: 1, trades: 2 } }}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe("Home opens on discovery", () => {
  it("leads with the greeting, Chats and Notifications — with separate counts", () => {
    renderHome({ attention: { chats: 1, notifications: 2, waiting: 0 } });
    expect(screen.getByRole("heading", { name: /Amina/ })).toBeInTheDocument();
    const chats = screen.getByTestId("home-chats");
    const notifications = screen.getByTestId("home-notifications");
    expect(chats).toHaveAttribute("href", "/inbox?tab=chats");
    expect(chats).toHaveAccessibleName(/1 unread message/i);
    expect(notifications).toHaveAttribute("href", "/inbox?tab=notifications");
    expect(notifications).toHaveAccessibleName(/2 unread/i);
    // A combined "waiting" badge cannot say which messages need a reply.
    expect(notifications.textContent).toContain("2");
    expect(chats.textContent).toContain("1");
  });

  it("puts one compact location control under the greeting", () => {
    renderHome();
    const indicator = screen.getByTestId("location-indicator");
    expect(indicator).toBeInTheDocument();
    expect(screen.getByTestId("location-indicator-toggle")).toHaveAttribute("aria-expanded", "false");
    // The full controls are one press away, never permanently on screen.
    expect(screen.queryByTestId("location-bar")).not.toBeInTheDocument();
  });

  it("says plainly when no area is known, instead of naming one", () => {
    renderHome();
    expect(screen.getByTestId("location-indicator-label")).toHaveTextContent(/Location unavailable/i);
    // The location control may not claim a town the app was never told.
    expect(screen.getByTestId("location-indicator")).not.toHaveTextContent(/Nyanza|Nairobi|Kisumu/);
  });

  it("names the area it was actually given, and no other", () => {
    useOutsideStore.setState({
      location: { lat: -0.095, lng: 34.77, label: "Kondele, Kisumu", radius_km: 15, source: "manual" },
      loadLocation: vi.fn(),
    });
    renderHome();
    const label = screen.getByTestId("location-indicator-label");
    expect(label).toHaveTextContent("Kondele, Kisumu");
    // A named area is not permission to invent a second one.
    expect(label).not.toHaveTextContent(/Nairobi/);
  });

  it("has ONE search, and it is the app's search", () => {
    renderHome();
    const fields = screen.getAllByRole("searchbox");
    expect(fields).toHaveLength(1);
    expect(fields[0]).toHaveAttribute("aria-label", "Search everything");
  });

  it("offers the five marketplace categories as doors, not as a list of types", () => {
    renderHome();
    const band = within(screen.getByTestId("discovery-band"));
    const doors = [
      ["/regions", "All"],
      ["/regions?kind=listing", "Goods"],
      ["/regions?kind=service", "Services"],
      ["/regions?kind=rental", "Rentals"],
      ["/regions?kind=event", "Events"],
    ];
    for (const [href, label] of doors) {
      const link = band.getByRole("link", { name: new RegExp(`^${label}`, "i") });
      expect(link.getAttribute("href")).toBe(href);
    }
    // Two columns on a phone: a single column of five tiles is a scroll.
    expect(band.getByTestId("explore-categories").className).toMatch(/grid-cols-2/);
  });

  it("shows the nearby listings on the standard card", () => {
    renderHome();
    const shelf = screen.getByTestId("nearby-shelf");
    const cards = within(shelf).getAllByTestId(/^content-card-/);
    expect(cards).toHaveLength(2);
    // The facts the brief names, on every card.
    expect(within(cards[0]).getByText("Maize flour 2kg")).toBeInTheDocument();
    expect(within(cards[0]).getByText("KSh 500")).toBeInTheDocument();
    expect(within(cards[0]).getByTestId("region-card-distance")).toHaveTextContent("2.1 km");
    expect(within(cards[0]).getByTestId("listing-card-seller")).toHaveTextContent("Milimani Cereals");
    expect(within(cards[0]).getByTestId("region-card-level")).toBeInTheDocument();
    expect(within(cards[0]).getByTestId("merch-card-save")).toBeInTheDocument();
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

  it("carries no promotional banner and no second map door", () => {
    renderHome();
    // A marketplace page must not open with a marketing plate competing with
    // the listings, and the map lives next to the results it maps.
    expect(screen.queryByText(/See what is trading in the city today/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-discovery")).not.toBeInTheDocument();
  });

  it("orders the page: hero, categories, nearby, then activity, then the records", () => {
    renderHome();
    const hero = screen.getByTestId("location-indicator");
    const band = screen.getByTestId("discovery-band");
    const nearby = screen.getByTestId("nearby-shelf");
    const community = screen.getByTestId("community-shelf");

    expect(hero.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(band.compareDocumentPosition(nearby) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nearby.compareDocumentPosition(community) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The person's own records sit BELOW the marketplace, not above it.
    const records = screen.getByTestId("identity-strip");
    expect(community.compareDocumentPosition(records) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
