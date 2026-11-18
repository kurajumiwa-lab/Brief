/**
 * REGIONS IS DISCOVERY AGAIN — with a region knob, not a market knob.
 *
 * The old discovery screen is the right shape: one search, the four posting
 * types, colour-coded categories, filters and results. What was wrong was the
 * place control. It named a market ("Gikomba"), which made the app read like a
 * directory of stalls and went stale as soon as a trader moved.
 *
 * These specs pin the reversion and the one change:
 *
 *   1. /regions renders the discovery layout, including the type row;
 *   2. the knob is the region, derived from where the person is;
 *   3. picking a region is shareable (URL) and lands on that region's page;
 *   4. no market strip, no GPS second answer, no "Gikomba";
 *   5. search scopes and the type row still drive the one feed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

const ok = (data) => Promise.resolve({ data });

const LOCATION = {
  lat: -0.095, lng: 34.77, label: "Kondele, Kisumu", radius_km: 15,
  layer: "town", source: "manual", interests: [], share_location: false,
  explainable: true,
};

const ITEMS = [
  {
    id: "l-1", kind: "listing", to: "/listing/l-1", title: "Maize flour 2kg",
    summary: "Wholesale bags in stock", location: "Kisumu central", distance_km: 2.1,
    created_at: "2026-10-16T07:00:00", status: "published", visibility: "public",
    price_kes: 180, is_commercial: true,
    owner: { id: "v-4", handle: "milimani", name: "Milimani Cereals" },
    counts: { available: 40 }, reasons: ["2.1 km away"], reactions: {}, meta: { unit: "kg" },
  },
];

const mocks = vi.hoisted(() => ({ feed: vi.fn(), market: vi.fn() }));

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
  marketsAPI: { around: mocks.market, list: mocks.market },
  serviceProviderAPI: { list: vi.fn(() => ok({ providers: [], count: 0, total: 0, limit: 24, filters: {}, note: "" })) },
  geoAPI: { geocode: vi.fn(() => ok({ lat: -0.095, lng: 34.77 })) },
  apiError: (_e, fallback) => fallback,
}));

beforeEach(() => {
  mocks.feed.mockReset().mockImplementation(() =>
    ok({ items: ITEMS, next_cursor: null, center: {}, location: LOCATION }));
  mocks.market.mockReset().mockImplementation(() => ok({ markets: [] }));
  try { localStorage.clear(); } catch { /* no storage */ }
});

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{pathname}{search}</output>;
}

async function renderRegions(path = "/regions") {
  const { default: RegionsPage } = await import("@/pages/regions/RegionsPage");
  const { default: DiscoverSectionPage } = await import("@/pages/discover/DiscoverSectionPage");
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/regions" element={<RegionsPage />} />
        <Route path="/regions/all" element={<div>All regions directory</div>} />
        <Route path="/regions/:slug" element={<div>Region page</div>} />
        <Route path="/discover/:section" element={<DiscoverSectionPage />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("1 · the discovery layout is back", () => {
  it("opens with one single-select category strip and one search", async () => {
    await renderRegions();
    expect(await screen.findByRole("heading", { name: "Discover" })).toBeInTheDocument();
    const bar = screen.getByRole("group", { name: /browse by category/i });
    for (const label of ["All", "Goods", "Services", "Rentals", "Rounds", "Spotted"]) {
      expect(within(bar).getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole("navigation", { name: /browse discovery/i })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: /search everything/i })).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole("button", {name: "Services"}));
    await waitFor(() => {
      const nextBar = screen.getByRole("group", { name: /browse by category/i });
      expect(within(nextBar).getByRole("button", { name: "Services" })).toHaveAttribute("aria-pressed", "true");
      expect(within(nextBar).getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false");
    });
    // The Services door is a provider directory: time, price, radius and the
    // standing filter do not apply, so the screen does not show dead controls.
    expect(screen.queryByTestId("explore-more-filters")).not.toBeInTheDocument();
    expect(screen.queryByTestId("regions-trust")).not.toBeInTheDocument();
    expect(await screen.findByTestId("service-providers-empty")).toBeInTheDocument();
  });
});

describe("2 · the knob is a region", () => {
  it("names the region the person is in, not a market", async () => {
    await renderRegions();
    const knob = await screen.findByTestId("region-picker");
    await waitFor(() =>
      expect(screen.getByTestId("region-picker-label")).toHaveTextContent(/Nyanza · Kisumu/i));
    expect(knob).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/gikomba/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("explore-place")).not.toBeInTheDocument();
    expect(screen.queryByTestId("location-bar")).not.toBeInTheDocument();
  });

  it("offers every region, searchable, and picks one from the list", async () => {
    await renderRegions();
    fireEvent.click(await screen.findByTestId("region-picker"));

    const panel = await screen.findByTestId("region-picker-panel");
    expect(within(panel).getByRole("link", { name: /all regions/i })).toHaveAttribute("href", "/regions/all");
    expect(within(panel).getByTestId("region-option-nyanza")).toHaveAttribute("aria-pressed", "true");
    expect(within(panel).getByTestId("region-option-coast")).toBeInTheDocument();

    fireEvent.change(within(panel).getByRole("searchbox"), { target: { value: "mombasa" } });
    await waitFor(() => expect(within(panel).queryByTestId("region-option-nyanza")).not.toBeInTheDocument());

    fireEvent.click(within(panel).getByTestId("region-option-coast"));
    await waitFor(() =>
      expect(screen.getByTestId("region-picker-label")).toHaveTextContent(/Coast · Mombasa/i));
    expect(screen.getByTestId("location")).toHaveTextContent("/regions?region=coast");
    // The same knob reaches the region's own page without a second screen.
    expect(screen.getByTestId("region-context")).toHaveTextContent(/Coast · Mombasa/i);
  });

  it("honours a shared region in the URL over the device's last choice", async () => {
    localStorage.setItem("brief-discovery-region", "coast");
    await renderRegions("/regions?region=western");
    await waitFor(() =>
      expect(screen.getByTestId("region-picker-label")).toHaveTextContent(/Western · Kakamega/i));
  });
});

describe("3 · no market surface survives", () => {
  it("renders no market strip and never asks for markets", async () => {
    await renderRegions();
    await screen.findByTestId("region-picker");
    expect(screen.queryByTestId("market-strip")).not.toBeInTheDocument();
    expect(mocks.market).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: /markets around you/i })).not.toBeInTheDocument();
  });

  it("keeps the region as a scope, not a gate", async () => {
    await renderRegions("/regions?region=nyanza");
    const context = await screen.findByTestId("region-context");
    expect(within(context).getByRole("link", { name: /open region/i })).toHaveAttribute("href", "/regions/nyanza");
    // The feed is still the network's feed — the region names it, it does not
    // hide everything outside a market gate.
    expect(await screen.findByTestId("content-card-listing")).toBeInTheDocument();
  });
});

describe("4 · the design preview renders the same screen without a network", () => {
  it("takes fixture items and a region, and never calls the feed", async () => {
    const { default: ExplorePage } = await import("@/pages/explore/ExplorePage");
    const { REGION_BY_SLUG } = await import("@/config/regions");
    mocks.feed.mockClear();

    render(
      <MemoryRouter>
        <ExplorePage
          regionAware
          demo={{ items: ITEMS, location: LOCATION, region: REGION_BY_SLUG.nyanza }}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("content-card-listing")).toBeInTheDocument();
    expect(screen.getByTestId("region-picker-label")).toHaveTextContent(/Nyanza · Kisumu/i);
    expect(mocks.feed).not.toHaveBeenCalled();
  });
});

describe("5 · old entry points still drive the one feed", () => {
  it("reads ?search= from the header scope into the field", async () => {
    await renderRegions("/regions?search=rice");
    await waitFor(() =>
      expect(screen.getByRole("searchbox", { name: /search everything/i })).toHaveValue("rice"));
  });

  it("maps the Goods tab to the goods filter", async () => {
    await renderRegions("/regions?filter=goods");
    await waitFor(() =>
      expect(within(screen.getByRole("group", {name: /browse by category/i})).getByRole("button", {name: "Goods"})).toHaveAttribute("aria-pressed", "true"));
  });
});
