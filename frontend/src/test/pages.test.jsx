import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

// ── API + socket doubles ────────────────────────────────────────────────────
const ok = (data) => Promise.resolve({ data });
const ME = {
  id: "v-me", business_name: "Mama Mboga Fresh", vendor_handle: "mama_mboga", current_role: "selling",
  business_categories: ["vegetables"], network_score: 5, parasitism_index: 42, total_sourced: 0, total_supplied: 1,
  total_stock_moved: 40, has_pos_connected: true, is_patron: true, is_verified: false, connected: false,
};
const OTHER = { ...ME, id: "v-2", business_name: "Kibanda Kitchen", vendor_handle: "kibanda_kitchen", current_role: "sourcing", connected: false, is_patron: false };
const MOVEMENTS = [
  { id: "m1", stock_name: "Tomatoes", sku: "TOM-C", from_handle: "mama_mboga", to_handle: "kibanda_kitchen", quantity: 2, unit_price: 2700, total_value: 5400, status: "pending", direction: "outgoing", notes: "Pickup Saturday", created_at: "2026-09-29T10:00:00" },
  { id: "m2", stock_name: "Sukuma wiki", sku: "SUK-1", from_handle: "mama_mboga", to_handle: "kibanda_kitchen", quantity: 40, unit_price: 20, total_value: 800, status: "received", direction: "outgoing", created_at: "2026-09-28T10:00:00" },
];
const STOCK = [
  { id: "s1", name: "Sukuma wiki", sku: "SUK-1", category: "vegetables", quantity_in_stock: 280, quantity_reserved: 0, quantity_available: 280, unit_of_measure: "bunches", unit_price: 20, min_order_quantity: 20, visible_to_network: true, tags: ["fresh"], vendor_handle: "mama_mboga", vendor_business: "Mama Mboga Fresh" },
];
const NETWORK_STOCK = [{ ...STOCK[0], id: "s9", name: "Kitenge 6-yard", vendor_handle: "gikomba_textiles", vendor_business: "Gikomba Textiles", unit_price: 1200, min_order_quantity: 5, quantity_available: 60 }];
const ROOMS = [
  { id: "r1", name: "Wakulima Sourcing Collective Chat", room_type: "group", topic: null, topic_tags: [], participant_count: 3, message_count: 5, joined: true },
  { id: "r2", name: "Import regulations", room_type: "niche", topic: "KEBS and KRA", topic_tags: ["imports"], participant_count: 1, message_count: 0, joined: false },
];
const MESSAGES = [
  { id: "x1", room_id: "r1", sender_id: "v-2", sender_handle: "kibanda_kitchen", sender_business: "Kibanda Kitchen", content: "Count me in for 60 bunches", message_type: "text", sent_at: "2026-09-29T09:00:00" },
  { id: "x2", room_id: "r1", sender_id: "v-me", sender_handle: "mama_mboga", sender_business: "Mama Mboga Fresh", content: "Fresh this morning", message_type: "stock_share", shared_stock: { id: "s1", name: "Sukuma wiki", quantity_available: 280, unit_of_measure: "bunches", unit_price: 20, min_order_quantity: 20 }, sent_at: "2026-09-29T09:05:00" },
];

vi.mock("@/lib/api", () => {
  const apiError = (e, f = "Something went wrong") => e?.response?.data?.detail || f;
  return {
    default: {},
    apiError,
    authAPI: { login: vi.fn(() => ok({ access_token: "tok" })), register: vi.fn(() => ok({})) },
    vendorAPI: {
      me: vi.fn(() => ok(ME)), stats: vi.fn(() => ok({ vendors: 4, by_role: { selling: 1, sourcing: 1, both: 2 }, connections: 3 })),
      suggested: vi.fn(() => ok([{ vendor_id: "v-3", vendor_handle: "boda_express", business_name: "Boda Express", business_categories: ["logistics"], current_role: "both", network_score: 1, reasons: ["They source what you stock"] }])),
      connections: vi.fn(() => ok([{ vendor_id: "v-2", vendor_handle: "kibanda_kitchen", business_name: "Kibanda Kitchen", business_categories: [], current_role: "sourcing", connection_type: "trade", parasitism_score: 35 }])),
      network: vi.fn(() => ok([ME, OTHER])), connect: vi.fn(() => ok({ message: "Connected" })), disconnect: vi.fn(() => ok({})),
      switchRole: vi.fn((role) => ok({ role })), byHandle: vi.fn(() => ok(OTHER)), profile: vi.fn(() => ok({})), patronStatus: vi.fn(() => ok({ is_patron: true, tier: "starter", max_lists: 1, max_vendors_per_list: 20 })),
      becomePatron: vi.fn(() => ok({})), update: vi.fn(() => ok(ME)), updateProfile: vi.fn(() => ok({})), graph: vi.fn(() => ok({})),
    },
    stockAPI: {
      mine: vi.fn(() => ok(STOCK)), network: vi.fn(() => ok(NETWORK_STOCK)), movements: vi.fn(() => ok(MOVEMENTS)), categories: vi.fn(() => ok(["vegetables", "textiles"])),
      add: vi.fn(() => ok({ message: "Stock added", stock_id: "s-new" })), get: vi.fn(() => ok({ ...STOCK[0], id: "s-new", name: "Spinach" })),
      update: vi.fn(() => ok(STOCK[0])), remove: vi.fn(() => ok({})), source: vi.fn(() => ok({ movement_id: "m9", total_value: 6000 })),
      advance: vi.fn((id, action) => ok({ message: `Movement ${action}ed`, status: action === "confirm" ? "confirmed" : action, movement_id: id })), bulkImport: vi.fn(() => ok({ added: 1, updated: 0, errors: [] })),
    },
    groupAPI: { browse: vi.fn(() => ok([])), mine: vi.fn(() => ok([])), get: vi.fn(() => ok({})), members: vi.fn(() => ok([])), create: vi.fn(), join: vi.fn(), leave: vi.fn(), approve: vi.fn(), createList: vi.fn() },
    listAPI: { browse: vi.fn(() => ok([])), mine: vi.fn(() => ok([])), members: vi.fn(() => ok([])), create: vi.fn(), register: vi.fn(), approve: vi.fn(), reject: vi.fn(), setOpen: vi.fn() },
    chatAPI: {
      rooms: vi.fn(() => ok(ROOMS)), room: vi.fn(() => ok(ROOMS[0])), messages: vi.fn(() => ok(MESSAGES)),
      send: vi.fn((room, body) => ok({ message: "Sent", message_id: "x3", sent: { id: "x3", room_id: room, sender_id: "v-me", sender_handle: "mama_mboga", sender_business: "Mama Mboga Fresh", content: body.content, message_type: body.message_type, sent_at: "2026-09-29T09:10:00" } })),
      join: vi.fn(() => ok({})), createTopic: vi.fn(() => ok({ message: "created", room_id: "r3" })), directRoom: vi.fn(() => ok({ room_id: "d1" })), dealRoom: vi.fn(() => ok({ room_id: "deal1" })),
    },
    toolAPI: { browse: vi.fn(() => ok([])), mine: vi.fn(() => ok([])), couriers: vi.fn(() => ok([])), create: vi.fn(), registerCourier: vi.fn(), setAvailability: vi.fn(), bookWarehouse: vi.fn() },
    eventAPI: { browse: vi.fn(() => ok([])), mine: vi.fn(() => ok([])), get: vi.fn(), registrations: vi.fn(() => ok([])), create: vi.fn(), register: vi.fn(), cancelRegistration: vi.fn(), setStatus: vi.fn() },
    posAPI: { connections: vi.fn(() => ok([])), connect: vi.fn(), disconnect: vi.fn(), sync: vi.fn(), push: vi.fn(), pushCsv: vi.fn(), syncLogs: vi.fn(() => ok([])) },
    // v2.1
    notificationAPI: { list: vi.fn(() => ok({ unread_count: 0, notifications: [] })), unreadCount: vi.fn(() => ok({ unread_count: 0 })), markRead: vi.fn(() => ok({})), markAllRead: vi.fn(() => ok({})) },
    collectiveAPI: { list: vi.fn(() => ok([])), get: vi.fn(), create: vi.fn(), pledge: vi.fn(), withdraw: vi.fn(), setStatus: vi.fn() },
    fileAPI: { upload: vi.fn(), limits: vi.fn(() => ok({ max_mb: 10, allowed: [".pdf"] })) },
    // the home hub reads four live counts
    newsAPI: { feed: vi.fn(() => ok({ window_days: 7, new_today: 2, generated_at: new Date().toISOString(), items: [], counts: {} })) },
    squadAPI: { calls: vi.fn(() => ok({ calls: [] })) },
    marketsAPI: { mine: vi.fn(() => ok({ markets: [] })) },
    mapAPI: { counts: vi.fn(() => ok({ markets: 0, vendors: 0, places: 0 })) },
  };
});

const wsSubscribe = vi.fn(() => () => {});
vi.mock("@/lib/ws", () => ({ ws: { subscribe: (...a) => wsSubscribe(...a), disconnect: vi.fn(), disconnectAll: vi.fn(), isOpen: () => true }, default: {} }));

import * as api from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/stores/chatStore";
import { useStockStore } from "@/stores/stockStore";
import { useNotificationStore } from "@/stores/notificationStore";
import App from "@/App";
import Dashboard from "@/pages/dashboard/Dashboard";
import StockRoom from "@/pages/stock/StockRoom";
import ChatPage from "@/pages/chat/ChatPage";
import Network from "@/pages/network/Network";
import Sidebar from "@/components/layout/Sidebar";
import AccountMenu from "@/components/layout/AccountMenu";
import MePage from "@/pages/me/MePage";
import SetupChecklist from "@/components/onboarding/SetupChecklist";

const mount = (ui, path = "/") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={ui} />
      </Routes>
    </MemoryRouter>
  );

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="current-location">{pathname}{search}</output>;
}

beforeEach(() => {
  window.localStorage.clear();
  useAuthStore.setState({ token: "tok", vendor: ME, ready: true, loading: false });
  useChatStore.setState({ rooms: [], activeRoom: null, messages: [], live: false });
  useStockStore.setState({ mine: [], network: [], movements: [], categories: [] });
  useNotificationStore.setState({ notifications: [], unreadCount: 0, loading: false, loaded: false });
  vi.clearAllMocks();
});

describe("routing & auth gate", () => {
  it("sends signed-out visitors to /auth and shows the vendor-only pitch", async () => {
    useAuthStore.setState({ token: null, vendor: null, ready: true });
    mount(<App />, "/stock");
    expect(await screen.findByRole("heading", { name: /enter the network/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /join/i }));
    expect(await screen.findByRole("heading", { name: /register your business/i })).toBeInTheDocument();
    // handle auto-slugs from the business name
    fireEvent.change(screen.getByLabelText(/business name/i), { target: { value: "Mama Mboga Fresh" } });
    expect(screen.getByLabelText(/^handle/i)).toHaveValue("mama_mboga_fresh");
  });

  it("keeps the secondary drawer free of Home and primary navigation", async () => {
    const { NAV } = await import("@/components/layout/Sidebar");
    mount(<Sidebar />, "/");
    const nav = await screen.findByRole("navigation", { name: /more sections/i });
    for (const { label } of NAV) expect(within(nav).getByText(label)).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: /^home$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: /current role/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
  });
});

describe("Account menu and operating mode", () => {
  it("keeps the sole mode switch in the identity menu and persists the server-backed choice", async () => {
    mount(<><AccountMenu /><Sidebar /></>);
    fireEvent.click(screen.getByRole("button", { name: /account and operating mode/i }));
    const menu = screen.getByRole("menu");
    const roleGroup = within(menu).getByRole("radiogroup", { name: /current role/i });
    fireEvent.click(within(roleGroup).getByTitle(/^Sourcing —/));
    await waitFor(() => expect(api.vendorAPI.switchRole).toHaveBeenCalledWith("sourcing"));
    await waitFor(() => expect(useAuthStore.getState().vendor.current_role).toBe("sourcing"));
    expect(screen.getAllByRole("radiogroup", { name: /current role/i })).toHaveLength(1);
    expect(within(menu).getByRole("menuitem", { name: /profile settings/i })).toBeInTheDocument();
    expect(within(menu).queryByRole("link", { name: /mama mboga fresh/i })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: /analytics|my shelf|pos bridge|dashboard/i })).not.toBeInTheDocument();
  });
});

describe("Me workspace", () => {
  it("shows business tools, a consistent operating mode and real destinations", async () => {
    mount(<MePage />, "/me");
    expect(await screen.findByRole("heading", { name: "Mama Mboga Fresh" })).toBeInTheDocument();
    expect(screen.getByText(/your business workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/currently selling/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /shop front/i })).toHaveAttribute("href", "/@mama_mboga");
    expect(screen.getByRole("link", { name: /my shelf/i })).toHaveAttribute("href", "/stock");
    expect(screen.getByRole("link", { name: /analytics/i })).toHaveAttribute("href", "/analytics");
    expect(screen.getByRole("link", { name: /pos bridge/i })).toHaveAttribute("href", "/pos");
    expect(screen.getByRole("link", { name: /^tasks\b/i })).toHaveAttribute("href", "/tasks");
    expect(screen.getByRole("link", { name: /vendor lists/i })).toHaveAttribute("href", "/lists");
    expect(screen.getByRole("link", { name: /market locks/i })).toHaveAttribute("href", "/locks");
    expect(screen.getByRole("link", { name: /our network/i })).toHaveAttribute("href", "/governance");
    expect(screen.getByRole("link", { name: /surfaces/i })).toHaveAttribute("href", "/feed");
    expect(screen.queryByRole("link", { name: /groups & collectives|events/i })).not.toBeInTheDocument();
  });
});

describe("Onboarding handoff", () => {
  it("removes completed steps and replaces onboarding with live business insights", async () => {
    useStockStore.setState({ mine: STOCK, movements: MOVEMENTS });
    mount(<SetupChecklist />, "/");

    const pulse = await screen.findByRole("region", { name: /your business, at a glance/i });
    expect(within(pulse).getByText("Visible listings").parentElement).toHaveTextContent("1");
    expect(within(pulse).getByText("Open trades").parentElement).toHaveTextContent("1");
    expect(within(pulse).getByText("Supplier links").parentElement).toHaveTextContent("1");
    expect(screen.queryByRole("heading", { name: /get trading/i })).not.toBeInTheDocument();
  });

  it("shows only remaining setup steps and turns a dismissal into a useful pulse", async () => {
    useStockStore.setState({ mine: STOCK, movements: [] });
    mount(<SetupChecklist />, "/");

    expect(await screen.findByText("Run the loop once")).toBeInTheDocument();
    expect(screen.queryByText("Say what you trade")).not.toBeInTheDocument();
    expect(screen.queryByText("Put one item on the shelf")).not.toBeInTheDocument();
    expect(screen.queryByText("Connect with a supplier")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /dismiss setup checklist/i }));
    expect(await screen.findByRole("region", { name: /a live read on your trading/i })).toBeInTheDocument();
  });
});

describe("Dashboard", () => {
  it("shows stats, actionable movements and suggested vendors", async () => {
    mount(<Dashboard />);
    expect(await screen.findByText("Mama Mboga Fresh")).toBeInTheDocument();
    expect(await screen.findByText("Tomatoes")).toBeInTheDocument(); // pending outgoing movement needs my confirm
    expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument();
    expect(await screen.findByText("Boda Express")).toBeInTheDocument();
    expect(screen.getByText(/they source what you stock/i)).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument(); // network pulse vendor count
  });

  it("renders notifications and routes market-lock notifications to the locks desk", async () => {
    api.notificationAPI.list.mockResolvedValueOnce(ok({
      unread_count: 1,
      notifications: [{
        id: "n-lock",
        type: "market_lock_locked",
        title: "Market lock reached",
        body: "Your zone reached its buying threshold.",
        is_read: false,
        created_at: new Date().toISOString(),
        data: { market_lock_cluster_id: "cluster-1" },
      }],
    }));

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Dashboard />
        <LocationProbe />
      </MemoryRouter>
    );

    const notification = await screen.findByRole("button", { name: /market lock reached/i });
    expect(notification).toHaveTextContent("just now");
    fireEvent.click(notification);
    await waitFor(() => expect(screen.getByTestId("current-location")).toHaveTextContent("/locks"));
  });

  it("advances a movement from the dashboard", async () => {
    mount(<Dashboard />);
    fireEvent.click(await screen.findByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(api.stockAPI.advance).toHaveBeenCalledWith("m1", "confirm"));
    expect(await screen.findByRole("button", { name: /mark shipped/i })).toBeInTheDocument();
  });
});

describe("Stock Room", () => {
  it("lists my shelf with owner controls", async () => {
    mount(<StockRoom />, "/stock");
    expect(await screen.findByText("Sukuma wiki")).toBeInTheDocument();
    expect(screen.getByLabelText("Edit")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove")).toBeInTheDocument();
  });

  it("adds stock via the form and pulls the full item back", async () => {
    mount(<StockRoom />, "/stock");
    fireEvent.click(await screen.findByRole("button", { name: /add stock/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/item name/i), { target: { value: "Spinach" } });
    fireEvent.change(within(dialog).getByLabelText(/^quantity$/i), { target: { value: "120" } });
    fireEvent.change(within(dialog).getByLabelText(/price/i), { target: { value: "30" } });   // a price is required to go on the shelf
    fireEvent.click(within(dialog).getByRole("button", { name: /add to my stock/i }));
    await waitFor(() => expect(api.stockAPI.add).toHaveBeenCalled());
    expect(api.stockAPI.add.mock.calls[0][0]).toMatchObject({ name: "Spinach", quantity_in_stock: 120, unit_price: 30 });
    await waitFor(() => expect(api.stockAPI.get).toHaveBeenCalledWith("s-new"));
    expect(await screen.findByText("Spinach")).toBeInTheDocument();
  });

  it("sources network stock through the dialog", async () => {
    mount(<StockRoom />, "/stock?tab=network");
    expect(await screen.findByText("Kitenge 6-yard")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^source$/i }));
    const dialog = await screen.findByRole("dialog");
    const qty = within(dialog).getByLabelText(/quantity/i);
    expect(qty).toHaveValue(5); // defaults to min order
    fireEvent.change(qty, { target: { value: "10" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /send request/i }));
    await waitFor(() => expect(api.stockAPI.source).toHaveBeenCalledWith("s9", { quantity: 10, proposed_price: null, notes: null }));
  });

  it("shows movements with the right actions per side", async () => {
    mount(<StockRoom />, "/stock?tab=movements");
    expect(await screen.findByText("Tomatoes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /received/i })).not.toBeInTheDocument(); // buyer-only action
    expect(screen.getByText(/1 needs your action/i)).toBeInTheDocument();
  });
});

describe("Network", () => {
  it("hides me from discover and connects to a vendor", async () => {
    mount(<Network />, "/network");
    expect(await screen.findByText("Kibanda Kitchen")).toBeInTheDocument();
    expect(screen.queryByText("Mama Mboga Fresh")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^connect$/i }));
    await waitFor(() => expect(api.vendorAPI.connect).toHaveBeenCalledWith("v-2"));
    expect(await screen.findByRole("button", { name: /connected/i })).toBeInTheDocument();
  });
});

describe("Chat", () => {
  it("opens a deep-linked room, subscribes with the token socket, renders shares and sends", async () => {
    mount(<ChatPage />, "/chat?room=r1");
    expect(await screen.findByText("Count me in for 60 bunches")).toBeInTheDocument();
    expect(screen.getByText(/source it in the stock room|Sukuma wiki/i)).toBeInTheDocument();
    expect(wsSubscribe).toHaveBeenCalledWith("r1", expect.any(Function));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "On my way" } });
    fireEvent.click(screen.getByLabelText("Send"));
    await waitFor(() => expect(api.chatAPI.send).toHaveBeenCalledWith("r1", { message_type: "text", content: "On my way" }));
    expect(await screen.findByText("On my way")).toBeInTheDocument();
    // a socket echo of the same id must not duplicate
    const listener = wsSubscribe.mock.calls[0][1];
    listener({ type: "message", message: { id: "x3", room_id: "r1", sender_id: "v-me", sender_handle: "mama_mboga", content: "On my way", message_type: "text", sent_at: "2026-09-29T09:10:00" } });
    await waitFor(() => expect(screen.getAllByText("On my way")).toHaveLength(1));
  });

  it("asks to join an open topic before posting", async () => {
    mount(<ChatPage />, "/chat?room=r2");
    expect(await screen.findByRole("button", { name: /join topic/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("Send")).not.toBeInTheDocument();
  });
});
