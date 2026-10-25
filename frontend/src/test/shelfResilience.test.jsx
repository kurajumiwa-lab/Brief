/**
 * A BROKEN SHELF MUST COST ONE SHELF.
 *
 * The home feed loads nine independent modules and promises, in the error copy
 * itself, that "the rest of the market below is unaffected". Two things can
 * break that promise:
 *
 *   · a fetch that rejects — handled in `homeFeedStore` (status: "error", with
 *     a retry), and covered in media.test.jsx for the never-settling case;
 *   · a record that throws while React draws it — which unmounts the WHOLE
 *     tree, blanking every other shelf on the page.
 *
 * The second one is why each carousel has its own error boundary. These specs
 * pin that: the crashed shelf says so and offers a retry, and the shelf beside
 * it keeps drawing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/home/cards", () => ({
  CARD_RENDERERS: {},
  renderCard: (_kind, { item }) => {
    if (item?.title === "Ka-boom") throw new Error("this record cannot be drawn");
    return <div data-testid="card">{item?.title}</div>;
  },
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: Object.assign(() => null, {
    getState: () => ({ vendor: null, token: "tok", ready: true }),
  }),
}));

import CuratedShelf from "@/components/home/CuratedShelf";
import { useHomeFeedStore } from "@/stores/homeFeedStore";
import { shelfByKey } from "@/config/homeShelves";

const shelf = (key) => shelfByKey(key);

const mount = (nodes) => render(<MemoryRouter>{nodes}</MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  useHomeFeedStore.setState({ shelves: {} });
});

describe("one bad record in one shelf", () => {
  it("is contained: the shelf explains itself and the others still draw", () => {
    // React logs the boundary's catch; keep the test output about the assertion.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    mount(
      <>
        <CuratedShelf
          shelf={shelf("stock")}
          state={{ status: "ready", items: [{ id: "1", title: "Kitenge" }, { id: "2", title: "Ka-boom" }] }}
        />
        <CuratedShelf
          shelf={shelf("equipment")}
          state={{ status: "ready", items: [{ id: "3", title: "Cold room" }] }}
        />
      </>
    );

    expect(screen.getByText(/couldn't be drawn/i)).toBeInTheDocument();
    // The neighbour is untouched.
    expect(screen.getByTestId("home-shelf-equipment")).toBeInTheDocument();
    expect(screen.getByText("Cold room")).toBeInTheDocument();
    // …and the crashed shelf's own card list is gone, not half-drawn.
    expect(screen.queryByText("Kitenge")).toBeNull();

    quiet.mockRestore();
  });

  it("offers a retry that re-fetches the shelf", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const retryShelf = vi.fn();
    useHomeFeedStore.setState({ retryShelf });

    mount(
      <CuratedShelf
        shelf={shelf("stock")}
        state={{ status: "ready", items: [{ id: "2", title: "Ka-boom" }] }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retryShelf).toHaveBeenCalledWith("stock");

    quiet.mockRestore();
  });
});

describe("a shelf that failed to load", () => {
  it("shows its own apology and retry without touching the rest of the feed", () => {
    const retryShelf = vi.fn();
    useHomeFeedStore.setState({ retryShelf });

    mount(
      <>
        <CuratedShelf
          shelf={shelf("stock")}
          state={{ status: "error", error: "Fresh on the network didn't load" }}
        />
        <CuratedShelf
          shelf={shelf("people")}
          state={{ status: "ready", items: [{ id: "9", title: "Boda Express" }] }}
        />
      </>
    );

    expect(screen.getByText("Fresh on the network didn't load")).toBeInTheDocument();
    expect(screen.getByText(/the rest of the market below is unaffected/i)).toBeInTheDocument();
    expect(screen.getByText("Boda Express")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retryShelf).toHaveBeenCalledWith("stock");
  });

  it("hides a shelf that simply has nothing — it is not an error", () => {
    mount(<CuratedShelf shelf={shelf("markets")} state={{ status: "ready", items: [] }} />);
    expect(screen.queryByTestId("home-shelf-markets")).toBeNull();
  });
});
