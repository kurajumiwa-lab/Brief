/**
 * v3.1 — HOME AS A DISCOVERY FEED.
 *
 * What these specs protect:
 *
 *   · every shelf is drawn from a real module, and every card opens the record
 *     it showed (product, person, equipment, service, opportunity, event,
 *     group/list, market);
 *   · the vendor's OWN stock never reaches a public shelf — not even if the
 *     API hands it over;
 *   · an empty module hides its shelf instead of padding it;
 *   · one module failing leaves the rest of the feed standing, with a retry;
 *   · the carousel is one carousel: horizontal, labelled, and a swipe never
 *     opens the card under the thumb;
 *   · My Shop starts collapsed, shows no listing cards until asked, and expands
 *     into the summary that leads back to the shop's own screens;
 *   · the invite banner calls the app's real sharing flow and promises nothing
 *     it cannot keep.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// The feed renders eight shelves of animated cards; the DOM work is real, so the
// per-test budget is wider than the default 5s (nothing here waits on the network).
vi.setConfig({ testTimeout: 20000 });
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

const ok = (data) => Promise.resolve({ data });
const pending = () => new Promise(() => {});

const ME = {
  id: "v-me",
  business_name: "Mama Mboga Fresh",
  vendor_handle: "mama_mboga",
  current_role: "both",
  physical_location: "Kisumu",
};

/* Other people's records — the only kind a discovery shelf may show. */
const OTHER_STOCK = {
  id: "st-2", vendor_id: "v-2", vendor_handle: "gikomba_textiles", vendor_business: "Gikomba Textiles",
  name: "Kitenge 6-yard", category: "textiles", quantity_in_stock: 60, quantity_available: 60,
  quantity_reserved: 0, unit_of_measure: "piece", unit_price: 1200, min_order_quantity: 5,
  visible_to_network: true, images: [], tags: [], quality_status: "self_declared",
  vendor_fulfillment_rate: 92, updated_at: "2026-10-01T08:00:00",
};
/* My own record — served by mistake, to prove the client filter holds. */
const MY_STOCK = {
  ...OTHER_STOCK, id: "st-mine", vendor_id: "v-me", vendor_handle: "mama_mboga",
  vendor_business: "Mama Mboga Fresh", name: "Sukuma wiki", unit_price: 20,
};
const MY_SHELF = [{ ...MY_STOCK, quantity_available: 280, min_order_quantity: 20 }];

const DISCOVERED = [{
  vendor_id: "v-3", vendor_handle: "boda_express", business_name: "Boda Express",
  business_categories: ["logistics"], current_role: "both", physical_location: "Kisumu",
  fulfillment_rate: 88, movements_completed: 12, is_verified: true, is_patron: false,
  score: 61, distance_km: 2.4, reasons: ["2.4 km away"],
}];

const TOOL = {
  id: "tool-1", vendor_id: "v-4", vendor_handle: "cool_store", vendor_business: "Cool Store Ltd",
  category: "cold_storage", title: "Cold room, 20 pallets", location: "Kisumu",
  price_per_unit: 3500, price_unit: "per_day", min_booking: 2, deposit_required: 0,
  capacity: { value: 20, unit: "pallets" }, features: ["Generator"], is_available: true,
  times_booked: 4, avg_rating: 4.5, details: null, images: [],
};

const REQUEST = {
  id: "req-1", request_type: "delivery", description: "Move 40 crates to Ahero",
  location: "Kisumu", needed_by: "today", budget_kes: 3000, offers_count: 2,
  status: "open", is_mine: false, distance_km: 1.2, created_at: "2026-10-14T09:00:00",
};
const CALL = {
  id: "call-1", title: "Load a lorry at Kibuye", task_type: "loading", skill: "porter",
  pay_kes: 800, location: "Kibuye", distance_km: 3.1, status: "open", mine: false,
  client: "Kibuye Traders", expires_at: "2026-10-16T18:00:00",
};

const EVENT = {
  id: "ev-1", title: "Kisumu trade fair", event_type: "trade_fair",
  start_date: "2026-11-02T08:00:00", end_date: "2026-11-02T17:00:00",
  location: "Jomo Kenyatta Grounds", is_virtual: false, entry_fee: 500,
  registered_count: 12, max_vendors: 40, spots_left: 28,
  organizer: "kisumu_chamber", organizer_id: "v-5", organizer_business: "Kisumu Chamber", my_status: null,
};

const GROUP = {
  id: "g-1", name: "Fish traders", description: "Lake Victoria fish", group_type: "trade",
  category: "fresh", region: "Nyanza", member_count: 34, max_members: 100, is_public: true,
  requires_approval: true, created_by: "somebody_else", my_role: null,
};
const LIST = {
  id: "l-1", name: "Verified grain suppliers", description: "Reviewed yearly", category: "grains",
  region: "Kenya", patron_business: "Grain Hub", patron_handle: "grain_hub", member_count: 18,
  avg_rating: 4.2, review_count: 9, max_vendors: 40, is_open: true, requires_approval: false,
  is_group_created: false, my_status: null, i_run_it: false,
};

const MARKET = {
  id: "z-1", name: "Kibuye Market", city: "Kisumu", country: "Kenya",
  members: 12, places: 214, claimed: 3, distance_km: 1.1,
};

const CATALOGUE = {
  offers: [
    {
      key: "business_website", line: "digital_services", name: "Business website",
      price_min_kes: 15000, price_max_kes: 45000, price_unit: "one_off", readiness: "service",
      readiness_note: "Delivered by people", turnaround: "10 working days",
      deliverables: ["A site"], exclusions: [], customer_must_provide: [],
    },
  ],
};

const share = vi.fn(() => Promise.resolve());
const writeText = vi.fn(() => Promise.resolve());

vi.mock("@/lib/api", () => {
  const apiError = (e, f = "Something went wrong") => e?.message || f;
  return {
    apiError,
    stockAPI: {
      network: vi.fn(() => ok([OTHER_STOCK, MY_STOCK])),
      mine: vi.fn(() => ok(MY_SHELF)),
      movements: vi.fn(() => ok([])),
      categories: vi.fn(() => ok([])),
    },
    toolAPI: { browse: vi.fn(() => ok([TOOL])), mine: vi.fn(() => ok([])) },
    vendorAPI: { discover: vi.fn(() => ok(DISCOVERED)), connections: vi.fn(() => ok([])) },
    requestsAPI: { list: vi.fn(() => ok([REQUEST])) },
    squadAPI: { calls: vi.fn(() => ok({ calls: [CALL] })) },
    eventAPI: { browse: vi.fn(() => ok([EVENT])) },
    groupAPI: { browse: vi.fn(() => ok([GROUP])) },
    listAPI: { browse: vi.fn(() => ok([LIST])) },
    marketsAPI: { list: vi.fn(() => ok({ markets: [MARKET], countries: ["Kenya"] })) },
    catalogAPI: { catalogue: vi.fn(() => ok(CATALOGUE)) },
    commercialAPI: {
      shelf: vi.fn(() => ok({ shelf: [], title: "Commercial shelf", subtitle: "No offers", total_savings_potential: 0 })),
      feed: vi.fn(() => ok({ posts: [] })),
    },
  };
});

vi.mock("@/stores/authStore", () => ({
  useAuthStore: Object.assign((selector) => selector({ vendor: ME, token: "tok", ready: true }), {
    getState: () => ({ vendor: ME, token: "tok", ready: true }),
  }),
}));

import * as api from "@/lib/api";
import { useStockStore } from "@/stores/stockStore";
import { useHomeFeedStore } from "@/stores/homeFeedStore";
import HomeHub from "@/pages/home/HomeHub";
import { isOwnRecord, publicShelfItems } from "@/config/homeShelves";

function LocationProbe() {
  const { pathname } = useLocation();
  return <output data-testid="location">{pathname}</output>;
}

const mount = () =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <LocationProbe />
      <Routes>
        <Route path="/" element={<HomeHub />} />
        <Route path="/listing/:id" element={<div data-testid="listing-page">listing</div>} />
        <Route path="/browse" element={<div data-testid="browse-page">browse</div>} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  // fresh caches: the feed is a store, so tests start from an empty one
  useHomeFeedStore.setState({ shelves: {} });
  useStockStore.setState({ mine: [], movements: [], mineLoaded: false, network: [] });
  Object.defineProperty(navigator, "share", { configurable: true, writable: true, value: share });
  Object.defineProperty(navigator, "clipboard", { configurable: true, writable: true, value: { writeText } });
});

/* ── shelf records ─────────────────────────────────────────────────────────── */

describe("Home discovery shelves", () => {
  it("draws every shelf from a real module and opens the record it showed", async () => {
    mount();

    // goods — another vendor's stock
    const stockShelf = await screen.findByTestId("home-shelf-stock");
    expect(within(stockShelf).getByText("Kitenge 6-yard")).toBeInTheDocument();
    expect(stockShelf).toHaveTextContent(/1,200/);          // the vendor's own stated price
    expect(stockShelf).toHaveTextContent(/60 pieces available/i);
    expect(within(stockShelf).getByRole("link", { name: /Kitenge 6-yard/i })).toHaveAttribute("href", "/listing/st-2");

    // services — the platform catalogue, deep-linked to the offer
    const services = screen.getByTestId("home-shelf-services");
    expect(within(services).getByText("Business website")).toBeInTheDocument();
    expect(within(services).getByRole("link", { name: /Business website/i })).toHaveAttribute(
      "href", "/storefront?offer=business_website"
    );

    // people — discovery-ranked vendors
    expect(screen.getByTestId("home-shelf-people")).toHaveTextContent("Boda Express");
    expect(screen.getByRole("link", { name: /Boda Express/i })).toHaveAttribute("href", "/@boda_express");
    expect(api.vendorAPI.discover).toHaveBeenCalled();

    // equipment — the tools browser, deep-linked to that listing
    const equipment = screen.getByTestId("home-shelf-equipment");
    expect(within(equipment).getByText("Cold room, 20 pallets")).toBeInTheDocument();
    expect(within(equipment).getByRole("link", { name: /Cold room/i })).toHaveAttribute("href", "/tools?listing=tool-1");
    // include_mine=false is how the tools browser keeps my own listings out
    expect(api.toolAPI.browse).toHaveBeenCalledWith(expect.objectContaining({ include_mine: false }));

    // opportunities — open requests and call-ups, each to its own board
    const opportunities = screen.getByTestId("home-shelf-opportunities");
    expect(within(opportunities).getByText("Move 40 crates to Ahero")).toBeInTheDocument();
    expect(within(opportunities).getByText("Load a lorry at Kibuye")).toBeInTheDocument();
    expect(within(opportunities).getByRole("link", { name: /Move 40 crates/i })).toHaveAttribute("href", "/browse");
    expect(within(opportunities).getByRole("link", { name: /Load a lorry/i })).toHaveAttribute("href", "/tasks/squad");
    expect(api.requestsAPI.list).toHaveBeenCalledWith({ scope: "open", limit: 8 });

    // events, communities, markets
    expect(screen.getByTestId("home-shelf-events")).toHaveTextContent("Kisumu trade fair");
    expect(screen.getByTestId("home-shelf-community")).toHaveTextContent("Fish traders");
    expect(screen.getByTestId("home-shelf-community")).toHaveTextContent("Verified grain suppliers");
    expect(screen.getByTestId("home-shelf-markets")).toHaveTextContent("Kibuye Market");
    expect(screen.getByRole("link", { name: /Kibuye Market/i })).toHaveAttribute("href", "/markets/z-1");
  });

  it("gives every shelf a See all door into the module's own screen", async () => {
    mount();
    await screen.findByTestId("home-shelf-stock");

    const doors = {
      stock: ["See all stock", "/browse?type=goods"],
      people: ["See all vendors", "/network"],
      services: ["Open the storefront", "/storefront"],
      equipment: ["See all equipment", "/browse?type=equipment"],
      opportunities: ["See all requests", "/browse"],
      events: ["See all events", "/events"],
      community: ["See all groups", "/groups"],
      markets: ["See all markets", "/markets"],
    };
    for (const [key, [label, href]] of Object.entries(doors)) {
      const shelf = screen.getByTestId(`home-shelf-${key}`);
      expect(within(shelf).getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  it("keeps the vendor's own stock off every public shelf", async () => {
    mount();
    const stockShelf = await screen.findByTestId("home-shelf-stock");

    expect(within(stockShelf).queryByText("Sukuma wiki")).not.toBeInTheDocument();
    expect(screen.queryByText("Sukuma wiki")).not.toBeInTheDocument();
    expect(within(stockShelf).getByText("Kitenge 6-yard")).toBeInTheDocument();
  });

  it("hides a shelf the network has nothing for, instead of padding it", async () => {
    api.eventAPI.browse.mockResolvedValueOnce(ok([]));
    mount();
    await screen.findByTestId("home-shelf-stock");
    await waitFor(() => expect(screen.queryByTestId("home-shelf-events")).not.toBeInTheDocument());
  });

  it("says so — quietly — when the whole network is empty", async () => {
    // Every module answers — with nothing. (…Once: the fixtures stay intact for
    // the specs that follow.)
    api.stockAPI.network.mockResolvedValueOnce(ok([]));
    api.toolAPI.browse.mockResolvedValueOnce(ok([]));
    // twice: public discovery, then the connected fallback the people shelf uses
    api.vendorAPI.discover.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok([]));
    api.requestsAPI.list.mockResolvedValueOnce(ok([]));
    api.squadAPI.calls.mockResolvedValueOnce(ok({ calls: [] }));
    api.eventAPI.browse.mockResolvedValueOnce(ok([]));
    api.groupAPI.browse.mockResolvedValueOnce(ok([]));
    api.listAPI.browse.mockResolvedValueOnce(ok([]));
    api.marketsAPI.list.mockResolvedValueOnce(ok({ markets: [] }));
    api.catalogAPI.catalogue.mockResolvedValueOnce(ok({ offers: [] }));
    api.commercialAPI.shelf.mockResolvedValueOnce(ok({ shelf: [] }));

    mount();
    expect(await screen.findByText(/the network is quiet right now/i)).toBeInTheDocument();
    expect(screen.queryByTestId("home-shelf-stock")).not.toBeInTheDocument();
  });

  it("offers the people a vendor already trades with, and says so, when discovery has nobody new", async () => {
    // the public ranking is empty; the shelf falls back to the connected network
    api.vendorAPI.discover
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok([{ ...DISCOVERED[0], connected: true }]));

    mount();
    const people = await screen.findByTestId("home-shelf-people");
    const card = within(people).getByRole("link", { name: /Boda Express/i });
    expect(card).toHaveAttribute("href", "/@boda_express");
    expect(within(people).getByText(/in your network/i)).toBeInTheDocument();
  });

  it("can be asked to look again, without leaving Home", async () => {
    api.stockAPI.network.mockResolvedValueOnce(ok([]));
    api.toolAPI.browse.mockResolvedValueOnce(ok([]));
    api.commercialAPI.shelf.mockResolvedValueOnce(ok({ shelf: [] }));
    api.vendorAPI.discover.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok([]));
    api.requestsAPI.list.mockResolvedValueOnce(ok([]));
    api.squadAPI.calls.mockResolvedValueOnce(ok({ calls: [] }));
    api.eventAPI.browse.mockResolvedValueOnce(ok([]));
    api.groupAPI.browse.mockResolvedValueOnce(ok([]));
    api.listAPI.browse.mockResolvedValueOnce(ok([]));
    api.marketsAPI.list.mockResolvedValueOnce(ok({ markets: [] }));
    api.catalogAPI.catalogue.mockResolvedValueOnce(ok({ offers: [] }));

    mount();
    await screen.findByText(/the network is quiet right now/i);
    fireEvent.click(screen.getByRole("button", { name: /check again/i }));

    await waitFor(() => expect(screen.getByTestId("home-shelf-stock")).toHaveAttribute("data-shelf-status", "ready"));
    expect(api.stockAPI.network).toHaveBeenCalledTimes(2);
  });
});

/* ── failure isolation + loading ───────────────────────────────────────────── */

describe("Shelf states", () => {
  it("keeps the feed standing when one module fails, and retries just that shelf", async () => {
    api.stockAPI.network.mockRejectedValueOnce(new Error("offline"));
    mount();

    const failed = await screen.findByTestId("home-shelf-stock");
    expect(failed).toHaveAttribute("data-shelf-status", "error");
    expect(within(failed).getByText(/didn't load/i)).toBeInTheDocument();
    // the rest of the marketplace is untouched
    expect(screen.getByTestId("home-shelf-markets")).toHaveTextContent("Kibuye Market");

    fireEvent.click(within(failed).getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(within(screen.getByTestId("home-shelf-stock")).getByText("Kitenge 6-yard")).toBeInTheDocument());
    expect(api.stockAPI.network).toHaveBeenCalledTimes(2);
  });

  it("shows skeletons shaped like the cards while a shelf is still loading", async () => {
    api.stockAPI.network.mockImplementationOnce(pending);
    mount();

    const shelf = await screen.findByTestId("home-shelf-stock");
    expect(shelf).toHaveAttribute("data-shelf-status", "loading");
    expect(within(shelf).getByRole("status", { name: /loading fresh on the network/i })).toBeInTheDocument();
    expect(within(shelf).queryByText("Kitenge 6-yard")).not.toBeInTheDocument();
  });
});

/* ── the carousel ──────────────────────────────────────────────────────────── */

describe("Carousel behaviour", () => {
  it("scrolls horizontally and is announced as a carousel", async () => {
    mount();
    const shelf = await screen.findByTestId("home-shelf-stock");
    const rail = within(shelf).getByRole("list", { name: /fresh on the network/i });

    expect(rail).toHaveAttribute("aria-roledescription", "carousel");
    expect(rail.className).toMatch(/\bshelf\b/);          // the one horizontal scroller
    expect(within(rail).getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("opens a card on a tap", async () => {
    mount();
    const shelf = await screen.findByTestId("home-shelf-stock");
    const card = await within(shelf).findByRole("link", { name: /Kitenge 6-yard/i });

    fireEvent.touchStart(card, { touches: [{ clientX: 200, clientY: 120 }] });
    fireEvent.touchEnd(card);
    fireEvent.click(card);

    expect(await screen.findByTestId("listing-page")).toBeInTheDocument();
  });

  it("never opens a card that was only swiped across", async () => {
    mount();
    const shelf = await screen.findByTestId("home-shelf-stock");
    const rail = within(shelf).getByRole("list", { name: /fresh on the network/i });
    const card = within(shelf).getByRole("link", { name: /Kitenge 6-yard/i });

    fireEvent.touchStart(rail, { touches: [{ clientX: 240, clientY: 120 }] });
    fireEvent.touchMove(rail, { touches: [{ clientX: 120, clientY: 124 }] });   // a real swipe
    fireEvent.touchEnd(rail);
    fireEvent.click(card);

    expect(screen.queryByTestId("listing-page")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/");
  });

  it("carries See all into the module when a shelf is tapped through", async () => {
    mount();
    const shelf = await screen.findByTestId("home-shelf-stock");
    fireEvent.click(within(shelf).getByRole("link", { name: /see all stock/i }));
    expect(await screen.findByTestId("browse-page")).toBeInTheDocument();
  });
});

/* ── My Shop, collapsed ────────────────────────────────────────────────────── */

describe("My Shop", () => {
  it("is collapsed on load, with no listing cards, and keeps the management door", async () => {
    useStockStore.setState({ mine: MY_SHELF, mineLoaded: true });
    mount();

    const shop = await screen.findByTestId("home-your-shop");
    expect(shop).toHaveAttribute("data-shop-state", "collapsed");
    expect(within(shop).getByRole("heading", { name: /my shop/i })).toBeInTheDocument();
    expect(within(shop).getByText(/manage your published listings/i)).toBeInTheDocument();
    expect(within(shop).getByRole("link", { name: /manage shop/i })).toHaveAttribute("href", "/stock");
    // no stock cards before the vendor asks for them
    expect(within(shop).queryByText("Sukuma wiki")).not.toBeInTheDocument();
    expect(within(shop).queryByRole("link", { name: /preview shop/i })).not.toBeInTheDocument();
  });

  it("reports live counts only from the shelf it actually read", async () => {
    useStockStore.setState({ mine: MY_SHELF, mineLoaded: true });
    mount();
    const shop = await screen.findByTestId("home-your-shop");
    expect(within(shop).getByTestId("my-shop-counts")).toHaveTextContent(/1 published/);
    expect(api.stockAPI.mine).not.toHaveBeenCalled();   // already loaded — never fetched twice
  });

  it("expands into a compact summary that leads to editing, preview and sharing", async () => {
    useStockStore.setState({ mine: MY_SHELF, mineLoaded: true });
    mount();

    const shop = await screen.findByTestId("home-your-shop");
    fireEvent.click(within(shop).getByRole("button", { name: /expand/i }));

    expect(shop).toHaveAttribute("data-shop-state", "expanded");
    expect(within(shop).getByRole("link", { name: /Sukuma wiki/i })).toHaveAttribute("href", "/stock?search=Sukuma%20wiki");
    expect(within(shop).getByRole("link", { name: /add stock/i })).toHaveAttribute("href", "/stock?new=1");
    expect(within(shop).getByRole("link", { name: /preview shop/i })).toHaveAttribute("href", "/@mama_mboga");
    expect(within(shop).getByRole("link", { name: /full shop management/i })).toHaveAttribute("href", "/stock");

    fireEvent.click(within(shop).getByRole("button", { name: /share shop/i }));
    await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining("/@mama_mboga") })));

    // and collapses again
    fireEvent.click(within(shop).getByRole("button", { name: /collapse/i }));
    expect(shop).toHaveAttribute("data-shop-state", "collapsed");
    expect(within(shop).queryByText("Sukuma wiki")).not.toBeInTheDocument();
  });

  it("reads the shelf once when nothing has loaded it yet", async () => {
    mount();
    await waitFor(() => expect(api.stockAPI.mine).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId("my-shop-counts")).toHaveTextContent(/1 published/);
  });
});

/* ── the invite banner ─────────────────────────────────────────────────────── */

describe("Invite friends banner", () => {
  it("sits between the discovery shelves and calls the app's sharing flow", async () => {
    mount();
    const banner = await screen.findByTestId("invite-friends-banner");
    expect(within(banner).getByRole("heading", { name: /invite friends\. grow together\./i })).toBeInTheDocument();
    expect(banner).toHaveTextContent(/bring more businesses into ogallo/i);
    // no invented rewards anywhere in the promise
    expect(banner.textContent).not.toMatch(/kes|ksh|reward|credit|commission|bonus/i);

    fireEvent.click(within(banner).getByRole("button", { name: /invite friends/i }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share.mock.calls[0][0].url).toMatch(/\/storefront$/);
  });

  it("falls back to the clipboard when the device cannot share", async () => {
    Object.defineProperty(navigator, "share", { configurable: true, writable: true, value: undefined });
    mount();
    const banner = await screen.findByTestId("invite-friends-banner");
    fireEvent.click(within(banner).getByRole("button", { name: /invite friends/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toMatch(/\/storefront$/);
  });
});

/* ── shortcuts and the work pointer ────────────────────────────────────────── */

describe("Shortcuts and outstanding work", () => {
  it("links each shortcut to a destination that already exists", async () => {
    mount();
    const shortcuts = await screen.findByRole("navigation", { name: /find your way around the network/i });
    const hrefs = within(shortcuts).getAllByRole("link").map((a) => a.getAttribute("href"));
    // v3.2: commercial deals replaces tasks in shortcuts — harnessing, not replacing
    expect(hrefs).toEqual([
      "/browse?type=goods",
      "/browse?type=people",
      "/browse?type=services",
      "/browse?type=equipment",
      "/commercial",
      "/tools",
    ]);
  });

  it("points outstanding trades at the order that needs a decision, in one line", async () => {
    useStockStore.setState({
      movements: [{
        id: "m1", direction: "outgoing", status: "pending", stock_name: "Tomatoes",
        quantity: 2, total_value: 5400, created_at: "2026-10-14T10:00:00",
      }],
    });
    mount();
    const line = await screen.findByTestId("home-needs-action");
    expect(line).toHaveAttribute("href", "/orders?needs=me");
    expect(line).toHaveTextContent(/1 trade needs your next step/i);
  });
});

/* ── the exclusion rule itself ─────────────────────────────────────────────── */

describe("Own-inventory exclusion", () => {
  it("matches by id or by handle, and drops the record from a shelf", () => {
    expect(isOwnRecord({ owner: { id: "v-me" } }, ME)).toBe(true);
    expect(isOwnRecord({ owner: { handle: "@mama_mboga" } }, ME)).toBe(true);
    expect(isOwnRecord({ owner: { id: "v-2", handle: "gikomba_textiles" } }, ME)).toBe(false);
    expect(isOwnRecord({ owner: null }, ME)).toBe(false);

    const items = [{ id: "a", owner: { handle: "mama_mboga" } }, { id: "b", owner: { handle: "gikomba_textiles" } }];
    expect(publicShelfItems(items, ME).map((i) => i.id)).toEqual(["b"]);
  });
});
