import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TodayView from "@/components/home/TodayView";

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector) => (selector ? selector({ vendor: { vendor_handle: "amina", business_name: "Amina" } }) : {}),
}));

vi.mock("@/components/onboarding/useSetupProgress", () => ({
  useSetupProgress: () => ({ loaded: true, steps: [{ done: false }] }),
}));

vi.mock("@/components/receipts/ReceiptScanCard", () => ({ default: () => null }));
vi.mock("@/components/home/TownDoors", () => ({ default: () => null }));
vi.mock("@/components/home/StreetDoor", () => ({ default: () => null }));
vi.mock("@/components/home/HappeningShelf", () => ({ default: () => null }));
vi.mock("@/components/home/IdentityStrip", () => ({ default: () => null }));

const rank = {
  level: 2,
  next: { label: "Get verified", blurb: "A record beats a promise." },
  nextAction: { label: "Get verified", detail: "Add your licence.", to: "/you/identity" },
};

const renderHome = () =>
  render(
    <MemoryRouter>
      <TodayView name="Amina" rank={rank} />
    </MemoryRouter>,
  );

describe("Home carries the counter", () => {
  it("shows the records shelf on the home screen, not only at the foot of /you", () => {
    renderHome();
    expect(screen.getByTestId("counter-shelf")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Your business today/i })).toBeInTheDocument();
  });

  it("keeps the identity strip and the next step above it", () => {
    const { container } = renderHome();
    const html = container.innerHTML;
    // The next step is still the first card a person meets after the header.
    expect(html.indexOf("Get verified")).toBeLessThan(html.indexOf('data-testid="counter-shelf"'));
  });

  it("offers records even for a business with no rank yet", () => {
    render(
      <MemoryRouter>
        <TodayView name="New" rank={null} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("counter-shelf")).toBeInTheDocument();
  });
});
