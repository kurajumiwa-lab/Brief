/**
 * DISCOVER IS THE SAME MARKETPLACE, REACHED BY A SHAREABLE PATH.
 *
 * "Discover" was a second marketplace: a regional spotlight with invented
 * statistics, a mandatory "Featured & Trending" grid, intent chips, a saved
 * pill inside a custom category strip, and a services door that showed a mixed
 * feed. The review asked for one marketplace — so Discover is now a set of
 * ADDRESSES into Explore, and the address decides the filters.
 *
 * What is still worth pinning, and is pinned here:
 *
 *   · a section path becomes query state, so a link is shareable;
 *   · an explicit query in the URL wins over the path's default;
 *   · one search, one category grid, no second marketplace furniture;
 *   · a save is held on this device and opens the Saved route;
 *   · the Services door is a provider directory, not a filtered feed;
 *   · a quiet page falls back honestly instead of dead-ending.
 *
 * What is deliberately NOT pinned any more: the spotlight, the featured grid,
 * intent chips, the market strip and the seven-category strip. They were
 * removed by the brief, and a spec that keeps asking for them keeps a product
 * the review already rejected.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const ok = (data) => Promise.resolve({ data });

const LOCATION = {
  lat: -0.095, lng: 34.77, label: "Kondele, Kisumu", radius_km: 15,
  layer: "town", source: "manual", interests: [], share_location: false,
  explainable: true,
};

const highOwner = {
  id: "v-1", handle: "milimani", name: "Milimani Cereals",
  page_live: true, business_description: "Wholesale cereals in Kisumu",
  physical_location: "Kisumu central", contact_exposed: true,
  movements_completed: 3, confirmed_trade_proofs: 0, is_verified: false,
};

const lowOwner = {
  id: "v-2", handle: "new-tailor", name: "New Tailor",
  page_live: true, business_description: "Tailoring", physical_location: "Kisumu",
  contact_exposed: true, movements_completed: 0, confirmed_trade_proofs: 0,
  is_verified: false,
};

const ITEMS = [
  {
    id: "e-1", kind: "event", to: "/events/e-1", title: "Kisumu Music Round",
    category: "events", location: "Kisumu", price_kes: 200, distance_km: 1.2,
    owner: highOwner, counts: { attending: 20 }, meta: { capacity: 40 }, reasons: ["1.2 km away"],
  },
  {
    id: "l-1", kind: "listing", to: "/listing/l-1", title: "Maize flour 2kg",
    category: "bulk groceries", location: "Kisumu central", price_kes: 500,
    distance_km: 2.1, owner: highOwner, counts: { booked: 4 }, meta: { capacity: 10 },
  },
  {
    id: "s-1", kind: "service", to: "/tools?listing=s-1", title: "School uniform tailoring",
    category: "repairs", location: "Kisumu", price_kes: null, distance_km: 3.4,
    owner: lowOwner, counts: {}, meta: {},
  },
  {
    id: "r-1", kind: "rental", to: "/rentals/r-1", title: "Tent hire for a round",
    category: "rentals", location: "Kondele", price_kes: 1500, distance_km: 4.1,
    owner: highOwner, counts: {}, meta: {},
  },
];

const mocks = vi.hoisted(() => ({ feed: vi.fn(), providers: vi.fn(), spotted: vi.fn() }));

vi.mock("@/lib/api", () => ({
  outsideAPI: {
    shelves: vi.fn(() => ok({ shelves: [], scopes: {}, content_types: [], create_path: "/create", location: LOCATION })),
    feed: mocks.feed,
    search: mocks.feed,
    location: vi.fn(() => ok(LOCATION)),
    setLocation: vi.fn(() => ok(LOCATION)),
    react: vi.fn(() => ok({ ok: true })),
    unreact: vi.fn(() => ok({ ok: true })),
    activity: vi.fn(() => ok({ groups: [], counts: {} })),
  },
  marketsAPI: { around: vi.fn(() => ok({ markets: [] })), list: vi.fn(() => ok({ markets: [] })) },
  serviceProviderAPI: { list: mocks.providers },
  spottedDealAPI: { list: mocks.spotted },
  geoAPI: { geocode: vi.fn(() => ok({ lat: -0.095, lng: 34.77 })) },
  apiError: (_e, fallback) => fallback,
}));

beforeEach(() => {
  mocks.feed.mockReset().mockImplementation(() =>
    ok({ items: ITEMS, next_cursor: null, center: {}, location: LOCATION }));
  mocks.providers.mockReset().mockImplementation(() =>
    ok({ providers: [], count: 0, total: 0, limit: 30, filters: {}, note: "" }));
  mocks.spotted.mockReset().mockImplementation(() => ok([]));
  try { localStorage.clear(); } catch { /* no storage */ }
});

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{pathname}{search}</output>;
}

async function renderDiscover(path = "/discover") {
  const { default: ExplorePage } = await import("@/pages/explore/ExplorePage");
  const { default: DiscoverSectionPage } = await import("@/pages/discover/DiscoverSectionPage");
  const { default: DiscoverFavoritesPage } = await import("@/pages/discover/DiscoverFavoritesPage");
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/discover" element={<ExplorePage regionAware />} />
        <Route path="/discover/favorites" element={<DiscoverFavoritesPage />} />
        <Route path="/discover/:section" element={<DiscoverSectionPage />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

function setFeed(items) {
  mocks.feed.mockImplementation(() =>
    ok({ items, next_cursor: null, center: {}, location: LOCATION }));
}

describe("1 · one marketplace, not a second one", () => {
  it("opens like the Explore screen: one search, one category grid, one deck", async () => {
    await renderDiscover();
    await screen.findByTestId("discover-masthead");

    expect(screen.getByRole("heading", { name: "Explore" })).toBeInTheDocument();
    expect(screen.getAllByRole("searchbox", { name: /search everything/i })).toHaveLength(1);
    const grid = screen.getByTestId("explore-categories");
    for (const label of ["All", "Goods", "Services", "Rentals", "Events"]) {
      expect(within(grid).getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByTestId("discover-shop-toolbar")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sort results" })).toBeInTheDocument();

    // The second marketplace's furniture is gone.
    expect(screen.queryByTestId("region-spotlight")).not.toBeInTheDocument();
    expect(screen.queryByTestId("discover-featured")).not.toBeInTheDocument();
    expect(screen.queryByTestId("discover-category-person")).not.toBeInTheDocument();
  });

  it("turns the category grid into real URL filters", async () => {
    await renderDiscover();
    const grid = await screen.findByTestId("explore-categories");

    fireEvent.click(within(grid).getByRole("button", { name: "Events" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("kind=event"));
    expect(screen.getByTestId("explore-kind-event")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("explore-kind-event"));
    await waitFor(() => expect(screen.getByTestId("location").textContent).not.toContain("kind=event"));
    expect(screen.getByTestId("explore-kind-event")).toHaveAttribute("aria-pressed", "false");
  });

  it("clears the search and the category together when the deck resets", async () => {
    await renderDiscover("/discover?q=rice&kind=listing&public_sale=true");
    const search = await screen.findByRole("searchbox", { name: /search everything/i });
    expect(search).toHaveValue("rice");

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(search).toHaveValue(""));
    const location = screen.getByTestId("location").textContent;
    expect(location).not.toContain("q=rice");
    expect(location).not.toContain("kind=listing");
    expect(location).not.toContain("public_sale=true");
  });

  it("counts what is on the screen, and says so", async () => {
    await renderDiscover();
    const deck = await screen.findByTestId("discover-shop-toolbar");
    await waitFor(() =>
      expect(within(deck).getByTestId("explore-count")).toHaveTextContent(/4 results loaded/i));
  });

  it("gives every product card a share action and a level chip", async () => {
    await renderDiscover();
    const grid = await screen.findByTestId("explore-results");
    const card = within(grid).getAllByTestId(/^content-card-/)[0];
    expect(within(card).getByTestId("region-card-share")).toBeInTheDocument();
    expect(within(card).getByTestId("region-card-level")).toBeInTheDocument();
  });

  it("asks the server for the category's kinds instead of filtering a mixed feed on screen", async () => {
    await renderDiscover("/discover?kind=event");
    await waitFor(() => expect(mocks.feed).toHaveBeenCalledWith(expect.objectContaining({ kinds: ["event", "scheduled"] })));
  });
});

describe("2 · the saved shelf is device-local, and is a route", () => {
  it("is reachable from the screen as a link, not a filter", async () => {
    await renderDiscover();
    const saved = await screen.findByTestId("discover-saved-pill");
    expect(saved).toHaveAttribute("href", "/discover/favorites");
    expect(saved.querySelector("svg")).toBeTruthy();
  });

  it("saves a card on this device and opens the Saved route", async () => {
    await renderDiscover();
    const grid = await screen.findByTestId("explore-results");
    const card = within(grid).getAllByTestId(/^content-card-/)[0];
    const save = within(card).getByTestId("merch-card-save");
    expect(save).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(save);
    expect(save).toHaveAttribute("aria-pressed", "true");
    const stored = JSON.parse(localStorage.getItem("brief-discover-saved-v1"));
    expect(stored).toHaveLength(1);

    fireEvent.click(screen.getByTestId("discover-saved-pill"));
    expect(await screen.findByTestId("discover-favorites")).toBeInTheDocument();
    expect(screen.getByText("Saved on this device")).toBeInTheDocument();
  });
});

describe("3 · smart category routes are query state", () => {
  it("maps /discover/goods to goods", async () => {
    await renderDiscover("/discover/goods");
    await waitFor(() => {
      const text = screen.getByTestId("location").textContent;
      expect(text).toContain("kind=listing");
      expect(text).toContain("public_sale=true");
      // The path may not invent an intent the server does not understand.
      expect(text).not.toContain("intent=");
    });
  });

  it("maps /discover/rentals to rentals", async () => {
    await renderDiscover("/discover/rentals");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("kind=rental"));
  });

  it("maps /discover/trending to the feed flag", async () => {
    await renderDiscover("/discover/trending");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("feed=trending"));
  });

  it("maps /discover/verified to the standing door", async () => {
    await renderDiscover("/discover/verified");
    await waitFor(() => {
      const text = screen.getByTestId("location").textContent;
      expect(text).toContain("trust=3");
      expect(text).toContain("min_level=3");
    });
  });

  it("lets an explicit query win over the path default", async () => {
    await renderDiscover("/discover/goods?kind=rental&public_sale=false");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("kind=rental"));
    expect(screen.getByTestId("location").textContent).toContain("public_sale=false");
    expect(screen.getByTestId("location").textContent).not.toContain("public_sale=true");
  });
});

describe("4 · the Services door is a provider directory", () => {
  it("shows providers, never the mixed feed, and no dead filters", async () => {
    await renderDiscover("/discover/services");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("kind=service"));
    expect(await screen.findByTestId("service-providers-empty")).toBeInTheDocument();
    // Time, price, radius and standing do not apply to a provider list, so the
    // screen does not offer them.
    expect(screen.queryByTestId("explore-more-filters")).not.toBeInTheDocument();
    expect(screen.queryByTestId("regions-trust")).not.toBeInTheDocument();
    // …and it does not quietly fall back to a mixed feed.
    expect(screen.queryByTestId("explore-results")).not.toBeInTheDocument();
  });
});

describe("5 · a quiet page falls back honestly", () => {
  it("shows a wider search instead of an empty page, clearly labelled", async () => {
    const nearby = {
      ...ITEMS[2],
      id: "s-nearby",
      title: "Village tailor",
      distance_km: 42,
      owner: { ...lowOwner, contact_exposed: false },
    };
    mocks.feed.mockImplementation((params) =>
      ok({
        items: params?.radius_km === 50 ? [nearby] : [],
        next_cursor: null,
        center: {},
        location: { ...LOCATION, radius_km: 50 },
      }));

    await renderDiscover();
    const cold = await screen.findByTestId("discover-cold-start");
    expect(within(cold).getByText(/Quiet within 15 km/i)).toBeInTheDocument();
    expect(within(cold).getByRole("heading", { name: /Popular in .*all levels/i })).toBeInTheDocument();
    expect(within(cold).getByText("Village tailor")).toBeInTheDocument();
    expect(within(cold).getByTestId("region-card-distance")).toHaveTextContent("42.0 km");
    // Those records are further out, and the screen says so.
    expect(within(cold).getByText(/These are further out/i)).toBeInTheDocument();
    expect(screen.queryByTestId("explore-empty")).not.toBeInTheDocument();
  });

  it("shows the honest all-levels rail when a strict standing door finds nothing", async () => {
    setFeed([{ ...ITEMS[2], owner: { ...lowOwner, contact_exposed: false } }]);
    await renderDiscover("/discover/verified");
    const fallback = await screen.findByTestId("explore-filtered-empty");
    expect(within(fallback).getByText(/No Level 3\+ traders here yet/)).toBeInTheDocument();

    fireEvent.click(within(fallback).getByRole("button", { name: /show every page/i }));
    await waitFor(() => expect(screen.getByTestId("explore-results")).toBeInTheDocument());
  });
});
