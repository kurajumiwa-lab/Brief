import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DeskPage from "@/pages/desk/DeskPage";
import { offeringsAPI } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  offeringsAPI: { mine: vi.fn(), of: vi.fn() },
  workersAPI: { mine: vi.fn(() => Promise.resolve({ data: { items: [] } })), assignments: vi.fn(), assign: vi.fn(), start: vi.fn(), complete: vi.fn(), cancel: vi.fn(), reassign: vi.fn(), history: vi.fn() },
  officeAPI: { mine: vi.fn(() => Promise.resolve({ data: { offices: [] } })) },
  apiError: (_error, fallback) => fallback,
}));

const body = (items = [], counts = {}) => ({
  items,
  counts: { goods: 0, service: 0, tool: 0, ...counts },
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <DeskPage />
    </MemoryRouter>
  );

describe("My desk", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists goods, services and tools under their own headings", async () => {
    offeringsAPI.mine.mockResolvedValue({
      data: body(
        [
          { kind: "goods", id: "g1", title: "Tomatoes (crate)", category: "fresh_produce", price: 3500, price_unit: "crate", available: true },
          { kind: "service", id: "s1", title: "Haircut", category: null, price: 200, price_unit: "per visit", available: true },
          { kind: "tool", id: "t1", title: "Cold room", category: "cold_storage", price: 800, price_unit: "per_day", available: false },
        ],
        { goods: 1, service: 1, tool: 1 },
      ),
    });
    renderPage();
    expect(await screen.findByText("Tomatoes (crate)")).toBeInTheDocument();
    expect(screen.getByText("Haircut")).toBeInTheDocument();
    expect(screen.getByText("Cold room")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Goods \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Services \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Tools and rentals \(1\)/ })).toBeInTheDocument();
    expect(screen.getByText("Not offered")).toBeInTheDocument();
    expect(screen.getByText(/KES 3,500 crate/)).toBeInTheDocument();
  });

  it("links to the morning brief and the home office", async () => {
    offeringsAPI.mine.mockResolvedValue({ data: body() });
    renderPage();
    await screen.findByText("Nothing offered yet");
    expect(screen.getByRole("link", { name: /Today/ })).toHaveAttribute("href", "/brief");
    expect(screen.getByRole("link", { name: /My office/ })).toHaveAttribute("href", "/office");
  });

  it("shows a clear empty state with a way to add stock", async () => {
    offeringsAPI.mine.mockResolvedValue({ data: body() });
    renderPage();
    expect(await screen.findByText("Nothing offered yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Add to your stock/ })).toHaveAttribute("href", "/stock");
  });

  it("says so when it cannot load, and can retry", async () => {
    offeringsAPI.mine.mockRejectedValueOnce(new Error("down"));
    offeringsAPI.mine.mockResolvedValueOnce({ data: body() });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load what you offer");
    screen.getByRole("button", { name: /Try again/ }).click();
    await waitFor(() => expect(screen.getByText("Nothing offered yet")).toBeInTheDocument());
  });
});
