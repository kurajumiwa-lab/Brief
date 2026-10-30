/**
 * THE MARKET SHELF, AS A BUSINESS TOOL.
 *
 * The brief's five changes, each with a test that would fail if it regressed:
 *
 *   1. activity first, registration underneath  → the card leads with traders
 *      selling now, and a busy market outranks a market with more sign-ups;
 *   2. a walking radius, widening on request    → 25 km loads by itself;
 *   3. no scan button                           → the request fires on mount;
 *   4. the four doors are real                  → one with nothing behind it is
 *      disabled, and says "nothing yet" rather than opening an empty list;
 *   5. joining has a reason                     → the copy says what joining does
 *      to *your* shelf, and an empty market invites instead of showing zeroes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const api = vi.hoisted(() => ({
  around: vi.fn(),
  activity: vi.fn(),
  shelf: vi.fn(),
  join: vi.fn(),
  leave: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  marketsAPI: {
    around: api.around,
    activity: api.activity,
    shelf: api.shelf,
    join: api.join,
    leave: api.leave,
  },
  apiError: (e, f) => e?.response?.data?.detail || f,
}));

const { default: MarketsAround } = await import("@/components/markets/MarketsAround");
const { default: MarketActivityCard } = await import("@/components/markets/MarketActivityCard");
const { default: MarketDetail } = await import("@/pages/markets/MarketDetail");

const TRADING = {
  id: "m1",
  name: "Kibuye Market",
  city: "Kisumu",
  country: "Kenya",
  distance_km: 2.4,
  located: true,
  registered: 90,
  active_vendors: 32,
  selling_vendors: 32,
  listings: 86,
  services: 12,
  equipment: 4,
  recent_vendors: 21,
  categories: [{ category: "produce", listings: 40 }, { category: "household", listings: 12 }],
  explore: [
    { key: "goods", label: "Goods", blurb: "Products vendors sell", available: true, count: 86 },
    { key: "people", label: "People", blurb: "Find local vendors", available: true, count: 32 },
    { key: "services", label: "Services", blurb: "Find service providers", available: true, count: 12 },
    { key: "equipment", label: "Equipment", blurb: "Find tools and equipment", available: false, count: 0 },
  ],
  i_am_member: false,
  empty: false,
  invitation: null,
  last_activity_at: new Date().toISOString(),
};

const EMPTY = {
  id: "m2",
  name: "Kitale Town Market",
  city: "Kitale",
  country: "Kenya",
  distance_km: 9.1,
  located: true,
  registered: 0,
  active_vendors: 0,
  selling_vendors: 0,
  listings: 0,
  services: 0,
  equipment: 0,
  recent_vendors: 0,
  categories: [],
  explore: [],
  i_am_member: false,
  empty: true,
  invitation: "No trader has claimed Kitale Town Market yet. If you trade here, be the first.",
  last_activity_at: null,
};

function aroundBody(markets, wider = []) {
  return {
    data: {
      radius_km: 25,
      markets,
      wider,
      active_count: markets.filter((m) => !m.empty).length,
      inviting_count: markets.filter((m) => m.empty).length,
      note: null,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.around.mockResolvedValue(aroundBody([TRADING, EMPTY]));
  api.activity.mockResolvedValue({ data: TRADING });
  api.shelf.mockResolvedValue({ data: { kind: "goods", items: [], count: 0 } });
});

describe("1 · activity is the headline", () => {
  it("leads with traders selling now, not with registrations", () => {
    render(
      <MemoryRouter>
        <MarketActivityCard market={TRADING} />
      </MemoryRouter>
    );
    const card = screen.getByTestId("market-activity-card");
    const text = card.textContent;

    expect(text).toMatch(/32 traders selling now/);
    expect(text).toMatch(/86 listings/);
    // Registered is present, but after the activity line.
    expect(text.indexOf("32 traders selling now")).toBeLessThan(text.indexOf("90 registered"));
  });

  it("shows what the market actually sells", () => {
    render(
      <MemoryRouter>
        <MarketActivityCard market={TRADING} />
      </MemoryRouter>
    );
    const card = screen.getByTestId("market-activity-card");
    expect(card).toHaveTextContent("produce");
    expect(card).toHaveTextContent("household");
  });
});

describe("2 · an empty market invites", () => {
  it("says what claiming it would do instead of showing zeroes", () => {
    render(
      <MemoryRouter>
        <MarketActivityCard market={EMPTY} />
      </MemoryRouter>
    );
    const card = screen.getByTestId("market-activity-card");
    expect(card).toHaveAttribute("data-empty", "true");
    expect(card).toHaveTextContent(/be the first/i);
    expect(card).not.toHaveTextContent("0 registered");
    expect(card.textContent).not.toMatch(/0 traders selling/);
  });
});

describe("3 · markets around you, without a scan button", () => {
  it("loads by itself at a walking radius", async () => {
    render(
      <MemoryRouter>
        <MarketsAround />
      </MemoryRouter>
    );
    await screen.findByTestId("markets-around");
    // No button to press: the request happened on mount.
    expect(api.around).toHaveBeenCalledWith({ radius_km: 25, limit: 6 });
    expect(screen.queryByRole("button", { name: /^scan$/i })).toBeNull();
    expect(screen.getByText(/within 25 km/i)).toBeInTheDocument();
  });

  it("widens only when the reader asks, and never starts at 150 km", async () => {
    render(
      <MemoryRouter>
        <MarketsAround />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole("button", { name: /look further out/i }));
    await waitFor(() => expect(api.around).toHaveBeenCalledWith({ radius_km: 100, limit: 6 }));
  });

  it("renders nothing at all when there are no markets anywhere", async () => {
    api.around.mockResolvedValue(aroundBody([], []));
    const { container } = render(
      <MemoryRouter>
        <MarketsAround />
      </MemoryRouter>
    );
    await waitFor(() => expect(api.around).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("does not promise a shelf that further-out markets do not have", async () => {
    // Every market in the next ring is an invitation, not a trader. Saying
    // "3 further out are trading" here would be the same lie as a zero card.
    api.around.mockResolvedValue(aroundBody([], [EMPTY, { ...EMPTY, id: "m2" }, { ...EMPTY, id: "m3" }]));
    render(
      <MemoryRouter>
        <MarketsAround />
      </MemoryRouter>
    );
    expect(await screen.findByText(/still waiting for a first trader/i)).toBeInTheDocument();
    expect(screen.queryByText(/are trading/i)).not.toBeInTheDocument();
  });

  it("offers the widening when the ring is empty but markets exist further out", async () => {
    api.around.mockResolvedValue(aroundBody([], [TRADING]));
    render(
      <MemoryRouter>
        <MarketsAround />
      </MemoryRouter>
    );
    expect(await screen.findByText(/no market within 25 km has a shelf yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /look up to 100 km/i })).toBeInTheDocument();
  });
});

describe("4 · the market page", () => {
  function renderMarket() {
    return render(
      <MemoryRouter initialEntries={["/markets/m1"]}>
        <Routes>
          <Route path="/markets/:id" element={<MarketDetail />} />
        </Routes>
      </MemoryRouter>
    );
  }

  it("puts activity above registration", async () => {
    renderMarket();
    const stats = await screen.findByTestId("market-stats");
    expect(stats).toHaveTextContent("traders selling");
    expect(stats).toHaveTextContent("listings");
    expect(stats).toHaveTextContent("services");
    expect(screen.getByText(/90 registered/)).toBeInTheDocument();
  });

  it("only offers a door with something behind it", async () => {
    renderMarket();
    const goods = await screen.findByRole("button", { name: /Goods/i });
    expect(goods).not.toBeDisabled();
    expect(goods).toHaveTextContent("86 on the shelf");

    const equipment = screen.getByRole("button", { name: /Equipment/i });
    expect(equipment).toBeDisabled();
    expect(equipment).toHaveTextContent(/nothing yet/i);
  });

  it("switches the shelf to the door that was pressed", async () => {
    renderMarket();
    fireEvent.click(await screen.findByRole("button", { name: /People/i }));
    await waitFor(() => expect(api.shelf).toHaveBeenCalledWith("m1", { kind: "people", limit: 24 }));
  });

  it("says what joining does for the vendor, not just 'Register'", async () => {
    renderMarket();
    expect(await screen.findByRole("button", { name: /join this market/i })).toBeInTheDocument();
    expect(
      screen.getByText(/puts your shelf on this market's shelf, in front of buyers standing here/i)
    ).toBeInTheDocument();
  });

  it("calls an unclaimed market 'Claim', and explains why", async () => {
    api.activity.mockResolvedValue({ data: { ...EMPTY, explore: [] } });
    renderMarket();
    expect(await screen.findByRole("button", { name: /claim this market/i })).toBeInTheDocument();
    expect(screen.getByText(/joining makes you the first trader here/i)).toBeInTheDocument();
  });

  it("keeps the vendor's name on every shelf row", async () => {
    api.shelf.mockResolvedValue({
      data: {
        kind: "goods",
        count: 1,
        items: [
          {
            kind: "goods",
            id: "s1",
            title: "Tomatoes (crate)",
            category: "produce",
            price: 180,
            price_unit: "crate",
            quantity: 40,
            to: "/listing/s1",
            by: "Achieng Groceries",
            vendor_handle: "achieng",
          },
        ],
      },
    });
    renderMarket();
    const item = await screen.findByTestId("market-shelf-item");
    expect(item).toHaveTextContent("Tomatoes (crate)");
    expect(item).toHaveTextContent("by Achieng Groceries");
    expect(item).toHaveAttribute("href", "/listing/s1");
    // The price is the vendor's own, formatted for reading.
    expect(item).toHaveTextContent("KSh 180 / crate");
  });

  it("tells a vendor their own goods landed, even though it hides them", async () => {
    // The shelf never sells you your own stock, so a vendor with two items and
    // no neighbours would otherwise read a graveyard — and conclude that
    // publishing did nothing.
    api.shelf.mockResolvedValue({ data: { kind: "goods", count: 0, own: 2, items: [] } });
    renderMarket();
    expect(await screen.findByText(/your 2 items are on this market's shelf/i)).toBeInTheDocument();
    expect(screen.queryByText(/be the first/i)).not.toBeInTheDocument();
  });

  it("names a single own item in the singular", async () => {
    api.shelf.mockResolvedValue({ data: { kind: "goods", count: 0, own: 1, items: [] } });
    renderMarket();
    expect(await screen.findByText(/your item is on this market's shelf/i)).toBeInTheDocument();
  });

  it("turns an empty shelf into the market's own invitation", async () => {
    api.activity.mockResolvedValue({ data: EMPTY });
    renderMarket();
    expect(await screen.findByText(/be the first/i)).toBeInTheDocument();
  });
});
