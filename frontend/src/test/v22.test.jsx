import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// ── v2.2 surfaces: trade analytics, list reviews, discovery, route planner, calendars, ops ──
const ok = (data) => Promise.resolve({ data });
const ME = {
  id: "v-me", business_name: "Mama Mboga Fresh", vendor_handle: "mama_mboga", current_role: "selling",
  business_categories: ["fresh produce"], network_score: 5, parasitism_index: 42, is_patron: true, is_verified: false,
};

const OVERVIEW = {
  vendor_handle: "mama_mboga", days: 90,
  summary: {
    days: 90, supplied_value: 23000, sourced_value: 0, trade_value: 23000, supplied_units: 14, sourced_units: 0,
    units_moved: 14, movements_settled: 2, movements_cancelled: 0, avg_movement_value: 11500, counterparties: 1,
    open_movements: { pending: 1 }, open_movements_total: 1, avg_hours_to_ship: 6.5, avg_hours_to_settle: 30, on_time_shipment_rate: 100,
  },
  trend: [
    { period: "2026-09-22", bucket: "week", supplied_value: 12000, sourced_value: 0, value: 12000, units: 4, movements: 1 },
    { period: "2026-09-29", bucket: "week", supplied_value: 11000, sourced_value: 0, value: 11000, units: 10, movements: 1 },
  ],
  counterparties: [
    { vendor_id: "v-2", vendor_handle: "kibanda_kitchen", business_name: "Kibanda Kitchen", business_categories: ["food service"],
      supplied_value: 23000, sourced_value: 0, trade_value: 23000, units: 14, movements: 2, balance: 1,
      balance_label: "they buy more", parasitism_score: 40, last_trade_at: "2026-09-29T08:00:00" },
  ],
  categories: [{ category: "fresh produce", supplied_value: 23000, sourced_value: 0, trade_value: 23000, units: 14, movements: 2, share_pct: 100 }],
  price_position: [
    { category: "fresh produce", my_avg_price: 2050, my_items: 2, network_avg_price: 2700, network_vendors: 1, delta_pct: -24.1,
      position: "below", price_hint: "You are 24% below the network median — there is headroom before you look expensive." },
  ],
  network: { days: 90, trade_value: 100000, movements: 40, active_suppliers: 3, active_vendors: 9, new_vendors: 2, top_categories: [] },
  share_of_network_pct: 23.0, parasitism_index: 42, network_score: 5,
};
const COUNTERPARTY = {
  vendor_handle: "kibanda_kitchen", business_name: "Kibanda Kitchen", days: 90,
  you_sold: { movements: 2, value: 23000 }, you_bought: { movements: 0, value: 0 }, net_position: 23000, parasitism_score: 40,
  history: [{ period: "2026-09-01", sold_value: 23000, bought_value: 0, movements: 2 }],
  top_items: [{ name: "Tomatoes (crate)", value: 12000, units: 4 }],
};
const WEIGHTS = { factors: { complementarity: 25, reciprocity: 20, trade_evidence: 20, proximity: 15, graph: 10, reputation: 10 } };

const LIST = { id: "l1", name: "Nairobi Fresh Produce Vendors", patron_business: "Mama Mboga Fresh", patron_handle: "mama_mboga", avg_rating: 4.5, review_count: 2, member_count: 12, max_vendors: 100, is_open: true, requires_approval: true, i_run_it: false, my_status: "approved" };
const REVIEWS = {
  list_id: "l1", list_name: "Nairobi Fresh Produce Vendors", avg_rating: 4.5, review_count: 2,
  distribution: { "5": 1, "4": 1, "3": 0, "2": 0, "1": 0 }, can_review: true, my_status: "approved",
  reviews: [
    { id: "r1", rating: 5, title: "Vetted well", body: "Good market day crowd.", verified_member: true, helpful_count: 2,
      created_at: "2026-09-20T08:00:00", updated_at: null, mine: false, can_edit: false, marked_helpful: false,
      reviewer: { vendor_id: "v-2", vendor_handle: "kibanda_kitchen", business_name: "Kibanda Kitchen", business_categories: [], is_patron: false } },
    { id: "r2", rating: 4, title: null, body: "Steady buyers.", verified_member: true, helpful_count: 0,
      created_at: "2026-09-18T08:00:00", updated_at: "2026-09-19T08:00:00", mine: false, can_edit: false, marked_helpful: false,
      reviewer: { vendor_id: "v-me", vendor_handle: "mama_mboga", business_name: "Mama Mboga Fresh", business_categories: [], is_patron: true } },
  ],
};

const DISCOVERED = [
  { vendor_id: "v-4", vendor_handle: "kariobangi_fabrics", business_name: "Kariobangi Fabrics", business_categories: ["textiles"],
    current_role: "selling", physical_location: "Nairobi", network_score: 40, parasitism_index: 55, score: 72.5, distance_km: 4.2,
    connected: false, reasons: ["stocks textiles, which you source", "4.2 km away"], factors: { complementarity: 25 } },
];
const ROUTES = [
  { id: "rt1", name: "Eastlands loop", status: "planned", planned_for: null,
    courier: { id: "cr1", courier_name: "Boda Express", vendor_handle: "mama_mboga" },
    total_stops: 3, total_distance_km: 18.4, baseline_distance_km: 23.1, saved_km: 4.7, saved_pct: 20.3,
    estimated_minutes: 55, average_speed_kmh: 25, return_to_start: true, algorithm: "nearest_neighbour+2opt",
    start_label: "Depot", start: { lat: -1.29, lng: 36.82 }, notes: null, created_at: "2026-09-29T07:00:00", mine: true,
    stops: [
      { id: "s1", sequence: 1, label: "Kibanda Kitchen", address: "Kirinyaga Rd", contact_phone: null, lat: -1.3, lng: 36.8, weight_kg: 12, priority: 0, distance_from_prev_km: 2.1, cumulative_km: 2.1, eta_minutes: 5, solved: false, shipment_id: "sh1" },
      { id: "s2", sequence: 2, label: "Gikomba Textiles", address: "Gikomba", contact_phone: null, lat: -1.28, lng: 36.83, weight_kg: 5, priority: 0, distance_from_prev_km: 6.4, cumulative_km: 8.5, eta_minutes: 20, solved: true, shipment_id: null },
      { id: "s3", sequence: 3, label: "Ngara Market", address: "Ngara", contact_phone: null, lat: -1.27, lng: 36.82, weight_kg: 8, priority: 0, distance_from_prev_km: 9.9, cumulative_km: 18.4, eta_minutes: 30, solved: false, shipment_id: null },
    ] },
];
const BOOKINGS = [
  { id: "b1", kind: "warehouse", status: "requested", start_date: "2026-10-01T00:00:00", end_date: "2026-10-04T00:00:00",
    quantity: 10, unit: "sqm", rate: 150, estimated_cost: 4500, details: {}, notes: "Cold chain", decision_note: null,
    requested_at: "2026-09-29T08:00:00", host_handle: "mama_mboga", booker_handle: "kibanda_kitchen",
    tool: { id: "t1", title: "Cold room, Wakulima market", category: "warehouse", location: "Nairobi" } },
];
const CALENDAR = {
  listing_id: "t1", kind: "warehouse", title: "Cold room, Wakulima market", unit: "sqm", capacity: 20, location: "Nairobi",
  days: [
    { date: "2026-10-01", capacity: 20, committed: 10, free: 10, full: false, my_quantity: 10 },
    { date: "2026-10-02", capacity: 20, committed: 20, free: 0, full: true, my_quantity: 0 },
  ],
  mine: [],
};
const OPS = {
  version: "2.2.0",
  environment: { debug: false, auto_create_tables: false, scheduler_on_api: true, rate_limiter_backend: "_MemoryBackend", storage: "local", redis_configured: false },
  database: { reachable: true, error: null, pool: { class: "AsyncAdaptedQueuePool", size: 5, checkedout: 1 } },
  http: {
    uptime_seconds: 120, requests_total: 240, requests_per_second: 2.0, avg_ms: 30, p50_ms: 20, p95_ms: 250, p99_ms: 400,
    in_flight: 1, by_status: { 200: 230, 404: 10 }, error_rate_pct: 0.0, client_error_rate_pct: 4.17, slow_threshold_ms: 1000,
    routes: [{ path: "/api/stock/my-stock", requests: 40, avg_ms: 12, p50_ms: 10, p95_ms: 30, max_ms: 60, errors: 0, slow: 0 }],
    slow_routes: [{ path: "/api/analytics/overview", requests: 5, avg_ms: 900, p50_ms: 700, p95_ms: 2400, max_ms: 2600, errors: 0, slow: 3 }],
  },
  limits: { rate_limit_auth_per_min: 20, rate_limit_api_per_min: 600, max_upload_mb: 10, slow_request_ms: 1000 },
  counters: { rate_limited_responses: 2, requests_total: 240 },
};

vi.mock("@/lib/api", () => {
  const apiError = (e, f = "Something went wrong") => e?.response?.data?.detail || f;
  return {
    default: {},
    apiError,
    authAPI: { login: vi.fn(), register: vi.fn(), refresh: vi.fn() },
    vendorAPI: {
      me: vi.fn(() => ok(ME)), connections: vi.fn(() => ok([])), network: vi.fn(() => ok([])), stats: vi.fn(() => ok({})),
      suggested: vi.fn(() => ok([])), patronStatus: vi.fn(() => ok({ is_patron: true, tier: "starter" })),
      discover: vi.fn(() => ok(DISCOVERED)), discoverWeights: vi.fn(() => ok(WEIGHTS)),
      connect: vi.fn(() => ok({ message: "connected" })), disconnect: vi.fn(),
    },
    stockAPI: { mine: vi.fn(() => ok([])), network: vi.fn(() => ok([])), movements: vi.fn(() => ok([])), categories: vi.fn(() => ok([])), get: vi.fn(), alternatives: vi.fn(), verify: vi.fn(), patronVerify: vi.fn(), revokePatronVerify: vi.fn(), source: vi.fn(), add: vi.fn(), update: vi.fn(), remove: vi.fn(), advance: vi.fn(), bulkImport: vi.fn() },
    groupAPI: { browse: vi.fn(() => ok([])), mine: vi.fn(() => ok([])), get: vi.fn(), members: vi.fn(() => ok([])), create: vi.fn(), join: vi.fn(), leave: vi.fn(), approve: vi.fn(), createList: vi.fn() },
    listAPI: {
      browse: vi.fn(() => ok([LIST])), mine: vi.fn(() => ok([])), members: vi.fn(() => ok([])), create: vi.fn(), register: vi.fn(), approve: vi.fn(), reject: vi.fn(), setOpen: vi.fn(),
      reviews: vi.fn(() => ok(REVIEWS)), myReview: vi.fn(() => ok(REVIEWS.reviews[1])),
      createReview: vi.fn(() => ok({ message: "Review recorded", review_id: "r3", avg_rating: 5.0, review_count: 3 })),
      updateReview: vi.fn(() => ok({ message: "Review updated", avg_rating: 4.0, review_count: 2 })),
      deleteReview: vi.fn(() => ok({ message: "Review removed", avg_rating: 5.0, review_count: 1 })),
      markHelpful: vi.fn(() => ok({ message: "Marked helpful", helpful_count: 3 })),
    },
    chatAPI: { rooms: vi.fn(() => ok([])), room: vi.fn(), messages: vi.fn(() => ok([])), send: vi.fn(), join: vi.fn(), createTopic: vi.fn(), directRoom: vi.fn(), dealRoom: vi.fn(), acceptDeal: vi.fn(), counterDeal: vi.fn(), declineDeal: vi.fn() },
    toolAPI: {
      browse: vi.fn(() => ok([])), mine: vi.fn(() => ok([{ id: "t1", title: "Cold room, Wakulima market", category: "warehouse", is_available: true, vendor_handle: "mama_mboga" }])),
      couriers: vi.fn(() => ok([{ id: "cr1", courier_name: "Boda Express", vendor_handle: "mama_mboga", coverage_areas: ["Eastlands"], service_types: ["same_day"], price_per_kg: 25, base_rate: 100, rating: 5, total_deliveries: 3, is_verified: true }])),
      create: vi.fn(), registerCourier: vi.fn(), setAvailability: vi.fn(), bookWarehouse: vi.fn(),
      book: vi.fn(() => ok({ message: "Warehouse requested — the host will confirm", booking_id: "b2", status: "requested" })),
      calendar: vi.fn(() => ok(CALENDAR)), bookings: vi.fn(() => ok(BOOKINGS)), booking: vi.fn(), setBookingStatus: vi.fn(() => ok({ message: "Booking confirmed", status: "confirmed" })),
      planRoute: vi.fn(() => ok(ROUTES[0])), planRouteFromShipments: vi.fn(() => ok(ROUTES[0])),
      routes: vi.fn(() => ok(ROUTES)), route: vi.fn(() => ok(ROUTES[0])),
      setRouteStatus: vi.fn(() => ok({ message: "Route dispatched", status: "dispatched", plan: { ...ROUTES[0], status: "dispatched" } })),
      solveStop: vi.fn(() => ok({ solved: true })),
      shipments: vi.fn(() => ok([])), bookShipment: vi.fn(), shipmentStatus: vi.fn(), rateShipment: vi.fn(), track: vi.fn(),
    },
    eventAPI: { browse: vi.fn(() => ok([])), mine: vi.fn(() => ok([])), get: vi.fn(), registrations: vi.fn(() => ok([])), create: vi.fn(), register: vi.fn(), cancelRegistration: vi.fn(), setStatus: vi.fn(), checkIn: vi.fn(), checkInVendor: vi.fn(), analytics: vi.fn() },
    posAPI: { connections: vi.fn(() => ok([])), syncLogs: vi.fn(() => ok([])) },
    notificationAPI: { list: vi.fn(() => ok({ unread_count: 0, notifications: [] })), unreadCount: vi.fn(() => ok({ unread_count: 0 })), markRead: vi.fn(), markAllRead: vi.fn() },
    collectiveAPI: { list: vi.fn(() => ok([])), get: vi.fn(), create: vi.fn(), pledge: vi.fn(), withdraw: vi.fn(), setStatus: vi.fn() },
    fileAPI: { upload: vi.fn(), limits: vi.fn(() => ok({ max_mb: 10, allowed: [] })) },
    analyticsAPI: {
      overview: vi.fn(() => ok(OVERVIEW)), trend: vi.fn(() => ok({ days: 90, trend: OVERVIEW.trend })),
      counterparties: vi.fn(() => ok([])), categories: vi.fn(() => ok(OVERVIEW.categories)),
      pricePosition: vi.fn(() => ok(OVERVIEW.price_position)), network: vi.fn(() => ok(OVERVIEW.network)),
      counterparty: vi.fn(() => ok(COUNTERPARTY)), weights: vi.fn(() => ok(WEIGHTS)),
    },
    opsAPI: {
      status: vi.fn(() => ok(OPS)),
      slow: vi.fn(() => ok({ threshold_ms: 1000, slow_routes: OPS.http.slow_routes })),
      metrics: vi.fn(() => ok("brief_up 1\nbrief_requests_total 240\n")),
    },
  };
});
vi.mock("@/lib/ws", () => ({ ws: { subscribe: vi.fn(() => () => {}), disconnect: vi.fn(), disconnectAll: vi.fn(), isOpen: () => true }, default: {} }));

import * as api from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { useAnalyticsStore } from "@/stores/analyticsStore";
import { useVendorStore } from "@/stores/vendorStore";
import { useListStore } from "@/stores/listStore";
import Analytics from "@/pages/analytics/Analytics";
import Ops from "@/pages/ops/Ops";
import Network from "@/pages/network/Network";
import RoutePlanner from "@/components/tools/RoutePlanner";
import BookingPanel from "@/components/tools/BookingPanel";
import ReviewsDrawer from "@/components/lists/ReviewPanel";

const mount = (ui, path = "/") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={ui} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  window.localStorage.clear();
  useAuthStore.setState({ token: "tok", vendor: ME, ready: true, loading: false });
  useAnalyticsStore.setState({ days: 90, overview: null, counterparty: null, weights: null, loading: false, loadingCounterparty: false });
  useVendorStore.setState({ network: [], connections: [], suggested: [], discovered: [], discoverWeights: null, stats: null, patron: null, loading: false });
  useListStore.setState({ lists: [], mine: [], loading: false });
  vi.clearAllMocks();
});

describe("Trade analytics dashboard", () => {
  it("opens with the summary, trend, price position and drills into a counterparty", async () => {
    mount(<Analytics />, "/analytics");
    expect(await screen.findByText("Trade analytics")).toBeInTheDocument();
    expect(api.analyticsAPI.overview).toHaveBeenCalledWith(90);

    expect(await screen.findByText("Trade value")).toBeInTheDocument();
    expect(screen.getAllByText(/23,000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Counterparties").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/100%/).length).toBeGreaterThan(0); // on-time shipment rate
    expect(screen.getByText("Price position")).toBeInTheDocument();
    expect(screen.getByText("below")).toBeInTheDocument();
    expect(screen.getByText(/headroom before you look expensive/i)).toBeInTheDocument();
    expect(screen.getAllByText("fresh produce").length).toBeGreaterThan(0);

    // switching the window refetches
    fireEvent.click(screen.getByRole("tab", { name: "30d" }));
    await waitFor(() => expect(api.analyticsAPI.overview).toHaveBeenLastCalledWith(30));

    // counterparty drill-down
    fireEvent.click(screen.getByText(/Kibanda Kitchen/));
    await waitFor(() => expect(api.analyticsAPI.counterparty).toHaveBeenCalledWith("kibanda_kitchen", 30)); // respects the selected window
    expect(await screen.findByText("You sold")).toBeInTheDocument();
    expect(screen.getByText("Net position")).toBeInTheDocument();
    expect(screen.getByText("Tomatoes (crate)")).toBeInTheDocument();
  });

  it("explains the discovery weights it was ranked with", async () => {
    mount(<Analytics />, "/analytics");
    await screen.findByText("Trade analytics");
    await waitFor(() => expect(api.analyticsAPI.weights).toHaveBeenCalled());
    expect(screen.getByTitle(/complementarity: 25%/)).toBeInTheDocument();
  });
});

describe("Vendor-list reviews", () => {
  it("shows the distribution, posts a review and mirrors the new aggregate", async () => {
    const list = { ...LIST, avg_rating: 4.5, review_count: 2 };
    useListStore.setState({ lists: [list] });
    mount(<ReviewsDrawer list={list} onClose={() => {}} />);
    await waitFor(() => expect(api.listAPI.reviews).toHaveBeenCalledWith("l1", { sort: "recent", limit: 50 }));
    expect(await screen.findByText("4.5")).toBeInTheDocument();
    expect(screen.getByText("Vetted well")).toBeInTheDocument();
    expect(screen.getByText("Good market day crowd.")).toBeInTheDocument();
    expect(screen.getAllByText(/member/i).length).toBeGreaterThan(0);

    // a member can review, and the list store learns the new average
    fireEvent.click(screen.getByRole("button", { name: /write a review/i }));
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "Worth it" } });
    fireEvent.change(screen.getByLabelText("Review"), { target: { value: "Great buyers." } });
    fireEvent.click(screen.getByRole("button", { name: /(post|update) review/i }));
    await waitFor(() => expect(api.listAPI.createReview).toHaveBeenCalledWith("l1", { rating: 5, title: "Worth it", body: "Great buyers." }));
    await waitFor(() => expect(useListStore.getState().lists[0].avg_rating).toBe(5.0));
    expect(useListStore.getState().lists[0].review_count).toBe(3);
  });

  it("marks someone else's review helpful and never your own", async () => {
    mount(<ReviewsDrawer list={LIST} onClose={() => {}} />);
    await screen.findByText("Vetted well");
    const helpful = screen.getByRole("button", { name: /2 helpful/i });
    fireEvent.click(helpful);
    await waitFor(() => expect(api.listAPI.markHelpful).toHaveBeenCalledWith("l1", "r1"));
  });
});

describe("Discovery algorithm", () => {
  it("ranks candidates with their score, factors and reasons", async () => {
    mount(<Network />, "/network?tab=suggested");
    await waitFor(() => expect(api.vendorAPI.discover).toHaveBeenCalledWith({ limit: 12 }));
    expect(await screen.findByText("Kariobangi Fabrics")).toBeInTheDocument();
    expect(screen.getByText(/match 73\/100/)).toBeInTheDocument();
    expect(screen.getByText(/stocks textiles, which you source/)).toBeInTheDocument();
    expect(screen.getByText(/4.2 km away/)).toBeInTheDocument();
    expect(screen.getByText("complementarity 25")).toBeInTheDocument();
  });
});

describe("Courier route optimisation", () => {
  it("plans from undelivered parcels, ticks stops and dispatches the run", async () => {
    mount(<RoutePlanner />, "/tools?tab=routes");
    expect(await screen.findByText("Eastlands loop")).toBeInTheDocument();
    expect(screen.getByText("3 stops")).toBeInTheDocument();
    expect(screen.getByText("−4.7 km")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /plan from undelivered parcels/i }));
    await waitFor(() => expect(api.toolAPI.planRouteFromShipments).toHaveBeenCalledWith("cr1", { return_to_start: true, average_speed_kmh: 25 }));

    // the drawer opens on the optimised plan with its ordered stops
    expect(await screen.findByText("Kibanda Kitchen")).toBeInTheDocument();
    expect(screen.getByText(/unoptimised 23.1 km/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByTitle(/mark as done/i)[0]);
    await waitFor(() => expect(api.toolAPI.solveStop).toHaveBeenCalledWith("rt1", "s1", true));

    fireEvent.click(screen.getByRole("button", { name: /dispatch — tell senders/i }));
    await waitFor(() => expect(api.toolAPI.setRouteStatus).toHaveBeenCalledWith("rt1", "dispatched"));
  });

  it("points a non-courier at registration", async () => {
    api.toolAPI.couriers.mockResolvedValueOnce(ok([]));
    mount(<RoutePlanner onRegisterCourier={vi.fn()} />, "/tools?tab=routes");
    expect(await screen.findByText(/register as a courier to plan runs/i)).toBeInTheDocument();
  });
});

describe("Tool bookings & calendars", () => {
  it("surfaces host requests with confirm/decline and the day-by-day calendar", async () => {
    mount(<BookingPanel />, "/tools?tab=bookings");
    expect(await screen.findByText("Waiting on you")).toBeInTheDocument();
    expect(screen.getAllByText("Cold room, Wakulima market").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/10 sqm/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: /^confirm$/i })[0]);
    await waitFor(() => expect(api.toolAPI.setBookingStatus).toHaveBeenCalledWith("b1", "confirmed", undefined));

    // the availability tab paints committed vs free
    fireEvent.click(screen.getByRole("tab", { name: /availability/i }));
    fireEvent.change(await screen.findByLabelText(/choose a listing/i), { target: { value: "t1" } });
    await waitFor(() => expect(api.toolAPI.calendar).toHaveBeenCalledWith("t1", expect.objectContaining({ days: 14 })));
    expect(await screen.findByText("10")).toBeInTheDocument();
    expect(screen.getAllByText(/\/ 20 free/).length).toBe(2);
    expect(screen.getAllByText(/yours: 10/).length).toBeGreaterThan(0);
  });
});

describe("Ops console", () => {
  it("reads the registry: percentiles, error rate, pool and the raw scrape", async () => {
    mount(<Ops />, "/ops");
    expect(await screen.findByText("Ops & monitoring")).toBeInTheDocument();
    expect(api.opsAPI.status).toHaveBeenCalled();
    expect(screen.getByText("p95 latency")).toBeInTheDocument();
    expect(screen.getByText("250 ms")).toBeInTheDocument();
    expect(screen.getByText("v2.2.0")).toBeInTheDocument();
    expect(screen.getByText("reachable")).toBeInTheDocument();
    expect(screen.getByText("/api/analytics/overview")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /raw scrape/i }));
    await waitFor(() => expect(api.opsAPI.metrics).toHaveBeenCalled());
    expect(await screen.findByText(/brief_up 1/)).toBeInTheDocument();
  });
});
