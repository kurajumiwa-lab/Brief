/**
 * THE REGION SHELF, REBUILT — and the rules it must never break.
 *
 * The review of the Regions screen found four things: repeated search and
 * filter surfaces, an under-informative "Around You" card, inconsistent
 * category cards, and a nearby list that said "We couldn't load what's around
 * you" and stopped there.
 *
 * The first three are presentation. The fourth was a functional fault, and it
 * is the reason this file exists: a failed list must name its cause, offer a
 * retry, keep the rest of the screen alive, and — above all — never present a
 * missing number as a zero. A marketplace that shows "0 listings" because the
 * request failed is telling a person their town is empty when the truth is
 * that the app did not ask.
 *
 * These specs cover:
 *
 *   1. ONE search, ONE category grid, ONE filters door;
 *   2. the regional spotlight's counts — true, or a dash, never a zero;
 *   3. a chosen region being a real scope, and a way back to "around me";
 *   4. location permission that can be refused without breaking the screen;
 *   5. a failed nearby list that says why, retries, and falls back;
 *   6. the compact "items on sale" empty state with a way to change it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

const ok = (data) => Promise.resolve({ data });

const LOCATION = {
  lat: -0.095, lng: 34.77, label: "Kondele, Kisumu", radius_km: 15,
  layer: "town", source: "manual", interests: [], share_location: false,
  explainable: true,
};

const LISTING = {
  id: "l-1", kind: "listing", to: "/listing/l-1", title: "Maize flour 2kg",
  summary: "Wholesale bags in stock", location: "Kisumu central", distance_km: 2.1,
  created_at: "2026-10-16T07:00:00", status: "published", visibility: "public",
  price_kes: 180, is_commercial: true,
  owner: { id: "v-4", handle: "milimani", name: "Milimani Cereals" },
  counts: { available: 40 }, reasons: ["2.1 km away"], reactions: {}, meta: { unit: "kg" },
};

const SERVICE = {
  id: "s-1", kind: "service", to: "/listing/s-1", title: "Boda delivery",
  summary: "Same day within Kisumu", location: "Kondele", distance_km: 0.8,
  created_at: "2026-10-16T07:00:00", status: "published", visibility: "public",
  price_kes: 300, is_commercial: true,
  owner: { id: "v-5", handle: "boda", name: "Otieno Boda" },
  counts: {}, reasons: ["0.8 km away"], reactions: {}, meta: {},
};

const mocks = vi.hoisted(() => ({ feed: vi.fn(), providers: vi.fn(), spotted: vi.fn() }));

vi.mock("@/lib/api", () => ({
  outsideAPI: {
    shelves: vi.fn(() => ok({ shelves: [], scopes: {}, content_types: [], create_path: "/create" })),
    feed: mocks.feed,
    search: mocks.feed,
    location: vi.fn(() => ok(LOCATION)),
    setLocation: vi.fn((body) => ok({ ...LOCATION, ...body })),
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

async function renderRegions(path = "/regions") {
  const { useOutsideStore } = await import("@/stores/outsideStore");
  const { default: RegionsPage } = await import("@/pages/regions/RegionsPage");
  const { default: ExplorePage } = await import("@/pages/explore/ExplorePage");
  useOutsideStore.setState({
    items: [], cursor: null, status: "idle", error: "", failure: null,
    kinds: null, lastQuery: null, scope: null, location: null, locationStatus: "idle",
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/regions" element={<RegionsPage />} />
        <Route path="/regions/:slug" element={<div>Region page</div>} />
        <Route path="/map" element={<div>Map screen</div>} />
        <Route path="/create" element={<div>Create screen</div>} />
        <Route path="*" element={<ExplorePage regionAware />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{pathname}{search}</output>;
}

beforeEach(() => {
  mocks.feed.mockReset().mockImplementation(() =>
    ok({ items: [LISTING, SERVICE], next_cursor: null, center: {}, location: LOCATION }));
  mocks.providers.mockReset().mockImplementation(() =>
    ok({ providers: [], count: 0, total: 0, limit: 30, filters: {}, note: "" }));
  mocks.spotted.mockReset().mockImplementation(() => ok([]));
  try { localStorage.clear(); } catch { /* no storage */ }
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ────────────────────────────────────────────────────────────────────────── */

describe("1 · one search, one category grid, one filters door", () => {
  it("never shows two search fields or two filter surfaces", async () => {
    await renderRegions();
    await screen.findByTestId("region-spotlight");

    // One field. The header's own search is hidden on the discovery routes,
    // because the page's field answers the same question in the same place.
    expect(screen.getAllByRole("searchbox", { name: /search everything/i })).toHaveLength(1);

    // One category grid, wrapping rather than scrolling sideways.
    const grid = screen.getByTestId("explore-categories");
    expect(grid.className).toMatch(/\bgrid\b/);
    expect(grid.className).not.toMatch(/overflow-x|snap-x/);

    // One filters door, and nothing else that opens a filter panel.
    expect(screen.getAllByTestId("explore-more-filters")).toHaveLength(1);
    expect(screen.queryByTestId("explore-filter-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("discover-quick-filters")).not.toBeInTheDocument();
  });

  it("counts the filters that are on, and clears them in one action", async () => {
    await renderRegions();
    await screen.findByTestId("region-spotlight");

    fireEvent.click(screen.getByTestId("explore-more-filters"));
    const panel = await screen.findByTestId("explore-filter-panel");
    fireEvent.click(within(panel).getByRole("button", { name: /this weekend/i }));

    await waitFor(() => expect(screen.getByTestId("explore-more-filters")).toHaveTextContent("1"));

    fireEvent.click(screen.getByTestId("explore-clear-all"));
    await waitFor(() => expect(screen.getByTestId("explore-more-filters")).not.toHaveTextContent("1"));
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe("2 · the regional spotlight tells the truth", () => {
  it("counts the records it holds and says where they came from", async () => {
    await renderRegions();
    const spotlight = await screen.findByTestId("region-spotlight");

    await waitFor(() =>
      expect(within(spotlight).getByTestId("region-metric-listings")).toHaveTextContent("1"));
    expect(within(spotlight).getByTestId("region-metric-businesses")).toHaveTextContent("2");
    expect(within(spotlight).getByTestId("region-metric-offers")).toHaveTextContent("2");
    expect(within(spotlight).getByTestId("region-metrics-note")).toHaveTextContent(
      /from the 2 results loaded for Nyanza/i,
    );
  });

  it("shows a dash, never a zero, while the results are still loading", async () => {
    let release;
    mocks.feed.mockImplementation(() => new Promise((resolve) => { release = () => resolve(ok({ items: [], next_cursor: null, center: {}, location: LOCATION })); }));
    await renderRegions();

    const spotlight = await screen.findByTestId("region-spotlight");
    expect(within(spotlight).getByTestId("region-metric-listings")).toHaveTextContent("—");
    expect(within(spotlight).getByTestId("region-metrics-note")).toHaveTextContent(
      /once the results/i,
    );
    release?.();
  });

  it("says the counts are unavailable when the list failed, and never says zero", async () => {
    mocks.feed.mockRejectedValue(Object.assign(new Error("boom"), {
      response: { status: 503, data: { detail: "The database is reachable but its tables do not exist yet" } },
    }));
    await renderRegions();

    const spotlight = await screen.findByTestId("region-spotlight");
    await waitFor(() =>
      expect(within(spotlight).getByTestId("region-metrics-note")).toHaveTextContent(/unavailable/i));
    expect(within(spotlight).getByTestId("region-metric-listings")).toHaveTextContent("—");
    expect(within(spotlight).getByTestId("region-metric-listings")).not.toHaveTextContent("0");
  });

  it("names the region and offers one clear action", async () => {
    await renderRegions();
    const spotlight = await screen.findByTestId("region-spotlight");
    expect(within(spotlight).getByRole("heading", { name: "Nyanza" })).toBeInTheDocument();
    expect(within(spotlight).getByTestId("region-open")).toHaveAttribute("href", "/regions/nyanza");
    expect(within(spotlight).getByTestId("region-post")).toBeInTheDocument();
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe("3 · a chosen region is a real scope", () => {
  it("asks the feed for the region's hub and a wide radius", async () => {
    await renderRegions("/regions?region=nyanza");
    await waitFor(() =>
      expect(mocks.feed).toHaveBeenCalledWith(expect.objectContaining({
        lat: -0.0917, lng: 34.768, radius_km: 50,
      })));
    // And the screen says where the results are looking from.
    expect(await screen.findByTestId("regions-scope-label")).toHaveTextContent(/Centred on Kisumu/i);
  });

  it("leaves an inferred region alone — it must not move the search away from you", async () => {
    await renderRegions();
    await screen.findByTestId("region-spotlight");
    await waitFor(() => expect(mocks.feed).toHaveBeenCalled());
    const params = mocks.feed.mock.calls[0][0];
    expect(params.lat).toBeUndefined();
    expect(params.lng).toBeUndefined();
    expect(await screen.findByTestId("regions-scope-label")).toHaveTextContent(/Kondele, Kisumu/i);
  });

  it("puts the search back on you when you ask for your own location", async () => {
    await renderRegions("/regions?region=nyanza");
    await screen.findByTestId("region-spotlight");
    await waitFor(() => expect(mocks.feed).toHaveBeenCalled());

    const { useOutsideStore } = await import("@/stores/outsideStore");
    // The device refuses the permission: the region scope must survive it.
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (_ok, fail) => fail({ code: 1 }) },
    });

    fireEvent.click(screen.getByTestId("regions-scope-toggle"));
    fireEvent.click(await screen.findByRole("button", { name: /use my location/i }));

    await waitFor(() => expect(useOutsideStore.getState().locationStatus).toBe("denied"));
    expect(await screen.findByText(/permission declined/i)).toBeInTheDocument();
    // The screen still has a scope, and it is still the region.
    expect(screen.getByTestId("regions-scope-label")).toHaveTextContent(/Centred on Kisumu/i);
  });

  it("says so when the device cannot share a location at all", async () => {
    await renderRegions();
    await screen.findByTestId("region-spotlight");

    const { useOutsideStore } = await import("@/stores/outsideStore");
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });

    fireEvent.click(screen.getByTestId("regions-scope-toggle"));
    fireEvent.click(await screen.findByRole("button", { name: /use my location/i }));

    await waitFor(() => expect(useOutsideStore.getState().locationStatus).toBe("unavailable"));
    expect(await screen.findByText(/can.t share a location/i)).toBeInTheDocument();
    // The typed area is still there: a refusal is a change of route, not a
    // dead end.
    expect(screen.getByTestId("regions-area-input")).toBeInTheDocument();
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe("4 · a failed nearby list says why, and stays alive", () => {
  it("names the failure, offers a retry, and keeps the rest of the screen", async () => {
    mocks.feed.mockRejectedValue(Object.assign(new Error("boom"), {
      response: { status: 500, data: { detail: "upstream exploded" } },
    }));
    await renderRegions();

    const panel = await screen.findByTestId("explore-error");
    expect(within(panel).getByText(/server hit a problem/i)).toBeInTheDocument();
    // The server's own words are support material, never the headline.
    expect(within(panel).getByText(/technical note/i)).toBeInTheDocument();
    expect(within(panel).getByTestId("explore-retry")).toBeInTheDocument();

    // The region, the categories and the scope are all still on screen: one
    // broken list does not take the screen with it.
    expect(screen.getByTestId("region-spotlight")).toBeInTheDocument();
    expect(screen.getByTestId("explore-categories")).toBeInTheDocument();
  });

  it("retries the same request when asked", async () => {
    mocks.feed.mockRejectedValueOnce(Object.assign(new Error("boom"), { response: { status: 500 } }));
    await renderRegions();

    await screen.findByTestId("explore-error");
    mocks.feed.mockReset().mockImplementation(() =>
      ok({ items: [LISTING], next_cursor: null, center: {}, location: LOCATION }));

    fireEvent.click(screen.getByTestId("explore-retry"));
    expect(await screen.findByTestId("content-card-listing")).toBeInTheDocument();
    expect(screen.queryByTestId("explore-error")).not.toBeInTheDocument();
  });

  it("never turns a failed request into a count of zero", async () => {
    mocks.feed.mockRejectedValue(Object.assign(new Error("boom"), { response: { status: 500 } }));
    await renderRegions();

    await screen.findByTestId("explore-error");
    const deck = screen.getByTestId("discover-shop-toolbar");
    expect(within(deck).getByTestId("explore-count")).toHaveTextContent(/couldn.t load/i);
    expect(within(deck).getByTestId("explore-count")).not.toHaveTextContent("0");
  });

  it("keeps the rows on screen when only the NEXT page fails", async () => {
    mocks.feed.mockImplementation((params) => {
      if (params?.cursor) return Promise.reject(Object.assign(new Error("boom"), { response: { status: 500 } }));
      return ok({ items: [LISTING], next_cursor: "cursor-1", center: {}, location: LOCATION });
    });
    await renderRegions();

    expect(await screen.findByTestId("content-card-listing")).toBeInTheDocument();
    const { useOutsideStore } = await import("@/stores/outsideStore");
    await useOutsideStore.getState().loadMore();
    await waitFor(() => expect(useOutsideStore.getState().items).toHaveLength(1));
    expect(screen.getByTestId("content-card-listing")).toBeInTheDocument();
  });

  it("falls back to what is nearby when the region itself is quiet", async () => {
    mocks.feed.mockImplementation((params) => {
      if (params?.radius_km === 50) {
        return ok({
          items: [{ ...LISTING, id: "far-1", title: "Village tailor", distance_km: 42 }],
          next_cursor: null, center: {}, location: LOCATION,
        });
      }
      return ok({ items: [], next_cursor: null, center: {}, location: LOCATION });
    });
    await renderRegions();

    const cold = await screen.findByTestId("discover-cold-start");
    expect(within(cold).getByText(/Quiet within 15 km/i)).toBeInTheDocument();
    expect(within(cold).getByText("Village tailor")).toBeInTheDocument();
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe("5 · items on sale has a compact empty state with a way out", () => {
  it("offers a seller and a spotter when nothing is priced", async () => {
    mocks.feed.mockImplementation(() =>
      ok({ items: [], next_cursor: null, center: {}, location: LOCATION }));
    await renderRegions();

    const empty = await screen.findByTestId("discover-deals-empty");
    expect(within(empty).getByText(/no priced items here yet/i)).toBeInTheDocument();
    expect(within(empty).getByTestId("discover-deals-publish")).toBeInTheDocument();
    expect(within(empty).getByTestId("discover-deals-spot")).toBeInTheDocument();
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe("6 · the list and the map are two views of one search", () => {
  it("carries the search to the map and offers the way back", async () => {
    await renderRegions("/regions?q=rice&region=nyanza");
    await screen.findByTestId("region-spotlight");

    fireEvent.click(screen.getByTestId("regions-view-map"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/map?"));
    const href = screen.getByTestId("location").textContent;
    expect(href).toContain("q=rice");
    expect(href).toContain("region=nyanza");
  });
});
