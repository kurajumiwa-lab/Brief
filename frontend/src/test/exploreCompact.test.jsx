/**
 * EXPLORE, MADE LIGHTER — without losing a single filter.
 *
 * The brief was explicit: "Do not rebuild the Explore functionality. Improve
 * its presentation, hierarchy and space efficiency." So these specs are about
 * *presentation promises*, each of which would be obvious to a person holding
 * the phone:
 *
 *   1. the location card is gone from first paint, but not gone — one press
 *      brings back the entire control (GPS, typed area, radius, layer);
 *   2. the FIVE categories are colour-coded, wrap, and are never a carousel;
 *   3. the colour a category has in the selector is the colour it has on
 *      the card that comes back from that filter;
 *   4. time, price and the posting types are demoted behind one door that
 *      counts AND names what is on, and Clear resets everything;
 *   5. content arrives before the furniture.
 *
 * What these specs deliberately do NOT ask for any more: a market strip, a
 * row of posting types permanently on screen, a seven-tile category grid, or
 * a second search field. Those were the "repeated surfaces" the brief asked
 * to lose, and the screen is better without them.
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
      markets: [], active_count: 0, inviting_count: 0, wider: [], unlocated: [], note: null,
    })),
  },
  serviceProviderAPI: { list: vi.fn(() => ok({ providers: [], count: 0, total: 0, limit: 24, filters: {}, note: "" })) },
  spottedDealAPI: { list: vi.fn(() => ok([])) },
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

    // First paint: ONE pill that says what the results are looking from, and
    // no location card. The knob beside it chooses a region; the pill is the
    // sentence about the scope, and it is the door to the full controls.
    const pill = await screen.findByTestId("regions-scope-label");
    await waitFor(() => expect(pill).toHaveTextContent(/Kondele, Kisumu/i));
    expect(screen.queryByTestId("location-bar")).not.toBeInTheDocument();
    expect(pill).toHaveAttribute("aria-expanded", "false");

    // One press: the SAME location control as before, with its own testids.
    fireEvent.click(pill);
    expect(pill).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByTestId("location-bar")).toBeInTheDocument();
  });

  it("keeps the radius one press away, on one line instead of a row of large buttons", async () => {
    await renderExplore();
    fireEvent.click(await screen.findByTestId("regions-scope-label"));

    await waitFor(() =>
      expect(screen.getByTestId("radius-15")).toHaveAttribute("aria-pressed", "true"));

    fireEvent.click(screen.getByTestId("radius-50"));
    // The store merges the change into the saved location, so the call carries
    // the full record — the radius is what changed.
    await waitFor(() => expect(mocks.setLocation).toHaveBeenCalledWith(
      expect.objectContaining({ radius_km: 50 }),
    ));
    // The radius lives in the location store, so Explore does not keep a copy.
    expect(screen.queryByTestId("radius-15")).toHaveAttribute("aria-pressed", "false");
  });
});

describe("2 · categories are colour-coded and never a carousel", () => {
  it("shows every one of the five categories at once, in a wrapping grid", async () => {
    await renderExplore();
    const group = await screen.findByTestId("explore-categories");

    // A grid that wraps — not an overflow-x strip that hides categories.
    expect(group.className).toMatch(/\bgrid\b/);
    expect(group.className).not.toMatch(/overflow-x|flex-nowrap|snap-x/);

    for (const key of ["all", "goods", "services", "rentals", "events"]) {
      const tile = group.querySelector(`[data-category="${key}"]`);
      expect(tile, `${key} tile`).toBeTruthy();
      // Nothing is filtered yet, so only "All" is pressed.
      expect(tile.getAttribute("aria-pressed")).toBe(key === "all" ? "true" : "false");
    }
    // Five categories. Not seven, and not a second vocabulary.
    expect(group.querySelectorAll("[data-category]")).toHaveLength(5);
  });

  it("gives each category its own restrained hue", async () => {
    await renderExplore();
    const group = await screen.findByTestId("explore-categories");
    const washes = ["goods", "services", "rentals", "events"].map(
      (key) => group.querySelector(`[data-category="${key}"]`).className,
    );
    // Four categories, four different background classes…
    const bg = (cls) => (cls.match(/bg-cat-[a-z-]+/) || [])[0];
    expect(new Set(washes.map(bg)).size).toBe(4);
    // …and every one of them is a soft wash from the shared palette, never a
    // saturated brand block.
    expect(washes.every((cls) => bg(cls) && bg(cls).endsWith("-soft"))).toBe(true);
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
    expect(badge.className).toMatch(/bg-cat-goods-soft/);
    // A service result wears the services hue, not the goods one.
    const service = screen.getByTestId("content-card-service");
    expect(service.querySelector('[data-tint="services"]')).toBeTruthy();
  });
});

describe("3 · filters are consolidated, not deleted", () => {
  it("keeps the posting types behind the one filter door", async () => {
    await renderExplore();
    // Nothing is permanently on screen: a screen showing five filter chips at
    // all times shows none of them clearly.
    expect(screen.queryByTestId("explore-type-available")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("explore-more-filters"));
    const panel = await screen.findByTestId("explore-filter-panel");
    for (const key of ["all", "available", "wanted", "scheduled", "opportunity", "post"]) {
      expect(within(panel).getByTestId(`explore-type-${key}`)).toBeInTheDocument();
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
    // It says what is on, not only how much: a filter hidden behind a number
    // is a filter nobody can find.
    expect(screen.getByTestId("explore-more-filters")).toHaveTextContent(/this weekend/i);
  });

  it("clears every filter in one action", async () => {
    await renderExplore();
    fireEvent.click(await screen.findByTestId("explore-kind-listing"));

    fireEvent.click(screen.getByTestId("explore-more-filters"));
    fireEvent.click(await screen.findByRole("button", { name: /today/i }));
    await waitFor(() => expect(screen.getByTestId("explore-more-filters")).toHaveTextContent("1"));

    fireEvent.click(screen.getByTestId("explore-clear-all"));
    await waitFor(() => expect(screen.getByTestId("explore-kind-listing")).toHaveAttribute("aria-pressed", "false"));
    expect(screen.getByTestId("explore-more-filters")).not.toHaveTextContent("1");
    expect(screen.queryByTestId("explore-clear-all")).not.toBeInTheDocument();
  });
});

describe("4 · content arrives earlier", () => {
  it("puts the categories above the results, and the results above nothing", async () => {
    await renderExplore();
    const categories = await screen.findByTestId("explore-categories");
    const card = await screen.findByTestId("content-card-listing");

    // Document order is reading order: categories → results.
    expect(categories.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The market strip is gone: a market is a place you go to, not a feed.
    expect(screen.queryByTestId("market-strip")).not.toBeInTheDocument();
  });

  it("no longer opens with a three-line introduction", async () => {
    await renderExplore();
    // The heading is one line and the description paragraph is gone; the search
    // field is the second thing on the screen, not the fifth.
    expect(screen.queryByText(/Events, people, communities, requests and things for sale/i)).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: /search everything/i })).toBeInTheDocument();
  });
});
