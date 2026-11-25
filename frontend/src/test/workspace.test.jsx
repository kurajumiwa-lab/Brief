import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({
  overview: vi.fn(),
  tradeProofs: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  analyticsAPI: { overview: mocks.overview },
  vendorAPI: {
    profile: vi.fn(() => Promise.resolve({ data: {} })),
    connections: vi.fn(() => Promise.resolve({ data: [] })),
  },
}));

vi.mock("@/lib/receiptsApi", () => ({
  receiptsAPI: { tradeProofs: mocks.tradeProofs },
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector) =>
    selector ? selector({ vendor: { business_name: "Moraa Cereals", vendor_handle: "moraa_cereals" } }) : {},
}));

vi.mock("@/stores/identityStore", () => ({
  useIdentityStore: Object.assign(
    (selector) => (selector ? selector({ intent: "offer", load: vi.fn() }) : { intent: "offer" }),
    { getState: () => ({ intent: "offer" }) },
  ),
}));

vi.mock("@/stores/stockStore", () => ({
  useStockStore: (selector) =>
    selector({
      mine: [{ id: "i-1", visible_to_network: true }],
      movements: [{ id: "m-1", direction: "outgoing", status: "pending" }],
      fetchMine: vi.fn(() => Promise.resolve()),
      fetchMovements: vi.fn(() => Promise.resolve()),
      mineLoaded: true,
    }),
  needsMyAction: (m) => m.direction === "outgoing" && m.status === "pending",
}));

import WorkspaceView from "@/components/workspace/WorkspaceView";

const rank = {
  level: 3,
  key: "trusted",
  label: "Trusted",
  blurb: "A record behind the name.",
  tone: "brand",
  next: { label: "Get verified", blurb: "A record beats a promise." },
  nextAction: { label: "Add your licence", detail: "One licence moves you up.", to: "/you/identity" },
};

function renderWorkspace(overrides = {}) {
  return render(
    <MemoryRouter>
      <WorkspaceView
        vendor={{ business_name: "Moraa Cereals", vendor_handle: "moraa_cereals" }}
        rank={rank}
        stats={{ recorded: 12, outstanding: 3, confirmed: 4, people: 7 }}
        pending={[
          { id: "setup", title: "2 steps left on your shop", body: "Photograph what you sell", to: "/stock?new=1" },
          { id: "movements", title: "1 movement waiting on you", body: "Someone is waiting for the next step.", to: "/orders" },
        ]}
        listings={5}
        records={[{ label: "Receipts", value: 9, hint: "On the record.", to: "/payments", action: "Open" }]}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe("The business workspace", () => {
  it("separates recorded trades, outstanding movements and receipt-backed confirmations", () => {
    renderWorkspace();
    const stats = screen.getAllByTestId("workspace-stat");
    const said = stats.map((s) => s.textContent);
    expect(said.some((t) => /Recorded/.test(t) && /12/.test(t))).toBe(true);
    expect(said.some((t) => /Outstanding/.test(t) && /3/.test(t))).toBe(true);
    expect(said.some((t) => /Receipt-backed/.test(t) && /4/.test(t))).toBe(true);
    expect(said.some((t) => /People/.test(t) && /7/.test(t))).toBe(true);
  });

  it("never presents a balance, an earning or money it can move", () => {
    renderWorkspace();
    expect(screen.getByTestId("workspace-money-note")).toHaveTextContent(
      /holds no money for you and lends you none/i,
    );
    const body = document.body.textContent;
    expect(body).not.toMatch(/\bbalance\b/i);
    expect(body).not.toMatch(/\bearnings?\b/i);
    expect(body).not.toMatch(/\bpayout\b/i);
    expect(body).not.toMatch(/\bwithdraw\b/i);
  });

  it("says what is waiting, and each row goes somewhere", () => {
    renderWorkspace();
    const rows = screen.getAllByTestId("workspace-pending-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/2 steps left on your shop/i);
    expect(rows[0].getAttribute("href")).toBe("/stock?new=1");
    expect(rows[1].getAttribute("href")).toBe("/orders");
  });

  it("says so plainly when nothing is waiting", () => {
    renderWorkspace({ pending: [] });
    expect(screen.getByText("Nothing is waiting")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-pending-row")).not.toBeInTheDocument();
  });

  it("shows an unknown reading as unknown, not as zero", () => {
    renderWorkspace({ stats: { recorded: null, outstanding: null, confirmed: null, people: null } });
    // The first four cards are the four readings.
    const readings = screen.getAllByTestId("workspace-stat").slice(0, 4);
    for (const stat of readings) {
      expect(within(stat).getByText("—")).toBeInTheDocument();
      expect(stat.textContent).not.toMatch(/\b0\b/);
    }
  });

  it("states the verification position and the way to move it", () => {
    renderWorkspace();
    const section = screen.getByRole("region", { name: /verification/i });
    expect(within(section).getByText("Not verified yet")).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: /Add your licence/i })).toHaveAttribute(
      "href",
      "/you/identity",
    );
  });

  it("shows the shelf and the records as doors", () => {
    renderWorkspace();
    const section = screen.getByRole("region", { name: /shelf and your records/i });
    const links = within(section).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toContain("/stock");
    expect(links).toContain("/payments");
  });
});

describe("The workspace reads the business, it does not guess", () => {
  it("separates recorded, outstanding, receipt-backed and people from real readings", async () => {
    mocks.overview.mockResolvedValue({
      data: {
        summary: {
          movements_settled: 12,
          open_movements_total: 3,
          counterparties: 7,
        },
      },
    });
    mocks.tradeProofs.mockResolvedValue({
      data: [{ id: "p-1", status: "pending" }, { id: "p-2", status: "confirmed" }],
    });

    const WorkspacePage = (await import("@/pages/workspace/WorkspacePage")).default;
    render(
      <MemoryRouter>
        <WorkspacePage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("Recorded")).toBeInTheDocument());
    const stats = screen.getAllByTestId("workspace-stat");
    const said = stats.map((s) => s.textContent);
    expect(said.some((t) => /Recorded/.test(t) && /12/.test(t))).toBe(true);
    expect(said.some((t) => /Outstanding/.test(t) && /3/.test(t))).toBe(true);
    expect(said.some((t) => /Receipt-backed/.test(t) && /2/.test(t))).toBe(true);
    expect(said.some((t) => /People/.test(t) && /7/.test(t))).toBe(true);
  });

  it("shows an unknown reading as unknown when the server cannot answer", async () => {
    mocks.overview.mockRejectedValue(new Error("offline"));
    mocks.tradeProofs.mockRejectedValue(new Error("offline"));

    const WorkspacePage = (await import("@/pages/workspace/WorkspacePage")).default;
    render(
      <MemoryRouter>
        <WorkspacePage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("Recorded")).toBeInTheDocument());
    const readings = screen.getAllByTestId("workspace-stat").slice(0, 4);
    for (const stat of readings) {
      expect(within(stat).getByText("—")).toBeInTheDocument();
    }
  });

  it("lists what is waiting on the business", async () => {
    mocks.overview.mockResolvedValue({ data: { summary: { movements_settled: 0, open_movements_total: 1, counterparties: 0 } } });
    mocks.tradeProofs.mockResolvedValue({ data: [{ id: "p-1", status: "pending" }] });

    const WorkspacePage = (await import("@/pages/workspace/WorkspacePage")).default;
    render(
      <MemoryRouter>
        <WorkspacePage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getAllByTestId("workspace-pending-row").length).toBeGreaterThan(0));
    const said = screen.getAllByTestId("workspace-pending-row").map((r) => r.textContent).join(" ");
    expect(said).toMatch(/movement waiting on you/i);
    expect(said).toMatch(/trade confirmation to confirm/i);
  });
});
