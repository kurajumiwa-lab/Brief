/**
 * THE CONNECTION LAYER, ON THE HOME SCREEN (v2.18, direction C).
 *
 * The turn this pins down, in the words it was asked in: *"You are not trying to
 * build another online marketplace. You are trying to digitally connect,
 * organise and activate the informal economy using technology."* Direction C —
 * a connected business network **with** digital identities, registers, vendor
 * fronts and automation inside it.
 *
 * Four promises, and each one is a spec:
 *
 *   1. **Nobody is asked to pick a side.** One headline, for a school, a
 *      household, an artisan and a shop. The old hero changed with the vendor's
 *      trading mode, which meant the product changed shape per visitor.
 *   2. **The categories are doors, not a taxonomy.** Five named trades, each
 *      landing on a results screen that exists.
 *   3. **Everyone trades both ways.** A school is an institution that buys; a
 *      household can sell. Both are rows here, and both are `account_kind`
 *      values the schema already has.
 *   4. **The four systems are real or labelled.** Identity, discovery, codes and
 *      records each name the screen they live on — and the one that is not built
 *      yet says "Next" instead of pretending.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const auth = vi.hoisted(() => ({ vendor: null }));
vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector) => selector({ vendor: auth.vendor }),
}));

// The hero carries the real search field; it is covered by marketSearch.test.jsx.
vi.mock("@/components/home/MarketSearch", () => ({
  default: () => <div data-testid="market-search" />,
}));

const { default: HomeHero } = await import("@/components/home/HomeHero");
const { default: TradeNetworkPanel } = await import("@/components/home/TradeNetworkPanel");
const { default: ParticipantBand } = await import("@/components/home/ParticipantBand");
const { default: FoundationStrip } = await import("@/components/home/FoundationStrip");

const renderIn = (ui) => render(<MemoryRouter initialEntries={["/"]}>{ui}</MemoryRouter>);

beforeEach(() => {
  auth.vendor = { vendor_handle: "mama_mboga", business_name: "Mama Mboga Fresh" };
});

describe("the hero states one idea for everybody", () => {
  it("does not change its headline with the vendor's trading mode", () => {
    auth.vendor = { ...auth.vendor, current_role: "sourcing" };
    const { unmount } = renderIn(<HomeHero />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/the businesses around you/i);
    unmount();

    auth.vendor = { ...auth.vendor, current_role: "selling" };
    const view = renderIn(<HomeHero />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/the businesses around you/i);
    view.unmount();
  });

  it("says what the network is, not what a market garden is", () => {
    renderIn(<HomeHero />);
    const hero = screen.getByTestId("home-hero");
    // The copy that made the product look agricultural is gone.
    expect(hero.textContent).not.toMatch(/produce|farm|vegetable/i);
    expect(hero).toHaveTextContent(/suppliers, skilled professionals, products and enterprises/i);
    expect(hero).toHaveTextContent(/an existing economy\. a connected future\./i);
  });

  it("gives six doors, each one a route that exists", () => {
    renderIn(<HomeHero />);
    const hrefs = Array.from(screen.getByTestId("home-hero").querySelectorAll("a")).map((a) =>
      a.getAttribute("href")
    );
    for (const expected of [
      "/browse?type=services",
      "/browse?type=goods",
      "/browse?type=people",
      "/browse?type=equipment",
      "/network",
      "/tools",
    ]) {
      expect(hrefs).toContain(expected);
    }
  });

  it("asks a vendor with a shop front to open it, and a visitor to create one", () => {
    const { unmount } = renderIn(<HomeHero />);
    expect(screen.getByRole("link", { name: /open it/i })).toHaveAttribute("href", "/@mama_mboga?edit=1");
    unmount();

    auth.vendor = null;
    renderIn(<HomeHero />);
    // A record without a handle is a data problem, not a signup: the ask goes
    // to the profile rather than the auth screen.
    expect(screen.getByRole("link", { name: /create one/i })).toHaveAttribute("href", "/me");
    expect(screen.getByText(/have a business or skill\?/i)).toBeInTheDocument();
  });

  it("carries no invented numbers", () => {
    renderIn(<HomeHero />);
    expect(screen.getByTestId("home-hero").textContent).not.toMatch(/\d+\s*(k|m|\+)?\s*(vendors|businesses|customers)/i);
  });
});

describe("the trade network panel", () => {
  it("names the five starting categories and where each one goes", () => {
    renderIn(<TradeNetworkPanel />);
    const panel = screen.getByTestId("trade-network-panel");
    for (const title of [
      /technology and digital services/i,
      /manufacturing and fabrication/i,
      /skilled trades and technical work/i,
      /products and equipment/i,
      /business and operational services/i,
    ]) {
      expect(panel).toHaveTextContent(title);
    }
    expect(screen.getByRole("link", { name: /skilled trades and technical work/i })).toHaveAttribute(
      "href",
      "/browse?type=people"
    );
    expect(screen.getByRole("link", { name: /business and operational services/i })).toHaveAttribute(
      "href",
      "/tools"
    );
  });

  it("says the list is a starting point, not an exclusion", () => {
    renderIn(<TradeNetworkPanel />);
    expect(screen.getByText(/starting categories, not restrictions/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Create$/ })).toHaveAttribute("href", "/create");
  });
});

describe("every participant trades both ways", () => {
  it("carries the school, the household, the enterprise and the artisan", () => {
    renderIn(<ParticipantBand />);
    const band = screen.getByTestId("participant-band");
    for (const label of ["A school", "A household", "An enterprise", "A skilled worker"]) {
      expect(band).toHaveTextContent(label);
    }
    // The schema's own kinds, in the words a person uses.
    expect(band).toHaveTextContent(/institution/i);
    expect(band).toHaveTextContent(/consumer \+ potential vendor/i);
  });

  it("says the account kind decides the record, not the permission", () => {
    renderIn(<ParticipantBand />);
    expect(
      screen.getByText(/decides what the record looks like, not what it is allowed to do/i)
    ).toBeInTheDocument();
  });
});

describe("the four systems underneath", () => {
  it("points three of them at a screen that exists", () => {
    renderIn(<FoundationStrip />);
    expect(screen.getByRole("link", { name: /digital business identity/i })).toHaveAttribute(
      "href",
      "/passport"
    );
    expect(screen.getByRole("link", { name: /discovery and relationships/i })).toHaveAttribute(
      "href",
      "/network"
    );
    expect(screen.getByRole("link", { name: /trade activity and records/i })).toHaveAttribute(
      "href",
      "/orders"
    );
  });

  it("labels the QR code as next instead of claiming it exists", () => {
    renderIn(<FoundationStrip />);
    const pending = screen.getByText(/business codes and automation/i).closest("div");
    expect(pending).toHaveTextContent(/next/i);
    // And there is no link to a QR screen, because there is no QR screen.
    expect(screen.queryByRole("link", { name: /business codes and automation/i })).toBeNull();
  });
});
