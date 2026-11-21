import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CounterShelf from "@/components/home/CounterShelf";

const vendor = { vendor_handle: "amina", business_name: "Amina's Home Nursing" };

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector) => (selector ? selector({ vendor }) : { vendor }),
}));

vi.mock("@/components/onboarding/useSetupProgress", () => ({
  useSetupProgress: () => ({
    loaded: true,
    steps: [{ done: true }, { done: true }, { done: false }, { done: false }],
  }),
}));

const renderShelf = (progress) =>
  render(
    <MemoryRouter>
      <CounterShelf progress={progress} />
    </MemoryRouter>,
  );

describe("The counter on Home", () => {
  it("is a shelf of four standing positions, each an existing route", () => {
    renderShelf();
    const shelf = screen.getByTestId("counter-shelf");
    const links = [...shelf.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toContain("/you/page");
    expect(links).toContain("/desk");
    expect(links).toContain("/payments");
    expect(links).toContain("/more");
  });

  it("says what it is not: a record, never an account", () => {
    renderShelf();
    expect(screen.getByText(/holds no money for you and lends you none/i)).toBeInTheDocument();
  });

  it("counts the open items from the reading Home already made, not a second request", () => {
    renderShelf({ loaded: true, steps: [{ done: true }, { done: false }, { done: false }, { done: false }] });
    expect(screen.getByText("3 open")).toBeInTheDocument();
  });

  it("stops nagging when the books are in order", () => {
    renderShelf({ loaded: true, steps: [{ done: true }, { done: true }] });
    expect(screen.getByText("All in order")).toBeInTheDocument();
  });

  it("shows the page address, but never invents one", () => {
    renderShelf();
    expect(screen.getByText("/p/amina")).toBeInTheDocument();
  });

  it("does not count while the setup read is still loading", () => {
    renderShelf({ loaded: false, steps: [] });
    expect(screen.queryByText(/open$/)).not.toBeInTheDocument();
  });
});
