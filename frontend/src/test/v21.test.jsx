import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// ── v2.1 surfaces: notifications, quality + compare, deal cards, collectives, shipments, check-in ──
const ok = (data) => Promise.resolve({ data });
const ME = {
  id: "v-me", business_name: "Mama Mboga Fresh", vendor_handle: "mama_mboga", current_role: "selling",
  business_categories: ["vegetables"], network_score: 5, parasitism_index: 42, total_sourced: 0, total_supplied: 1,
  has_pos_connected: false, is_patron: true, is_verified: false, fulfillment_rate: 92.5, reliability_score: 88, movements_completed: 12,
};
const NOTIFICATIONS = [
  { id: "n1", type: "deal_proposal", title: "@kibanda_kitchen proposed a deal", body: "20 crates at KES 2,500", data: { room_id: "deal1", message_id: "x5" }, is_read: false, created_at: "2026-09-29T08:00:00", sender_handle: "kibanda_kitchen" },
  { id: "n2", type: "collective_update", title: "Quota met", body: "Grade A tomatoes reached 30/30", data: { group_id: "g1", collective_id: "c1" }, is_read: true, created_at: "2026-09-28T08:00:00" },
];
const STOCK = [
  { id: "s1", name: "Sukuma wiki", sku: "SUK-1", category: "vegetables", quantity_in_stock: 280, quantity_reserved: 0, quantity_available: 280, unit_of_measure: "bunches", unit_price: 20, min_order_quantity: 20, visible_to_network: true, tags: [], vendor_handle: "mama_mboga", vendor_business: "Mama Mboga Fresh", quality_status: "self_declared", batch_number: "MWEA-0927", origin_country: "Kenya" },
];
const NETWORK_STOCK = [
  { ...STOCK[0], id: "s9", name: "Kitenge 6-yard", category: "textiles", vendor_handle: "gikomba_textiles", vendor_business: "Gikomba Textiles", unit_price: 1200, min_order_quantity: 5, quantity_available: 60, quality_status: "patron_verified", vendor_is_patron: true, vendor_fulfillment_rate: 97 },
];
const ALTS = [{ ...NETWORK_STOCK[0], id: "s10", name: "Kitenge 6-yard (Kariobangi)", vendor_handle: "kariobangi_fabrics", vendor_business: "Kariobangi Fabrics", unit_price: 1100, quality_status: "unverified", vendor_fulfillment_rate: 80 }];
const DEAL_ROOM = { id: "deal1", name: "Deal · Tomatoes", room_type: "deal", topic: null, topic_tags: [], participant_count: 2, message_count: 2, joined: true, deal_stock_item_id: "s1", participants: [{ id: "v-me", vendor_handle: "mama_mboga", business_name: "Mama Mboga Fresh" }, { id: "v-2", vendor_handle: "kibanda_kitchen", business_name: "Kibanda Kitchen" }] };
const DEAL_MESSAGES = [
  { id: "x5", room_id: "deal1", sender_id: "v-2", sender_handle: "kibanda_kitchen", sender_business: "Kibanda Kitchen", content: "Deal proposal: 20 crates × KES 2,500", message_type: "deal_proposal", sent_at: "2026-09-29T09:00:00", deal_data: { stock_item_id: "s1", stock_name: "Tomatoes", quantity: 20, unit_of_measure: "crates", proposed_price_per_unit: 2500, total: 50000, delivery_terms: "pickup", payment_terms: "on_delivery", status: "proposed", proposed_by: "v-2", round: 1 } },
];
const ACCEPTED = { ...DEAL_MESSAGES[0], deal_data: { ...DEAL_MESSAGES[0].deal_data, status: "accepted", movement_id: "m77" } };
const SYSTEM = { id: "x6", room_id: "deal1", sender_id: "v-me", sender_handle: "mama_mboga", content: "@mama_mboga accepted the deal", message_type: "system", sent_at: "2026-09-29T09:02:00", deal_data: { kind: "deal_accepted", movement_id: "m77" } };
const COLLECTIVES = [
  { id: "c1", group_id: "g1", organizer_handle: "mama_mboga", item_name: "Grade A tomatoes", target_quantity: 30, target_price_per_unit: 2400, unit_of_measure: "crates", status: "gathering", current_pledged_quantity: 10, pledge_count: 1, progress_pct: 33.3, deadline: "2026-10-04T00:00:00", my_pledge: null, can_manage: true, created_at: "2026-09-27T08:00:00" },
];
const SHIPMENTS = [
  { id: "sh1", tracking_number: "BRF-7F3A2C", status: "in_transit", courier_name: "Boda Express", courier_handle: "boda_express", sender_handle: "mama_mboga", receiver_handle: "kibanda_kitchen", origin: "Ngara", destination: "Kirinyaga Rd", weight_kg: 12, cost: 350, status_history: [{ status: "picked_up", at: "2026-09-29T07:00:00", by: "boda_express" }, { status: "in_transit", at: "2026-09-29T07:30:00", by: "boda_express" }], rating: null, my_role: "courier", created_at: "2026-09-29T07:00:00" },
  { id: "sh2", tracking_number: "BRF-11AA22", status: "delivered", courier_name: "Boda Express", courier_handle: "boda_express", sender_handle: "gikomba_textiles", receiver_handle: "mama_mboga", status_history: [], rating: null, my_role: "receiver", created_at: "2026-09-28T07:00:00", delivered_at: "2026-09-28T09:00:00" },
];
const EVENT = { id: "e1", title: "Ngara Farm-Gate Saturday", event_type: "sourcing_trip", organizer: "mama_mboga", organizer_id: "v-me", organizer_business: "Mama Mboga Fresh", start_date: "2026-09-29T06:00:00", end_date: "2026-09-29T11:00:00", location: "Ngara", is_virtual: false, entry_fee: 0, max_vendors: 20, registered_count: 2, spots_left: 18, status: "active", vendor_requirements: {}, my_status: null };
const ATTENDEE_EVENT = { ...EVENT, id: "e2", title: "Eastlands Trade Fair", organizer: "gikomba_textiles", organizer_id: "v-3", organizer_business: "Gikomba Textiles", my_status: "registered" };

vi.mock("@/lib/api", () => {
  const apiError = (e, f = "Something went wrong") => e?.response?.data?.detail || f;
  return {
    default: {},
    apiError,
    authAPI: { login: vi.fn(), register: vi.fn(), refresh: vi.fn() },
    vendorAPI: { me: vi.fn(() => ok(ME)), connections: vi.fn(() => ok([{ id: "v-2", vendor_handle: "kibanda_kitchen", business_name: "Kibanda Kitchen" }])), network: vi.fn(() => ok([])), stats: vi.fn(() => ok({})), suggested: vi.fn(() => ok([])), patronStatus: vi.fn(() => ok({ is_patron: true, tier: "starter" })) },
    stockAPI: {
      mine: vi.fn(() => ok(STOCK)), network: vi.fn(() => ok(NETWORK_STOCK)), movements: vi.fn(() => ok([])), categories: vi.fn(() => ok(["vegetables", "textiles"])),
      get: vi.fn(() => ok(STOCK[0])), alternatives: vi.fn(() => ok(ALTS)), verify: vi.fn(() => ok({ message: "Provenance recorded", item: { ...STOCK[0], quality_status: "self_declared" } })),
      patronVerify: vi.fn(() => ok({ ...NETWORK_STOCK[0], quality_status: "patron_verified" })), revokePatronVerify: vi.fn(), source: vi.fn(() => ok({ movement_id: "m9" })), add: vi.fn(), update: vi.fn(), remove: vi.fn(), advance: vi.fn(), bulkImport: vi.fn(),
    },
    groupAPI: { browse: vi.fn(() => ok([])), mine: vi.fn(() => ok([{ id: "g1", name: "Wakulima Sourcing Collective", group_type: "sourcing_collective", member_count: 3, is_member: true, my_role: "admin", creator_handle: "mama_mboga", is_public: true, description: "", categories: ["vegetables"] }])), get: vi.fn(() => ok({})), members: vi.fn(() => ok([])), create: vi.fn(), join: vi.fn(), leave: vi.fn(), approve: vi.fn(), createList: vi.fn() },
    listAPI: { browse: vi.fn(() => ok([])), mine: vi.fn(() => ok([])), members: vi.fn(() => ok([])), create: vi.fn(), register: vi.fn(), approve: vi.fn(), reject: vi.fn(), setOpen: vi.fn() },
    chatAPI: {
      rooms: vi.fn(() => ok([DEAL_ROOM])), room: vi.fn(() => ok(DEAL_ROOM)), messages: vi.fn(() => ok(DEAL_MESSAGES)), send: vi.fn(), join: vi.fn(), createTopic: vi.fn(), directRoom: vi.fn(), dealRoom: vi.fn(() => ok({ room_id: "deal1" })),
      acceptDeal: vi.fn(() => ok({ status: "accepted", movement_id: "m77", movement_status: "confirmed" })),
      counterDeal: vi.fn(() => ok({ message_id: "x7", sent: {} })),
      declineDeal: vi.fn(() => ok({ status: "declined" })),
    },
    toolAPI: {
      browse: vi.fn(() => ok([])), mine: vi.fn(() => ok([])), couriers: vi.fn(() => ok([{ id: "cr1", courier_name: "Boda Express", vendor_handle: "boda_express", coverage_areas: ["Eastlands"], service_types: ["same_day"], price_per_kg: 25, base_rate: 100, rating: 5, total_deliveries: 1, is_verified: true }])),
      create: vi.fn(), registerCourier: vi.fn(), setAvailability: vi.fn(), bookWarehouse: vi.fn(),
      shipments: vi.fn(() => ok(SHIPMENTS)), bookShipment: vi.fn(() => ok({ shipment_id: "sh3", tracking_number: "BRF-NEW001" })), shipmentStatus: vi.fn(() => ok({ status: "delivered" })), rateShipment: vi.fn(() => ok({ rating: 5 })), track: vi.fn(() => ok(SHIPMENTS[0])),
    },
    eventAPI: {
      browse: vi.fn(() => ok([EVENT, ATTENDEE_EVENT])), mine: vi.fn(() => ok([EVENT])), get: vi.fn(() => ok(EVENT)), registrations: vi.fn(() => ok([{ vendor_id: "v-2", vendor_handle: "kibanda_kitchen", business_name: "Kibanda Kitchen", status: "registered", registered_at: "2026-09-27T08:00:00" }])),
      create: vi.fn(), register: vi.fn(), cancelRegistration: vi.fn(), setStatus: vi.fn(),
      checkIn: vi.fn(() => ok({ message: "Checked in to 'Eastlands Trade Fair'", status: "attended" })), checkInVendor: vi.fn(() => ok({ status: "attended" })),
      analytics: vi.fn(() => ok({ registered: 2, capacity: 20, fill_rate: 10, attended: 0, no_show: 0, attendance_rate: 0, by_status: { registered: 2 }, categories: [{ category: "vegetables", vendors: 2 }] })),
    },
    posAPI: { connections: vi.fn(() => ok([])), syncLogs: vi.fn(() => ok([])) },
    notificationAPI: { list: vi.fn(() => ok({ unread_count: 1, notifications: NOTIFICATIONS })), unreadCount: vi.fn(() => ok({ unread_count: 1 })), markRead: vi.fn(() => ok({})), markAllRead: vi.fn(() => ok({})) },
    collectiveAPI: { list: vi.fn(() => ok(COLLECTIVES)), get: vi.fn(), create: vi.fn(() => ok({ message: "created", collective_id: "c2" })), pledge: vi.fn(() => ok({ status: "gathering", current_pledged_quantity: 15 })), withdraw: vi.fn(() => ok({})), setStatus: vi.fn(() => ok({ status: "negotiating" })) },
    fileAPI: { upload: vi.fn(), limits: vi.fn(() => ok({ max_mb: 10, allowed: [".pdf"] })) },
  };
});
const wsSubscribe = vi.fn(() => () => {});
vi.mock("@/lib/ws", () => ({ ws: { subscribe: (...a) => wsSubscribe(...a), disconnect: vi.fn(), disconnectAll: vi.fn(), isOpen: () => true }, default: {} }));

import * as api from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/stores/chatStore";
import { useStockStore } from "@/stores/stockStore";
import { useNotificationStore } from "@/stores/notificationStore";
import NotificationBell, { routeFor } from "@/components/notifications/NotificationBell";
import QualityBadge from "@/components/stock/QualityBadge";
import VendorCard from "@/components/vendor/VendorCard";
import CollectivePanel from "@/components/groups/CollectivePanel";
import ShipmentPanel from "@/components/tools/ShipmentPanel";
import StockRoom from "@/pages/stock/StockRoom";
import ChatPage from "@/pages/chat/ChatPage";
import EventsPage from "@/pages/events/EventsPage";
import ToolsPage from "@/pages/tools/ToolsPage";

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
  useChatStore.setState({ rooms: [], activeRoom: null, messages: [], live: false });
  useStockStore.setState({ mine: [], network: [], movements: [], categories: [] });
  useNotificationStore.getState().reset();
  vi.clearAllMocks();
});

describe("NotificationBell", () => {
  it("polls the unread count, lists notifications on open and follows one after marking it read", async () => {
    mount(<NotificationBell pollMs={60_000} />);
    await waitFor(() => expect(api.notificationAPI.unreadCount).toHaveBeenCalled());
    expect(await screen.findByTestId("unread-badge")).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: /1 unread notifications/i }));
    const panel = await screen.findByRole("dialog", { name: /notifications/i });
    expect(api.notificationAPI.list).toHaveBeenCalledWith({ limit: 30 });
    expect(await within(panel).findByText(/proposed a deal/i)).toBeInTheDocument();
    fireEvent.click(within(panel).getByText(/proposed a deal/i));
    await waitFor(() => expect(api.notificationAPI.markRead).toHaveBeenCalledWith("n1"));
    expect(useNotificationStore.getState().unreadCount).toBe(0);
  });

  it("routes each notification to the right screen", () => {
    expect(routeFor(NOTIFICATIONS[0])).toBe("/chat?room=deal1");
    expect(routeFor(NOTIFICATIONS[1])).toBe("/groups?tab=mine&group=g1&panel=collective");
    expect(routeFor({ type: "shipment_update", data: { tracking_number: "BRF-1" } })).toBe("/tools?tab=shipments");
    expect(routeFor({ type: "event_reminder", data: { event_id: "e1" } })).toBe("/events?event=e1");
    expect(routeFor({ type: "source_request", data: {} })).toBe("/stock?tab=movements&direction=outgoing");
  });
});

describe("Quality + comparison", () => {
  it("renders the quality ladder", () => {
    const { rerender } = render(<QualityBadge status="lab_certified" />);
    expect(screen.getByText("Lab-certified")).toBeInTheDocument();
    rerender(<QualityBadge status="patron_verified" />);
    expect(screen.getByText("Patron-verified")).toBeInTheDocument();
    rerender(<QualityBadge status="unverified" />);
    expect(screen.queryByText("Unverified")).not.toBeInTheDocument(); // hidden on network cards unless asked
    rerender(<QualityBadge status="unverified" showUnverified />);
    expect(screen.getByText("Unverified")).toBeInTheDocument();
  });

  it("compares a network item with cheaper alternatives", async () => {
    mount(<StockRoom />, "/stock?tab=network");
    expect(await screen.findByText("Kitenge 6-yard")).toBeInTheDocument();
    expect(screen.getByText("Patron-verified")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /compare alternatives/i }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(api.stockAPI.alternatives).toHaveBeenCalledWith("s9", 6));
    expect(await within(dialog).findByText("Kitenge 6-yard (Kariobangi)")).toBeInTheDocument();
    expect(within(dialog).getAllByTestId("compare-alt")).toHaveLength(1);
  });

  it("lets the owner declare provenance from their shelf", async () => {
    mount(<StockRoom />, "/stock");
    expect(await screen.findByText("Sukuma wiki")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /declare provenance/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/batch \/ lot number/i), { target: { value: "MWEA-0928" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /save provenance|verify|declare/i }));
    await waitFor(() => expect(api.stockAPI.verify).toHaveBeenCalled());
    expect(api.stockAPI.verify.mock.calls[0][0]).toBe("s1");
    expect(api.stockAPI.verify.mock.calls[0][1]).toMatchObject({ batch_number: "MWEA-0928" });
  });

  it("shows the reliability chip on vendor cards", () => {
    mount(<VendorCard vendor={{ ...ME, id: "v-9", vendor_handle: "someone" }} />);
    expect(screen.getByTestId("reliability-chip")).toHaveTextContent("93% fulfilled");
    expect(screen.getByText(/reliability 88/)).toBeInTheDocument();
  });
});

describe("Deal proposals in chat", () => {
  it("renders the structured card for the other party and accepts it", async () => {
    api.chatAPI.messages.mockImplementationOnce(() => ok(DEAL_MESSAGES)).mockImplementationOnce(() => ok([ACCEPTED, SYSTEM]));
    mount(<ChatPage />, "/chat?room=deal1");
    const card = await screen.findByTestId("deal-card");
    expect(card).toHaveAttribute("data-status", "proposed");
    expect(within(card).getByText("Tomatoes")).toBeInTheDocument();
    expect(within(card).getByText("Ksh 50,000")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: /^accept$/i }));
    await waitFor(() => expect(api.chatAPI.acceptDeal).toHaveBeenCalledWith("deal1", "x5"));
    await waitFor(() => expect(screen.getByTestId("deal-card")).toHaveAttribute("data-status", "accepted"));
    expect(screen.getByText(/accepted the deal/i)).toBeInTheDocument(); // system pill
    expect(screen.queryByRole("button", { name: /^accept$/i })).not.toBeInTheDocument();
  });

  it("sends a counter-offer with the new terms", async () => {
    mount(<ChatPage />, "/chat?room=deal1");
    const card = await screen.findByTestId("deal-card");
    fireEvent.click(within(card).getByRole("button", { name: /^counter$/i }));
    fireEvent.change(within(card).getByLabelText(/counter price per unit/i), { target: { value: "2300" } });
    fireEvent.change(within(card).getByLabelText(/counter quantity/i), { target: { value: "25" } });
    fireEvent.click(within(card).getByRole("button", { name: /send counter/i }));
    await waitFor(() => expect(api.chatAPI.counterDeal).toHaveBeenCalledWith("deal1", "x5", { proposed_price_per_unit: 2300, quantity: 25, delivery_terms: "pickup", payment_terms: "on_delivery", notes: null }));
  });

  it("applies message_update frames from the socket", async () => {
    mount(<ChatPage />, "/chat?room=deal1");
    await screen.findByTestId("deal-card");
    const listener = wsSubscribe.mock.calls[0][1];
    listener({ type: "message_update", message: { id: "x5", deal_data: { ...DEAL_MESSAGES[0].deal_data, status: "declined" } } });
    await waitFor(() => expect(screen.getByTestId("deal-card")).toHaveAttribute("data-status", "declined"));
  });

  it("hides the actions from the proposer", async () => {
    api.chatAPI.messages.mockImplementationOnce(() => ok([{ ...DEAL_MESSAGES[0], sender_id: "v-me", sender_handle: "mama_mboga", deal_data: { ...DEAL_MESSAGES[0].deal_data, proposed_by: "v-me" } }]));
    mount(<ChatPage />, "/chat?room=deal1");
    const card = await screen.findByTestId("deal-card");
    expect(within(card).getByText(/waiting for the other side/i)).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /^accept$/i })).not.toBeInTheDocument();
  });
});

describe("Collective sourcing", () => {
  it("lists requests for a group and records a pledge", async () => {
    mount(<CollectivePanel group={{ id: "g1", name: "Wakulima Sourcing Collective" }} canOpen />);
    expect(await screen.findByText("Grade A tomatoes")).toBeInTheDocument();
    await waitFor(() => expect(api.collectiveAPI.list).toHaveBeenCalledWith({ group_id: "g1" }));
    expect(screen.getByText(/10 \/ 30 pledged/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^pledge$/i }));
    const form = await screen.findByRole("form", { name: /^pledge$/i });
    fireEvent.change(within(form).getByLabelText(/units/i), { target: { value: "5" } });
    fireEvent.change(within(form).getByLabelText(/max price/i), { target: { value: "2450" } });
    fireEvent.submit(form);
    await waitFor(() => expect(api.collectiveAPI.pledge).toHaveBeenCalledWith("c1", { pledged_quantity: 5, max_price_per_unit: 2450 }));
    expect(api.collectiveAPI.list).toHaveBeenCalledTimes(2); // refetched after the pledge
  });

  it("opens a new request for the group", async () => {
    mount(<CollectivePanel group={{ id: "g1", name: "Wakulima" }} canOpen />);
    fireEvent.click(await screen.findByRole("button", { name: /open a request/i }));
    const form = await screen.findByRole("form", { name: /new collective request/i });
    fireEvent.change(within(form).getByLabelText(/^item/i), { target: { value: "Onions" } });
    fireEvent.change(within(form).getByLabelText(/target quantity/i), { target: { value: "40" } });
    fireEvent.change(within(form).getByLabelText(/target price/i), { target: { value: "1800" } });
    fireEvent.submit(form);
    await waitFor(() => expect(api.collectiveAPI.create).toHaveBeenCalled());
    expect(api.collectiveAPI.create.mock.calls[0][0]).toMatchObject({ group_id: "g1", item_name: "Onions", target_quantity: 40, target_price_per_unit: 1800 });
  });
});

describe("Courier shipments", () => {
  it("shows role-aware actions: the courier advances, the receiver rates", async () => {
    mount(<ShipmentPanel />);
    expect(await screen.findByText("BRF-7F3A2C")).toBeInTheDocument();
    const cards = screen.getAllByTestId("shipment-card");
    // courier on sh1 → forward-only next steps
    fireEvent.click(within(cards[0]).getByRole("button", { name: /out for delivery/i }));
    await waitFor(() => expect(api.toolAPI.shipmentStatus).toHaveBeenCalledWith("sh1", "out_for_delivery"));
    // receiver on delivered sh2 → rating form
    fireEvent.click(within(cards[1]).getByRole("button", { name: /^4 stars$/i }));
    fireEvent.click(within(cards[1]).getByRole("button", { name: /^rate$/i }));
    await waitFor(() => expect(api.toolAPI.rateShipment).toHaveBeenCalledWith("sh2", { rating: 4, review: null }));
  });

  it("books a courier from the Couriers tab and lands on Shipments", async () => {
    mount(<ToolsPage />, "/tools?tab=couriers");
    fireEvent.click(await screen.findByRole("button", { name: /book a delivery/i }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(api.vendorAPI.connections).toHaveBeenCalled());
    fireEvent.change(within(dialog).getByLabelText(/receiver/i), { target: { value: "v-2" } });
    fireEvent.change(within(dialog).getByLabelText(/weight/i), { target: { value: "8" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /book courier/i }));
    await waitFor(() => expect(api.toolAPI.bookShipment).toHaveBeenCalled());
    expect(api.toolAPI.bookShipment.mock.calls[0][0]).toBe("cr1");
    expect(api.toolAPI.bookShipment.mock.calls[0][1]).toMatchObject({ receiver_vendor_id: "v-2", weight_kg: 8, cost: 100 }); // base rate prefilled
    expect(await screen.findByTestId("shipment-panel")).toBeInTheDocument();
  });
});

describe("Event check-in", () => {
  it("lets a registered vendor check in when the window is open", async () => {
    mount(<EventsPage />, "/events");
    fireEvent.click(await screen.findByRole("button", { name: /eastlands trade fair/i }));
    const drawer = await screen.findByRole("dialog");
    fireEvent.click(within(drawer).getByRole("button", { name: /^check in$/i }));
    await waitFor(() => expect(api.eventAPI.checkIn).toHaveBeenCalledWith("e2"));
    expect(await within(drawer).findByText(/checked in/i)).toBeInTheDocument();
  });

  it("gives the organiser analytics and door check-in, and honours ?event= deep links", async () => {
    mount(<EventsPage />, "/events?event=e1");
    const drawer = await screen.findByRole("dialog");
    await waitFor(() => expect(api.eventAPI.analytics).toHaveBeenCalledWith("e1"));
    expect(await within(drawer).findByTestId("event-analytics")).toHaveTextContent("2 / 20");
    fireEvent.click(await within(drawer).findByRole("button", { name: /^check in$/i }));
    await waitFor(() => expect(api.eventAPI.checkInVendor).toHaveBeenCalledWith("e1", "v-2"));
  });
});
