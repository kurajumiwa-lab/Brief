import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  token: "token-1",
  vendor: { id: "v-me", vendor_handle: "me", business_name: "Me", physical_location: "Kisumu" },
}));

const mocks = vi.hoisted(() => ({
  overview: vi.fn(),
  campaigns: vi.fn(),
  link: vi.fn(),
  claim: vi.fn(),
  publicCode: vi.fn(),
  createCampaign: vi.fn(),
  setStatus: vi.fn(),
  markPaid: vi.fn(),
  myMerchants: vi.fn(),
}));

vi.mock("@/stores/authStore", () => ({ useAuthStore: (selector) => selector(auth) }));
vi.mock("@/lib/api", () => ({
  referralAPI: {
    overview: mocks.overview,
    campaigns: mocks.campaigns,
    link: mocks.link,
    claim: mocks.claim,
    publicCode: mocks.publicCode,
    createCampaign: mocks.createCampaign,
    setStatus: mocks.setStatus,
    markPaid: mocks.markPaid,
  },
  apiError: (_error, fallback) => fallback,
}));
vi.mock("@/lib/receiptsApi", () => ({ receiptsAPI: { myMerchants: mocks.myMerchants } }));
vi.mock("@/components/ui/Toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import ReferralsPage from "@/pages/referrals/ReferralsPage";
import ReferralLandingPage from "@/pages/referrals/ReferralLandingPage";

const overview = {
  summary: {
    pending: 1, qualified: 2, rejected: 0, points_earned: 80,
    bounty_due_kes: 150, bounty_paid_kes: 0,
  },
  links: [{
    code: "RABCDEFG", path: "/r/RABCDEFG", campaign_id: "c1",
    campaign_title: "Bring a new customer", merchant_name: "Kisumu Chemist",
    campaign_status: "active", reward_points: 40, reward_kes: 150,
    counts: { pending: 1, qualified: 1 },
  }],
  referrals: [{
    id: "ref-1", status: "pending", campaign_id: "c1",
    campaign_title: "Bring a new customer", merchant_name: "Kisumu Chemist",
    reward_points: 0, bounty_kes: 0, bounty_status: "not_due",
    referred: { name: "New Person", handle: "new_person" },
    created_at: "2026-11-17T10:00:00Z",
  }],
  received: [],
  campaigns: [],
};

const campaigns = {
  campaigns: [{
    id: "c1", title: "Bring a new customer",
    description: "A new customer who buys anything counts.",
    region_slug: "nyanza", status: "active", reward_points: 40, reward_kes: 150,
    max_referrals: 5, remaining_referrals: 4,
    budget_points: 200, budget_kes: 750,
    merchant: { name: "Kisumu Chemist", pin: "P051234567X", region: "nyanza" },
    is_mine: false, my_link: null,
    stats: {
      referrals: 1, pending: 1, qualified: 0, rejected: 0, used: 1,
      reward_points_awarded: 0, bounty_due_kes: 0, bounty_paid_kes: 0,
    },
  }],
};

function renderPage(entry = "/referrals") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ReferralsPage />
    </MemoryRouter>,
  );
}

describe("Referral network", () => {
  beforeEach(() => {
    auth.token = "token-1";
    localStorage.clear();
    vi.clearAllMocks();
    mocks.overview.mockResolvedValue({ data: overview });
    mocks.campaigns.mockResolvedValue({ data: campaigns });
    mocks.myMerchants.mockResolvedValue({ data: { merchants: [] } });
    mocks.claim.mockResolvedValue({ data: { already_linked: false } });
  });

  it("separates a waiting claim from a verified referral and shows the shop's reward", async () => {
    renderPage();

    expect((await screen.findAllByText("Bring a new customer")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Waiting for a receipt").length).toBeGreaterThan(0);
    expect(screen.getByText("Verified referrals")).toBeInTheDocument();
    expect(screen.getByText("40 points")).toBeInTheDocument();
    expect(screen.getByText("KSh 150 direct")).toBeInTheDocument();
    expect(screen.getByText("What counts as a referral")).toBeInTheDocument();
    expect(screen.getByText(/a link click never qualifies/i)).toBeInTheDocument();
  });

  it("creates a link only when asked and never treats a click as a conversion", async () => {
    mocks.link.mockResolvedValue({
      data: { link: { code: "RXYZ2345", path: "/r/RXYZ2345", active: true } },
    });
    renderPage();
    const button = await screen.findByRole("button", { name: /get my link/i });
    mocks.campaigns.mockResolvedValue({
      data: {
        campaigns: [{
          ...campaigns.campaigns[0],
          my_link: { code: "RXYZ2345", path: "/r/RXYZ2345", active: true },
        }],
      },
    });

    fireEvent.click(button);
    await waitFor(() => expect(mocks.link).toHaveBeenCalledWith("c1"));
    expect(await screen.findByText("RXYZ2345")).toBeInTheDocument();
  });

  it("claims a code from the URL and immediately explains that it is still pending", async () => {
    renderPage("/referrals?code=RABCDEFG");
    await waitFor(() => expect(mocks.claim).toHaveBeenCalledWith("RABCDEFG"));
    expect(await screen.findByText(/invitation linked/i)).toBeInTheDocument();
    expect(screen.getByText(/becomes a verified referral only after/i)).toBeInTheDocument();
  });

  it("opens a public invite without an account", async () => {
    auth.token = null;
    mocks.publicCode.mockResolvedValue({
      data: {
        code: "RABCDEFG",
        campaign: {
          id: "c1", title: "Bring a new customer",
          description: "A new customer who buys anything counts.",
          region_slug: "nyanza", reward_points: 40, reward_kes: 150,
          remaining_referrals: 4,
        },
        merchant: { name: "Kisumu Chemist", region: "nyanza" },
        referrer: { name: "Achieng", handle: "achieng" },
        verification: "Only a verified receipt counts.",
      },
    });

    render(
      <MemoryRouter initialEntries={["/r/RABCDEFG"]}>
        <Routes>
          <Route path="/r/:code" element={<ReferralLandingPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Bring a new customer")).toBeInTheDocument();
    expect(screen.getByText(/Achieng invited you/i)).toBeInTheDocument();
    expect(screen.getByText("KSh 150")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue with this invitation/i })).toBeInTheDocument();
    expect(localStorage.getItem("brief-referral-code")).toBe("RABCDEFG");
  });
});
