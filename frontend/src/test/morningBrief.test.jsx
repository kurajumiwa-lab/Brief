import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MorningBriefPage from "@/pages/brief/MorningBriefPage";
import { briefAPI } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  briefAPI: { morning: vi.fn() },
  apiError: (_error, fallback) => fallback,
}));

const brief = (overrides = {}) => ({
  generated_at: new Date().toISOString(),
  vendor_handle: "achieng_o",
  total: 0,
  empty: false,
  signals: [],
  note: "Read-only summary of your own records.",
  ...overrides,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <MorningBriefPage />
    </MemoryRouter>
  );

describe("Morning Brief", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("says nothing needs attention, rather than looking broken", async () => {
    briefAPI.morning.mockResolvedValue({ data: brief({ empty: true }) });
    renderPage();
    expect(await screen.findByText("Nothing needs you today")).toBeInTheDocument();
    expect(screen.getByText(/Nothing needs your attention right now/i)).toBeInTheDocument();
  });

  it("shows each signal with its record count and provenance", async () => {
    briefAPI.morning.mockResolvedValue({
      data: brief({
        total: 3,
        signals: [
          {
            id: "low_stock:/stock",
            kind: "low_stock",
            severity: "warning",
            title: "Stock needs attention",
            detail: "3 items at or below 5 bunch",
            count: 3,
            record_ids: ["a1", "b2", "c3"],
            route: "/stock",
            occurred_at: new Date(Date.now() - 3600_000).toISOString(),
          },
        ],
      }),
    });
    renderPage();
    expect(await screen.findByText("Stock needs attention")).toBeInTheDocument();
    expect(screen.getByText(/3 records · 3 cited/)).toBeInTheDocument();
    expect(screen.getByText(/Worth doing/)).toBeInTheDocument();
    // The disclaimer is the promise: no generated text can change a balance.
    expect(screen.getByText(/Read-only summary of your own records/)).toBeInTheDocument();
  });

  it("keeps the last brief on screen when a refresh fails, and labels it stale", async () => {
    briefAPI.morning.mockResolvedValueOnce({
      data: brief({
        total: 1,
        signals: [{
          id: "pending_movements:/orders", kind: "pending_movements", severity: "warning",
          title: "Movements waiting", detail: "1 movement has not been confirmed",
          count: 1, record_ids: ["mv-1"], route: "/orders",
          occurred_at: new Date(Date.now() - 7200_000).toISOString(),
        }],
      }),
    });
    renderPage();
    expect(await screen.findByText("Movements waiting")).toBeInTheDocument();

    // The network drops; the vendor must not lose a list of overdue work.
    briefAPI.morning.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: /Refresh brief/ }));
    expect(await screen.findByText("Could not refresh — showing your last brief")).toBeInTheDocument();
    expect(screen.getByText("Movements waiting")).toBeInTheDocument();
    expect(screen.queryByText("The brief could not be loaded")).not.toBeInTheDocument();
  });

  it("offers a retry when the brief cannot be loaded", async () => {
    briefAPI.morning.mockRejectedValueOnce(new Error("offline"));
    renderPage();
    expect(await screen.findByText("The brief could not be loaded")).toBeInTheDocument();

    briefAPI.morning.mockResolvedValueOnce({ data: brief({ empty: true }) });
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    await waitFor(() => expect(screen.getByText("Nothing needs you today")).toBeInTheDocument());
  });
});
