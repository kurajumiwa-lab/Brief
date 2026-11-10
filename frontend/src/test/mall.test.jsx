import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Mall from "@/pages/mall/Mall";
import { useVendorStore } from "@/stores/vendorStore";

/**
 * P1 Mall: only verified businesses are shown. Server-side gating is P3; this
 * pins the display gate and the rule that the Mall is not paid placement.
 */

const business = (overrides) => ({
  id: "b-1",
  business_name: "Default",
  vendor_handle: "default",
  is_verified: false,
  network_score: 10,
  ...overrides,
});

const seed = (network) => {
  useVendorStore.setState({
    network,
    loading: false,
    // Stub the fetch: the page calls it on mount; the test controls the list.
    fetchNetwork: async () => {},
  });
};

const renderMall = () =>
  render(
    <MemoryRouter initialEntries={["/mall"]}>
      <Routes>
        <Route path="/mall" element={<Mall />} />
      </Routes>
    </MemoryRouter>,
  );

describe("Mall (P1)", () => {
  beforeEach(() => {
    seed([]);
  });

  it("shows only verified businesses and never an unverified one", () => {
    seed([
      business({ id: "a", business_name: "Verified Duka", vendor_handle: "verified_duka", is_verified: true }),
      business({ id: "b", business_name: "Unverified Stall", vendor_handle: "unverified_stall", is_verified: false }),
      business({ id: "c", business_name: "Missing Flag Shop", vendor_handle: "missing_flag" }),
    ]);
    renderMall();

    const list = screen.getByTestId("mall-list");
    expect(within(list).getByText("Verified Duka")).toBeInTheDocument();
    expect(within(list).queryByText("Unverified Stall")).not.toBeInTheDocument();
    expect(within(list).queryByText("Missing Flag Shop")).not.toBeInTheDocument();
  });

  it("explains the empty state and points unverified businesses to Local network", () => {
    seed([business({ business_name: "Only Unverified", is_verified: false })]);
    renderMall();

    expect(screen.getByText("No verified businesses yet")).toBeInTheDocument();
    expect(screen.queryByTestId("mall-list")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Local network/).length).toBeGreaterThan(0);
  });

  it("states that listing is not for sale and that order is not payment", () => {
    seed([]);
    renderMall();

    expect(screen.getByTestId("mall-rule")).toHaveTextContent(/not for sale/i);
    expect(screen.getByTestId("mall-rule")).toHaveTextContent(/not payment/i);
  });
});
