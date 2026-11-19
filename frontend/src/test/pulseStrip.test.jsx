import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  current: vi.fn(), flashDrops: vi.fn(), claimDrop: vi.fn(),
}));

vi.mock("@/lib/pulseApi", () => ({ pulseAPI: mocks }));
vi.mock("@/components/ui/Toast", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import PulseStrip from "@/components/pulse/PulseStrip";

describe("Pulse strip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.current.mockResolvedValue({
      data: {
        active: {
          key: "payday", label: "Payday", hint: "Fresh money moves first.",
          starts_at: "2026-11-25T00:00:00+03:00", ends_at: "2026-12-03T23:59:00+03:00",
          categories: ["food", "decor"], rail_color: "#E65100",
        },
        next: { key: "mid_month", label: "Mid-Month Clearance", categories: [] },
        rail: { color: "#E65100" },
      },
    });
    mocks.flashDrops.mockResolvedValue({
      data: {
        drops: [{
          id: "d1", label: "Mandazi box", price_kes: 200, remaining: 2, minutes_left: 42,
          capacity: 2, claimed_count: 0, can_claim: true, seller: { business: "Amina's Kitchen" },
        }],
      },
    });
    mocks.claimDrop.mockResolvedValue({
      data: { claimed: true, message: "Claimed", drop: { remaining: 1, claimed_count: 1 } },
    });
  });

  it("shows the active terracotta window and claims one live drop", async () => {
    render(<PulseStrip />);

    expect(await screen.findByText("Payday")).toBeInTheDocument();
    expect(screen.getByTestId("pulse-window")).toHaveStyle({ borderLeftColor: "#E65100" });
    expect(screen.getByText("Mandazi box")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Claim$/i }));
    await waitFor(() => expect(mocks.claimDrop).toHaveBeenCalledWith("d1"));
    expect(await screen.findByText(/1 left/)).toBeInTheDocument();
  });
});
