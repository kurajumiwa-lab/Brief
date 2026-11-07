import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { trustAPI } from "@/lib/api";
import TrustBrowsePage from "@/pages/trust/TrustBrowsePage";
import TrustBranchPage from "@/pages/trust/TrustBranchPage";
import TrustMePage from "@/pages/trust/TrustMePage";
import { scoreText, POINTS_NOTE } from "@/pages/trust/trustCore";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal()),
  trustAPI: {
    branches: vi.fn(), branch: vi.fn(), reviews: vi.fn(), mine: vi.fn(), addBranch: vi.fn(),
    issueToken: vi.fn(), review: vi.fn(), points: vi.fn(), services: vi.fn(), redeem: vi.fn(),
  },
}));

const shop = (over = {}) => ({
  id: "b1", vendor_id: "v1", country_code: "KE", branch_name: "Kondele Stores",
  address_text: "Kondele road", latitude: null, longitude: null, status: "active",
  verification_level: 2, reputation: { score: null, review_count: 0 }, ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("checked shops page", () => {
  it("shows shops, and says plainly when a shop has no reviews yet", async () => {
    trustAPI.branches.mockResolvedValue({ data: { branches: [shop()] } });
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

describe("shop page: rating", () => {
  const renderShop = () => render(
    <MemoryRouter initialEntries={["/trust/branches/b1"]}>
      <Routes><Route path="/trust/branches/:id" element={<TrustBranchPage />} /></Routes>
    </MemoryRouter>,
  );

  beforeEach(() => {
    trustAPI.branch.mockResolvedValue({ data: { branch: shop(), reputation: { score: null, review_count: 0 } } });
    trustAPI.reviews.mockResolvedValue({ data: { reviews: [] } });
  });

  it("asks for a star first", async () => {
    renderShop();
    fireEvent.click(await screen.findByRole("button", { name: "Publish my rating" }));
    expect(await screen.findByText("Tap a star rating first.")).toBeInTheDocument();
    expect(trustAPI.review).not.toHaveBeenCalled();
  });

  it("publishes a rating with no till code, and says the points were added", async () => {
    trustAPI.review.mockResolvedValue({ data: { points_earned: 20 } });
    renderShop();
    fireEvent.click(await screen.findByRole("button", { name: "4 stars" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish my rating" }));
    await waitFor(() => expect(trustAPI.review).toHaveBeenCalledWith("b1", { rating: 4 }));
    expect(await screen.findByText(/20 points were added/)).toBeInTheDocument();
  });

  it("sends the till code when one is typed", async () => {
    trustAPI.review.mockResolvedValue({ data: { points_earned: 20 } });
    renderShop();
    fireEvent.click(await screen.findByRole("button", { name: "5 stars" }));
    fireEvent.change(screen.getByLabelText(/Till code/), { target: { value: "TKN-AB12-CD34-EF56" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish my rating" }));
    await waitFor(() => expect(trustAPI.review).toHaveBeenCalledWith("b1", { rating: 5, transaction_token: "TKN-AB12-CD34-EF56" }));
  });

  it("asks a visitor who is not signed in to sign in, without an error", async () => {
    trustAPI.review.mockRejectedValue({ response: { status: 401 } });
    renderShop();
    fireEvent.click(await screen.findByRole("button", { name: "2 stars" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish my rating" }));
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });
});

describe("my shops and points page", () => {
  const setup = ({ services = [], shops = [], points = 0 } = {}) => {
    trustAPI.points.mockResolvedValue({ data: { balance_points: points, note: POINTS_NOTE, entries: [] } });
    trustAPI.services.mockResolvedValue({ data: { services } });
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

  it("offers a till code only for a checked shop", async () => {
    setup({
      shops: [
        { id: "s1", branch_name: "Waiting shop", country_code: "KE", status: "pending" },
        { id: "s2", branch_name: "Checked shop", country_code: "UG", status: "active" },
      ],
    });
    expect(await screen.findByText("Waiting shop")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Get a till code" })).toHaveLength(1);
  });
});
