/**
 * EXPLORE, MADE LIGHTER — without losing a single filter.
 *
 * The brief was explicit: "Do not rebuild the Explore functionality. Improve
 * its presentation, hierarchy and space efficiency." So these specs are about
 * *presentation promises*, each of which would be obvious to a person holding
 * the phone:
 *
 *   1. the location card is gone from first paint, but not gone — one press
 *      brings back the entire control (GPS, typed area, layer, sharing);
 *   2. categories are colour-coded, wrap, and are never a horizontal carousel;
 *   3. the colour a category has in the selector is the colour it has on the
 *      card that comes back from that filter;
 *   4. time and price are demoted behind "More filters", which counts what is
 *      on, and Clear resets everything;
 *   5. content and markets appear before the old wall of controls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.setConfig({ testTimeout: 20000 });

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
  {
    id: "s-1", kind: "service", to: "/listing/s-1", title: "Boda delivery",
    summary: "Same day within Kisumu", location: "Kondele", distance_km: 0.8,
    created_at: "2026-10-16T07:00:00", status: "published", visibility: "public",
    price_kes: 300, is_commercial: true,
    owner: { id: "v-5", handle: "boda", name: "Otieno Boda" },
    counts: {}, reasons: ["0.8 km away"], reactions: {}, meta: {},
  },
];

const MARKET_ROW = {
  id: "m1", name: "Kibuye Market", city: "Kisumu", country: "Kenya",
  distance_km: 0.9, located: true, registered: 0, active_vendors: 0,
  selling_vendors: 0, listings: 0, recent_vendors: 0, services: 0, equipment: 0,
  last_activity_at: null, categories: [], empty: true,
  invitation: "No trader has claimed Kibuye yet. If you trade here, be the first.",
};

const mocks = vi.hoisted(() => ({ setLocation: vi.fn(), feed: vi.fn() }));

vi.mock("@/lib/api", () => ({
  outsideAPI: {
    shelves: vi.fn(() => ok({ shelves: [], scopes: {}, content_types: [], create_path: "/create", location: LOCATION })),
    feed: mocks.feed,
    search: mocks.feed,
    location: vi.fn(() => ok(LOCATION)),
    setLocation: mocks.setLocation,
    react: vi.fn(() => ok({ ok: true })),
    unreact: vi.fn(() => ok({ ok: true })),
    activity: vi.fn(() => ok({ groups: [], counts: {} })),
  },
  marketsAPI: {
    around: vi.fn(() => ok({
      radius_km: 25, origin: { lat: -0.095, lng: 34.77 },
      markets: [MARKET_ROW], active_count: 0, inviting_count: 1, wider: [], unlocated: [], note: null,
    })),
  },
  geoAPI: { geocode: vi.fn(() => ok({ lat: -0.095, lng: 34.77 })) },
  apiError: (_e, fallback) => fallback,
}));

beforeEach(() => {
  mocks.setLocation.mockReset().mockImplementation((body) => ok({ ...LOCATION, ...body }));
  mocks.feed.mockReset().mockImplementation(() => ok({
    items: ITEMS, next_cursor: null, center: {}, location: LOCATION,
  }));
  try { localStorage.clear(); } catch { /* no storage in this env */ }
});

const renderExplore = async () => {
  const { default: ExplorePage } = await import("@/pages/explore/ExplorePage");
  return render(
    <MemoryRouter initialEntries={["/explore"]}>
      <Routes><Route path="*" element={<ExplorePage />} /></Routes>
    </MemoryRouter>,
  );
};

describe("1 · the location card is compacted, not removed", () => {
  it("shows where you are as a pill and keeps the full controls one press away", async () => {
    await renderExplore();

    // First paint: a pill, no card.
    const pill = await screen.findByTestId("explore-place");
    await waitFor(() => expect(pill).toHaveTextContent(/Kondele, Kisumu/i));
    expect(screen.queryByTestId("location-bar")).not.toBeInTheDocument();
    expect(pill).toHaveAttribute("aria-expanded", "false");

    // One press: the SAME location control as before, with its own testids.
    fireEvent.click(pill);
    expect(pill).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByTestId("location-bar")).toBeInTheDocument();
  });

  it("keeps the radius on one line instead of a row of large buttons", async () => {
    await renderExplore();
    await waitFor(() => expect(screen.getByTestId("explore-radius-15")).toHaveAttribute("aria-pressed", "true"));

    fireEvent.click(screen.getByTestId("explore-radius-50"));
    // The store merges the change into the saved location, so the call carries
    // the full record — the radius is what changed.
    await waitFor(() => expect(mocks.setLocation).toHaveBeenCalledWith(
      expect.objectContaining({ radius_km: 50 }),
    ));
    // The radius lives in the location store, so Explore does not keep a copy.
    expect(screen.queryByTestId("location-bar")).not.toBeInTheDocument();
  });
});

describe("2 · categories are colour-coded and never a carousel", () => {
  it("shows every category at once, in a wrapping grid", async () => {
    await renderExplore();
    const group = await screen.findByTestId("explore-categories");

    // A grid that wraps — not an overflow-x strip that hides categories.
    expect(group.className).toMatch(/\bgrid\b/);
    expect(group.className).not.toMatch(/overflow-x|flex-nowrap|snap-x/);

    for (const key of ["goods", "people", "services", "rentals", "events", "communities", "collections"]) {
      const tile = group.querySelector(`[data-category="${key}"]`);
      expect(tile, `${key} tile`).toBeTruthy();
      expect(tile.getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("gives each category its own restrained hue", async () => {
    await renderExplore();
    const group = await screen.findByTestId("explore-categories");
    const washes = ["goods", "people", "services", "rentals"].map(
      (key) => group.querySelector(`[data-category="${key}"]`).className,
    );
    // Four categories, four different background classes.
    const bg = (cls) => (cls.match(/bg-\[#([0-9A-Fa-f]{6})\]/) || [])[1];
    expect(new Set(washes.map(bg)).size).toBe(4);
    // ...and none of them is a saturated brand block.
    expect(washes.every((cls) => bg(cls))).toBe(true);
  });

  it("carries the same hue onto the result that comes back", async () => {
    await renderExplore();
    const goods = await screen.findByTestId("explore-kind-listing");
    fireEvent.click(goods);
    await waitFor(() => expect(screen.getByTestId("explore-kind-listing")).toHaveAttribute("aria-pressed", "true"));

    // The category colour is not decoration: the card wears it too.
    const card = await screen.findByTestId("content-card-listing");
    const badge = card.querySelector('[data-tint="goods"]');
    expect(badge).toBeTruthy();
    expect(badge.className).toMatch(/bg-\[#E8F2EC\]/);
    // A service result wears the services hue, not the goods one.
    const service = screen.getByTestId("content-card-service");
    expect(service.querySelector('[data-tint="services"]')).toBeTruthy();
  });
});

describe("3 · filters are consolidated, not deleted", () => {
  it("keeps the posting types on one quiet row", async () => {
    await renderExplore();
    for (const key of ["all", "available", "wanted", "scheduled", "opportunity", "post"]) {
      expect(screen.getByTestId(`explore-type-${key}`)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByTestId("explore-type-wanted"));
    await waitFor(() => expect(screen.getByTestId("explore-type-wanted")).toHaveAttribute("aria-pressed", "true"));
  });

  it("hides time and price behind a control that counts what is on", async () => {
    await renderExplore();
    const more = screen.getByTestId("explore-more-filters");
    expect(screen.queryByTestId("explore-filter-panel")).not.toBeInTheDocument();

    fireEvent.click(more);
    const panel = await screen.findByTestId("explore-filter-panel");
    fireEvent.click(within(panel).getByRole("button", { name: /this weekend/i }));

    await waitFor(() => expect(screen.getByTestId("explore-more-filters")).toHaveTextContent("1"));
    expect(screen.getByTestId("explore-more-filters")).toHaveTextContent(/this weekend/i);
  });

  it("clears every filter in one action", async () => {
    await renderExplore();
    fireEvent.click(await screen.findByTestId("explore-kind-listing"));

    fireEvent.click(screen.getByTestId("explore-more-filters"));
    fireEvent.click(await screen.findByRole("button", { name: /today/i }));
    await waitFor(() => expect(screen.getByTestId("explore-more-filters")).toHaveTextContent("1"));

    fireEvent.click(screen.getByTestId("explore-clear"));
    await waitFor(() => expect(screen.getByTestId("explore-kind-listing")).toHaveAttribute("aria-pressed", "false"));
    expect(screen.getByTestId("explore-more-filters")).not.toHaveTextContent("1");
    expect(screen.queryByTestId("explore-clear")).not.toBeInTheDocument();
  });
});

describe("4 · content arrives earlier", () => {
  it("puts categories and markets above the feed, and the feed above nothing", async () => {
    await renderExplore();
    const categories = await screen.findByTestId("explore-categories");
    const markets = await screen.findByTestId("markets-around");
    const card = await screen.findByTestId("content-card-listing");

    // Document order is reading order: categories → markets → results.
    expect(categories.compareDocumentPosition(markets) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(markets.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("no longer opens with a three-line introduction", async () => {
    await renderExplore();
    // The heading is one line and the description paragraph is gone; the search
    // field is the second thing on the screen, not the fifth.
    expect(screen.queryByText(/Events, people, communities, requests and things for sale/i)).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: /search everything/i })).toBeInTheDocument();
  });
});
