/**
 * THE FEED BELONGS TO ONE VENDOR.
 *
 * `useHomeFeedStore` deliberately keeps a shelf for five minutes so returning
 * to Home does not re-hit nine endpoints. That cache outlives the session, and
 * nothing cleared it when the person at the browser changed — so signing in as
 * someone else showed the previous vendor's shelves, and a shelf that failed
 * for one account stayed failed for the next. Both are another merchant's
 * records on a screen that promises "your own shelf never appears in the
 * shelves above".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const ok = (data) => Promise.resolve({ data });

vi.mock("@/lib/api", () => ({
  apiError: (e, f = "Something went wrong") => e?.message || f,
  stockAPI: {
    network: vi.fn(() => ok([{
      id: "st-1", vendor_id: "v-other", vendor_handle: "other", vendor_business: "Other Ltd",
      name: "Kitenge", category: "textiles", quantity_available: 5, quantity_in_stock: 5,
      unit_of_measure: "piece", unit_price: 1200, visible_to_network: true, images: [],
    }])),
    movements: vi.fn(() => ok([])),
    mine: vi.fn(() => ok([])),
  },
  toolAPI: { browse: vi.fn(() => ok([])), mine: vi.fn(() => ok([])) },
  vendorAPI: { discover: vi.fn(() => ok([])), connections: vi.fn(() => ok([])) },
  requestsAPI: { list: vi.fn(() => ok([])) },
  squadAPI: { calls: vi.fn(() => ok({ calls: [] })) },
  eventAPI: { browse: vi.fn(() => ok([])) },
  groupAPI: { browse: vi.fn(() => ok([])) },
  listAPI: { browse: vi.fn(() => ok([])) },
  marketsAPI: { list: vi.fn(() => ok({ markets: [], countries: [] })) },
  catalogAPI: { catalogue: vi.fn(() => ok({ offers: [] })) },
}));

// A controllable auth store: the test plays the part of the person signing in.
vi.mock("@/stores/authStore", async () => {
  const { create } = await import("zustand");
  const useAuthStore = create(() => ({
    vendor: { id: "v-one", vendor_handle: "one", business_name: "One Ltd" },
    token: "tok",
    ready: true,
  }));
  return { useAuthStore };
});

import * as api from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { useHomeFeedStore } from "@/stores/homeFeedStore";
import HomeFeed from "@/components/home/HomeFeed";

beforeEach(() => {
  vi.clearAllMocks();
  useHomeFeedStore.setState({ shelves: {} });
  useAuthStore.setState({ vendor: { id: "v-one", vendor_handle: "one", business_name: "One Ltd" } });
});

describe("a different vendor at the same browser", () => {
  it("drops the last vendor's shelves and loads them again", async () => {
    render(<MemoryRouter><HomeFeed /></MemoryRouter>);

    // The first account loads its stock shelf.
    await waitFor(() => expect(useHomeFeedStore.getState().shelves.stock?.status).toBe("ready"));
    const callsAfterFirst = api.stockAPI.network.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Someone else signs in on the same tab.
    useAuthStore.setState({ vendor: { id: "v-two", vendor_handle: "two", business_name: "Two Ltd" } });

    // The shelf is fetched again for the new vendor — no five-minute carry-over.
    await waitFor(() => expect(api.stockAPI.network.mock.calls.length).toBeGreaterThan(callsAfterFirst));
    await waitFor(() => expect(useHomeFeedStore.getState().shelves.stock?.status).toBe("ready"));

    expect(screen.getByTestId("home-shelf-stock")).toBeInTheDocument();
  });
});
