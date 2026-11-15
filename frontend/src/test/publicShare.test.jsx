import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ token: null, vendor: null }));

vi.mock("@/lib/receiptsApi", () => ({
  receiptsAPI: {
    invite: vi.fn(),
    claimMerchant: vi.fn(),
  },
}));

vi.mock("@/lib/api", () => ({
  apiError: (err, fallback) => err?.response?.data?.detail || fallback,
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector) => selector(auth),
}));

import { receiptsAPI } from "@/lib/receiptsApi";
import InviteShopPage from "@/pages/trades/InviteShopPage";

const INVITE = {
  shop: { name: "Kisumu Fresh Mart", pin: "P051234567X", region: "Kisumu", claim_status: "unclaimed", verified: false },
  receipts: 3,
  title: "Kisumu Fresh Mart has 3 customer receipts waiting on Home Office",
  description: "Shoppers in Kisumu have scanned receipts from this shop.",
  invite_path: "/invite/kisumu-fresh-mart",
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/invite/kisumu-fresh-mart"]}>
      <Routes>
        <Route path="/invite/:slug" element={<InviteShopPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("the shop invite behind a WhatsApp card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.token = null;
    auth.vendor = null;
    receiptsAPI.invite.mockResolvedValue({ data: INVITE });
    receiptsAPI.claimMerchant.mockResolvedValue({ data: { merchant: { claim_status: "pending" } } });
  });

  it("shows a stranger the shop and why claiming needs a sign-in", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Kisumu Fresh Mart" })).toBeInTheDocument();
    expect(screen.getByText(/3 customer receipts were scanned/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in to claim/i })).toBeInTheDocument();
    expect(screen.queryByTestId("invite-claim-form")).not.toBeInTheDocument();
  });

  it("lets a signed-in person send a claim for review, not publish instantly", async () => {
    auth.token = "token";
    auth.vendor = { business_name: "Ogallo" };
    renderPage();

    const name = await screen.findByTestId("invite-name");
    expect(name).toHaveValue("Ogallo");
    fireEvent.change(screen.getByTestId("invite-phone"), { target: { value: "0712000111" } });
    fireEvent.click(screen.getByTestId("invite-claim"));

    await waitFor(() => expect(receiptsAPI.claimMerchant).toHaveBeenCalledWith(
      "P051234567X",
      expect.objectContaining({ name: "Ogallo", phone: "0712000111" }),
    ));
    expect(await screen.findByTestId("invite-pending")).toHaveTextContent(/claim sent/i);
    expect(screen.getByText(/before the page can publish/i)).toBeInTheDocument();
  });
});
