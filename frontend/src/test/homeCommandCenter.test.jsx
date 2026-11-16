import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/receiptsApi", () => ({
  receiptsAPI: {
    vouchers: vi.fn().mockResolvedValue({ data: { vouchers: [] } }),
    offers: vi.fn().mockResolvedValue({ data: { offers: [] } }),
  },
}));

import TodayView from "@/components/home/TodayView";
import { rankFor } from "@/config/identity";
import { REGION_BY_SLUG } from "@/config/regions";

const region = REGION_BY_SLUG.nyanza;
const starts = new Date(Date.now() + 2 * 86400000).toISOString();

const happening = [
  {
    id: "a1", kind: "scheduled", to: "/activities/a1",
    title: "Groceries bulk purchase", category: "bulk groceries",
    location: "Kisii", starts_at: starts, price_kes: 500,
    counts: { booked: 4 }, meta: { capacity: 10 },
  },
  {
    id: "e1", kind: "event", to: "/events?event=e1",
    title: "Saturday brunch and bike ride", category: "trip",
    location: "Kisumu", starts_at: starts, price_kes: null,
    image: "/images/brunch.jpg", counts: { attending: 3 }, meta: { capacity: 12 },
  },
];

const page = {
  published: true,
  url: "/p/ogallo",
  href: "/p/ogallo",
  counts: { offers: 2, trades: 4, verified: false },
};

function renderHome(overrides = {}) {
  const rank = rankFor({
    vendor: { business_name: "Ogallo", vendor_handle: "ogallo", movements_completed: 1 },
    identity: { contact: { phone: "0712000111" } },
  });
  return render(
    <MemoryRouter>
      <TodayView
        name="Ogallo"
        firstName="Ogallo"
        rank={rank}
        identity={{ intent: "offer" }}
        region={region}
        happening={happening}
        page={page}
        institution={{ name: "Kisumu Hospitality Association", line: "Member · Kisumu" }}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe("Home as a command centre", () => {
  it("merges page and home office into one identity strip with a WhatsApp share", () => {
    renderHome();
    const strip = screen.getByTestId("identity-strip");
    expect(within(strip).getByText(/\/p\/ogallo/)).toBeInTheDocument();
    expect(within(strip).getByText("Kisumu Hospitality Association")).toBeInTheDocument();
    expect(within(strip).getByTestId("identity-share").getAttribute("href")).toMatch(
      /^https:\/\/wa\.me\/\?text=/,
    );
    expect(within(strip).getByTestId("identity-share").getAttribute("href"))
      .toContain(encodeURIComponent("/p/ogallo"));
  });

  it("shows dated rounds as a compact shelf with real join counts, not a second feed", () => {
    renderHome();
    const shelf = screen.getByTestId("happening-shelf");
    expect(within(shelf).getByRole("heading", { name: "Happening soon" })).toBeInTheDocument();
    const cards = within(shelf).getAllByTestId("happening-card");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText("Groceries bulk purchase")).toBeInTheDocument();
    expect(within(cards[0]).getByTestId("happening-joined")).toHaveTextContent("4/10 joined");
    expect(within(cards[0]).getByText(/Kisii/)).toBeInTheDocument();
    // No uploaded photo: the category paints the header instead of a text row.
    expect(within(cards[0]).getByTestId("happening-art")).toHaveAttribute("data-fallback", "true");
    // An uploaded photo is used as-is.
    expect(within(cards[1]).getByTestId("happening-art")).toHaveAttribute("data-fallback", "false");
    expect(within(cards[1]).getByTestId("happening-joined")).toHaveTextContent("3/12 joined");
    // The old region listing rows are gone from Home.
    expect(screen.queryByTestId("merchant-row")).not.toBeInTheDocument();
  });

  it("says what a returned person actually needs when nothing is scheduled", () => {
    renderHome({ happening: [], region: null });
    const shelf = screen.getByTestId("happening-shelf");
    expect(within(shelf).getByText(/Nothing scheduled near you yet/i)).toBeInTheDocument();
    expect(within(shelf).getByRole("link", { name: /publish a round or event/i })).toBeInTheDocument();
  });

  it("keeps the receipt scanner one tap away and names the wallet", () => {
    renderHome();
    const card = screen.getByTestId("receipt-card");
    expect(within(card).getByTestId("receipt-vouchers-ready")).toHaveTextContent("0");
    fireEvent.click(within(card).getByTestId("receipt-card-scan"));
    expect(screen.getByTestId("receipt-scanner")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /wallet & shops/i })).toBeInTheDocument();
  });
});
