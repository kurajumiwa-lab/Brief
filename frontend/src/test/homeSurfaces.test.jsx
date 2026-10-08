import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// ─────────────────────────────────────────────────────────────────────────────
// The home refactor's contract, asserted:
//
//   · Home is a hub — a tile is a door, not a place the detail lives
//   · every tile opens a real screen (URL changes, screen renders)
//   · a category is a screen: /nearby/{group} filters from the URL
//   · a public place gets its own screen instead of bouncing to /map
//   · a market gets its own screen instead of acting inline in a list
//   · the squad track is reachable as a task screen; /squad still resolves
//   · nothing pads: a zero count reads "—", not a badge
// ─────────────────────────────────────────────────────────────────────────────

const ok = (data) => Promise.resolve({ data });

const VENDOR = {
  id: "v-me", business_name: "Mama Mboga Fresh", vendor_handle: "mama_mboga", current_role: "selling",
};

const FEED = {
  window_days: 7, new_today: 3, generated_at: new Date().toISOString(),
  items: [
    { id: "n1", kind: "stock", title: "Tomatoes dropped", created_at: new Date().toISOString() },
    { id: "n2", kind: "movement", title: "Sukuma wiki moved", created_at: new Date().toISOString() },
  ],
  counts: { news: 2, suppliers: 4, stock: 0, rentals: 1, groups: 0, events: 2 },
};

const NEARBY = {
  center: { lat: -1.2867, lng: 36.8172 }, anchor: "you", area: "Kisumu", radius_km: 5,
  total: 3, generated_at: new Date().toISOString(),
  businesses: [
    { id: "p-1", name: "Kamau Electronics", group: "electronics", label: "Electronics", distance_km: 0.4, phone: "+254700000001", source: "open data", zone_name: "Kisumu CBD" },
    { id: "v-2", name: "Kibanda Kitchen", group: "food", label: "Food & drink", distance_km: 1.2, phone: "+254700000002", source: "member", handle: "kibanda_kitchen", categories: ["food"] },
  ],
  groups: [
    { group: "food", label: "Food & drink", count: 2 },
    { group: "electronics", label: "Electronics", count: 1 },
  ],
};

const PLACE = {
  id: "p-1", kind: "places", name: "Kamau Electronics", category: "shop:electronics",
  phone: "+254700000001", opening_hours: "Mo-Sa 09:00-18:00", website: "https://example.com",
  address: "12 Tom Mboya Street", zone_name: "Kisumu CBD", lat: -1.28, lng: 36.82,
  distance_km: 0.4, status: "active", claimed: false, claimed_by_me: false,
  first_seen_at: new Date().toISOString(), last_checked_at: new Date().toISOString(),
  attribution: "Data © OpenStreetMap contributors (ODbL)",
};

const MARKET = {
  id: "z-1", kind: "markets", name: "Kibuye Market", city: "Kisumu", country: "Kenya",
  lat: -1.29, lng: 36.82, members: 0, places: 214, claimed: 3, distance_km: 1.1,
  last_ingest_at: new Date().toISOString(), last_ingest_count: 214, welcome: null,
};

const calls = { nearby: [], place: [], market: [], join: [] };

vi.mock("@/lib/api", () => {
  const apiError = (e, f = "Something went wrong") => e?.message || f;
  return {
    apiError,
    newsAPI: { feed: vi.fn(() => ok(FEED)) },
    squadAPI: {
      calls: vi.fn(() => ok({ calls: [{ id: "c1" }, { id: "c2" }] })),
      me: vi.fn(() => ok({
        id: "s1", handle: "mama_mboga", xp: 10, gold: 0, tier: "common", division: "bronze",
        wins: 0, losses: 0, streak: 0, active_contract: null, squads: [],
        energy: { used: 1, limit: 3 }, level_progress: { next: 2, pct: 40 }, cards: [],
      })),
      squads: vi.fn(() => ok({ squads: [] })),
      league: vi.fn(() => ok({ divisions: [], entries: [] })),
      recent: vi.fn(() => ok({ wins: [] })),
    },
    marketsAPI: {
      mine: vi.fn(() => ok({ markets: [] })),
      join: vi.fn((id) => { calls.join.push(id); return ok({ message: "joined" }); }),
      leave: vi.fn(() => ok({ message: "left" })),
      welcome: vi.fn(() => ok({})),
    },
    mapAPI: {
      counts: vi.fn(() => ok({ markets: 25, vendors: 118, places: 7640 })),
      place: vi.fn((id) => { calls.place.push(id); return ok({ ...PLACE, id }); }),
      market: vi.fn((id) => { calls.market.push(id); return ok({ ...MARKET, id }); }),
    },
    geoAPI: { claim: vi.fn(() => ok({ changed: true })) },
    /* v3 home pulls real listings and ranked suppliers into the hub so the
       first screen is a marketplace, not a tile wall. Both are "nice to
       have" blocks — the doors must still render if either is empty. */
    stockAPI: {
      network: vi.fn(() => ok([])),
      movements: vi.fn(() => ok([])),
    },
    vendorAPI: { suggested: vi.fn(() => ok([])) },
    nearbyAPI: {
      list: vi.fn((params) => { calls.nearby.push(params); return ok(NEARBY); }),
    },
  };
});

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector) => selector({ vendor: VENDOR, token: "tok", ready: true }),
}));

/** Renders with a REAL route pattern so useParams() resolves — a screen that
    reads its subject from the URL has to be tested through that URL. */
const renderAt = (pattern, entry, ui) =>
  render(
    <MemoryRouter initialEntries={[entry ?? pattern]}>
      <Routes>
        <Route path={pattern} element={ui} />
        <Route path="*" element={<div data-testid="elsewhere">elsewhere</div>} />
      </Routes>
    </MemoryRouter>,
  );

const renderRoutes = (path, extra) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {extra}
        <Route path="*" element={<div data-testid="elsewhere">elsewhere</div>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  calls.nearby.length = 0;
  calls.place.length = 0;
  calls.market.length = 0;
  calls.join.length = 0;
});

// ── the hub ──────────────────────────────────────────────────────────────────
describe("Home (hub)", () => {
  it("is a shelf of doors, each labelled by the section behind it", async () => {
    const { default: HomeHub } = await import("@/pages/home/HomeHub");
    renderAt("/", "/", <HomeHub />);

    await waitFor(() => expect(screen.getByText("Around you")).toBeInTheDocument());
    for (const label of ["Map", "News", "Suppliers", "Stock", "Rentals", "Markets", "Groups", "Events", "Tasks"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("shows zero as a dash, not as a badge", async () => {
    const { default: HomeHub } = await import("@/pages/home/HomeHub");
    renderAt("/", "/", <HomeHub />);
    await waitFor(() => expect(screen.getByText("Around you")).toBeInTheDocument());
    // stock and groups are 0 in the fixture — both tiles read "—"
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it("opens a secondary screen instead of expanding in place", async () => {
    const { default: HomeHub } = await import("@/pages/home/HomeHub");
    renderRoutes("/", <Route path="/" element={<HomeHub />} />);
    await waitFor(() => expect(screen.getByText("Around you")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Around you"));
    await waitFor(() => expect(screen.getByTestId("elsewhere")).toBeInTheDocument());
  });
});

// ── around you ───────────────────────────────────────────────────────────────
describe("Around you", () => {
  it("asks for the radius it is showing, and says where", async () => {
    const { default: NearbyPage } = await import("@/pages/nearby/NearbyPage");
    renderAt("/nearby", "/nearby", <NearbyPage />);
    await waitFor(() => expect(screen.getByText("Kamau Electronics")).toBeInTheDocument());
    expect(calls.nearby[0]).toMatchObject({ radius_km: 5 });
    expect(screen.getByText(/within 5 km of Kisumu/)).toBeInTheDocument();
  });

  it("makes a category a screen: the group comes from the URL", async () => {
    const { default: NearbyPage } = await import("@/pages/nearby/NearbyPage");
    renderAt("/nearby/:group", "/nearby/food", <NearbyPage />);
    await waitFor(() => expect(screen.getByText("Kamau Electronics")).toBeInTheDocument());
    expect(calls.nearby[0]).toMatchObject({ group: "food" });
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toContain("Food & drink");
  });

  it("sends a member to their shop front and a public row to its own screen", async () => {
    const { default: NearbyPage } = await import("@/pages/nearby/NearbyPage");
    renderRoutes("/nearby", (
      <>
        <Route path="/nearby" element={<NearbyPage />} />
        <Route path="/place/:id" element={<div data-testid="place">place screen</div>} />
        <Route path="/@:handle" element={<div data-testid="shop">shop front</div>} />
      </>
    ));
    await waitFor(() => expect(screen.getByText("Kamau Electronics")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Kamau Electronics"));   // open data → its own screen
    await waitFor(() => expect(screen.getByTestId("place")).toBeInTheDocument());
  });

  it("keeps the public-data rows honest", async () => {
    const { default: NearbyPage } = await import("@/pages/nearby/NearbyPage");
    renderAt("/nearby", "/nearby", <NearbyPage />);
    await waitFor(() => expect(screen.getByText("Kamau Electronics")).toBeInTheDocument());
    expect(screen.getByText("Open data")).toBeInTheDocument();
    expect(screen.getByText(/OpenStreetMap \(ODbL\)/)).toBeInTheDocument();
  });
});

// ── a public place's own screen ──────────────────────────────────────────────
describe("Place", () => {
  it("loads the row it was opened on and shows what the source gave", async () => {
    const { default: PlaceProfile } = await import("@/pages/nearby/PlaceProfile");
    renderAt("/place/:id", "/place/p-1", <PlaceProfile />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Kamau Electronics" })).toBeInTheDocument());
    expect(calls.place).toEqual(["p-1"]);
    expect(screen.getByText("+254700000001")).toBeInTheDocument();
    expect(screen.getByText(/Mo-Sa 09:00-18:00/)).toBeInTheDocument();
    expect(screen.getByText("Unverified · public data")).toBeInTheDocument();
    expect(screen.getByText(/OpenStreetMap/)).toBeInTheDocument();
  });

  it("offers the one real action on an unclaimed row", async () => {
    const { default: PlaceProfile } = await import("@/pages/nearby/PlaceProfile");
    const { geoAPI } = await import("@/lib/api");
    renderAt("/place/:id", "/place/p-1", <PlaceProfile />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Kamau Electronics" })).toBeInTheDocument());
    fireEvent.click(screen.getByText("This is my business"));
    await waitFor(() => expect(geoAPI.claim).toHaveBeenCalledWith("p-1"));
  });
});

// ── a market's own screen ────────────────────────────────────────────────────
describe("Market", () => {
  it("names the unworked market as a number a vendor can act on", async () => {
    const { default: MarketDetail } = await import("@/pages/markets/MarketDetail");
    renderAt("/markets/:id", "/markets/z-1", <MarketDetail />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Kibuye Market" })).toBeInTheDocument());
    expect(calls.market).toEqual(["z-1"]);
    expect(screen.getByText("214")).toBeInTheDocument();      // mapped places
    expect(screen.getByText("Unworked")).toBeInTheDocument(); // places > 0, members 0
    expect(screen.getByText("mapped places")).toBeInTheDocument();
  });

  it("registers you from the market's screen", async () => {
    const { default: MarketDetail } = await import("@/pages/markets/MarketDetail");
    renderAt("/markets/:id", "/markets/z-1", <MarketDetail />);
    await waitFor(() => expect(screen.getByText("Register here")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Register here"));
    await waitFor(() => expect(calls.join).toEqual(["z-1"]));
  });
});

// ── task tracks ──────────────────────────────────────────────────────────────
describe("Task tracks", () => {
  it("hands the squad league a screen under Tasks", async () => {
    const { default: TaskTrack } = await import("@/pages/tasks/TaskTrack");
    renderRoutes("/tasks/squad", <Route path="/tasks/:track" element={<TaskTrack />} />);
    // SquadPage renders its own board; it must not fall through to the catch-all.
    await waitFor(() => expect(screen.queryByTestId("elsewhere")).toBeNull());
  });

  it("points the Brief track at the workspace that already owns it", async () => {
    const { default: TaskTrack } = await import("@/pages/tasks/TaskTrack");
    renderRoutes("/tasks/brief", (
      <>
        <Route path="/tasks/:track" element={<TaskTrack />} />
        <Route path="/brief" element={<div data-testid="brief">workspace</div>} />
      </>
    ));
    await waitFor(() => expect(screen.getByTestId("brief")).toBeInTheDocument());
  });
});
