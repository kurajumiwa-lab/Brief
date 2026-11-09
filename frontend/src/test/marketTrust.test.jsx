import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { trustAPI } from "@/lib/api";
import { getCustomerKey } from "@/lib/customerKey";
import { t } from "@/lib/i18n";
import TrustBrowsePage from "@/pages/trust/TrustBrowsePage";
import TrustBranchPage from "@/pages/trust/TrustBranchPage";
import TrustMePage from "@/pages/trust/TrustMePage";
import TrustStaffPage from "@/pages/trust/TrustStaffPage";
import TrustMyReviewsPage from "@/pages/trust/TrustMyReviewsPage";
import { scoreText, POINTS_NOTE, FREE_LISTING_NOTE, checkedByText } from "@/pages/trust/trustCore";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal()),
  trustAPI: {
    branches: vi.fn(), branch: vi.fn(), reviews: vi.fn(), customerReview: vi.fn(), customerReviews: vi.fn(),
    customerProfile: vi.fn(), mine: vi.fn(), addBranch: vi.fn(), issueToken: vi.fn(), review: vi.fn(),
    points: vi.fn(), services: vi.fn(), redeem: vi.fn(), pendingBranches: vi.fn(), verify: vi.fn(),
    flaggedReviews: vi.fn(), moderateReview: vi.fn(), setDelivery: vi.fn(),
  },
}));

const shop = (over = {}) => ({
  id: "b1", vendor_id: "v1", country_code: "KE", branch_name: "Kondele Stores",
  address_text: "Kondele road", latitude: null, longitude: null, status: "active",
  verification_level: 2, reputation: { score: null, review_count: 0 }, ...over,
});

const noRep = { score: null, review_count: 0, verified_review_count: 0, service_average: null, product_average: null, raw_average: null };

beforeEach(() => {
  vi.clearAllMocks();
  trustAPI.flaggedReviews.mockResolvedValue({ data: { reviews: [] } });
  trustAPI.pendingBranches.mockResolvedValue({ data: { branches: [] } });
});

describe("checked shops page", () => {
  it("shows shops, and says plainly when a shop has no reviews yet", async () => {
    trustAPI.branches.mockResolvedValue({ data: { branches: [shop({ reputation: noRep })] } });
    render(<MemoryRouter><TrustBrowsePage /></MemoryRouter>);
    expect(await screen.findByText("Kondele Stores")).toBeInTheDocument();
    expect(screen.getByText(/Not enough reviews yet/)).toBeInTheDocument();
  });

  it("asks for shops in the chosen country only", async () => {
    trustAPI.branches.mockResolvedValue({ data: { branches: [] } });
    render(<MemoryRouter><TrustBrowsePage /></MemoryRouter>);
    await screen.findByText(/No checked shops/);
    fireEvent.click(screen.getByRole("button", { name: "Uganda" }));
    await waitFor(() => expect(trustAPI.branches).toHaveBeenLastCalledWith({ country: "UG", limit: 50 }));
  });

  it("formats a score honestly", () => {
    expect(scoreText({ score: 3.41, review_count: 3 })).toBe("3.4 out of 5 · 3 reviews");
    expect(scoreText({ score: 5, review_count: 1 })).toBe("5.0 out of 5 · 1 review");
    expect(scoreText(null)).toBe("Not enough reviews yet");
  });
});

describe("customer device key", () => {
  it("is created once, reused, and is long enough for the server", () => {
    const first = getCustomerKey();
    expect(first.length).toBeGreaterThanOrEqual(16);
    expect(getCustomerKey()).toBe(first);
  });
});

describe("shop page: customer review with a till code", () => {
  const renderShop = () => render(
    <MemoryRouter initialEntries={["/trust/branches/b1"]}>
      <Routes><Route path="/trust/branches/:id" element={<TrustBranchPage />} /></Routes>
    </MemoryRouter>,
  );

  beforeEach(() => {
    trustAPI.branch.mockResolvedValue({ data: { branch: shop(), reputation: noRep } });
    trustAPI.reviews.mockResolvedValue({ data: { reviews: [] } });
  });

  it("needs a till code before it sends anything", async () => {
    renderShop();
    fireEvent.click(await screen.findByRole("button", { name: "Publish my review" }));
    expect(await screen.findByText(/Enter the till code/)).toBeInTheDocument();
    expect(trustAPI.customerReview).not.toHaveBeenCalled();
  });

  it("needs all three star ratings", async () => {
    renderShop();
    fireEvent.change(await screen.findByLabelText(/Till code from your receipt/), { target: { value: "TKN-AB12-CD34-EF56" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish my review" }));
    expect(await screen.findByText(/Tap a star rating for service, product and your overall/)).toBeInTheDocument();
    expect(trustAPI.customerReview).not.toHaveBeenCalled();
  });

  it("sends the code and the three ratings, with no login", async () => {
    trustAPI.customerReview.mockResolvedValue({ data: { status: "published", message: "Thanks. Your review is published." } });
    renderShop();
    fireEvent.change(await screen.findByLabelText(/Till code from your receipt/), { target: { value: "TKN-AB12-CD34-EF56" } });
    fireEvent.click(screen.getByRole("button", { name: "Service: 4 stars" }));
    fireEvent.click(screen.getByRole("button", { name: "Product quality: 3 stars" }));
    fireEvent.click(screen.getByRole("button", { name: "Overall experience: 5 stars" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish my review" }));
    await waitFor(() => expect(trustAPI.customerReview).toHaveBeenCalledWith("b1", {
      transaction_code: "TKN-AB12-CD34-EF56", service_rating: 4, product_rating: 3, overall_rating: 5, comment: undefined,
    }));
    expect(await screen.findByText("Thanks. Your review is published.")).toBeInTheDocument();
  });

  it("tells the customer when a review is held for a check", async () => {
    trustAPI.customerReview.mockResolvedValue({ data: { status: "hidden_pending_review", message: "Thanks. Your review is being checked before it is published." } });
    renderShop();
    fireEvent.change(await screen.findByLabelText(/Till code from your receipt/), { target: { value: "TKN-AB12-CD34-EF56" } });
    fireEvent.click(screen.getByRole("button", { name: "Service: 2 stars" }));
    fireEvent.click(screen.getByRole("button", { name: "Product quality: 2 stars" }));
    fireEvent.click(screen.getByRole("button", { name: "Overall experience: 2 stars" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish my review" }));
    expect(await screen.findByText(/being checked before it is published/)).toBeInTheDocument();
  });

  it("shows the server's reason when a code does not work", async () => {
    trustAPI.customerReview.mockRejectedValue({ response: { status: 422, data: { detail: "That code has already been used or has expired." } } });
    renderShop();
    fireEvent.change(await screen.findByLabelText(/Till code from your receipt/), { target: { value: "TKN-AB12-CD34-EF56" } });
    fireEvent.click(screen.getByRole("button", { name: "Service: 4 stars" }));
    fireEvent.click(screen.getByRole("button", { name: "Product quality: 4 stars" }));
    fireEvent.click(screen.getByRole("button", { name: "Overall experience: 4 stars" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish my review" }));
    expect(await screen.findByText("That code has already been used or has expired.")).toBeInTheDocument();
  });
});

describe("verified and unverified reviews", () => {
  it("labels each review and shows the score breakdown", async () => {
    trustAPI.branch.mockResolvedValue({ data: { branch: shop(), reputation: { score: 4, review_count: 2, verified_review_count: 1, service_average: 4, product_average: 3.5, raw_average: 4 } } });
    trustAPI.reviews.mockResolvedValue({ data: { reviews: [
      { id: "r1", overall: 5, service: 5, product: 4, evidence_tier: "confirmed_token", reviewer: "Achieng", comment: null, created_at: "2026-11-07T10:00:00" },
      { id: "r2", overall: 3, service: null, product: null, evidence_tier: "unverified", reviewer: "Business", comment: null, created_at: "2026-11-07T11:00:00" },
    ] } });
    render(
      <MemoryRouter initialEntries={["/trust/branches/b1"]}>
        <Routes><Route path="/trust/branches/:id" element={<TrustBranchPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Verified visit")).toBeInTheDocument();
    expect(screen.getByText("Not verified")).toBeInTheDocument();
    expect(screen.getByText(/1 verified visit \(till code used\) · 1 not verified/)).toBeInTheDocument();
    expect(screen.getByText("Achieng")).toBeInTheDocument();
  });
});

describe("my shops and points page", () => {
  const setup = ({ services = [], shops = [], points = 0, entries = [] } = {}) => {
    trustAPI.points.mockResolvedValue({ data: { balance_points: points, note: POINTS_NOTE, entries } });
    trustAPI.services.mockResolvedValue({ data: { approved: services.length > 0, services } });
    trustAPI.mine.mockResolvedValue({ data: { branches: shops } });
    return render(<MemoryRouter><TrustMePage /></MemoryRouter>);
  };

  it("hides the exchange and my-shops sections when they are empty", async () => {
    setup();
    expect(await screen.findByText("Your points")).toBeInTheDocument();
    expect(screen.queryByLabelText("Exchange points")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("My shops")).not.toBeInTheDocument();
    expect(screen.getByText(POINTS_NOTE)).toBeInTheDocument();
  });

  it("exchanges points with a fresh Idempotency-Key for each click", async () => {
    const svc = { service_key: "booking_setup", title: "Booking page set-up help", points_cost: 40, countries: ["KE"] };
    trustAPI.redeem.mockResolvedValue({ data: { status: "redeemed" } });
    setup({ services: [svc], points: 40 });
    fireEvent.click(await screen.findByRole("button", { name: "Exchange" }));
    await waitFor(() => expect(trustAPI.redeem).toHaveBeenCalledTimes(1));
    const [body, key] = trustAPI.redeem.mock.calls[0];
    expect(body).toEqual({ service_key: "booking_setup", country: "KE" });
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThanOrEqual(8);
  });

  it("disables an exchange the account cannot afford", async () => {
    const svc = { service_key: "directory_listing", title: "Directory listing", points_cost: 100, countries: ["KE"] };
    setup({ services: [svc], points: 20 });
    expect(await screen.findByRole("button", { name: "Not enough points" })).toBeDisabled();
  });

  it("asks for a receipt reference before making a till code, and only for a checked shop", async () => {
    trustAPI.issueToken.mockResolvedValue({ data: { token: "TKN-1111-2222-3333", expires_at: "2026-11-07T12:00:00", detail: "x" } });
    setup({
      shops: [
        { id: "s1", branch_name: "Waiting shop", country_code: "KE", status: "pending" },
        { id: "s2", branch_name: "Checked shop", country_code: "UG", status: "active" },
      ],
    });
    expect(await screen.findByText("Waiting shop")).toBeInTheDocument();
    const make = screen.getAllByRole("button", { name: "Make a till code for this sale" });
    expect(make).toHaveLength(1);
    fireEvent.click(make[0]);
    expect(await screen.findByText(/Enter the receipt or sale reference first/)).toBeInTheDocument();
    expect(trustAPI.issueToken).not.toHaveBeenCalled();
  });

  it("lists points history with a plus sign for rewards", async () => {
    setup({ entries: [{ entry_type: "earn", points: 20, reason_key: "accepted_review", country_code: "KE", created_at: "2026-11-07T10:00:00" }], points: 20 });
    expect(await screen.findByText("Rating published")).toBeInTheDocument();
    expect(screen.getByText("+20")).toBeInTheDocument();
  });

  it("says services cannot be exchanged yet while the catalogue is unapproved", async () => {
    setup();
    expect(await screen.findByText(/Nothing can be exchanged yet/)).toBeInTheDocument();
  });
});

describe("my reviews page (customer)", () => {
  it("lists the customer's own reviews, including held ones, and lets them set a name", async () => {
    trustAPI.customerReviews.mockResolvedValue({ data: { display_name: null, reviews: [
      { id: "x1", branch_id: "b1", branch_name: "Kondele Stores", country_code: "KE", overall: 5, service: 4, product: 5, status: "published", created_at: "2026-11-07T10:00:00" },
      { id: "x2", branch_id: "b2", branch_name: "Kampala Shop", country_code: "UG", overall: 2, service: 2, product: 2, status: "hidden_pending_review", created_at: "2026-11-07T11:00:00" },
    ] } });
    trustAPI.customerProfile.mockResolvedValue({ data: { display_name: "Achieng" } });
    render(<MemoryRouter><TrustMyReviewsPage /></MemoryRouter>);
    expect(await screen.findByText("Kondele Stores")).toBeInTheDocument();
    expect(screen.getByText("Being checked")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Achieng" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(trustAPI.customerProfile).toHaveBeenCalledWith("Achieng"));
  });
});

describe("check desk (staff)", () => {
  const pending = { id: "b9", branch_name: "Nyalenda Duka", address_text: "Nyalenda", country_code: "KE" };
  const held = { id: "r7", branch_name: "Kondele Stores", country_code: "KE", overall: 1, service: 1, product: 2, comment: "Long wait", reasons: ["code_used_too_fast"] };

  it("says plainly when the visitor is not staff", async () => {
    trustAPI.pendingBranches.mockRejectedValue({ response: { status: 403 } });
    render(<MemoryRouter><TrustStaffPage /></MemoryRouter>);
    expect(await screen.findByText("This page is for Brief staff only.")).toBeInTheDocument();
  });

  it("approves a shop with the chosen check method", async () => {
    trustAPI.pendingBranches.mockResolvedValue({ data: { branches: [pending] } });
    trustAPI.verify.mockResolvedValue({ data: {} });
    render(<MemoryRouter><TrustStaffPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(trustAPI.verify).toHaveBeenCalledWith("b9", {
      method: "storefront_photo", result: "approved", note: null,
    }));
  });

  it("will not reject a shop without a reason the owner can read", async () => {
    trustAPI.pendingBranches.mockResolvedValue({ data: { branches: [pending] } });
    render(<MemoryRouter><TrustStaffPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    expect(await screen.findByText(/at least 10 characters/)).toBeInTheDocument();
    expect(trustAPI.verify).not.toHaveBeenCalled();
  });

  it("shows held reviews with the reasons, and publishes only with a reason", async () => {
    trustAPI.pendingBranches.mockResolvedValue({ data: { branches: [] } });
    trustAPI.flaggedReviews.mockResolvedValue({ data: { reviews: [held] } });
    trustAPI.moderateReview.mockResolvedValue({ data: { status: "published" } });
    render(<MemoryRouter><TrustStaffPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("tab", { name: "Reviews held" }));
    expect(await screen.findByText("Till code used within seconds of being made")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByText(/at least 10 characters/)).toBeInTheDocument();
    expect(trustAPI.moderateReview).not.toHaveBeenCalled();
  });
});

describe("trust signals and free listing", () => {
  it("describes how a shop was checked from its level", () => {
    expect(checkedByText(3)).toBe("Checked by Brief staff: storefront photo or in-person visit.");
    expect(checkedByText(2)).toBe("Checked by Brief staff: business papers or confirmation from other businesses.");
  });

  it("shows the check on the shop page", async () => {
    trustAPI.branch.mockResolvedValue({ data: { branch: shop({ verification_level: 3 }), reputation: { score: null, review_count: 0 } } });
    trustAPI.reviews.mockResolvedValue({ data: { reviews: [] } });
    render(
      <MemoryRouter initialEntries={["/trust/branches/b1"]}>
        <Routes><Route path="/trust/branches/:id" element={<TrustBranchPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("checked-by-text")).toHaveTextContent(
      "Checked by Brief staff: storefront photo or in-person visit.",
    );
  });

  it("says listing is free on the add-shop form", async () => {
    trustAPI.points.mockResolvedValue({ data: { balance_points: 0, note: POINTS_NOTE, entries: [] } });
    trustAPI.services.mockResolvedValue({ data: { approved: false, services: [] } });
    trustAPI.mine.mockResolvedValue({ data: { branches: [] } });
    render(<MemoryRouter><TrustMePage /></MemoryRouter>);
    expect(await screen.findByTestId("free-listing-note")).toHaveTextContent(FREE_LISTING_NOTE);
    expect(FREE_LISTING_NOTE).toMatch(/free/);
  });
});

describe("Kiswahili on the public trust pages", () => {
  beforeEach(() => {
    localStorage.removeItem("brief-lang");
  });

  it("starts in English and switches to Kiswahili, then remembers the choice", async () => {
    trustAPI.branches.mockResolvedValue({ data: { branches: [] } });
    const { unmount } = render(<MemoryRouter><TrustBrowsePage /></MemoryRouter>);
    expect(await screen.findByText("Shops you can trust")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Kiswahili" }));
    expect(await screen.findByText("Maduka unayoweza kuamini")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kiswahili" })).toHaveAttribute("aria-pressed", "true");
    unmount();
    // a fresh visit on the same device opens in Kiswahili
    render(<MemoryRouter><TrustBrowsePage /></MemoryRouter>);
    expect(await screen.findByText("Maduka unayoweza kuamini")).toBeInTheDocument();
    localStorage.removeItem("brief-lang");
  });

  it("falls back to English for any string without a Swahili version", () => {
    expect(t("no.such.key", "sw")).toBe("no.such.key");
    expect(t("shop.publish", "sw")).toBe("Chapisha ukaguzi wangu");
    expect(t("shop.publish", "en")).toBe("Publish my review");
  });

  it("gives the shop check wording in Kiswahili", () => {
    expect(checkedByText(3, "sw")).toBe("Wafanyakazi wa Brief wameliangalia: picha ya duka au ziara ya ana kwa ana.");
    expect(checkedByText(3, "en")).toBe("Checked by Brief staff: storefront photo or in-person visit.");
  });
});

describe("how a shop delivers", () => {
  const rider = { area: "Kisii town", name: "Otieno", phone: "+254712345678" };

  it("owner: pick-up is always on, and a rider is saved with area, name and number", async () => {
    trustAPI.points.mockResolvedValue({ data: { balance_points: 0, note: POINTS_NOTE, entries: [] } });
    trustAPI.services.mockResolvedValue({ data: { approved: false, services: [] } });
    trustAPI.mine.mockResolvedValue({ data: { branches: [shop({ status: "pending", verification_level: 0,
      delivery: { options: ["pickup"], rider: null } })] } });
    trustAPI.setDelivery.mockResolvedValue({ data: { detail: "Delivery saved. Brief has not checked the rider." } });
    render(<MemoryRouter><TrustMePage /></MemoryRouter>);
    const pickup = await screen.findByRole("checkbox", { name: /Buyer collects at the shop/ });
    expect(pickup).toBeChecked();
    expect(pickup).toBeDisabled();
    fireEvent.click(screen.getByTestId("known-rider-b1"));
    fireEvent.change(screen.getByLabelText(/Where does this rider work/), { target: { value: "Kisii town" } });
    fireEvent.change(screen.getByLabelText(/Rider's name/), { target: { value: "Otieno" } });
    fireEvent.change(screen.getByLabelText(/Rider's phone number/), { target: { value: "0712 345 678" } });
    fireEvent.click(screen.getByRole("button", { name: "Save delivery" }));
    await waitFor(() => expect(trustAPI.setDelivery).toHaveBeenCalledTimes(1));
    expect(trustAPI.setDelivery).toHaveBeenCalledWith("b1", {
      options: ["pickup", "known_rider"], area: "Kisii town", rider_name: "Otieno", rider_phone: "0712 345 678",
    });
    expect(await screen.findByText(/Brief has not checked the rider/)).toBeInTheDocument();
  });

  it("owner: pick-up only sends pick-up and no rider details", async () => {
    trustAPI.points.mockResolvedValue({ data: { balance_points: 0, note: POINTS_NOTE, entries: [] } });
    trustAPI.services.mockResolvedValue({ data: { approved: false, services: [] } });
    trustAPI.mine.mockResolvedValue({ data: { branches: [shop({ delivery: { options: ["pickup", "known_rider"], rider } })] } });
    trustAPI.setDelivery.mockResolvedValue({ data: { detail: "Delivery saved." } });
    render(<MemoryRouter><TrustMePage /></MemoryRouter>);
    const box = await screen.findByTestId("known-rider-b1");
    expect(box).toBeChecked();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Save delivery" }));
    await waitFor(() => expect(trustAPI.setDelivery).toHaveBeenCalledWith("b1", { options: ["pickup"] }));
  });

  it("buyer: a shop with a known rider shows the rider, says Brief has not checked them, and says where the fee sits", async () => {
    trustAPI.branch.mockResolvedValue({ data: { branch: shop({ delivery: { options: ["pickup", "known_rider"], rider,
      fee_note: "", rider_checked_by_brief: false } }), reputation: noRep } });
    trustAPI.reviews.mockResolvedValue({ data: { reviews: [] } });
    render(<MemoryRouter initialEntries={["/trust/branches/b1"]}><Routes>
      <Route path="/trust/branches/:id" element={<TrustBranchPage />} /></Routes></MemoryRouter>);
    const line = await screen.findByTestId("delivery-line");
    expect(line).toHaveTextContent("Delivery: Collect at the shop · Rider you know, in Kisii town: Otieno");
    expect(line.textContent).not.toMatch(/254712345678/);
    expect(line).toHaveTextContent("Brief has not checked this rider.");
    expect(line).toHaveTextContent("The rider and the buyer agree the fee between them.");
  });

  it("buyer: a shop with pick-up only shows no rider", async () => {
    trustAPI.branch.mockResolvedValue({ data: { branch: shop({ delivery: { options: ["pickup"], rider: null } }), reputation: noRep } });
    trustAPI.reviews.mockResolvedValue({ data: { reviews: [] } });
    render(<MemoryRouter initialEntries={["/trust/branches/b1"]}><Routes>
      <Route path="/trust/branches/:id" element={<TrustBranchPage />} /></Routes></MemoryRouter>);
    const line = await screen.findByTestId("delivery-line");
    expect(line).toHaveTextContent("Delivery: Collect at the shop");
    expect(line).not.toHaveTextContent("Brief has not checked");
  });

  it("in Kiswahili the buyer line is in Kiswahili", async () => {
    localStorage.setItem("brief-lang", "sw");
    trustAPI.branch.mockResolvedValue({ data: { branch: shop({ delivery: { options: ["pickup"], rider: null } }), reputation: noRep } });
    trustAPI.reviews.mockResolvedValue({ data: { reviews: [] } });
    render(<MemoryRouter initialEntries={["/trust/branches/b1"]}><Routes>
      <Route path="/trust/branches/:id" element={<TrustBranchPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByTestId("delivery-line")).toHaveTextContent("Usafirishaji: Chukua dukani");
    localStorage.removeItem("brief-lang");
  });
});
