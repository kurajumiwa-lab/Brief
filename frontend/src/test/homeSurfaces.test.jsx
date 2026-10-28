import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// ─────────────────────────────────────────────────────────────────────────────
// The navigation redesign's contract, asserted:
//
//   · Home is a personalised trading feed, not a directory of destinations
//   · hero search still routes into the existing stock-browse workflow
//   · Browse groups the discovery surfaces without removing their deep links
//   · a category is a screen: /nearby/{group} filters from the URL
//   · a public place gets its own screen instead of bouncing to /map
//   · a market gets its own screen instead of acting inline in a list
//   · the squad track is reachable as a task screen; /squad still resolves
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

const calls = { nearby: [], place: [], market: [], join: [], tools: [] };

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
      list: vi.fn(() => ok({ markets: [MARKET, { ...MARKET, id: "z-2", name: "Nairobi Wholesale", city: "Nairobi" }], countries: ["Kenya"] })),
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
      categories: vi.fn(() => ok(["fresh produce", "grains", "textiles"])),
      movements: vi.fn(() => ok([])),
    },
    vendorAPI: { suggested: vi.fn(() => ok([])) },
    toolAPI: {
      browse: vi.fn((params) => { calls.tools.push(params); return ok([]); }),
      mine: vi.fn(() => ok([])),
      couriers: vi.fn(() => ok([])),
    },
    nearbyAPI: {
      list: vi.fn((params) => { calls.nearby.push(params); return ok(NEARBY); }),
    },
  };
});

vi.mock("@/stores/authStore", () => {
  const state = { vendor: VENDOR, token: "tok", ready: true };
  return {
    useAuthStore: Object.assign((selector) => selector(state), { getState: () => state }),
  };
});

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

beforeEach(async () => {
  // The feed is cached in a store: a test that creates its own feed must not
  // inherit the shelves the previous one loaded.
  const { useHomeFeedStore } = await import("@/stores/homeFeedStore");
  useHomeFeedStore.setState({ shelves: {} });
  calls.nearby.length = 0;
  calls.place.length = 0;
  calls.market.length = 0;
  calls.join.length = 0;
  calls.tools.length = 0;
});

// ── the hub ──────────────────────────────────────────────────────────────────
describe("Home trading feed", () => {
  it("opens with search and the marketplace, not a wall of destination tiles", async () => {
    const { default: HomeHub } = await import("@/pages/home/HomeHub");
    renderAt("/", "/", <HomeHub />);

    expect(screen.getByRole("search")).toBeInTheDocument();
    // the compact rail: six doors into screens that already exist
    const shortcuts = await screen.findByRole("navigation", { name: /find your way around the network/i });
    expect(within(shortcuts).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/browse?type=goods", "/browse?type=people", "/browse?type=services",
      "/browse?type=equipment", "/tools", "/tasks",
    ]);
    // the old hub's tile wall is gone
    expect(screen.queryByText("Your shelf of doors")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^around you$/i })).not.toBeInTheDocument();
  });

  it("leads with the network's own records, and hides a module with nothing to show", async () => {
    const { default: HomeHub } = await import("@/pages/home/HomeHub");
    renderAt("/", "/", <HomeHub />);

    // the module that answered shows its records …
    const markets = await screen.findByTestId("home-shelf-markets");
    expect(within(markets).getByText("Kibuye Market")).toBeInTheDocument();
    expect(within(markets).getByRole("link", { name: /Kibuye Market/i })).toHaveAttribute("href", "/markets/z-1");
    // … and a module with no rows contributes no shelf, and no filler
    expect(screen.queryByTestId("home-shelf-stock")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-shelf-events")).not.toBeInTheDocument();
  });

  it("keeps every shelf honest about where its numbers come from", async () => {
    const { default: HomeHub } = await import("@/pages/home/HomeHub");
    renderAt("/", "/", <HomeHub />);

    expect(screen.getByText(/your own shelf never appears in the shelves above/i)).toBeInTheDocument();
    expect(screen.getByText(/prices and availability are stated by the vendor who published them/i)).toBeInTheDocument();
    expect(screen.queryByText(/market rate/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/popular/i)).not.toBeInTheDocument();
  });

  it("contains a module's failure to its own shelf, with an honest retry", async () => {
    const { stockAPI } = await import("@/lib/api");
    stockAPI.network.mockRejectedValue(new Error("offline"));
    const { default: HomeHub } = await import("@/pages/home/HomeHub");
    renderAt("/", "/", <HomeHub />);

    const failed = await screen.findByTestId("home-shelf-stock");
    expect(failed).toHaveAttribute("data-shelf-status", "error");
    expect(within(failed).getByText(/didn't load/i)).toBeInTheDocument();
    expect(within(failed).getByRole("button", { name: /try again/i })).toBeInTheDocument();
    // everything else on the feed is still standing
    expect(await screen.findByTestId("home-shelf-markets")).toBeInTheDocument();
  });

  it("keeps outstanding work reachable in one line, and My Shop folded shut", async () => {
    const { stockAPI } = await import("@/lib/api");
    stockAPI.movements.mockResolvedValueOnce(ok([{
      id: "move-1", stock_item_id: "stock-4", stock_name: "Red onions", direction: "outgoing",
      status: "pending", from_handle: "mama_mboga", to_handle: "east_market", quantity: 4,
      unit_price: 120, total_value: 480, created_at: new Date().toISOString(),
    }]));
    const { default: HomeHub } = await import("@/pages/home/HomeHub");
    renderAt("/", "/", <HomeHub />);

    const line = await screen.findByTestId("home-needs-action");
    expect(line).toHaveAttribute("href", "/orders?needs=me");
    expect(line).toHaveTextContent(/1 trade needs your next step/i);

    const shop = screen.getByTestId("home-your-shop");
    expect(shop).toHaveAttribute("data-shop-state", "collapsed");
    expect(within(shop).queryByRole("link", { name: /preview shop/i })).not.toBeInTheDocument();
  });

  it("submits the hero search to the existing Browse results route", async () => {
    const { default: HomeHub } = await import("@/pages/home/HomeHub");
    renderRoutes("/", (
      <>
        <Route path="/" element={<HomeHub />} />
        <Route path="/browse" element={<div data-testid="browse-results">Browse results</div>} />
      </>
    ));
    fireEvent.change(screen.getByLabelText("Search the network"), { target: { value: "rice" } });
    fireEvent.submit(screen.getByRole("search"));
    expect(await screen.findByTestId("browse-results")).toBeInTheDocument();
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

// ── a global market-search result ────────────────────────────────────────────
describe("Market search", () => {
  it("opens the all-markets view and filters the existing catalog from the URL", async () => {
    const { default: MarketsPage } = await import("@/pages/markets/MarketsPage");
    renderAt("/markets", "/markets?tab=all&search=Kibuye", <MarketsPage />);
    expect(await screen.findByRole("link", { name: "Kibuye Market" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Nairobi Wholesale" })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search markets, towns or countries")).toHaveValue("Kibuye");
  });
});

// ── the global rentals search ────────────────────────────────────────────────
describe("Rentals search", () => {
  it("seeds the existing tools search from its deep-link query", async () => {
    const { default: ToolsPage } = await import("@/pages/tools/ToolsPage");
    renderAt("/tools", "/tools?search=warehouse", <ToolsPage />);
    await waitFor(() => expect(calls.tools).toContainEqual({ category: "", search: "warehouse" }));
    expect(screen.getByPlaceholderText("Search tools")).toHaveValue("warehouse");
  });

  it("opens the listing a home card deep-linked to", async () => {
    const { toolAPI } = await import("@/lib/api");
    // The feed's equipment cards link to /tools?listing={id}; the page must open
    // that listing's own drawer rather than dropping the vendor on a list.
    toolAPI.browse.mockResolvedValueOnce(ok([{
      id: "tool-1", vendor_handle: "boda_express", vendor_business: "Boda Express", category: "cold_storage",
      title: "Shared cold room space", location: "Ngara, Nairobi", price_per_unit: 4500,
      price_unit: "per_day", min_booking: 1, is_available: true, times_booked: 3, features: ["Driver included"],
    }]));
    const { default: ToolsPage } = await import("@/pages/tools/ToolsPage");
    renderAt("/tools", "/tools?listing=tool-1", <ToolsPage />);
    expect(await screen.findByText("Shared cold room space")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /request booking/i })).toBeInTheDocument();
    expect(screen.getByText(/hosted by boda express/i)).toBeInTheDocument();
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
