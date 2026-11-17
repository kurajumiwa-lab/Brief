import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import CorridorPriceHint from "@/components/prices/CorridorPriceHint";
import RegionsGrid from "@/components/regions/RegionsGrid";

const hint = {
  available: true,
  scope_label: "Kisumu • Nyanza • Health & Nursing",
  sample_count: 18,
  p25_kes: 450,
  median_kes: 500,
  p75_kes: 650,
  fair_price_ceiling_kes: 525,
  window_days: 45,
  signal_note: "A guide from confirmed local trades in the last 45 days. It is not a valuation, and it awards no standing credit.",
};

describe("corridor price hint", () => {
  it("stays completely silent when the sample is too small", () => {
    const { container } = render(
      <CorridorPriceHint hint={{ available: false }} enteredPrice="500" onApplySuggestedPrice={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the interquartile range and applies the median in one tap", () => {
    const apply = vi.fn();
    render(<CorridorPriceHint hint={hint} enteredPrice="" onApplySuggestedPrice={apply} />);
    expect(screen.getByTestId("price-hint-range")).toHaveTextContent("KSh 450 – 650");
    expect(screen.getByText(/18 local trades/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /use median \(ksh 500\)/i }));
    expect(apply).toHaveBeenCalledWith(500);
  });

  it("tells the vendor when the price qualifies, and when it is above the range", () => {
    const { rerender } = render(
      <CorridorPriceHint hint={hint} enteredPrice="500" onApplySuggestedPrice={vi.fn()} />,
    );
    expect(screen.getByTestId("price-hint-qualification")).toHaveTextContent(/Qualifies for the “Fair Corridor Price” badge/);

    rerender(<CorridorPriceHint hint={hint} enteredPrice="700" onApplySuggestedPrice={vi.fn()} />);
    expect(screen.getByTestId("price-hint-qualification")).toHaveTextContent(/Above the typical corridor range/);
  });

  it("never calls the range a valuation or a standing credit", () => {
    render(<CorridorPriceHint hint={hint} enteredPrice="" onApplySuggestedPrice={vi.fn()} />);
    expect(screen.getByText(/not a valuation, and it awards no standing credit/i)).toBeInTheDocument();
  });
});

describe("Fair Corridor Price badge", () => {
  function renderCard(extra = {}) {
    return render(
      <MemoryRouter>
        <RegionsGrid items={[{
          id: "listing-1",
          kind: "available",
          title: "Bulk maize",
          price_kes: 500,
          location: "Kisumu",
          to: "/activities/1",
          is_fair_corridor_price: true,
          corridor_median_kes: 500,
          corridor_scope_label: "Kisumu • Nyanza",
          ...extra,
        }]} />
      </MemoryRouter>,
    );
  }

  it("renders the data-backed pill beside the price line", () => {
    renderCard();
    const badge = screen.getByTestId("region-card-fair-price");
    expect(badge).toHaveTextContent("Fair Corridor Price");
    expect(badge).toHaveAttribute("title", expect.stringContaining("median of KSh 500"));
  });

  it("renders nothing when the listing has no corridor index", () => {
    renderCard({ is_fair_corridor_price: false });
    expect(screen.queryByTestId("region-card-fair-price")).not.toBeInTheDocument();
  });
});
