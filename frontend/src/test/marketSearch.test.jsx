/**
 * THE HOME SEARCH, AFTER THE CHIPS WERE DELETED.
 *
 * Three promises, and each one is testable without a browser:
 *
 * 1. **Nothing is hardcoded.** The old row was the same five words — tomatoes,
 *    sukuma wiki, cooking oil, kitenge, rice — for every business on the
 *    network. There is no such list any more; the component has no chip
 *    constant at all.
 * 2. **Suggestions are specific.** Typing asks the guide and shows what is on
 *    the shelves right now; an empty field shows the vendor's own declared
 *    categories. No categories and no query means no band, no reserved space.
 * 3. **The field is small.** It is a 40px control, not a 52px one inside a card
 *    with a permanent row under it.
 *
 * The guide is mocked at the `@/lib/guide` boundary — the same boundary the
 * component uses — so these tests describe behaviour, not wiring.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const guide = vi.hoisted(() => ({ suggest: vi.fn(), nextShelf: vi.fn() }));
vi.mock("@/lib/guide", () => ({
  suggest: guide.suggest,
  nextShelf: guide.nextShelf,
  default: {},
}));

const auth = vi.hoisted(() => ({ categories: [] }));
vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector) =>
    selector({ vendor: { business_categories: auth.categories, physical_location: "Kondele, Kisumu" } }),
}));

const { default: MarketSearch } = await import("@/components/home/MarketSearch");
const { default: HomeTrustStrip } = await import("@/components/home/HomeTrustStrip");
const { default: HomeHero } = await import("@/components/home/HomeHero");

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{`${pathname}${search}`}</output>;
}

function renderSearch() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <MarketSearch />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.categories = [];
  guide.suggest.mockResolvedValue([]);
});

describe("Nothing is hardcoded", () => {
  it("shows no suggestion band at all for a vendor with no categories and an empty field", () => {
    renderSearch();
    expect(screen.getByTestId("market-search")).toBeInTheDocument();
    expect(screen.queryByTestId("market-search-suggestions")).toBeNull();
  });

  it("never renders the old generic words, whatever the vendor trades in", async () => {
    auth.categories = ["tailoring"];
    renderSearch();
    fireEvent.focus(screen.getByRole("searchbox"));

    const band = await screen.findByTestId("market-search-suggestions");
    expect(band).toHaveTextContent("tailoring");
    for (const stale of ["sukuma", "kitenge", "cooking oil"]) {
      expect(band.textContent.toLowerCase()).not.toContain(stale);
    }
  });
});

describe("Specific to this vendor", () => {
  it("offers the vendor's own categories when the field is empty", async () => {
    auth.categories = ["groceries", "fresh_produce"];
    renderSearch();
    fireEvent.focus(screen.getByRole("searchbox"));

    const band = await screen.findByTestId("market-search-suggestions");
    expect(band).toHaveAttribute("data-source", "categories");
    expect(screen.getByText("groceries")).toBeInTheDocument();
    // Underscores are for the database, not for people.
    expect(screen.getByText("fresh produce")).toBeInTheDocument();
  });

  it("keeps the category limit to four so the band cannot become a menu", async () => {
    auth.categories = ["a1", "a2", "a3", "a4", "a5", "a6"];
    renderSearch();
    fireEvent.focus(screen.getByRole("searchbox"));
    const band = await screen.findByTestId("market-search-suggestions");
    expect(band.querySelectorAll("li")).toHaveLength(4);
  });
});

describe("Specific to what is on the shelves", () => {
  it("asks the guide after a pause and shows real stock with its shelf count", async () => {
    guide.suggest.mockResolvedValue([
      {
        kind: "item",
        label: "Tomatoes (crate)",
        blurb: "2 shelves carry it · from KSh 180",
        to: "/browse?type=goods&q=Tomatoes (crate)",
      },
    ]);

    renderSearch();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "tom" } });

    // Debounced: not called on the keystroke itself.
    expect(guide.suggest).not.toHaveBeenCalled();

    const band = await screen.findByTestId("market-search-suggestions");
    expect(band).toHaveAttribute("data-source", "live");
    expect(await screen.findByText("Tomatoes (crate)")).toBeInTheDocument();
    expect(screen.getByText(/2 shelves carry it/)).toBeInTheDocument();
    expect(guide.suggest).toHaveBeenCalledWith("tom", { limit: 5 });
  });

  it("does not ask at all for a single letter", async () => {
    renderSearch();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "t" } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(guide.suggest).not.toHaveBeenCalled();
    expect(screen.queryByTestId("market-search-suggestions")).toBeNull();
  });

  it("says the shelves have nothing rather than inventing a suggestion", async () => {
    guide.suggest.mockResolvedValue([]);
    renderSearch();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "unobtainium" } });

    const band = await screen.findByTestId("market-search-suggestions");
    await waitFor(() => expect(band).toHaveTextContent(/nothing on the shelves matches/i));
    expect(band.querySelectorAll("li")).toHaveLength(0);
  });

  it("opens the record it suggested", async () => {
    guide.suggest.mockResolvedValue([
      { kind: "shelf", label: "Markets", blurb: "Physical markets", to: "/browse?type=markets" },
    ]);
    renderSearch();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "mark" } });
    fireEvent.click(await screen.findByText("Markets"));
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent("/browse?type=markets")
    );
  });

  it("still searches the chosen scope when the reader ignores the suggestions", async () => {
    renderSearch();
    const field = screen.getByRole("searchbox");
    fireEvent.change(field, { target: { value: "rice" } });
    fireEvent.submit(field.closest("form"));
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent("/browse?type=goods&search=rice")
    );
  });
});

describe("A smaller field", () => {
  it("is a 40px control inside the hero, not a card with a permanent row", () => {
    renderSearch();
    const field = screen.getByTestId("market-search");
    expect(field.className).toContain("h-10");
    expect(field.className).not.toContain("3.25rem");
  });

  it("the hero carries the field and no chip band of its own", async () => {
    auth.categories = [];
    render(
      <MemoryRouter>
        <HomeHero />
      </MemoryRouter>
    );
    expect(screen.getByTestId("market-search")).toBeInTheDocument();
    // The old surface: a white card and a "Try" row. Both gone.
    expect(screen.queryByTestId("home-search-card")).toBeNull();
    expect(screen.queryByText(/^Try$/)).toBeNull();
    expect(screen.getByText(/browse everything/i)).toBeInTheDocument();
  });
});

describe("The blended home furniture", () => {
  it("states four guarantees and no invented number", () => {
    render(<HomeTrustStrip />);
    const strip = screen.getByTestId("home-trust-strip");
    expect(strip.querySelectorAll("li")).toHaveLength(4);
    // "10K+ happy customers" is the reference's claim, not ours.
    expect(strip.textContent).not.toMatch(/\d/);
    expect(strip).toHaveTextContent(/verified businesses/i);
  });

  // The nine-tile shelf strip this used to assert was removed in v2.18: its
  // first three tiles read "Online services · Farms · Your category", which made
  // the product look agricultural. `TradeNetworkPanel` replaced it, and its own
  // specs live in `networkIdentity.test.jsx`.
});
