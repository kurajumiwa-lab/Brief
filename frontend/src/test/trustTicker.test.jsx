import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const card = vi.fn();

vi.mock("@/lib/api", () => ({
  meritAPI: {
    card: (...args) => card(...args),
    ticker: () => Promise.resolve({ data: { points: [{ as_of: "2026-11-01", score: 20 }, { as_of: "2026-11-21", score: 46 }] } }),
  },
}));

import TrustTicker from "@/components/merit/TrustTicker";

const renderTicker = (handle = "merit-shop") =>
  render(
    <MemoryRouter>
      <TrustTicker handle={handle} />
    </MemoryRouter>,
  );

const base = {
  score: 46.2,
  score_earned: 46.2,
  max_score: 100,
  tier: "verified",
  tier_label: "Verified",
  next_tier: "blue_chip",
  points_to_next: 3.8,
  decay: 1,
  quiet_days: 3,
  families: 3,
  streak_weeks: 0,
  unlocks: ["Discovery position in its own area"],
  components: [
    { key: "fulfilment", label: "Delivered what was promised", points: 27.9, max_points: 30, reason: "24 orders delivered · 96% of finished orders arrived" },
    { key: "verification", label: "Checked by a person", points: 10.7, max_points: 25, reason: "2 documents independently checked" },
    { key: "price_work", label: "Helped the town's price list", points: 0, max_points: 10, reason: "No accepted price observations yet." },
  ],
};

describe("the trust ticker", () => {
  beforeEach(() => {
    card.mockReset();
    card.mockResolvedValue({ data: base });
  });

  it("shows a record, never a valuation", async () => {
    renderTicker();
    expect(await screen.findByTestId("trust-ticker")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    // The reason is rendered split across two elements (points + sentence).
    expect(screen.getByText(/24 orders delivered · 96% of finished orders arrived/)).toBeInTheDocument();
    // The load-bearing sentence, on every card.
    expect(screen.getByText(/not a promise of credit/i)).toBeInTheDocument();
    expect(screen.getByText(/not money/i)).toBeInTheDocument();
  });

  it("omits empty reasons instead of padding the card with zeros", async () => {
    renderTicker();
    await screen.findByTestId("trust-ticker");
    expect(screen.queryByText(/No accepted price observations yet/)).not.toBeInTheDocument();
  });

  it("says when part of the score is hidden, and says nothing was lost", async () => {
    card.mockResolvedValue({ data: { ...base, decay: 0.62, quiet_days: 120, tier: "seed", tier_label: "Seed" } });
    renderTicker();
    await screen.findByTestId("trust-ticker");
    expect(screen.getByText(/120 days since the last recorded activity/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing was lost/)).toBeInTheDocument();
  });

  it("renders nothing at all when there is no record to show", async () => {
    card.mockRejectedValue(new Error("404"));
    const { container } = renderTicker("unknown");
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
