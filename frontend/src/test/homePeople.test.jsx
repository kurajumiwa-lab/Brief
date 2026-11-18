/** People are a Home experience: a circular-photo directory rail, not cards. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const ok = (data) => Promise.resolve({ data });
const mocks = vi.hoisted(() => ({ discover: vi.fn() }));

vi.mock("@/lib/api", () => ({
  vendorAPI: { discover: mocks.discover, connections: vi.fn(() => ok([])) },
}));

beforeEach(() => {
  mocks.discover.mockReset();
});

describe("Home people rail", () => {
  it("shows each person's chosen photo as a circular avatar with name and trade", async () => {
    mocks.discover.mockResolvedValue(ok([
      {
        vendor_id: "v-1", vendor_handle: "kemunto", business_name: "Kemunto Tailoring",
        business_categories: ["tailoring"], current_role: "artisan",
        avatar_url: "/api/files/people/kemunto.jpg", distance_km: 1.4,
        physical_location: "Nyanchwa, Kisii",
      },
      {
        vendor_id: "v-2", vendor_handle: "otieno", business_name: "Otieno Boda",
        business_categories: ["transport"], current_role: "artisan",
        avatar_url: null, logo_url: "/api/files/people/otieno-boda.png",
        physical_location: "Kisii town",
      },
    ]));

    const { default: PeopleRail } = await import("@/components/home/PeopleRail");
    render(<MemoryRouter><PeopleRail /></MemoryRouter>);

    const rail = await screen.findByTestId("home-people-rail");
    expect(within(rail).getByText("People around you")).toBeInTheDocument();
    expect(within(rail).getByText("Kemunto Tailoring")).toBeInTheDocument();
    expect(within(rail).getByText("tailoring")).toBeInTheDocument();

    const first = within(rail).getByTestId("home-person-kemunto");
    expect(first).toHaveAttribute("href", "/@kemunto");
    const img = first.querySelector("img");
    expect(img).toHaveAttribute("src", "/api/files/people/kemunto.jpg");
    // The avatar itself is round, so the DP is the circle rather than a colour fill.
    expect(img.className).toMatch(/rounded-full/);

    const second = within(rail).getByTestId("home-person-otieno");
    expect(second.querySelector("img")).toHaveAttribute("src", "/api/files/people/otieno-boda.png");
    expect(within(rail).getByText("1.4 km")).toBeInTheDocument();
  });

  it("falls back to a neutral silhouette and never an initials block when no photo exists", async () => {
    mocks.discover.mockResolvedValue(ok([{
      vendor_id: "v-3", vendor_handle: "njeri", business_name: "Njeri Kiosk",
      business_categories: ["retail"], current_role: "business",
    }]));

    const { default: PeopleRail } = await import("@/components/home/PeopleRail");
    render(<MemoryRouter><PeopleRail /></MemoryRouter>);

    const row = await screen.findByTestId("home-person-njeri");
    expect(row.querySelector("img")).toBeNull();
    await waitFor(() => expect(row.querySelector("svg")).toBeTruthy());
    expect(row.textContent).not.toMatch(/^[A-Z]{1,2}$/);
  });
});
