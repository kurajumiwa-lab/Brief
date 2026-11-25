/**
 * DISCOVER IS A MERCHANDISING FEED, NOT A FILTER PANEL.
 *
 * These specs pin the conversion layout and the rules that keep it honest:
 *
 *   · a spotlight built only from live records;
 *   · a Featured & Trending grid that needs three real items and never fakes one;
 *   · the strict Level 3+ door falling back to Level 2+, then to an all-levels rail;
 *   · smart category routes that are URL-bound and deep-linkable;
 *   · saves held on this device, with no server signal.
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
  {
    id: "p-1", kind: "person", to: "/p/milimani", title: "Milimani Cereals",
    category: "bulk groceries", location: "Kisumu central", distance_km: 2.0,
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

describe("1 · spotlight and featured merchandising", () => {
  it("opens with the region card and a three-card Featured & Trending grid", async () => {
    await renderDiscover();
    const spotlight = await screen.findByTestId("region-spotlight");
    expect(within(spotlight).getByRole("heading", { name: /Nyanza/i })).toBeInTheDocument();

    const featured = await screen.findByTestId("discover-featured");
    expect(within(featured).getByText("Featured & Trending")).toBeInTheDocument();
    expect(within(featured).getAllByTestId(/^content-card-/)).toHaveLength(3);
    expect(within(featured).getAllByTestId("region-card-distance")).toHaveLength(3);
    expect(within(featured).getAllByTestId("region-card-distance")[0]).toHaveTextContent("1.2 km");
    // The three featured items leave the dense grid rather than repeating there.
    // The person record no longer comes to Discover at all: five fixtures minus
    // a person minus three featured leaves exactly one dense card.
    expect(within(screen.getByTestId("regions-grid")).getAllByTestId(/^content-card-/)).toHaveLength(1);
  });

  it("opens like a region shelf: identity, one search, categories and a deck", async () => {
    await renderDiscover();
    const spotlight = await screen.findByTestId("region-spotlight");
    expect(within(spotlight).getByText(/Kenya/)).toBeInTheDocument();
    // The old 2×2 trust wall is gone; the four facts live behind the ? button.
    expect(screen.queryByLabelText("How this marketplace works")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("discover-how-it-works-button"));
    const works = await screen.findByRole("dialog", { name: /how wasta works/i });
    expect(within(works).getByText("No paid placement")).toBeInTheDocument();
    expect(within(works).getByText("Trade on record")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Categories" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What’s on offer" })).toBeInTheDocument();
    expect(screen.getByLabelText("Sort results")).toBeInTheDocument();
    // One live search, and it lives in the bar that sticks under the app header.
    const toolbar = screen.getByTestId("discover-toolbar");
    expect(toolbar.className).toMatch(/sticky/);
    expect(within(toolbar).getByRole("searchbox", { name: /search everything/i })).toBeInTheDocument();
    expect(screen.getAllByRole("searchbox", { name: /search everything/i })).toHaveLength(1);
  });

  it("turns the category grid into real URL filters, with no duplicate search", async () => {
    await renderDiscover();
    const grid = await screen.findByTestId("explore-categories");
    expect(screen.getAllByRole("searchbox", { name: /search everything/i })).toHaveLength(1);

    fireEvent.click(within(grid).getByRole("button", { name: "Rounds" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("kind=rounds"));
    expect(screen.getByTestId("discover-category-rounds")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("discover-category-rounds"));
    await waitFor(() => expect(screen.getByTestId("location").textContent).not.toContain("kind=rounds"));
    expect(screen.getByTestId("discover-category-rounds")).toHaveAttribute("aria-pressed", "false");
  });

  it("clears the sticky search and sale door together when the shelf resets", async () => {
    await renderDiscover("/discover?q=rice&kind=listing&public_sale=true");
    const search = await screen.findByRole("searchbox", { name: /search everything/i });
    expect(search).toHaveValue("rice");

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(search).toHaveValue(""));
    const location = screen.getByTestId("location").textContent;
    expect(location).not.toContain("q=rice");
    expect(location).not.toContain("public_sale=true");
    expect(location).not.toContain("kind=listing");
  });

  it("counts the region from the records it holds, and says where they came from", async () => {
    await renderDiscover();
    const spotlight = await screen.findByTestId("region-spotlight");
    // Five fixtures: a round, a listing, a service, a rental and a person.
    // One listing, two owners, three offers — and the note says they came
    // from the loaded page rather than from the region.
    expect(within(spotlight).getByTestId("region-metric-listings")).toHaveTextContent("1");
    expect(within(spotlight).getByTestId("region-metric-businesses")).toHaveTextContent("2");
    expect(within(spotlight).getByTestId("region-metric-offers")).toHaveTextContent("3");
    expect(within(spotlight).getByTestId("region-metrics-note")).toHaveTextContent(/results loaded/i);
    // The region has a clear action of its own.
    expect(within(spotlight).getByTestId("region-open")).toHaveAttribute("href", "/regions/nyanza");
    expect(within(spotlight).getByTestId("region-post")).toBeInTheDocument();
  });

  it("keeps the deck's count tied to what is on screen", async () => {
    await renderDiscover();
    const deck = await screen.findByTestId("discover-shop-toolbar");
    await waitFor(() =>
      expect(within(deck).getByTestId("explore-count")).toHaveTextContent(/results loaded/i));
  });

  it("gives every product card a share action and a real price plate", async () => {
    await renderDiscover();
    const grid = await screen.findByTestId("regions-grid");
    const card = within(grid).getAllByTestId(/^content-card-/)[0];
    expect(within(card).getByTestId("region-card-share")).toBeInTheDocument();
    expect(within(card).getByTestId("region-card-level")).toBeInTheDocument();
  });

  it("asks the server for one category only instead of filtering a mixed feed on screen", async () => {
    await renderDiscover("/discover?kind=event");
    await waitFor(() => expect(mocks.feed).toHaveBeenCalledWith(expect.objectContaining({ kinds: ["event"] })));
    expect(screen.queryByTestId("discover-category-person")).not.toBeInTheDocument();
  });

  it("does not fake a featured grid with fewer than three items", async () => {
    setFeed(ITEMS.slice(0, 2));
    await renderDiscover();
    await screen.findByTestId("regions-grid");
    expect(screen.queryByTestId("discover-featured")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("regions-grid")).getAllByTestId(/^content-card-/)).toHaveLength(2);
  });
});

describe("2 · the saved strip and device-local favourites", () => {
  it("keeps Saved in the grid as a route, not a filter", async () => {
    await renderDiscover();
    const strip = await screen.findByTestId("explore-categories");
    const saved = within(strip).getByTestId("discover-saved-pill");
    expect(saved).toHaveAttribute("href", "/discover/favorites");
    expect(saved.querySelector("svg")).toBeTruthy();
    expect(within(strip).getByTestId("explore-kind-listing").querySelector("svg")).toBeTruthy();

    fireEvent.click(within(strip).getByRole("button", { name: /goods/i }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/discover/goods"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("kind=listing"));
  });

  it("saves a card on this device and opens the Saved route", async () => {
    await renderDiscover();
    const grid = await screen.findByTestId("regions-grid");
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

describe("3 · smart category routes", () => {
  it("maps /discover/goods to offers and public sales", async () => {
    await renderDiscover("/discover/goods");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/discover/goods"));
    await waitFor(() => {
      const text = screen.getByTestId("location").textContent;
      expect(text).toContain("kind=listing");
      expect(text).toContain("intent=offers");
      expect(text).toContain("public_sale=true");
    });
  });

  it("maps /discover/rentals and /discover/trending", async () => {
    await renderDiscover("/discover/rentals");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("kind=rental"));
  });

  it("maps /discover/trending to the feed flag", async () => {
    await renderDiscover("/discover/trending");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("feed=trending"));
  });

  it("lets an explicit query win over the path default", async () => {
    await renderDiscover("/discover/goods?kind=rental&public_sale=false");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("kind=rental"));
    expect(screen.getByTestId("location").textContent).toContain("public_sale=false");
    expect(screen.getByTestId("location").textContent).not.toContain("public_sale=true");
  });

  it("opens the Services door as a provider directory", async () => {
    await renderDiscover("/discover/services");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("kind=service"));
    expect(await screen.findByTestId("service-providers-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("explore-more-filters")).not.toBeInTheDocument();
    expect(screen.queryByTestId("regions-trust")).not.toBeInTheDocument();
  });
});

describe("4 · cold-start backfill", () => {
  it("shows nearby Level 1–2 pages at 50 km instead of an empty page", async () => {
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
    expect(screen.queryByTestId("explore-empty")).not.toBeInTheDocument();
  });
});

describe("5 · the Level 3+ door never dead-ends", () => {
  it("falls back to Level 2+ when fewer than four Level 3 traders exist", async () => {
    setFeed(ITEMS.slice(0, 4));
    await renderDiscover("/discover/verified");
    await waitFor(() => {
      const text = screen.getByTestId("location").textContent;
      expect(text).toContain("trust=3");
      expect(text).toContain("min_level=3");
    });
    const featured = await screen.findByTestId("discover-featured");
    expect(within(featured).getByText("School uniform tailoring")).toBeInTheDocument();
    expect(
      within(featured).getAllByTestId("region-card-level").some((node) => node.textContent === "Lvl 2"),
    ).toBe(true);
    expect(screen.queryByTestId("explore-filtered-empty")).not.toBeInTheDocument();
  });

  it("shows an all-levels Popular rail instead of a dead end", async () => {
    setFeed([{ ...ITEMS[2], owner: { ...lowOwner, contact_exposed: false } }]);
    await renderDiscover("/discover/verified");
    const fallback = await screen.findByTestId("explore-filtered-empty");
    expect(within(fallback).getByText(/No Level 3\+ traders here yet/)).toBeInTheDocument();
    expect(within(fallback).getByRole("heading", { name: /Popular in .*all levels/i })).toBeInTheDocument();

    fireEvent.click(within(fallback).getByRole("button", { name: /show every page/i }));
    await waitFor(() => expect(screen.getByTestId("regions-grid")).toBeInTheDocument());
  });
});
