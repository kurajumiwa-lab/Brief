/**
 * OUTSIDE (v4) — the client side of the transformation.
 *
 * What these specs protect:
 *
 *   · navigation is Home · Explore · Create · Activity · Profile, and every v3
 *     URL still highlights the tab that absorbed it;
 *   · ONE creation entry point publishes all six content types, shows only the
 *     fields the chosen type needs, and never asks for a price;
 *   · switching content type keeps what you already typed, and a draft survives
 *     the component unmounting;
 *   · a card renders the response its own kind invites — attending an event is
 *     not saving a post — and shows a price only when the record has one;
 *   · the location bar explains where it thinks you are, offers a typed
 *     fallback, and never implies that GPS is required;
 *   · the forced shop-first onboarding modal no longer renders in the shell.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.setConfig({ testTimeout: 20000 });

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const ok = (data) => Promise.resolve({ data });

const ME = {
  id: "v-me", business_name: "Achieng Groceries", vendor_handle: "achieng",
  current_role: "both", physical_location: "Kondele, Kisumu",
  geo_lat: -0.095, geo_lng: 34.77,
};

const LOCATION = {
  lat: -0.095, lng: 34.77, label: "Kondele, Kisumu", radius_km: 15,
  layer: "town", source: "manual", interests: [], share_location: false,
  explainable: true,
};

const ITEMS = [
  {
    id: "p-1", kind: "post", to: "/post/p-1", title: "Saturday house party",
    summary: "Everyone welcome, bring your own drinks", location: "Kondele",
    distance_km: 0.4, created_at: "2026-10-16T18:00:00", status: "published",
    visibility: "public", price_kes: null, is_commercial: false,
    owner: { id: "v-2", handle: "otieno", name: "Otieno" },
    counts: { like: 3 }, reasons: ["0.4 km away"], reactions: {}, meta: {},
  },
  {
    id: "e-1", kind: "event", to: "/events?event=e-1", title: "Kit Mikayi hike",
    summary: "Meeting at the stage at 6am", location: "Kisumu",
    distance_km: 12.0, created_at: "2026-10-15T09:00:00",
    starts_at: "2026-10-19T06:00:00", status: "upcoming", visibility: "public",
    price_kes: null, is_commercial: false,
    owner: { id: "v-3", handle: "hikers", name: "Kisumu Hikers" },
    counts: { attending: 8 }, reasons: ["in 3 days"], reactions: {},
    meta: { capacity: 20, seats_left: 12, full: false },
  },
  {
    id: "l-1", kind: "listing", to: "/listing/l-1", title: "Maize flour 2kg",
    summary: "Wholesale bags in stock", location: "Kisumu central",
    distance_km: 2.1, created_at: "2026-10-16T07:00:00", status: "published",
    visibility: "public", price_kes: 180, is_commercial: true,
    owner: { id: "v-4", handle: "milimani", name: "Milimani Cereals" },
    counts: { available: 40 }, reasons: ["2.1 km away"], reactions: {},
    meta: { unit: "kg" },
  },
];

const SHELF_MANIFEST = {
  shelves: [
    { key: "happening_around_you", title: "Happening around you", subtitle: "",
      kinds: ["post", "event", "opportunity"], scope: "near", radius_km: 3,
      layout: "row", card: "notice", see_all: { to: "/explore?scope=near", label: "See everything nearby" },
      empty_state: { title: "Nothing within 3 km yet", body: "", action: { label: "Create a post", to: "/create" } },
      min_items: 0, boost: null },
  ],
  scopes: {}, content_types: ["post", "event", "listing", "community", "collection", "opportunity"],
  create_path: "/create",
  location: LOCATION,
};

const ACTIVITY = {
  groups: [
    { key: "invitations", count: 1, items: [{ id: "n-1", type: "group_invite", group: "invitations",
      title: "Kisumu Hikers invited you", body: "Come along on Sunday", data: {}, is_read: false,
      created_at: "2026-10-16T10:00:00" }] },
    { key: "events", count: 0, items: [] },
    { key: "replies", count: 0, items: [] },
    { key: "trades", count: 0, items: [] },
    { key: "community", count: 0, items: [] },
    { key: "account", count: 0, items: [] },
  ],
  counts: { unread_notifications: 1, rooms: 4, rooms_active_today: 2, attending: 3 },
  preferences: { groups: [], muted_groups: [] },
};

/* ── mocks ─────────────────────────────────────────────────────────────────── */

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  setLocation: vi.fn(),
  geocode: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  outsideAPI: {
    shelves: vi.fn(() => ok(SHELF_MANIFEST)),
    feed: vi.fn(() => ok({ items: ITEMS, next_cursor: null, center: {}, location: LOCATION })),
    search: vi.fn(() => ok({ items: ITEMS, next_cursor: null, query: null, filters: {}, location: LOCATION })),
    create: mocks.create,
    detail: vi.fn(), update: vi.fn(), remove: vi.fn(),
    react: vi.fn(() => ok({ ok: true })),
    unreact: vi.fn(() => ok({ ok: true })),
    location: vi.fn(() => ok(LOCATION)),
    setLocation: mocks.setLocation,
    report: vi.fn(() => ok({ ok: true })),
    activity: vi.fn(() => ok(ACTIVITY)),
  },
  geoAPI: { geocode: mocks.geocode },
  fileAPI: { upload: mocks.upload },
  apiError: (_e, fallback) => fallback,
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: Object.assign((selector) => selector({
    token: "t", ready: true, vendor: ME, fetchVendor: vi.fn(),
  }), { getState: () => ({ vendor: ME }) }),
}));

// The existing feed and chat stores are exercised by their own specs; here they
// only need to not explode.
vi.mock("@/stores/homeFeedStore", () => ({
  useHomeFeedStore: (s) => s({ shelves: {}, loadFeed: vi.fn(), refreshFeed: vi.fn(), retryShelf: vi.fn() }),
  feedIsQuiet: () => false,
  feedSettled: () => true,
  STALE_MS: 1000,
}));
vi.mock("@/stores/stockStore", () => ({
  useStockStore: (s) => s({ movements: [], fetchMovements: vi.fn() }),
  needsMyAction: () => false,
}));
vi.mock("@/stores/chatStore", () => ({
  useChatStore: (s) => s({ rooms: [] }),
}));

beforeEach(async () => {
  mocks.create.mockReset();
  mocks.setLocation.mockReset().mockImplementation((body) => ok({ ...LOCATION, ...body }));
  mocks.geocode.mockReset().mockImplementation(() => ok({ lat: -0.095, lng: 34.77 }));
  mocks.upload.mockReset().mockImplementation(() => ok({ url: "/files/a.jpg" }));
  try { localStorage.clear(); } catch { /* no storage in this env */ }
  // Both stores are module singletons, so a draft or a loaded feed would
  // otherwise leak from one spec into the next. `discard()` is the same reset a
  // real "start a new post" performs.
  const { useCreateStore } = await import("@/stores/createStore");
  useCreateStore.getState().discard();
});

const renderAt = (path, element) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={element} />
      </Routes>
    </MemoryRouter>,
  );

/* ── 1. navigation ─────────────────────────────────────────────────────────── */

describe("Outside navigation", () => {
  it("presents the five Outside destinations with one prominent create action", async () => {
    const { PRIMARY_NAV } = await import("@/config/navigation");
    expect(PRIMARY_NAV.map((i) => i.label)).toEqual(["Home", "Explore", "Create", "Activity", "Profile"]);
    expect(PRIMARY_NAV.filter((i) => i.action).map((i) => i.to)).toEqual(["/create"]);
    expect(new Set(PRIMARY_NAV.map((i) => i.to)).size).toBe(5);
  });

  it("keeps every v3 URL resolving to the tab that absorbed it", async () => {
    const { PRIMARY_NAV, isPrimaryActive } = await import("@/config/navigation");
    const explore = PRIMARY_NAV.find((i) => i.label === "Explore");
    const activity = PRIMARY_NAV.find((i) => i.label === "Activity");
    const profile = PRIMARY_NAV.find((i) => i.label === "Profile");

    // Browse's discovery surfaces became Explore.
    for (const path of ["/explore", "/browse", "/network", "/nearby/food", "/map", "/markets",
      "/news", "/search/goods", "/listing/x", "/place/y", "/events", "/groups", "/lists"]) {
      expect(isPrimaryActive(explore, path), path).toBe(true);
    }
    // Work and Inbox became Activity.
    for (const path of ["/activity", "/work", "/orders", "/chat", "/tasks", "/locks", "/tools"]) {
      expect(isPrimaryActive(activity, path), path).toBe(true);
    }
    // The workspace is Profile, and only your own handle highlights it.
    for (const path of ["/me", "/stock", "/analytics", "/pos", "/passport", "/enterprise"]) {
      expect(isPrimaryActive(profile, path), path).toBe(true);
    }
    expect(isPrimaryActive(profile, "/@achieng", "achieng")).toBe(true);
    expect(isPrimaryActive(profile, "/@someone_else", "achieng")).toBe(false);
    // Areas never overlap.
    expect(isPrimaryActive(activity, "/explore")).toBe(false);
    expect(isPrimaryActive(explore, "/orders")).toBe(false);
  });

  it("names all six content types for the single creation entry point", async () => {
    const { CREATE_TYPES } = await import("@/config/navigation");
    expect(CREATE_TYPES.map((t) => t.value).sort()).toEqual(
      ["collection", "community", "event", "listing", "opportunity", "post"]);
  });

  it("renders a bottom tab bar whose create tab is the prominent one", async () => {
    const MobileTabBar = (await import("@/components/layout/MobileTabBar")).default;
    renderAt("/", <MobileTabBar />);
    expect(screen.getByTestId("tab-create")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /primary mobile/i })).toBeInTheDocument();
    for (const label of ["home", "explore", "activity", "profile"]) {
      expect(screen.getByTestId(`tab-${label}`)).toBeInTheDocument();
    }
  });
});

/* ── 2. the unified creation page ──────────────────────────────────────────── */

describe("Unified creation", () => {
  const Create = async () => (await import("@/pages/create/CreatePage")).default;

  it("offers all six content types behind one entry point", async () => {
    renderAt("/create", await (async () => { const C = await Create(); return <C />; })());
    for (const type of ["post", "event", "listing", "community", "collection", "opportunity"]) {
      expect(screen.getByTestId(`create-type-${type}`)).toBeInTheDocument();
    }
  });

  it("shows only the fields an event needs, and never demands a price", async () => {
    renderAt("/create?type=event", await (async () => { const C = await Create(); return <C />; })());
    // An event needs a title and a start time.
    expect(screen.getByTestId("create-title")).toBeInTheDocument();
    expect(screen.getByTestId("create-starts_at")).toBeInTheDocument();
    // Price exists but is behind "More options" and explicitly optional.
    expect(screen.queryByTestId("create-price")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/more options/i));
    const price = await screen.findByTestId("create-price");
    expect(price.closest("div")).toBeInTheDocument();
    expect(screen.getByText(/Leaving this out is a normal choice/i)).toBeInTheDocument();
  });

  it("publishes a house party with no price anywhere in the payload", async () => {
    mocks.create.mockImplementation(() => ok({ content_type: "event", id: "e-9", to: "/events?event=e-9", price_required: false }));
    renderAt("/create?type=event", await (async () => { const C = await Create(); return <C />; })());

    // An event's two required fields — a title and a start time. Note what is
    // absent: capacity, entry fee, tickets. None of them is asked for.
    fireEvent.change(screen.getByTestId("create-title"), { target: { value: "House party on Saturday" } });
    fireEvent.change(screen.getByTestId("create-body"), { target: { value: "Come round from seven, bring your own drinks" } });
    fireEvent.change(screen.getByTestId("create-starts_at"), { target: { value: "2026-10-24T19:00" } });
    fireEvent.click(screen.getByRole("button", { name: /publish event/i }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    const payload = mocks.create.mock.calls[0][0];
    expect(payload.content_type).toBe("event");
    expect(payload.title).toBe("House party on Saturday");
    expect(payload.starts_at).toBe("2026-10-24T19:00");
    // The whole point: a party publishes with no price in the payload at all.
    expect(payload).not.toHaveProperty("price_kes");
    expect(payload).not.toHaveProperty("wholesale_price_kes");
    expect(payload).not.toHaveProperty("capacity");
  });

  it("refuses to publish a post with nothing written, and says which field", async () => {
    renderAt("/create?type=post", await (async () => { const C = await Create(); return <C />; })());
    const publish = screen.getByRole("button", { name: /publish post/i });
    expect(publish).toBeDisabled();
    expect(screen.getByText(/Needs: body/i)).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("keeps what you typed when you change content type", async () => {
    renderAt("/create?type=post", await (async () => { const C = await Create(); return <C />; })());
    fireEvent.change(screen.getByTestId("create-body"), { target: { value: "Anyone fancy a hike on Sunday morning?" } });
    fireEvent.click(screen.getByTestId("create-type-event"));
    expect(screen.getByTestId("create-body")).toHaveValue("Anyone fancy a hike on Sunday morning?");
    // …and the event's own required field has appeared.
    expect(screen.getByTestId("create-starts_at")).toBeInTheDocument();
  });

  it("survives being unmounted, because drafts are real", async () => {
    const First = await Create();
    const { unmount } = renderAt("/create", <First />);
    fireEvent.change(screen.getByTestId("create-body"), { target: { value: "A draft that should outlive this test" } });
    unmount();

    const Second = await Create();
    renderAt("/create", <Second />);
    expect(screen.getByTestId("create-body")).toHaveValue("A draft that should outlive this test");
  });

  it("keeps the draft when publishing fails", async () => {
    mocks.create.mockImplementation(() => Promise.reject({ response: { data: { detail: "The network dropped that." } } }));
    renderAt("/create?type=post", await (async () => { const C = await Create(); return <C />; })());
    fireEvent.change(screen.getByTestId("create-body"), { target: { value: "A post that will fail to publish" } });
    fireEvent.click(screen.getByRole("button", { name: /publish post/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The network dropped that."));
    expect(screen.getByTestId("create-body")).toHaveValue("A post that will fail to publish");
  });

  it("treats a failed image upload as survivable, not fatal", async () => {
    mocks.upload.mockImplementation(() => Promise.reject(new Error("nope")));
    const CreatePage = await Create();
    renderAt("/create?type=post", <CreatePage />);
    fireEvent.change(screen.getByTestId("create-body"), { target: { value: "A post with a photo that will not upload" } });

    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });

    await waitFor(() => expect(mocks.upload).toHaveBeenCalled());
    // Still publishable — the text was not lost with the image.
    await waitFor(() => expect(screen.getByRole("button", { name: /publish post/i })).toBeEnabled());
  });
});

/* ── 3. the content card ───────────────────────────────────────────────────── */

describe("Content cards", () => {
  const Card = async () => (await import("@/components/outside/ContentCard")).default;

  it("gives each kind its own primary response", async () => {
    const ContentCard = await Card();
    const { unmount } = renderAt("/", <ContentCard item={ITEMS[1]} />);
    // An event invites attendance, not a save.
    expect(screen.getByRole("button", { name: /i'm going/i })).toBeInTheDocument();
    unmount();

    renderAt("/", <ContentCard item={ITEMS[0]} />);
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
  });

  it("shows a price only when the record actually has one", async () => {
    const ContentCard = await Card();
    const { unmount } = renderAt("/", <ContentCard item={ITEMS[2]} />);
    expect(screen.getByText(/KSh 180/)).toBeInTheDocument();
    unmount();

    // The party has no price, and the card does not invent "Free" or "N/A".
    renderAt("/", <ContentCard item={ITEMS[0]} />);
    expect(screen.queryByText(/KSh/)).not.toBeInTheDocument();
    expect(screen.queryByText(/free/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/n\/a/i)).not.toBeInTheDocument();
  });

  it("attributes content to its source", async () => {
    const ContentCard = await Card();
    renderAt("/", <ContentCard item={ITEMS[1]} />);
    expect(screen.getByText("@hikers")).toBeInTheDocument();
  });

  it("says where and how far, which is what makes it local", async () => {
    const ContentCard = await Card();
    renderAt("/", <ContentCard item={ITEMS[0]} />);
    expect(screen.getByText("Kondele")).toBeInTheDocument();
    expect(screen.getByText(/400 m away/)).toBeInTheDocument();
  });
});

/* ── 4. location ───────────────────────────────────────────────────────────── */

describe("Location awareness", () => {
  const Bar = async () => (await import("@/components/outside/LocationBar")).default;

  it("says where it thinks you are, and why", async () => {
    const LocationBar = await Bar();
    renderAt("/", <LocationBar />);
    await waitFor(() => expect(screen.getByTestId("location-label")).toHaveTextContent("Kondele, Kisumu"));
    expect(screen.getByText(/Using the area you chose/i)).toBeInTheDocument();
  });

  it("offers the three named radii rather than a bare number", async () => {
    const LocationBar = await Bar();
    renderAt("/", <LocationBar />);
    for (const km of [3, 15, 50]) {
      expect(screen.getByTestId(`radius-${km}`)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByTestId("radius-3"));
    await waitFor(() => expect(mocks.setLocation).toHaveBeenCalledWith(
      expect.objectContaining({ radius_km: 3 })));
  });

  it("accepts a typed location, so GPS is never required", async () => {
    const LocationBar = await Bar();
    renderAt("/", <LocationBar />);
    fireEvent.click(screen.getByRole("button", { name: /^change$/i }));
    fireEvent.change(await screen.findByTestId("location-input"), { target: { value: "Milimani, Kisumu" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(mocks.geocode).toHaveBeenCalledWith("Milimani, Kisumu"));
    await waitFor(() => expect(mocks.setLocation).toHaveBeenCalledWith(
      expect.objectContaining({ source: "manual", label: "Milimani, Kisumu" })));
  });

  it("never turns on location sharing by default", async () => {
    const LocationBar = await Bar();
    renderAt("/", <LocationBar />);
    fireEvent.click(screen.getByRole("button", { name: /^change$/i }));
    const share = await screen.findByRole("checkbox", { name: /show me on the nearby shelf/i });
    expect(share).not.toBeChecked();
    expect(screen.getByText(/Off by default/i)).toBeInTheDocument();
  });

  it("explains the fallback chain in words a person can act on", async () => {
    const { locationExplain } = await import("@/stores/outsideStore");
    expect(locationExplain({ source: "vendor_profile" })).toMatch(/business address/i);
    expect(locationExplain({ source: "market_zone" })).toMatch(/nearest market/i);
    expect(locationExplain({ source: "unset" })).toMatch(/pick a neighbourhood/i);
  });
});

/* ── 5. Explore ────────────────────────────────────────────────────────────── */

describe("Explore", () => {
  const Explore = async () => (await import("@/pages/explore/ExplorePage")).default;

  it("renders every content type with its own card, from one results list", async () => {
    const ExplorePage = await Explore();
    renderAt("/explore", <ExplorePage />);
    await waitFor(() => expect(screen.getByTestId("content-card-post")).toBeInTheDocument());
    expect(screen.getByTestId("content-card-event")).toBeInTheDocument();
    expect(screen.getByTestId("content-card-listing")).toBeInTheDocument();
  });

  it("filters by type through the URL, so back restores the results", async () => {
    const ExplorePage = await Explore();
    const { rerender } = render(
      <MemoryRouter initialEntries={["/explore"]}>
        <Routes><Route path="*" element={<ExplorePage />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId("content-card-post")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("explore-kind-event"));
    await waitFor(() => {
      // The chip is pressed; the query state lives in the URL, not in memory.
      expect(screen.getByTestId("explore-kind-event")).toHaveAttribute("aria-pressed", "true");
    });
    rerender(
      <MemoryRouter initialEntries={["/explore?kind=event"]}>
        <Routes><Route path="*" element={<ExplorePage />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId("explore-kind-event")).toHaveAttribute("aria-pressed", "true"));
  });

  it("keeps the no-price filter, one press away behind More filters", async () => {
    // The filter was demoted, not deleted: time and price now live behind one
    // disclosure so the first screen is categories and content, not controls.
    const ExplorePage = await Explore();
    renderAt("/explore", <ExplorePage />);
    await waitFor(() => expect(screen.getByTestId("content-card-post")).toBeInTheDocument());

    const more = screen.getByTestId("explore-more-filters");
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /no price/i })).not.toBeInTheDocument();

    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    const freeChip = screen.getByRole("button", { name: /no price/i });
    fireEvent.click(freeChip);
    expect(freeChip).toHaveAttribute("aria-pressed", "true");
    // ...and the collapsed control counts what is on, so nothing hides silently.
    expect(screen.getByTestId("explore-more-filters")).toHaveTextContent("1");
  });
});

/* ── 6. Activity ───────────────────────────────────────────────────────────── */

describe("Activity", () => {
  const Activity = async () => (await import("@/pages/activity/ActivityPage")).default;

  it("groups notifications instead of showing one undifferentiated wall", async () => {
    const ActivityPage = await Activity();
    renderAt("/activity", <ActivityPage />);
    await waitFor(() => expect(screen.getByTestId("activity-section-invitations")).toBeInTheDocument());
    expect(screen.getByText("Kisumu Hikers invited you")).toBeInTheDocument();
  });

  it("shows the counts that are real work", async () => {
    const ActivityPage = await Activity();
    renderAt("/activity", <ActivityPage />);
    await waitFor(() => expect(screen.getByTestId("activity-rooms")).toHaveTextContent("2"));
    expect(screen.getByTestId("activity-attending")).toHaveTextContent("3");
  });
});

/* ── 7. the shelf manifest and the removed onboarding ──────────────────────── */

describe("Shelves and onboarding", () => {
  it("treats shelf names as configuration the client renders from", async () => {
    const { outsideAPI } = await import("@/lib/api");
    const { data } = await outsideAPI.shelves();
    expect(data.shelves[0].key).toBe("happening_around_you");
    expect(data.shelves[0].kinds).toContain("event");
    expect(data.create_path).toBe("/create");
    // An intentional empty state points at the one creation entry point.
    expect(data.shelves[0].empty_state.action.to).toBe("/create");
    expect(data.content_types).toHaveLength(6);
  });

  it("no longer mounts a forced onboarding modal in the shell", async () => {
    const { default: Shell } = await import("@/components/layout/Shell");
    const { container } = renderAt("/", <Shell />);
    // The shell renders the chrome; it must not render the old flow's markers.
    expect(container.querySelector("[data-testid='onboarding-modal']")).toBeNull();
    expect(screen.queryByRole("dialog", { name: /walk your market/i })).toBeNull();
  });
});

/* ── 8. design tokens ──────────────────────────────────────────────────────── */

describe("Design tokens", () => {
  it("exposes semantic status colours, a spacing scale and card radii", async () => {
    const { default: config } = await import("../../tailwind.config.js");
    const theme = config.theme.extend;
    for (const name of ["ok", "warn", "danger", "info"]) {
      expect(theme.colors[name].DEFAULT).toContain(`var(--${name})`);
      expect(theme.colors[name].soft).toContain(`var(--${name}-soft)`);
    }
    expect(theme.spacing.s5).toBe("var(--space-5)");
    expect(theme.borderRadius.card).toBe("var(--card-radius)");
    // The top of the type scale was compressed so headings stop competing
    // with content: 5xl is no longer 3rem.
    expect(theme.fontSize["5xl"][0]).toBe("2.25rem");
    expect(theme.fontSize["title-page"][0]).toBe("1.75rem");
  });
});
