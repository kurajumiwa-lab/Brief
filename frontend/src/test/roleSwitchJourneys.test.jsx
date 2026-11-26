import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * ROLE SWITCHING AS A REAL SHELL JOURNEY.
 *
 * Component specs prove that a Drawer or a dialog can restore focus. They do
 * not prove that the header, the drawer, the global confirmation, the identity
 * store and the server-backed role write still work together after a change.
 * These tests drive that whole path: open -> read reachability -> confirm ->
 * token -> switch -> focus back.
 */

const apiMocks = vi.hoisted(() => ({
  identityMe: vi.fn(),
  dormantConfirmation: vi.fn(),
  switchRole: vi.fn(),
  fetchRooms: vi.fn(),
  loadActivity: vi.fn(),
  vendorMe: vi.fn(),
}));

vi.mock("@/lib/api", () => {
  const ok = (data) => Promise.resolve({ data });
  return {
    default: {},
    apiError: (error, fallback) => error?.response?.data?.detail || fallback,
    authAPI: {
      login: vi.fn(() => ok({})), register: vi.fn(() => ok({})),
      refresh: vi.fn(() => ok({})), changePassword: vi.fn(() => ok({})),
    },
    vendorAPI: {
      me: apiMocks.vendorMe,
      update: vi.fn(() => ok({})),
      profile: vi.fn(() => ok({})),
      updateProfile: vi.fn(() => ok({})),
      dormantConfirmation: apiMocks.dormantConfirmation,
      switchRole: apiMocks.switchRole,
    },
    identityAPI: {
      me: apiMocks.identityMe,
      save: vi.fn(() => ok({})),
    },
    outsideAPI: {
      activity: vi.fn(() => ok({ groups: [], counts: { rooms_active_today: 0 } })),
      agenda: vi.fn(() => ok({ items: [] })),
    },
    chatAPI: { rooms: vi.fn(() => ok([])) },
    stockAPI: {
      mine: vi.fn(() => ok([])),
      movements: vi.fn(() => ok([])),
      network: vi.fn(() => ok([])),
    },
    nearbyAPI: {
      frontDoors: vi.fn(() => ok({ front_doors: [] })),
      frontDoorSetting: vi.fn(() => ok({ front_door_visible: false })),
    },
  };
});

vi.mock("@/lib/ws", () => ({
  ws: {
    subscribe: vi.fn(() => () => {}),
    disconnect: vi.fn(),
    disconnectAll: vi.fn(),
    isOpen: () => false,
  },
}));

import { useAuthStore } from "@/stores/authStore";
import { useChatStore } from "@/stores/chatStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useOutsideStore } from "@/stores/outsideStore";
import { useStockStore } from "@/stores/stockStore";
import { useUIStore } from "@/stores/uiStore";
import Shell from "@/components/layout/Shell";

const ok = (data) => Promise.resolve({ data });
const VENDOR = {
  id: "v-me",
  business_name: "Mama Mboga Fresh",
  vendor_handle: "mama_mboga",
  current_role: "selling",
};

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<p>Home content</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function openDrawer() {
  const opener = screen.getByRole("button", { name: "Workspace menu" });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

function openRoleMenu() {
  fireEvent.click(screen.getByRole("button", { name: /operating as selling/i }));
  return screen.getByRole("menu", { name: /how you operate/i });
}

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = vi.fn();
  vi.clearAllMocks();
  apiMocks.identityMe.mockImplementation(() => ok({
    contact: { phone: "", email: "", show_phone: false, show_email: false },
  }));
  apiMocks.dormantConfirmation.mockImplementation(() => ok({
    current_role: "selling",
    confirmation_token: "server-token",
    confirm_dormant: true,
  }));
  apiMocks.switchRole.mockImplementation((role) => ok({ role, previous_role: "selling" }));
  apiMocks.fetchRooms.mockImplementation(() => ok([]));
  apiMocks.loadActivity.mockImplementation(() => ok({ groups: [], counts: {} }));
  apiMocks.vendorMe.mockImplementation(() => ok(VENDOR));

  useAuthStore.setState({ token: "tok", vendor: { ...VENDOR }, ready: true, loading: false });
  useIdentityStore.setState({
    intent: null,
    capabilities: [],
    contact: { phone: "", email: "", show_phone: false, show_email: false },
    affiliation: null,
    licence: null,
    loaded: false,
    status: "idle",
    error: null,
  });
  useUIStore.setState({ mobileSidebarOpen: false, confirm: null });
  useOutsideStore.setState({
    activity: { groups: [], counts: { rooms_active_today: 0 } },
    activityStatus: "ready",
    loadActivity: apiMocks.loadActivity,
  });
  useChatStore.setState({ rooms: [], fetchRooms: apiMocks.fetchRooms, activeRoom: null });
  useStockStore.setState({ movements: [] });
});

describe("the workspace drawer journey", () => {
  it("loads identity, reports reachability, and returns focus to the opener", async () => {
    const identityLoad = deferred();
    apiMocks.identityMe.mockImplementationOnce(() => identityLoad.promise);
    renderShell();
    const opener = openDrawer();

    const dialog = screen.getByRole("dialog", { name: "Workspace menu" });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(await screen.findByText(/page live, no reply route/i)).toBeInTheDocument();
    expect(apiMocks.identityMe).toHaveBeenCalledTimes(1);

    identityLoad.resolve({
      data: {
        contact: { phone: "", email: "mama@example.ke", show_phone: false, show_email: true },
      },
    });
    expect(await screen.findByText("Reachable")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("lets an active mode change through in one step, without a dormancy token", async () => {
    renderShell();
    openDrawer();
    const menu = openRoleMenu();
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /^sourcing\b/i }));

    await waitFor(() => expect(apiMocks.switchRole).toHaveBeenCalledWith("sourcing"));
    expect(apiMocks.dormantConfirmation).not.toHaveBeenCalled();
    expect(useAuthStore.getState().vendor.current_role).toBe("sourcing");
  });

  it("keeps the drawer open when its nested confirmation is cancelled", async () => {
    renderShell();
    openDrawer();
    const menu = openRoleMenu();
    const dormant = within(menu).getByRole("menuitemradio", { name: /^dormant\b/i });
    dormant.focus();
    fireEvent.click(dormant);

    const confirm = await screen.findByRole("dialog", { name: /stop appearing in discovery/i });
    expect(confirm).toBeInTheDocument();
    expect(apiMocks.dormantConfirmation).not.toHaveBeenCalled();

    // Escape belongs to the confirmation first. The old document-level Escape
    // handlers closed BOTH layers and dropped keyboard focus on the body.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Workspace menu" })).toBeInTheDocument();
    expect(useUIStore.getState().confirm).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(dormant));
    expect(apiMocks.switchRole).not.toHaveBeenCalled();
  });

  it("switches to dormant only after confirmation and a server-issued token", async () => {
    renderShell();
    openDrawer();
    const menu = openRoleMenu();
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /^dormant\b/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^go dormant$/i }));

    await waitFor(() => expect(apiMocks.dormantConfirmation).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(apiMocks.switchRole).toHaveBeenCalledWith(
      "dormant",
      expect.objectContaining({
        expected_current_role: "selling",
        confirm_dormant: true,
        confirmation_token: "server-token",
      }),
    ));
    expect(useAuthStore.getState().vendor.current_role).toBe("dormant");
  });
});
