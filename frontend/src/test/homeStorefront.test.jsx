import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HomeStorefront from "@/components/home/HomeStorefront";
import { useHomeFeedStore } from "@/stores/homeFeedStore";

const ready = (items) => ({ status: "ready", items, error: "", reason: "", retryable: false, at: Date.now() });

const offer = {
  id: "o1",
  kind: "offer",
  to: "/offers/o1",
  title: "Maize flour 2kg",
  vendorName: "Nyanza Fresh",
  owner: null,
  image: null,
};

function renderStorefront() {
  return render(
    <MemoryRouter>
      <HomeStorefront />
    </MemoryRouter>,
  );
}

describe("home storefront", () => {
  beforeEach(() => {
    useHomeFeedStore.setState({ shelves: {}, loadFeed: vi.fn(), reset: vi.fn() });
  });

  it("is never blank: chips and the Brief Trust door show before any shelf loads", () => {
    renderStorefront();
    const chips = screen.getByRole("navigation", { name: "Browse Brief" });
    expect(within(chips).getByRole("link", { name: /Checked shops/ })).toHaveAttribute("href", "/trust");
    expect(within(chips).getByRole("link", { name: "Offers" })).toHaveAttribute("href", "/offers");
    expect(screen.getByTestId("hero-trust")).toHaveAttribute("href", "/trust");
  });

  it("turns real shelf records into hero cards, and shows no ad or invented row", () => {
    useHomeFeedStore.setState({ shelves: { offers: ready([offer]) } });
    renderStorefront();
    const heroItem = screen.getByTestId("hero-item");
    expect(heroItem).toHaveAttribute("href", "/offers/o1");
    expect(within(heroItem).getByText("Maize flour 2kg")).toBeInTheDocument();
    expect(screen.queryByText(/sponsored/i)).toBeNull();
  });

  it("shows the quiet panel only when every shelf has answered with nothing", () => {
    useHomeFeedStore.setState({
      shelves: Object.fromEntries(["offers", "stock", "services", "people", "equipment", "opportunities", "events", "community", "markets", "notices"].map((k) => [k, ready([])])),
    });
    renderStorefront();
    expect(screen.getByTestId("home-quiet")).toBeInTheDocument();
    expect(screen.queryByTestId("hero-item")).toBeNull();
  });

  it("does not show the quiet panel while shelves are still loading", () => {
    useHomeFeedStore.setState({ shelves: { offers: { status: "loading", items: [] } } });
    renderStorefront();
    expect(screen.queryByTestId("home-quiet")).toBeNull();
  });
});
