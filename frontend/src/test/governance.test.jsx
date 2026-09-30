import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import OurNetwork from "@/pages/governance/OurNetwork";

vi.mock("@/lib/api", () => ({
  governanceAPI: {
    proposals: vi.fn(), council: vi.fn(), myScore: vi.fn(), myBenefits: vi.fn(),
    allocationPolicy: vi.fn(), consents: vi.fn(), myAppeals: vi.fn(),
    vote: vi.fn(), results: vi.fn(), createProposal: vi.fn(), setConsent: vi.fn(),
    submitAppeal: vi.fn(), opsAppeals: vi.fn(), audit: vi.fn(), approvals: vi.fn(),
    decideApproval: vi.fn(), resolveAppeal: vi.fn(),
  },
  locksAPI: { home: vi.fn() },
  apiError: (_error, fallback) => fallback,
}));

import { governanceAPI, locksAPI } from "@/lib/api";

const openProposal = {
  id: "proposal-1", title: "Change the market pickup time", summary: "Move the shared pickup time to 6am for the next season.",
  scope: "zone", authority: "advisory", status: "open", closes_at: new Date(Date.now() + 86400000).toISOString(),
  opens_at: new Date().toISOString(), proposed_changes: { pickup_time: "06:00" },
  eligibility: { eligible: false, reasons: ["Verify your phone number before voting."] }, vendor_vote: null,
};

function setup({ zone = { id: "zone-1", name: "Gikomba A", city: "Nairobi" }, role = null } = {}) {
  governanceAPI.proposals.mockResolvedValue({ data: [openProposal] });
  governanceAPI.council.mockResolvedValue({ data: [] });
  governanceAPI.myScore.mockResolvedValue({ data: { score: 0, window_days: 180, events: [], dimension_note: "Awaiting verified sources.", rules: { active: false } } });
  governanceAPI.myBenefits.mockResolvedValue({ data: { available_credit_ksh: "0", pending_estimate_ksh: "0", pool_status: "not_configured" } });
  governanceAPI.allocationPolicy.mockResolvedValue({ data: { active: false, message: "No policy active." } });
  governanceAPI.consents.mockResolvedValue({ data: [{ purpose: "lender_profile_sharing", granted: false, expires_at: null }] });
  governanceAPI.myAppeals.mockResolvedValue({ data: [] });
  locksAPI.home.mockResolvedValue({ data: { vendor_zone: zone, market_ops_role: role } });
  return render(<MemoryRouter><OurNetwork /></MemoryRouter>);
}

describe("Our Network governance page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows transparent proposal authority and disables a ballot until eligible", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "Our Network" })).toBeInTheDocument();
    expect(screen.getByText("Change the market pickup time")).toBeInTheDocument();
    expect(screen.getByText("Zone · Advisory")).toBeInTheDocument();
    expect(screen.getByText("Verify your phone number before voting.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes" })).toBeDisabled();
    expect(screen.getByText(/Biashara Score does not determine ballot access or weight/i)).toBeInTheDocument();
  });

  it("requires a market zone before a vendor can open a zone proposal", async () => {
    setup({ zone: null });
    expect(await screen.findByText(/Choose an active market zone/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open proposal" })).toBeDisabled();
    await waitFor(() => expect(governanceAPI.proposals).toHaveBeenCalledTimes(1));
  });

  it("keeps optional lender consent separate and revocable", async () => {
    setup();
    const revoke = await screen.findByRole("button", { name: "Grant for 30 days" });
    expect(revoke).toBeEnabled();
    fireEvent.click(revoke);
    await waitFor(() => expect(governanceAPI.setConsent).toHaveBeenCalledWith("lender_profile_sharing", expect.objectContaining({ granted: true })));
  });
});
