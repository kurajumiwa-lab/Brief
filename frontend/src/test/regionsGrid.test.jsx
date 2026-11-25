import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import RegionsGrid from "@/components/regions/RegionsGrid";
import ExplorePage from "@/pages/explore/ExplorePage";
import { REGION_BY_SLUG } from "@/config/regions";

const highOwner = {
  id: "v-1", handle: "milimani", name: "Milimani Cereals",
  page_live: true, business_description: "Wholesale cereals in Kisumu",
  physical_location: "Kisumu central", contact_exposed: true,
  movements_completed: 3, confirmed_trade_proofs: 0, is_verified: false,
};

const lowOwner = {
  id: "v-2", handle: "new-tailor", name: "New Tailor",
  page_live: true, business_description: "Tailoring", physical_location: "Kisumu",
  contact_exposed: true, movements_completed: 0, confirmed_trade_proofs: 0,
  is_verified: false,
};

const listing = {
  id: "l-1", kind: "listing", to: "/listing/l-1", title: "Maize flour 2kg",
  category: "bulk groceries", location: "Kisumu central", price_kes: 500,
  owner: highOwner, counts: { booked: 4 }, meta: { capacity: 10 },
};

const service = {
  id: "s-1", kind: "service", to: "/tools?listing=s-1", title: "School uniform tailoring",
  category: "repairs", location: "Kisumu", price_kes: null,
  image: "/images/tailor.jpg", owner: lowOwner, counts: {}, meta: {},
};

function LocationProbe() {
  const { search } = useLocation();
  return <output data-testid="location">{search}</output>;
}

describe("Regions visual grid", () => {
  it("uses the same category art as Home when a card has no photograph", () => {
    render(
      <MemoryRouter>
        <RegionsGrid items={[listing, service]} />
      </MemoryRouter>,
    );

    const cards = screen.getAllByTestId("content-card-listing");
    expect(cards).toHaveLength(1);
    expect(within(cards[0]).getByTestId("region-card-art")).toHaveAttribute("data-fallback", "true");
    expect(within(cards[0]).getByTestId("region-card-level")).toHaveTextContent("Lvl 3");
    expect(within(cards[0]).getByTestId("region-card-momentum")).toHaveTextContent("4/10 joined");
    expect(within(cards[0]).getByText("KSh 500")).toBeInTheDocument();

    const photo = screen.getByTestId("content-card-service");
    expect(within(photo).getByTestId("region-card-art")).toHaveAttribute("data-fallback", "false");
    expect(within(photo).getByText("Open")).toBeInTheDocument();
    expect(within(photo).getByText("/p/new-tailor")).toBeInTheDocument();
    expect(within(photo).getByText("No trades yet")).toBeInTheDocument();
  });

  it("is a two-column grid on a phone", () => {
    render(
      <MemoryRouter>
        <RegionsGrid items={[listing, service]} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("regions-grid").className).toContain("grid-cols-2");
  });

  it("badges probationary and verified shops distinctly without inflating their level", () => {
    const probationCard = {
      ...listing,
      id: "l-prob",
      owner: { ...lowOwner, claim_status: "probationary", probationary: true },
    };
    const verifiedCard = {
      ...service,
      id: "s-ver",
      owner: { ...highOwner, claim_status: "verified" },
    };
    render(
      <MemoryRouter>
        <RegionsGrid items={[probationCard, verifiedCard]} />
      </MemoryRouter>,
    );
    const statuses = screen.getAllByTestId("region-card-claim-status");
    expect(statuses.map((node) => node.textContent)).toEqual(["Probationary", "Verified shop"]);
  });
});

describe("Regions intent and standing filters", () => {
  it("falls back to Level 2+ when the strict standing door finds nothing", () => {
    render(
      <MemoryRouter>
        <ExplorePage
          regionAware
          demo={{
            items: [service],
            location: { label: "Kondele, Kisumu", radius_km: 15 },
            region: REGION_BY_SLUG.nyanza,
          }}
        />
      </MemoryRouter>,
    );

    // The standing filter lives in the one consolidated filters door.
    fireEvent.click(screen.getByTestId("explore-more-filters"));
    fireEvent.click(screen.getByTestId("regions-trust"));
    const grid = screen.getByTestId("regions-grid");
    expect(within(grid).getByText("School uniform tailoring")).toBeInTheDocument();
    expect(within(grid).getByTestId("region-card-level")).toHaveTextContent("Lvl 2");
    expect(screen.queryByTestId("explore-filtered-empty")).not.toBeInTheDocument();
  });

  it("shows the honest all-levels rail when even Level 2 has nothing", () => {
    render(
      <MemoryRouter>
        <ExplorePage
          regionAware
          demo={{
            items: [{ ...service, owner: { ...lowOwner, contact_exposed: false } }],
            location: { label: "Kondele, Kisumu", radius_km: 15 },
            region: REGION_BY_SLUG.nyanza,
          }}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("explore-more-filters"));
    fireEvent.click(screen.getByTestId("regions-trust"));
    expect(screen.getByTestId("explore-filtered-empty")).toBeInTheDocument();
    expect(screen.getByText("No Level 3+ traders here yet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show every page" }));
    expect(
      within(screen.getByTestId("regions-grid")).getByText("School uniform tailoring"),
    ).toBeInTheDocument();
  });

  it("offers intent chips and never inflates a Level 2 trader to Level 3", () => {
    render(
      <MemoryRouter>
        <ExplorePage
          regionAware
          demo={{
            items: [listing, service],
            location: { label: "Kondele, Kisumu", radius_km: 15 },
            region: REGION_BY_SLUG.nyanza,
          }}
        />
        <LocationProbe />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("explore-more-filters"));
    expect(screen.getByTestId("regions-intent-all")).toHaveAttribute("aria-pressed", "true");
    const grid = within(screen.getByTestId("regions-grid"));
    expect(grid.getByText("Maize flour 2kg")).toBeInTheDocument();
    expect(grid.getByText("School uniform tailoring")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("regions-intent-offers"));
    expect(screen.getByTestId("regions-intent-offers")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("location")).toHaveTextContent("intent=offers");

    fireEvent.click(screen.getByTestId("regions-trust"));
    expect(screen.getByTestId("regions-trust")).toHaveAttribute("aria-pressed", "true");
    const trusted = within(screen.getByTestId("regions-grid"));
    expect(trusted.getByText("Maize flour 2kg")).toBeInTheDocument();
    // Level 2 is shown as Level 2 when the strict door falls back; it is never
    // rounded up to "verified".
    const serviceCard = trusted.getByText("School uniform tailoring").closest("article");
    expect(within(serviceCard).getByTestId("region-card-level")).toHaveTextContent("Lvl 2");
  });
});
