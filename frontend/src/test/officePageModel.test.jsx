import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import OfficePage from "@/pages/office/OfficePage";

const mocks = vi.hoisted(() => ({
  mine: vi.fn(),
  detail: vi.fn(),
  calendar: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  officeAPI: {
    mine: mocks.mine,
    detail: mocks.detail,
    calendar: mocks.calendar,
    create: mocks.create,
    inviteAccount: vi.fn(),
    inviteLink: vi.fn(),
    removeMember: vi.fn(),
    addEvent: vi.fn(),
  },
  apiError: (_err, fallback) => fallback,
}));

const detail = {
  id: "office-1",
  name: "Amina's Home Office",
  nature: "Home nursing",
  area: "Kondele, Kisumu",
  hours_text: null,
  my_role: "owner",
  members: [{ id: "m1", name: "Amina", role: "owner", status: "active", registered: true }],
  events: [],
  roles: ["owner", "editor", "staff"],
  contact_modes: ["none", "phone", "email"],
  page: {
    handle: "amina",
    url: "/p/amina",
    published: true,
    discoverable: true,
    preset: "service",
    payment_ready: false,
  },
  setup: {
    page_ready: true,
    shelf_ready: false,
    hours_ready: false,
    payment_ready: false,
    team_ready: false,
    service_count: 0,
    stock_count: 0,
    hours_count: 0,
    active_members: 1,
    preset: "service",
  },
};

describe("Home office model", () => {
  it("says the office is private, links the public Page, and gives the next steps", async () => {
    mocks.mine.mockResolvedValue({ data: { offices: [{ id: "office-1", name: detail.name, my_role: "owner" }] } });
    mocks.detail.mockResolvedValue({ data: detail });

    render(<MemoryRouter><OfficePage /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText("Amina's Home Office")).toBeInTheDocument());
    expect(screen.getByText(/Private workspace/)).toBeInTheDocument();
    expect(screen.getByText(/Customers never see/)).toBeInTheDocument();
    expect(screen.getByText("/p/amina")).toBeInTheDocument();

    const steps = screen.getByTestId("office-next-steps");
    expect(steps).toHaveTextContent("1/4 done");
    expect(screen.getByTestId("office-step-page")).toHaveAttribute("data-done", "true");
    expect(screen.getByTestId("office-step-shelf")).toHaveAttribute("data-done", "false");
    expect(screen.getByTestId("office-step-hours")).toHaveAttribute("data-done", "false");
    expect(screen.getByTestId("office-step-payment")).toHaveAttribute("data-done", "false");
    // A service office is pointed at services, not at stock.
    expect(screen.getByTestId("office-step-shelf")).toHaveTextContent("Open your services");

    // People are available but are explicitly optional, not the first thing.
    expect(screen.getByTestId("office-people")).toHaveTextContent("optional");
    expect(screen.getByText(/One person is a complete office/)).toBeInTheDocument();
  });

  it("does not pretend a page exists when the handle is missing", async () => {
    mocks.mine.mockResolvedValue({ data: { offices: [{ id: "office-1", name: detail.name, my_role: "owner" }] } });
    mocks.detail.mockResolvedValue({
      data: {
        ...detail,
        page: { handle: null, url: null, published: false, discoverable: true, preset: "service", payment_ready: false },
        setup: { ...detail.setup, page_ready: false },
      },
    });

    render(<MemoryRouter><OfficePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Not ready yet")).toBeInTheDocument());
    expect(screen.getByTestId("office-step-page")).toHaveAttribute("data-done", "false");
    expect(screen.getByText("Create page")).toBeInTheDocument();
  });
});
