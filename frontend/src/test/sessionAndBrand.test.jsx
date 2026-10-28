/**
 * STAYING SIGNED IN, AND WHAT THE PRODUCT IS CALLED.
 *
 * The report was "the accounts keep being logged out … it fails to log in so I
 * end up opening new accounts". Both halves are covered here:
 *
 *   · a session whose access token has died is renewed from the refresh token
 *     instead of being thrown away;
 *   · a profile call that fails for a reason other than the session does not
 *     sign anybody out;
 *   · when a session really does end, the sign-in screen says why and
 *     remembers the handle — the two things that stop people abandoning an
 *     account and registering another.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const api = vi.hoisted(() => ({
  me: vi.fn(),
  login: vi.fn(),
  refresh: vi.fn(),
  register: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  authAPI: { login: api.login, refresh: api.refresh, register: api.register },
  vendorAPI: { me: api.me },
  apiError: (err, fallback) => err?.response?.data?.detail || fallback,
}));

vi.mock("@/lib/ws", () => ({ ws: { disconnectAll: vi.fn() } }));
vi.mock("@/lib/offline", () => ({ clearCache: vi.fn() }));
vi.mock("@/lib/offlineReceipt", () => ({ clearAllPendingReceipts: vi.fn() }));

const VENDOR = { id: "v-1", vendor_handle: "achieng", business_name: "Achieng Groceries" };

const getState = async () => (await import("@/stores/authStore")).useAuthStore;

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  const store = await getState();
  store.setState({
    token: null,
    refreshToken: null,
    vendor: null,
    ready: false,
    authError: null,
    endedReason: null,
    lastIdentifier: null,
  });
  api.me.mockResolvedValue({ data: VENDOR });
});

describe("A session that has to be renewed", () => {
  it("trades a dead access token for a live one instead of signing out", async () => {
    const unauthorised = { response: { status: 401 } };
    api.me.mockRejectedValueOnce(unauthorised).mockResolvedValueOnce({ data: VENDOR });
    api.refresh.mockResolvedValue({ data: { access_token: "fresh-token", refresh_token: "fresh-refresh" } });

    const store = await getState();
    store.setState({ token: "expired", refreshToken: "still-good", ready: false });

    const vendor = await store.getState().fetchVendor();
    const after = store.getState();

    expect(api.refresh).toHaveBeenCalledWith("still-good");
    expect(vendor).toEqual(VENDOR);
    expect(after.token).toBe("fresh-token");
    expect(after.endedReason).toBeNull();
  });

  it("signs out only when renewing also fails, and says why", async () => {
    api.me.mockRejectedValue({ response: { status: 401 } });
    api.refresh.mockRejectedValue(new Error("nope"));

    const store = await getState();
    store.setState({ token: "expired", refreshToken: "also-dead", ready: false });

    await store.getState().fetchVendor();
    const after = store.getState();

    expect(after.token).toBeNull();
    expect(after.endedReason).toMatch(/sign in again/i);
    expect(after.endedReason).toMatch(/untouched|nothing was deleted/i);
  });

  it("does not throw the session away over a server fault", async () => {
    api.me.mockRejectedValue({ response: { status: 500 } });

    const store = await getState();
    store.setState({ token: "fine", refreshToken: "fine", ready: false });

    await store.getState().fetchVendor();
    const after = store.getState();

    expect(after.token).toBe("fine");
    expect(after.authError).toMatch(/didn't load/i);
    expect(after.endedReason).toBeNull();
  });

  it("does not sign someone out for a permission answer", async () => {
    // 403 is "signed in, not allowed here" — not a dead session.
    api.me.mockRejectedValue({ response: { status: 403 } });

    const store = await getState();
    store.setState({ token: "fine", refreshToken: "fine", ready: false });

    await store.getState().fetchVendor();
    const after = store.getState();

    expect(after.token).toBe("fine");
    expect(after.vendor).toBeNull();
    expect(after.endedReason).toBeNull();
  });
});

describe("The sign-in screen after a session ends on its own", () => {
  it("says what happened and starts from the last handle", async () => {
    const { useAuthStore } = await import("@/stores/authStore");
    useAuthStore.setState({
      endedReason: "Your session expired. Sign in again — your account and records are untouched.",
      lastIdentifier: "achieng",
    });

    const AuthPage = (await import("@/pages/auth/AuthPage")).default;
    render(
      <MemoryRouter initialEntries={["/auth"]}>
        <AuthPage />
      </MemoryRouter>
    );

    console.log("AUTH BODY:", document.body.textContent.slice(0, 300));
    const note = await screen.findByTestId("session-ended");
    expect(note).toHaveTextContent(/session expired/i);
    expect(screen.getByLabelText(/email or handle/i)).toHaveValue("achieng");
  });

  it("keeps the remembered handle across a reload", async () => {
    const { useAuthStore } = await import("@/stores/authStore");
    api.login.mockResolvedValue({
      data: { access_token: "t", refresh_token: "r", vendor_handle: "achieng" },
    });
    await useAuthStore.getState().login("  achieng  ", "Correct-horse-9");
    expect(useAuthStore.getState().lastIdentifier).toBe("achieng");

    // What zustand writes to storage is what the next launch reads.
    const persisted = JSON.parse(localStorage.getItem("brief-auth"));
    expect(persisted.state.lastIdentifier).toBe("achieng");
    expect(persisted.version).toBe(2);
  });
});

describe("The product's name", () => {
  it("is Vendor World in every string that matters, with Ogallo kept as the parent", async () => {
    const { BRAND } = await import("@/config/brand");
    expect(BRAND.name).toBe("Vendor World");
    expect(BRAND.wordmark).toBe("vendorworld");
    expect(BRAND.parent).toBe("Ogallo");

    const { default: Logo } = await import("@/components/layout/Logo");
    render(
      <MemoryRouter>
        <Logo />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: /vendor world — home/i })).toBeInTheDocument();
    expect(screen.getByText("vendorworld")).toBeInTheDocument();
  });

  it("titles the document Vendor World, not Ogallo", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    expect(html).toMatch(/<title>Vendor World —/);
    expect(html).not.toMatch(/<title>Ogallo/);
  });
});

describe("Your business billboard", () => {
  it("carries the shop's name on the board and the copper shelf under it", async () => {
    const { default: BusinessBillboard } = await import("@/components/home/BusinessBillboard");
    const { container } = render(
      <MemoryRouter>
        <BusinessBillboard vendor={{ ...VENDOR, physical_location: "Kondele, Kisumu" }} />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Achieng Groceries" })).toBeInTheDocument();
    expect(screen.getByText("@achieng")).toBeInTheDocument();
    expect(screen.getByText("Kondele, Kisumu")).toBeInTheDocument();

    // The art is decorative: no alt text competing with the heading, and the
    // card keeps its copper if the image never arrives.
    const art = container.querySelector("img");
    expect(art).toHaveAttribute("alt", "");
    expect(art).toHaveAttribute("loading", "lazy");
    expect(container.innerHTML).toContain("#8a4a22");
  });

  it("still renders a legible card for a business with no name, handle or photo", async () => {
    const { default: BusinessBillboard } = await import("@/components/home/BusinessBillboard");
    render(
      <MemoryRouter>
        <BusinessBillboard vendor={{}} />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "Your business" })).toBeInTheDocument();
    expect(screen.getByText(/a shelf on vendor world/i)).toBeInTheDocument();
  });
});
