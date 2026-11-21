import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DeskPage from "@/pages/desk/DeskPage";

vi.mock("@/lib/api", () => ({
  offeringsAPI: {
    mine: vi.fn().mockResolvedValue({ data: { items: [], groups: {}, counts: {} } }),
    terms: vi.fn().mockResolvedValue({ data: {} }),
    create: vi.fn(),
    update: vi.fn(),
    setStatus: vi.fn(),
  },
  officeAPI: {
    mine: vi.fn().mockResolvedValue({ data: { offices: [] } }),
    assignments: vi.fn().mockResolvedValue({ data: { items: [] } }),
    work: vi.fn().mockResolvedValue({ data: { items: [] } }),
  },
  stockAPI: { mine: vi.fn().mockResolvedValue({ data: { items: [] } }) },
  apiError: (_e, fallback) => fallback,
}));

vi.mock("@/components/desk/OfferingForm", () => ({
  default: ({ initialKind }) => (
    <div data-testid="offering-form">kind:{initialKind || "none"}</div>
  ),
}));

vi.mock("@/components/ui/Toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/desk/AssignedToMe", () => ({ default: () => null }));
vi.mock("@/components/desk/ManageWork", () => ({ default: () => null }));

const renderAt = (url) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <DeskPage />
    </MemoryRouter>,
  );

describe("a door that already knows what you want to add", () => {
  it("/desk?new=service opens the form on a service instead of a dropdown", async () => {
    renderAt("/desk?new=service");
    await waitFor(() => expect(screen.getByTestId("offering-form")).toHaveTextContent("kind:service"));
  });

  it("/desk?new=tool is honoured too", async () => {
    renderAt("/desk?new=tool");
    await waitFor(() => expect(screen.getByTestId("offering-form")).toHaveTextContent("kind:tool"));
  });

  it("a nonsense value falls back to the form's own choice, not a crash", async () => {
    renderAt("/desk?new=spaceship");
    expect(screen.queryByTestId("offering-form")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("My desk")).toBeInTheDocument());
  });

  it("says the form has one save, so nobody hunts for a second one", async () => {
    renderAt("/desk?new=service");
    await waitFor(() => expect(screen.getByText(/One form, one save/i)).toBeInTheDocument());
  });

  it("the header names the three facts an offer carries", async () => {
    renderAt("/desk");
    await waitFor(() =>
      expect(screen.getByText(/price, duration and/i)).toBeInTheDocument(),
    );
    // and the empty state still offers the one action that matters
    expect(screen.getByRole("button", { name: /add your first offering/i })).toBeInTheDocument();
  });
});
