import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ me: vi.fn() }));

vi.mock("@/lib/api", () => ({
  earningsAPI: { me: mocks.me },
  apiError: (_error, fallback) => fallback,
}));

import EarningsPage from "@/pages/earnings/EarningsPage";

const full = {
  summary: { completed_projects: 4, successful_referrals: 12, event_connections: 28, active_opportunities: 6 },
  commissions: {
    pending_kes: 300, pending_count: 2,
    due_kes: 1500, due_count: 3,
    paid_kes: 4200, paid_count: 5,
    reward_points: 640,
    project_payouts_recorded_kes: 12000, project_payouts_recorded_count: 3,
    event_value_estimate_kes: 2500,
  },
  channels: [
    { key: "projects", name: "Project earnings", detail: "4 completed on the squad board", count: 4, to: "/tasks/squad" },
    { key: "referrals", name: "Referral commissions", detail: "12 verified referral(s)", count: 12, to: "/referral-index" },
    { key: "events", name: "Event hosting", detail: "2 hosted", count: 2, to: "/events" },
    { key: "partnerships", name: "Partnership revenue", detail: "No partnership ledger exists yet", count: null, to: "/office" },
    { key: "knowledge", name: "Consulting and mentoring", detail: "1 completed", count: 1, to: "/learn" },
    { key: "rentals", name: "Resource rentals", detail: "No trusted count yet", count: null, to: "/desk" },
  ],
  recent: [
    { id: "contract-1", kind: "project", label: "Project completed (squad)", amount_kes: 3000, status: "recorded", occurred_at: "2026-11-20T10:00:00", to: "/tasks/squad" },
  ],
  not_measured: [
    { what: "Partnership revenue", why: "There is no partnership revenue table." },
    { what: "Resource rentals", why: "Rental terms live on the desk." },
  ],
  note: "Pending commissions become earnings only when the transaction is verified. Points are not money and cannot be withdrawn.",
};

const empty = {
  summary: { completed_projects: 0, successful_referrals: 0, event_connections: 0, active_opportunities: 0 },
  commissions: {
    pending_kes: 0, pending_count: 0, due_kes: 0, due_count: 0, paid_kes: 0, paid_count: 0,
    reward_points: 0, project_payouts_recorded_kes: 0, project_payouts_recorded_count: 0,
    event_value_estimate_kes: 0,
  },
  channels: full.channels.map((c) => ({ ...c, count: c.count === null ? null : 0 })),
  recent: [],
  not_measured: emptyNotMeasured(),
  note: full.note,
};

function emptyNotMeasured() {
  return [{ what: "Partnership revenue", why: "no table" }, { what: "Rentals", why: "no count yet" },
          { what: "Project cash", why: "off platform" }, { what: "Mentoring cash", why: "off platform" }];
}

beforeEach(() => {
  mocks.me.mockReset();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/you/earnings"]}>
      <EarningsPage />
    </MemoryRouter>
  );
}

describe("My Opportunities & Earnings", () => {
  it("renders the member's evidence and the three commission states separately", async () => {
    mocks.me.mockResolvedValue({ data: full });
    renderPage();

    const stats = await screen.findByTestId("earnings-stats");
    expect(within(stats).getByText("Completed projects")).toBeTruthy();
    expect(within(stats).getByText("4")).toBeTruthy();
    expect(within(stats).getByText("Successful referrals")).toBeTruthy();
    expect(within(stats).getByText("12")).toBeTruthy();

    const commissions = screen.getByTestId("earnings-commissions");
    expect(commissions.textContent).toContain("KSh 300");
    expect(commissions.textContent).toContain("awaiting verification");
    expect(commissions.textContent).toContain("KSh 1,500");
    expect(commissions.textContent).toContain("approved, unpaid");
    expect(commissions.textContent).toContain("KSh 4,200");
    expect(commissions.textContent).toContain("recorded paid");
    expect(commissions.textContent).toContain("640 pts");
    expect(commissions.textContent).toContain("not money");
  });

  it("lists the six earning channels, labelling the unmeasurable ones honestly", async () => {
    mocks.me.mockResolvedValue({ data: full });
    renderPage();

    const channels = await screen.findByTestId("earnings-channels");
    expect(channels.textContent).toContain("Project earnings");
    expect(channels.textContent).toContain("Referral commissions");
    expect(channels.textContent).toContain("Event hosting");
    expect(channels.textContent).toContain("Partnership revenue");
    expect(channels.textContent).toContain("Consulting and mentoring");
    expect(channels.textContent).toContain("Resource rentals");
    // Two channels have no honest count.
    expect(channels.textContent.match(/not tracked yet/g)).toHaveLength(2);
  });

  it("states plainly what it cannot count rather than estimating", async () => {
    mocks.me.mockResolvedValue({ data: full });
    renderPage();

    const block = await screen.findByTestId("earnings-not-measured");
    expect(block.textContent).toContain("Partnership revenue");
    expect(block.textContent).toContain("Resource rentals");
  });

  it("shows the honest empty state when the member has no record yet", async () => {
    mocks.me.mockResolvedValue({ data: empty });
    renderPage();

    expect(await screen.findByText("Nothing to measure yet")).toBeTruthy();
  });

  it("recovers from a failed load with a retry", async () => {
    mocks.me.mockRejectedValueOnce(new Error("boom"));
    renderPage();

    expect(await screen.findByRole("button", { name: /try again/i })).toBeTruthy();
  });
});
