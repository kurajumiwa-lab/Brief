import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MorningBriefPage from "@/pages/brief/MorningBriefPage";
import { briefAPI } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";

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
    // The page caches the last good brief per account; start each test clean.
    window.localStorage.clear();
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

  it("paints the saved brief while offline and says how old it is", async () => {
    // First visit (online) writes the cache.
    briefAPI.morning.mockResolvedValueOnce({
      data: brief({
        total: 2,
        signals: [{
          id: "low_stock:/stock", kind: "low_stock", severity: "warning",
          title: "Stock needs attention", detail: "2 items at or below 5 bunch",
          count: 2, record_ids: ["a1", "b2"], route: "/stock",
          occurred_at: new Date().toISOString(),
        }],
      }),
    });
    const first = renderPage();
    expect(await screen.findByText("Stock needs attention")).toBeInTheDocument();
    first.unmount();

    // Second visit with the radio off: no request at all, cache is the answer.
    briefAPI.morning.mockClear();
    const onlineSpy = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    renderPage();

    expect(await screen.findByText("You are offline")).toBeInTheDocument();
    expect(screen.getByText("Stock needs attention")).toBeInTheDocument();
    expect(screen.getByText(/Showing the copy saved on this device/)).toBeInTheDocument();
    expect(briefAPI.morning).not.toHaveBeenCalled();
    // Refreshing is impossible, so the control is disabled rather than lying.
    expect(screen.getByRole("button", { name: /Refresh brief/ })).toBeDisabled();

    onlineSpy.mockRestore();
  });

  it("tells an offline vendor with no saved copy to reconnect rather than showing an error", async () => {
    const onlineSpy = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    renderPage();

    expect(await screen.findByText("You are offline")).toBeInTheDocument();
    expect(screen.getByText(/Nothing saved on this device yet/)).toBeInTheDocument();
    // Not the failure card: nothing failed, there is simply no network.
    expect(screen.queryByText("The brief could not be loaded")).not.toBeInTheDocument();
    expect(briefAPI.morning).not.toHaveBeenCalled();

    onlineSpy.mockRestore();
  });

  it("never shows one account's cached brief to another account on the same device", async () => {
    // Account A reads a brief; it is cached under A's id.
    useAuthStore.setState({ vendor: { id: "account-a", vendor_handle: "a" } });
    briefAPI.morning.mockResolvedValueOnce({ data: brief({ empty: true }) });
    const first = renderPage();
    await screen.findByText("Nothing needs you today");
    first.unmount();
    expect(window.localStorage.getItem("brief.cache.v1:account-a:brief")).toBeTruthy();

    // The same phone is handed to account B. A's copy must not appear, and the
    // next write removes it rather than leaving it on the device.
    useAuthStore.setState({ vendor: { id: "account-b", vendor_handle: "b" } });
    briefAPI.morning.mockRejectedValueOnce(new Error("offline"));
    renderPage();

    expect(await screen.findByText("The brief could not be loaded")).toBeInTheDocument();
    expect(screen.queryByText("Nothing needs you today")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("brief.cache.v1:account-a:brief")).toBeNull();

    useAuthStore.setState({ vendor: null });
  });
});
