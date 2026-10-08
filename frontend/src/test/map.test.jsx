import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor, renderHook, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import {
  areaSummary, bboxString, categoryLabel, clusterColor, clusterRadius,
  formatCount, zoomTier, rememberView, clearViews,
} from "@/lib/mapViewport";
import useMapViewport from "@/lib/useMapViewport";

// ─────────────────────────────────────────────────────────────────────────────
// The map's performance contract, asserted from the client side:
//   · a screen is described by a bbox + zoom, never by "everything"
//   · a pan debounces, cancels, and cannot be overwritten by a stale response
//   · when the network is gone the last screenful is shown, not invented
// ─────────────────────────────────────────────────────────────────────────────

const ok = (data) => Promise.resolve({ status: 200, data });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const VIEW = (bbox, zoom = 10) => ({
  bbox, zoom, bbox_key: bbox,
  points: [], clusters: [], counts: { markets: 0, vendors: 0, places: 0 },
});

beforeEach(() => {
  localStorage.clear();
  clearViews();
});

// ── pure helpers ──────────────────────────────────────────────────────────────
describe("counter formatting", () => {
  it("compresses thousands so three chips fit a phone", () => {
    expect(formatCount(25)).toBe("25");
    expect(formatCount(1240)).toBe("1,240");
    expect(formatCount(7640)).toBe("7.6K");
    expect(formatCount(128_000)).toBe("128K");
    expect(formatCount(2_500)).toBe("2.5K");
    expect(formatCount(null)).toBe("0");
  });
});

describe("zoom tiers", () => {
  it("progressively discloses: region → city → market → shop", () => {
    expect(zoomTier(4)).toBe("region");
    expect(zoomTier(9)).toBe("city");
    expect(zoomTier(13)).toBe("market");
    expect(zoomTier(17)).toBe("shop");
  });
});

describe("clusters", () => {
  it("grows with count, but not without limit", () => {
    expect(clusterRadius(2)).toBeLessThan(clusterRadius(200));
    expect(clusterRadius(50_000)).toBeLessThanOrEqual(40);
  });

  it("colours by size so a city reads differently from a street", () => {
    expect(clusterColor(5)).not.toBe(clusterColor(5000));
  });
});

describe("bbox", () => {
  it("serialises Leaflet bounds as minLng,minLat,maxLng,maxLat and pads them", () => {
    const bounds = {
      getSouthWest: () => ({ lat: -1.30, lng: 36.80 }),
      getNorthEast: () => ({ lat: -1.28, lng: 36.84 }),
    };
    const [minLng, minLat, maxLng, maxLat] = bboxString(bounds).split(",").map(Number);
    expect(minLng).toBeLessThan(36.80);
    expect(maxLng).toBeGreaterThan(36.84);
    expect(minLat).toBeLessThan(-1.30);
    expect(maxLat).toBeGreaterThan(-1.28);
  });

  it("clamps to the globe so a wild pan cannot send an invalid box", () => {
    const bounds = {
      getSouthWest: () => ({ lat: -95, lng: -190 }),
      getNorthEast: () => ({ lat: 95, lng: 190 }),
    };
    const [minLng, minLat, maxLng, maxLat] = bboxString(bounds).split(",").map(Number);
    expect(minLat).toBeGreaterThanOrEqual(-90);
    expect(maxLat).toBeLessThanOrEqual(90);
    expect(minLng).toBeGreaterThanOrEqual(-180);
    expect(maxLng).toBeLessThanOrEqual(180);
  });

  it("has nothing to say without bounds", () => {
    expect(bboxString(null)).toBe("");
  });
});

describe("labels", () => {
  it("turns OSM keys into words a trader reads", () => {
    expect(categoryLabel("shop:electronics")).toBe("electronics");
    expect(categoryLabel("amenity:fast_food")).toBe("fast food");
    expect(categoryLabel("")).toBe("business");
  });

  it("summarises an area without inventing anything", () => {
    expect(areaSummary({ places: 7640, vendors: 3, markets: 0 })).toBe("3 vendors · 7.6K places here");
    expect(areaSummary({}, "all")).toBe("Nothing mapped in this area yet");
  });
});

// ── the viewport hook ─────────────────────────────────────────────────────────
describe("useMapViewport", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads one screenful and asks for nothing without a viewport", async () => {
    const fetcher = vi.fn((params) => ok(VIEW(params.bbox)));
    const { result } = renderHook(() => useMapViewport({ bbox: "36.8,-1.3,36.9,-1.2", zoom: 12, fetcher }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toMatchObject({ bbox: "36.8,-1.3,36.9,-1.2", zoom: 12 });
    expect(result.current.data.bbox).toBe("36.8,-1.3,36.9,-1.2");

    const idle = renderHook(() => useMapViewport({ bbox: "", zoom: 12, fetcher }));
    await act(async () => {});
    expect(idle.result.current.data).toBe(null);
  });

  it("debounces a flung map: several moves, one request", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((params) => ok(VIEW(params.bbox)));
    const { rerender } = renderHook(
      ({ bbox }) => useMapViewport({ bbox, zoom: 12, debounceMs: 250, fetcher }),
      { initialProps: { bbox: "1,1,2,2" } },
    );

    await act(async () => { vi.advanceTimersByTime(1); });      // first paint: no wait
    expect(fetcher).toHaveBeenCalledTimes(1);

    rerender({ bbox: "1,1,2.5,2" });
    await act(async () => { vi.advanceTimersByTime(100); });
    rerender({ bbox: "1,1,2.6,2" });
    await act(async () => { vi.advanceTimersByTime(100); });
    rerender({ bbox: "1,1,3,2" });
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(fetcher).toHaveBeenCalledTimes(1);                    // still waiting

    await act(async () => { vi.advanceTimersByTime(300); });
    expect(fetcher).toHaveBeenCalledTimes(2);                    // one for the final position
    expect(fetcher.mock.calls[1][0].bbox).toBe("1,1,3,2");
  });

  it("cancels the request the pan just made stale", async () => {
    vi.useFakeTimers();
    const seen = [];
    const fetcher = vi.fn((params, opts) => { seen.push(opts?.signal); return ok(VIEW(params.bbox)); });
    const { rerender } = renderHook(
      ({ bbox }) => useMapViewport({ bbox, zoom: 12, debounceMs: 0, fetcher }),
      { initialProps: { bbox: "1,1,2,2" } },
    );
    await act(async () => { vi.advanceTimersByTime(1); });
    rerender({ bbox: "3,3,4,4" });
    await act(async () => { vi.advanceTimersByTime(10); });
    expect(seen).toHaveLength(2);
    expect(seen[0].aborted).toBe(true);                          // the first view was abandoned
    expect(seen[1].aborted).toBe(false);
  });

  it("ignores a slow response that arrives after a newer one", async () => {
    const first = deferred();
    const second = deferred();
    const fetcher = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { rerender, result } = renderHook(
      ({ bbox }) => useMapViewport({ bbox, zoom: 12, debounceMs: 0, fetcher }),
      { initialProps: { bbox: "1,1,2,2" } },
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    rerender({ bbox: "5,5,6,6" });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(fetcher).toHaveBeenCalledTimes(2);

    // The OLD area answers last — it must not overwrite the current one.
    await act(async () => { second.resolve({ status: 200, data: VIEW("5,5,6,6") }); });
    await act(async () => { first.resolve({ status: 200, data: VIEW("1,1,2,2") }); });
    expect(result.current.data.bbox).toBe("5,5,6,6");
  });

  it("falls back to the last loaded screenful when the network is gone", async () => {
    rememberView(VIEW("9,9,10,10"));
    const fetcher = vi.fn(() => Promise.reject(new Error("Network Error")));
    const { result } = renderHook(() => useMapViewport({ bbox: "1,1,2,2", zoom: 12, fetcher }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.offline).toBe(true);
    expect(result.current.data.bbox).toBe("9,9,10,10");
  });

  it("says nothing was loaded rather than showing stale pins as fresh", async () => {
    clearViews();
    const fetcher = vi.fn(() => Promise.reject(new Error("Network Error")));
    const { result } = renderHook(() => useMapViewport({ bbox: "1,1,2,2", zoom: 12, fetcher }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe(null);
    expect(result.current.offline).toBe(false);
  });

  it("does not search the whole network for one letter", async () => {
    const fetcher = vi.fn((params) => ok(VIEW(params.bbox)));
    renderHook(() => useMapViewport({ bbox: "", scope: "network", q: "a", fetcher }));
    await act(async () => {});
    expect(fetcher).not.toHaveBeenCalled();
  });
});

// ── the page ──────────────────────────────────────────────────────────────────

// `vi.mock` is hoisted above the module body, so every fixture it closes over
// has to be created with `vi.hoisted` too.
const fixtures = vi.hoisted(() => ({
  placeCalls: [],
  PLACE: { id: "p-1", kind: "places", name: "Kamau Electronics", category: "shop:electronics", lat: -1.28, lng: 36.82, distance_km: 1.2 },
  config: {
    tiles: {
      provider: "openstreetmap", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      subdomains: "abc", attribution: "&copy; OpenStreetMap contributors (ODbL)",
      min_zoom: 2, max_zoom: 19, dev_only: true, note: "development tiles",
    },
    thresholds: { places: 15, vendors: 12, markets: 6 },
    limits: { points_per_layer: 300, max_bbox_deg: 40, cluster_cell_px: 64 },
    quick_filters: [{ value: "food", label: "Food" }],
    viewer: { lat: -1.28, lng: 36.82 },
    default_center: [-1.2867, 36.8172], default_zoom: 12,
  },
  counts: {
    markets: 25, vendors: 0, places: 7640, claimed: 3,
    facets: [{ value: "food", label: "Food", count: 2749 }], categories: [],
  },
  view: {
    bbox: "36.7,-1.4,36.9,-1.2", zoom: 12,
    points: [{ id: "p1", kind: "places", name: "Amina Electronics", category: "shop:electronics", lat: -1.28, lng: 36.82, distance_km: 1.2 }],
    clusters: [{ id: "c1", kind: "places", lat: -1.3, lng: 36.8, count: 1240, sample: ["A", "B"] }],
    counts: { markets: 2, vendors: 1, places: 1240 }, truncated: false,
  },
}));
const PLACE = fixtures.PLACE;

vi.mock("@/lib/api", () => {
  const detail = {
    ...fixtures.PLACE, phone: "+254700000001", opening_hours: "Mo-Sa 09:00-18:00",
    address: "12 Tom Mboya Street", website: "https://example.com", zone_name: "Nairobi CBD",
    last_checked_at: new Date().toISOString(), claimed: false, claimed_by_me: false,
    attribution: "Data \u00a9 OpenStreetMap contributors (ODbL)",
  };
  const apiError = (e, f = "Something went wrong") => e?.message || f;
  return {
    apiError,
    mapAPI: {
      config: vi.fn(() => Promise.resolve({ data: fixtures.config })),
      counts: vi.fn(() => Promise.resolve({ data: fixtures.counts })),
      viewport: vi.fn(() => Promise.resolve({ status: 200, data: fixtures.view })),
      place: vi.fn((id, opts) => { fixtures.placeCalls.push(opts); return Promise.resolve({ data: detail }); }),
      vendor: vi.fn(() => Promise.resolve({ data: {} })),
      market: vi.fn(() => Promise.resolve({ data: {} })),
    },
    geoAPI: { claim: vi.fn(() => Promise.resolve({ data: { changed: true } })) },
    marketsAPI: { join: vi.fn(() => Promise.resolve({ data: {} })) },
  };
});

describe("MapSheet", () => {
  it("fetches a pin's details only once it is open", async () => {
    const { default: MapSheet } = await import("@/components/map/MapSheet");
    render(
      <MemoryRouter>
        <MapSheet item={PLACE} onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Kamau Electronics")).toBeInTheDocument();
    expect(screen.getByText("unverified")).toBeInTheDocument();     // honest until claimed
    expect(fixtures.placeCalls).toHaveLength(1);                     // one pin, one request
    await waitFor(() => expect(screen.getByText("+254700000001")).toBeInTheDocument());
    expect(screen.getByText(/Mo-Sa 09:00-18:00/)).toBeInTheDocument();
    expect(screen.getByText(/OpenStreetMap/)).toBeInTheDocument();   // ODbL travels with the row
  });

  it("cancels the detail request when the sheet is dismissed", async () => {
    const { default: MapSheet } = await import("@/components/map/MapSheet");
    const { unmount } = render(
      <MemoryRouter>
        <MapSheet item={PLACE} onClose={() => {}} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(fixtures.placeCalls.length).toBeGreaterThan(0));
    const signal = fixtures.placeCalls[fixtures.placeCalls.length - 1].signal;
    unmount();
    expect(signal.aborted).toBe(true);
  });
});

// ── the page: counters as filters, one screenful, canvas pins ─────────────────


// jsdom has no 2D canvas. Leaflet's canvas renderer (the thing that keeps the
// map to one DOM node instead of 7,640) needs one, so hand it a no-op context.
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => new Proxy({}, {
    get: (target, key) => (key === "canvas" ? {} : () => {}),
    set: () => true,
  }));
});

describe("MapPage", () => {
  it("renders the counters as filters, and draws one screenful", async () => {
    const { default: MapPage } = await import("@/pages/map/MapPage");
    render(<MemoryRouter><MapPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Markets/)).toBeInTheDocument());
    expect(screen.getByText("7.6K")).toBeInTheDocument();          // the headline chip
    expect(screen.getByPlaceholderText(/Search products/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/1,240 places here/)).toBeInTheDocument());
  });

  it("puts pins on a canvas, not one DOM node each", async () => {
    const { default: MapPage } = await import("@/pages/map/MapPage");
    const { container } = render(<MemoryRouter><MapPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/1,240 places here/)).toBeInTheDocument());
    // One cluster bubble (it has to show a number) and zero DOM pins: the
    // individual place is a canvas circle. 7,640 pins would be 7,640 nodes.
    expect(container.querySelectorAll(".leaflet-marker-icon")).toHaveLength(1);
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
  });

  it("treats a counter as a filter: tapping Markets loads one dataset", async () => {
    const { default: MapPage } = await import("@/pages/map/MapPage");
    const { mapAPI } = await import("@/lib/api");
    render(<MemoryRouter><MapPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/1,240 places here/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Markets/ }));
    await waitFor(() =>
      expect(mapAPI.viewport.mock.calls.some(([params]) => params.kind === "markets")).toBe(true));
    // …and the directory is not queried alongside it.
    const last = mapAPI.viewport.mock.calls.at(-1)[0];
    expect(last.kind).toBe("markets");
  });
});
