import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HomeHub from "@/pages/home/HomeHub";
import ActionCentre from "@/components/home/ActionCentre";
import { pendingCategoryRequest } from "@/config/categoryRequirements";
import { shouldShowDailyWelcome, WELCOME_KEY, WELCOME_INTERVAL_MS } from "@/components/home/DailyWelcome";
import { useTradeOverviewStore } from "@/stores/tradeOverviewStore";
import { vendorAPI, routineAPI, ordersAPI } from "@/lib/api";
import ExplorePage from "@/pages/explore/ExplorePage";
import { useHomeFeedStore } from "@/stores/homeFeedStore";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal()),
  vendorAPI: { profile: vi.fn(), connections: vi.fn(), update: vi.fn(), updateProfile: vi.fn() },
  routineAPI: { today: vi.fn() },
  ordersAPI: { records: vi.fn() },
}));

const auth = { vendor: null };
// Home now renders the storefront (chips, hero row, ten shelf skeletons) on every
// render. In jsdom that takes a few seconds per test, so this file gets a longer
// per-test budget. The shelf loaders are stubbed so no real network calls run.
vi.setConfig({ testTimeout: 20000 });

// The storefront loads every shelf on mount. These tests are about the header,
// action centre and welcome popup, so the shelf loaders are stubbed here rather
// than letting real API calls run inside the timing budget.
beforeEach(() => {
  useHomeFeedStore.setState({ loadFeed: () => {} });
});

vi.mock("@/stores/authStore", () => ({ useAuthStore: (sel) => sel({ vendor: auth.vendor }) }));

const stock = { mine: [], movements: [], mineLoaded: true, fetchMine: vi.fn() };
vi.mock("@/stores/stockStore", () => ({ useStockStore: (sel) => sel(stock) }));

function setup({ categories = ["shop"], profile = {}, vendorOver = {}, connections = [], movements = [], today = [], records = null } = {}) {
  auth.vendor = {
    vendor_handle: "amina",
    business_name: "Amina Stores",
    business_description: "",
    business_categories: categories,
    ...vendorOver,
  };
  stock.mine = [];
  stock.movements = movements;
  vendorAPI.profile.mockResolvedValue({ data: { portfolio_images: [], ...profile } });
  vendorAPI.connections.mockResolvedValue({ data: connections });
  routineAPI.today.mockResolvedValue({ data: { date: "2026-11-06", dots: today.length, items: today } });
  ordersAPI.records.mockResolvedValue({
    data: records || { summary: { recorded: 0, needs_action: 0 }, items: [] },
  });
}

const renderHome = (props = {}) =>
  render(<MemoryRouter><HomeHub {...props} /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useTradeOverviewStore.setState({ data: null, status: "idle", error: "", stale: false, retryable: false, at: null, token: 0, inFlight: null });
});

describe("Home is for doing", () => {
  it("shows the header, actions, activity and one discovery link — and nothing else", async () => {
    setup();
    renderHome();
    expect(await screen.findByRole("heading", { name: /Welcome, Amina Stores/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Find suppliers, goods and offers in Discovery/ }).getAttribute("href")).toBe("/explore");

    for (const removed of [
      "One network. Different participants.",
      "What the network is built on",
      "Explore the trade network",
      "Your shop is missing its details",
    ]) {
      expect(screen.queryByText(removed)).toBeNull();
    }
  });

  it("counts shop setup in the header (categories already set counts as one)", async () => {
    setup({ profile: { portfolio_images: ["a.jpg"] }, vendorOver: { business_description: "We sell soap." } });
    renderHome();
    expect(await screen.findByRole("link", { name: "Shop set up 3 of 6" })).toBeTruthy();
  });

  it("hides the action centre entirely when nothing is pending", async () => {
    setup({
      profile: { portfolio_images: ["a.jpg"] },
      vendorOver: { business_description: "We sell soap." },
      connections: [{ id: 1 }],
      movements: [{ id: 1 }],
    });
    stock.mine = [{ visible_to_network: true, images: ["x.jpg"] }];
    renderHome({ rules: [] });
    await screen.findByRole("link", { name: "Shop set up 6 of 6" });
    expect(screen.queryByRole("heading", { name: "Next actions" })).toBeNull();
  });
});

describe("next actions", () => {
  it("shows the first two pending items and expands the rest on View all", async () => {
    setup({ today: [{ key: "stock_out", label: "Sold-out stock", why: "Nothing left.", link: "/stock", count: 2, done: false, dot: true, kind: "check" }] });
    renderHome();
    await screen.findByRole("heading", { name: "Next actions" });
    const list = () => screen.getByRole("heading", { name: "Next actions" }).closest("section").querySelectorAll("li");
    expect(list()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /View all \(6\)/ }));
    expect(list()).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Show fewer" })).toBeTruthy();
  });

  it("puts vital setup tasks ahead of trading tasks", async () => {
    setup();
    renderHome();
    await screen.findByRole("heading", { name: "Next actions" });
    const first = screen.getByRole("heading", { name: "Next actions" }).closest("section").querySelector("li p");
    expect(first.textContent).toBe("Photograph what you sell");
  });

  it("only lists Today items that have something waiting", async () => {
    setup({
      profile: { portfolio_images: ["a.jpg"] },
      vendorOver: { business_description: "We sell soap." },
      connections: [{ id: 1 }],
      movements: [{ id: 1 }],
      today: [{ key: "x", label: "Quiet check", why: "", link: "/x", count: 0, done: false, dot: false, kind: "check" }],
    });
    stock.mine = [{ visible_to_network: true, images: ["x.jpg"] }];
    renderHome({ rules: [] });
    await screen.findByRole("link", { name: "Shop set up 6 of 6" });
    expect(screen.queryByText("Quiet check")).toBeNull();
  });
});

describe("activity", () => {
  it("is hidden when there are no trades", async () => {
    setup();
    renderHome();
    await screen.findByRole("link", { name: "Shop set up 1 of 6" });
    expect(screen.queryByRole("heading", { name: /Activity/ })).toBeNull();
  });

  it("shows the latest three trades and says how many need the business", async () => {
    setup({
      records: {
        summary: { recorded: 5, needs_action: 1 },
        items: [
          { id: "t1", item: "Soap", total_kes: 500 },
          { id: "t2", item: "Oil", total_kes: 900 },
          { id: "t3", item: "Flour", total_kes: 300 },
          { id: "t4", item: "Extra", total_kes: 100 },
        ],
      },
    });
    renderHome();
    expect(await screen.findByRole("heading", { name: /Activity · 1 needs you/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Soap/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Flour/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Extra/ })).toBeNull();
  });
});

describe("daily welcome", () => {
  it("shows when never shown, records the time, and stays closed for 24 hours", () => {
    expect(shouldShowDailyWelcome(1_000_000, localStorage)).toBe(true);
    localStorage.setItem(WELCOME_KEY, String(1_000_000));
    expect(shouldShowDailyWelcome(1_000_000 + WELCOME_INTERVAL_MS - 1, localStorage)).toBe(false);
    expect(shouldShowDailyWelcome(1_000_000 + WELCOME_INTERVAL_MS, localStorage)).toBe(true);
  });

  it("opens once, can be dismissed, and remembers the time across renders", async () => {
    setup();
    const first = renderHome();
    expect(await screen.findByRole("dialog", { name: /Good to see you, Amina Stores/ })).toBeTruthy();
    expect(localStorage.getItem(WELCOME_KEY)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    first.unmount();
    renderHome();
    await screen.findByRole("link", { name: "Shop set up 1 of 6" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("category data request", () => {
  const rules = [
    { key: "rider-vehicle", category: "rider", field: "vehicle_type", scope: "profile", label: "What do you deliver with?", prompt: "So buyers know what to expect.", placeholder: "e.g. van", minLength: 2 },
  ];

  it("picks the first applicable missing rule and ignores other categories", () => {
    const vendor = { business_categories: ["rider"] };
    expect(pendingCategoryRequest({ rules, vendor, profile: {} })?.key).toBe("rider-vehicle");
    expect(pendingCategoryRequest({ rules, vendor: { business_categories: ["shop"] }, profile: {} })).toBeNull();
  });

  it("stops asking once a valid answer exists, or once dismissed", () => {
    const vendor = { business_categories: ["rider"] };
    expect(pendingCategoryRequest({ rules, vendor, profile: { vehicle_type: "motorbike" } })).toBeNull();
    expect(pendingCategoryRequest({ rules, vendor, profile: { vehicle_type: " a " } })?.key).toBe("rider-vehicle");
    expect(pendingCategoryRequest({ rules, vendor, profile: {}, dismissedKeys: ["rider-vehicle"] })).toBeNull();
  });

  it("asks nothing before the profile has loaded", () => {
    expect(pendingCategoryRequest({ rules, vendor: { business_categories: ["rider"] }, profile: null })).toBeNull();
  });

  it("takes priority over the daily welcome, and saves one answer to the profile", async () => {
    setup({ categories: ["rider"] });
    vendorAPI.updateProfile.mockResolvedValue({ data: {} });
    renderHome({ rules });
    const dialog = await screen.findByRole("dialog", { name: "What do you deliver with?" });
    expect(screen.queryByRole("dialog", { name: /Good to see you/ })).toBeNull();

    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "motorbike" } });
    fireEvent.click(save);
    await waitFor(() => expect(vendorAPI.updateProfile).toHaveBeenCalledWith({ vehicle_type: "motorbike" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "What do you deliver with?" })).toBeNull());
  });

  it("Later closes it for this visit without saving anything", async () => {
    setup({ categories: ["rider"] });
    renderHome({ rules });
    const dialog = await screen.findByRole("dialog", { name: "What do you deliver with?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Later" }));
    expect(vendorAPI.updateProfile).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "What do you deliver with?" })).toBeNull();
  });
});

describe("Discovery owns the browsing doors", () => {
  it("Discovery links to verified offers, suppliers and goods", async () => {
    stock.mine = [];
    render(<MemoryRouter><ExplorePage /></MemoryRouter>);
    const nav = await screen.findByRole("navigation", { name: "Browse the network" });
    expect(within(nav).getByRole("link", { name: "Verified offers" }).getAttribute("href")).toBe("/offers");
    expect(within(nav).getByRole("link", { name: "Suppliers" }).getAttribute("href")).toBe("/browse?type=people");
  });
});

describe("ActionCentre on its own", () => {
  it("renders nothing while the progress is still loading", () => {
    const { container } = render(
      <MemoryRouter>
        <ActionCentre progress={{ steps: [], loaded: false }} />
      </MemoryRouter>,
    );
    expect(container.textContent).toBe("");
  });
});
