import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import MembershipPage from "@/pages/membership/MembershipPage";
import DirectoryPage from "@/pages/membership/DirectoryPage";
import LogisticsPage from "@/pages/logistics/LogisticsPage";
import LogisticsOrderPage, { parseStops } from "@/pages/logistics/LogisticsOrderPage";
import { membershipAPI, logisticsAPI } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  membershipAPI: {
    me: vi.fn(), update: vi.fn(), requestVerification: vi.fn(), events: vi.fn(),
    categories: vi.fn(), directory: vi.fn(),
  },
  logisticsAPI: {
    mine: vi.fn(), openOrders: vi.fn(), create: vi.fn(), get: vi.fn(), join: vi.fn(), leave: vi.fn(),
    route: vi.fn(), schedule: vi.fn(), status: vi.fn(), providers: vi.fn(),
  },
  feesAPI: { schedule: vi.fn() },
  apiError: (_e, fallback) => fallback,
}));

const CATS = { data: [{ key: "artisan", label: "Artisan or skilled trade" }] };

const profile = (over = {}) => ({
  vendor_id: "v1", handle: "amina", business_name: "Amina Fundi", display_name: "Amina",
  category: null, professional_class: null, bio: null, membership_status: "active",
  verification_status: "unverified", verified: false, verified_at: null,
  directory_visible: false, show_contact: false, fees: "none", ...over,
});

const order = (over = {}) => ({
  id: "o1", title: "Cement bulk buy", description: null, item_summary: "10 bags", status: "open",
  closes_at: null, delivery_point: "Kisumu market", window_start: null, window_end: null,
  provider_id: null, route: {}, participant_count: 2, my_role: "none", fees: "none", ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  membershipAPI.categories.mockResolvedValue(CATS);
  membershipAPI.events.mockResolvedValue({ data: [] });
  logisticsAPI.providers.mockResolvedValue({ data: [] });
});

describe("Membership (free for now)", () => {
  it("shows the profile, says it is free, and hides the member from the directory by default", async () => {
    membershipAPI.me.mockResolvedValue({ data: profile() });
    render(<MemoryRouter><MembershipPage /></MemoryRouter>);
    expect(await screen.findByText(/Nothing is charged for membership/)).toBeInTheDocument();
    const box = screen.getByLabelText(/Show me in the member directory/);
    expect(box).not.toBeChecked();
    expect(screen.getByRole("button", { name: /Request verification/ })).toBeInTheDocument();
  });

  it("asks for verification, which an operator then decides", async () => {
    membershipAPI.me.mockResolvedValue({ data: profile() });
    membershipAPI.requestVerification.mockResolvedValue({ data: {} });
    render(<MemoryRouter><MembershipPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /Request verification/ }));
    await waitFor(() => expect(membershipAPI.requestVerification).toHaveBeenCalled());
  });

  it("shows a suspended member that they are hidden and cannot edit", async () => {
    membershipAPI.me.mockResolvedValue({ data: profile({ membership_status: "suspended" }) });
    render(<MemoryRouter><MembershipPage /></MemoryRouter>);
    expect(await screen.findByText(/membership is suspended/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save profile/ })).toBeDisabled();
  });
});

describe("Member directory", () => {
  it("lists only what the server returns and never shows a phone number unless it was returned", async () => {
    membershipAPI.directory.mockResolvedValue({ data: [
      { vendor_id: "v2", handle: "kipchoge", display_name: "Kipchoge Tailors", professional_class: "Tailor",
        bio: "School uniforms", verified: true },
    ] });
    render(<MemoryRouter><DirectoryPage /></MemoryRouter>);
    expect(await screen.findByText("Kipchoge Tailors")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.queryByText(/Phone:/)).not.toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    membershipAPI.directory.mockResolvedValue({ data: [] });
    render(<MemoryRouter><DirectoryPage /></MemoryRouter>);
    expect(await screen.findByText(/No listed members match/)).toBeInTheDocument();
  });
});

describe("Group orders", () => {
  it("shows the orders I am in and the ones open to join", async () => {
    logisticsAPI.mine.mockResolvedValue({ data: [order({ id: "mine", title: "Sugar split", my_role: "organiser" })] });
    logisticsAPI.openOrders.mockResolvedValue({ data: [order({ id: "mine" }), order({ id: "other", title: "Maize flour" })] });
    render(<MemoryRouter><LogisticsPage /></MemoryRouter>);
    expect(await screen.findByText("Sugar split")).toBeInTheDocument();
    expect(screen.getByText("Maize flour")).toBeInTheDocument();
    expect(screen.getByText(/Buy together, deliver together/)).toBeInTheDocument();
  });

  it("lets a neighbour join an open order and says the sale is not handled here", async () => {
    logisticsAPI.get.mockResolvedValue({ data: order({ my_role: "none", participants: [] }) });
    logisticsAPI.join.mockResolvedValue({ data: {} });
    render(
      <MemoryRouter initialEntries={["/logistics/o1"]}>
        <Routes><Route path="/logistics/:id" element={<LogisticsOrderPage />} /></Routes>
      </MemoryRouter>
    );
    expect(await screen.findByText(/Coordination only/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Join$/ }));
    await waitFor(() => expect(logisticsAPI.join).toHaveBeenCalledWith("o1", ""));
  });

  it("gives the organiser only the moves the server allows from the current status", async () => {
    logisticsAPI.get.mockResolvedValue({ data: order({ status: "open", my_role: "organiser", events: [] }) });
    render(
      <MemoryRouter initialEntries={["/logistics/o1"]}>
        <Routes><Route path="/logistics/:id" element={<LogisticsOrderPage />} /></Routes>
      </MemoryRouter>
    );
    expect(await screen.findByRole("button", { name: /Mark Locked/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mark Delivered/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mark Delivery scheduled/ })).not.toBeInTheDocument();
  });
});

describe("parseStops", () => {
  it("reads name, latitude, longitude per line and flags lines it cannot read", () => {
    const { stops, bad } = parseStops("Mama Ann, -0.0917, 34.7680\nKibuye Market, Stall 4, -0.1, 34.75\nbroken line\n");
    expect(stops).toEqual([
      { label: "Mama Ann", lat: -0.0917, lng: 34.768, priority: 0 },
      { label: "Kibuye Market, Stall 4", lat: -0.1, lng: 34.75, priority: 0 },
    ]);
    expect(bad).toEqual([3]);
  });
});
