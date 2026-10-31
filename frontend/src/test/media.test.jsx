/**
 * PHOTOS ON THE HOME FEED.
 *
 * The report was two sentences: "Photos don't render and there is loading error
 * on some shelves." Four things had to be true for a photo to appear, and each
 * of them had a hole:
 *
 *   1. the URL the API hands out must reach a file     → `/static/<key>` is
 *      served by the backend from disk OR from Postgres (see
 *      backend/tests/test_media_static.py);
 *   2. the record must actually carry the photo        → `/api/tools/browse`
 *      dropped `images` from its response model, so equipment never had one;
 *   3. the card must render every stored shape         → `uploads/<key>`,
 *      `{ url }` objects and absolute URLs all reach the same file;
 *   4. a dead URL must degrade, not break              → an `<img>` with no
 *      `onError` paints the browser's broken-image glyph inside a designed card.
 *
 * These specs cover 2–4 on the client. A fifth file (`shelfResilience.test.jsx`)
 * covers the shelf-level failure path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { PHOTO, DEAD, BARE } = vi.hoisted(() => ({
  PHOTO: "/static/uploads/11111111-1111-1111-1111-111111111111/photo.jpg",
  DEAD: "/static/uploads/22222222-2222-2222-2222-222222222222/gone.jpg",
  BARE: "uploads/33333333-3333-3333-3333-333333333333/kitenge.jpg",
}));

const ok = (data) => Promise.resolve({ data });
const hanging = () => new Promise(() => {});

vi.mock("@/lib/api", () => {
  const apiError = (e, f = "Something went wrong") => e?.message || f;
  return {
    apiError,
    stockAPI: {
      network: vi.fn(() => ok([{
        id: "st-1", vendor_id: "v-2", vendor_handle: "gikomba", vendor_business: "Gikomba Textiles",
        name: "Kitenge 6-yard", category: "textiles", quantity_available: 60, quantity_in_stock: 60,
        unit_of_measure: "piece", unit_price: 1200, min_order_quantity: 5,
        visible_to_network: true, images: [PHOTO], quality_status: "unverified",
      }, {
        id: "st-2", vendor_id: "v-3", vendor_handle: "bare_key", vendor_business: "Bare Key Ltd",
        name: "Maize 90kg", category: "grains", quantity_available: 12, quantity_in_stock: 12,
        unit_of_measure: "bag", unit_price: 3200, visible_to_network: true,
        // A record whose key lost its prefix — bulk imports and older exports
        // look like this.
        images: [{ url: BARE }],
      }])),
      movements: vi.fn(() => ok([])),
      mine: vi.fn(() => ok([])),
    },
    toolAPI: {
      browse: vi.fn(() => ok([{
        id: "tool-1", vendor_id: "v-4", vendor_handle: "cool_store", vendor_business: "Cool Store Ltd",
        category: "cold_storage", title: "Cold room, 20 pallets", location: "Kisumu",
        price_per_unit: 3500, price_unit: "per_day", min_booking: 2, deposit_required: 0,
        capacity: { value: 20, unit: "pallets" }, features: [], is_available: true,
        times_booked: 4, avg_rating: 4.5, details: null, images: [PHOTO],
      }, {
        id: "tool-2", vendor_id: "v-5", vendor_handle: "no_photo", vendor_business: "No Photo Ltd",
        category: "warehouse", title: "Warehouse, no photo", location: "Kisumu",
        price_per_unit: 900, price_unit: "per_day", is_available: true,
        times_booked: 0, avg_rating: 0, capacity: {}, features: [], details: null, images: [],
      }])),
      mine: vi.fn(() => ok([])),
    },
    vendorAPI: { discover: vi.fn(() => ok([])), connections: vi.fn(() => ok([])) },
    requestsAPI: { list: vi.fn(() => ok([])) },
    squadAPI: { calls: vi.fn(() => ok({ calls: [] })) },
    eventAPI: { browse: vi.fn(() => ok([])) },
    groupAPI: { browse: vi.fn(() => ok([])) },
    listAPI: { browse: vi.fn(() => ok([])) },
    marketsAPI: {
      list: vi.fn(() => ok({
        markets: [
          { id: "z-1", name: "Kibuye Market", city: "Kisumu", country: "Kenya", member_count: 12 },
          { id: "z-2", name: "Old Shape Market", city: "Ahero", country: "Kenya", members: 4, places: 9 },
        ],
        countries: ["Kenya"],
      })),
    },
    catalogAPI: { catalogue: vi.fn(() => ok({ offers: [] })) },
  };
});

vi.mock("@/stores/authStore", () => ({
  useAuthStore: Object.assign(() => null, {
    getState: () => ({ vendor: null, token: "tok", ready: true }),
  }),
}));

import * as api from "@/lib/api";
import Media from "@/components/ui/Media";
import StockThumb from "@/components/stock/StockThumb";
import { CardMedia, CardPoster } from "@/components/home/cards/CardShell";
import MarketCard from "@/components/home/cards/MarketCard";
import { Package } from "lucide-react";
import CuratedShelf from "@/components/home/CuratedShelf";
import { mediaUrl } from "@/lib/media";
import Avatar from "@/components/ui/Avatar";
import { shelfByKey } from "@/config/homeShelves";
import { SHELF_TIMEOUT_MS, useHomeFeedStore } from "@/stores/homeFeedStore";

beforeEach(() => {
  vi.clearAllMocks();
  useHomeFeedStore.setState({ shelves: {} });
});

/* ── 1. one URL shape ──────────────────────────────────────────────────────── */

describe("mediaUrl", () => {
  it("leaves the URL the API already returns alone", () => {
    expect(mediaUrl(PHOTO)).toBe(PHOTO);
  });

  it("puts the /static prefix back on a bare storage key", () => {
    expect(mediaUrl(BARE)).toBe(`/static/${BARE}`);
    expect(mediaUrl(`/${BARE}`)).toBe(`/static/${BARE}`);
  });

  it("passes absolute and protocol-relative URLs through untouched", () => {
    expect(mediaUrl("https://cdn.example.com/a.jpg")).toBe("https://cdn.example.com/a.jpg");
    expect(mediaUrl("//cdn.example.com/a.jpg")).toBe("//cdn.example.com/a.jpg");
    expect(mediaUrl("data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA");
  });

  it("is empty for nothing at all — never the string 'undefined'", () => {
    expect(mediaUrl(null)).toBe("");
    expect(mediaUrl(undefined)).toBe("");
    expect(mediaUrl("   ")).toBe("");
    expect(mediaUrl({})).toBe("");
  });
});

/* ── 2. a dead file degrades to the design ─────────────────────────────────── */

describe("a photo that fails to load", () => {
  it("falls back to the product illustration instead of a broken-image glyph", () => {
    const { container } = render(
      <StockThumb item={{ name: "Kitenge 6-yard", category: "textiles", images: [DEAD] }} />
    );

    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", DEAD);

    fireEvent.error(img);

    expect(container.querySelector("img")).toBeNull();
    // The illustration names the category it stands in for.
    expect(screen.getByText("textiles")).toBeInTheDocument();
  });

  it("keeps the card's own text — only the picture is missing", () => {
    const { container } = render(
      <StockThumb item={{ name: "Kitenge 6-yard", category: "textiles", images: [DEAD] }}>
        <span>Sold out</span>
      </StockThumb>
    );
    fireEvent.error(container.querySelector("img"));
    expect(screen.getByText("Sold out")).toBeInTheDocument();
  });

  it("lets a card media slot fall back to its designed poster", () => {
    const { container } = render(
      <CardMedia src={DEAD} fallback={<span>Cold storage</span>} />
    );
    fireEvent.error(container.querySelector("img"));
    expect(screen.getByText("Cold storage")).toBeInTheDocument();
  });

  it("does not hide a later, working photo behind an earlier failure", () => {
    const { container, rerender } = render(<Media src={DEAD} fallback={<span>fallback</span>} />);
    fireEvent.error(container.querySelector("img"));
    expect(screen.getByText("fallback")).toBeInTheDocument();

    rerender(<Media src={PHOTO} fallback={<span>fallback</span>} />);
    expect(container.querySelector("img")).toHaveAttribute("src", PHOTO);
  });

  it("keeps a poster's own tone, and paints nothing over it", () => {
    // A poster card is a *designed* media slot, not an empty one — its tint
    // lives on the slot. Wrapping it in another background layer would hide the
    // market-green identity panel behind a grey box.
    const { container } = render(<CardPoster icon={Package} label="Cold storage" tone="brand" />);
    const slot = container.firstChild;
    expect(slot.className).toContain("bg-brand-50");
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("Cold storage")).toBeInTheDocument();
  });

  it("does not tint the slot of a card whose photo loaded", () => {
    const { container } = render(<CardMedia src={PHOTO} tint="bg-brand-50" fallback={<span>fallback</span>} />);
    const slot = container.firstChild;
    expect(container.querySelector("img")).toHaveAttribute("src", PHOTO);
    expect(slot.className).not.toContain("bg-brand-50");
  });

  it("shows the illustration for a record with no photo at all", () => {
    const { container } = render(<StockThumb item={{ name: "Maize", category: "grains" }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("grains")).toBeInTheDocument();
  });
});

/* ── 3. the record actually carries the photo ──────────────────────────────── */

describe("the avatar — the most-shown photo in the product", () => {
  // A vendor's face is drawn on every card, message, shelf and search result.
  // It used to be a bare <img> with whatever string the record held: a logo
  // stored as a bare key resolved against the current route, 404'd, and painted
  // the browser's broken glyph. This is the "photos are not visible anywhere"
  // report, in one component.
  it("puts the /static prefix back on a bare storage key", () => {
    const { container } = render(<Avatar name="Gikomba Textiles" src={BARE} />);
    expect(container.querySelector("img")).toHaveAttribute("src", `/static/${BARE}`);
  });

  it("falls back to initials when the file is gone", () => {
    const { container } = render(<Avatar name="Gikomba Textiles" src={DEAD} />);
    fireEvent.error(container.querySelector("img"));
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("GT");
  });

  it("draws initials when there is no photo at all", () => {
    const { container } = render(<Avatar name="Mama Mboga Fresh" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("MM");
  });
});

describe("a listing states whether it has a photo", () => {
  it("marks a card with a photo as present", () => {
    const { container } = render(<StockThumb item={{ name: "Kitenge", category: "textiles", images: [PHOTO] }} />);
    expect(container.firstChild).toHaveAttribute("data-photo", "present");
  });

  it("marks a card with no photo as missing — the distinction the bug hid", () => {
    const { container } = render(<StockThumb item={{ name: "Maize", category: "grains" }} />);
    expect(container.firstChild).toHaveAttribute("data-photo", "missing");
  });
});

describe("shelf normalisers", () => {
  it("keeps the equipment listing's photo, which the response model used to drop", async () => {
    const rows = await shelfByKey("equipment").load();
    expect(rows[0].image).toBe(PHOTO);
    expect(rows[1].image).toBeNull();
  });

  it("accepts an image stored as { url } and still writes a plain string", async () => {
    const rows = await shelfByKey("stock").load();
    expect(rows.find((r) => r.id === "st-2").image).toBe(BARE);
  });

  it("reads the market's member count from the field the API returns", async () => {
    const rows = await shelfByKey("markets").load();
    expect(rows[0].members).toBe(12);
    expect(rows[0].places).toBeNull();  // the list endpoint does not count places
    expect(rows[1].members).toBe(4);    // legacy shape still works
    expect(rows[1].places).toBe(9);
  });
});

describe("market card", () => {
  const market = (over = {}) => ({
    id: "z-1", kind: "market", to: "/markets/z-1", title: "Kibuye Market",
    city: "Kisumu", country: "Kenya", members: 12, places: null, distanceKm: null, ...over,
  });

  it("states the member count and stays silent about places it was not given", () => {
    render(<MemoryRouter><MarketCard item={market()} /></MemoryRouter>);
    expect(screen.getAllByText(/12 registered vendors/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/mapped place/)).toBeNull();
  });

  it("states mapped places when a screen does carry them", () => {
    render(<MemoryRouter><MarketCard item={market({ places: 214 })} /></MemoryRouter>);
    expect(screen.getAllByText(/214 mapped places/).length).toBeGreaterThan(0);
  });
});

/* ── 4. the whole chain, drawn by a shelf ──────────────────────────────────── */

describe("a shelf draws the photo", () => {
  it("points <img> at the uploaded file and falls back when it is gone", async () => {
    const shelf = shelfByKey("equipment");
    const items = await shelf.load();

    const { container } = render(
      <MemoryRouter>
        <CuratedShelf shelf={shelf} state={{ items, status: "ready" }} />
      </MemoryRouter>
    );

    const imgs = [...container.querySelectorAll("img")];
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual([PHOTO]);

    fireEvent.error(imgs[0]);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    // Both records now show the designed illustration, which names the
    // category it stands in for.
    expect(screen.getAllByText("Cold Storage").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Warehouse").length).toBeGreaterThan(0);
  });
});

/* ── 5. a shelf that never answers ─────────────────────────────────────────── */

describe("a shelf whose request never settles", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops loading and offers a retry instead of spinning forever", async () => {
    api.stockAPI.network.mockReturnValueOnce(hanging());

    vi.useFakeTimers();
    const pending = useHomeFeedStore.getState().loadShelf("stock");

    expect(useHomeFeedStore.getState().shelves.stock.status).toBe("loading");

    await vi.advanceTimersByTimeAsync(SHELF_TIMEOUT_MS + 100);
    await pending;

    const state = useHomeFeedStore.getState().shelves.stock;
    expect(state.status).toBe("error");
    expect(state.error).toMatch(/didn't load/i);

    // The retry runs a fresh request against a healthy API.
    await useHomeFeedStore.getState().retryShelf("stock");
    expect(useHomeFeedStore.getState().shelves.stock.status).toBe("ready");
  });
});
