import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ReceiptsPage from "@/pages/payments/ReceiptsPage";
import { receiptsAPI } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  receiptsAPI: { list: vi.fn(), one: vi.fn() },
  apiError: (_error, fallback) => fallback,
}));

const ROWS = [
  {
    id: "i1", entity_type: "stock_movement_payment", amount_ksh: 4500, provider: "MPESA",
    status: "completed", mpesa_receipt: "SJK4ABCD12", psp_api_ref: "COL-1",
    created_at: "2026-10-24T08:00:00", completed_at: "2026-10-24T08:01:10", failure_reason: null,
  },
  {
    id: "i2", entity_type: "stock_movement_payment", amount_ksh: 2000, provider: "MPESA",
    status: "pending", mpesa_receipt: null, psp_api_ref: "COL-2",
    created_at: "2026-10-25T07:00:00", completed_at: null, failure_reason: null,
  },
  {
    id: "i3", entity_type: "chama_deposit", amount_ksh: 1000, provider: "MPESA",
    status: "failed", mpesa_receipt: null, psp_api_ref: "COL-3",
    created_at: "2026-10-23T09:00:00", completed_at: null, failure_reason: "Insufficient funds",
  },
];

const renderPage = () =>
  render(
    <MemoryRouter>
      <ReceiptsPage />
    </MemoryRouter>
  );

describe("Receipts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear(); // the page caches the last good list per account
  });

  it("shows the provider's receipt only when the payment is settled", async () => {
    receiptsAPI.list.mockResolvedValue({ data: ROWS });
    renderPage();

    expect(await screen.findByText("Receipt SJK4ABCD12")).toBeInTheDocument();
    // Pending and failed attempts must say so rather than show a blank receipt.
    expect(screen.getAllByText(/No receipt yet/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/No receipt — the payment did not complete/).length).toBeGreaterThan(0);
    // Total paid counts only settled rows (the row itself also shows the amount).
    expect(screen.getAllByText("KES 4,500")).toHaveLength(2);
    expect(screen.getAllByText("KES 2,000")).toHaveLength(1);
  });

  it("explains a failed payment and offers a way to get help", async () => {
    receiptsAPI.list.mockResolvedValue({ data: ROWS });
    renderPage();

    expect(await screen.findByText("Insufficient funds")).toBeInTheDocument();
    expect(screen.getAllByText(/Get help with this payment/).length).toBe(2); // pending + failed
    expect(screen.getAllByText(/Refund and dispute policy/).length).toBe(2);
  });

  it("filters to one state without refetching", async () => {
    receiptsAPI.list.mockResolvedValue({ data: ROWS });
    renderPage();
    await screen.findByText("Receipt SJK4ABCD12");

    fireEvent.click(screen.getByRole("button", { name: "Failed" }));
    await waitFor(() => expect(screen.queryByText("Receipt SJK4ABCD12")).not.toBeInTheDocument());
    expect(screen.getByText("Insufficient funds")).toBeInTheDocument();
    expect(receiptsAPI.list).toHaveBeenCalledTimes(1);
  });

  it("says there is nothing yet instead of showing an empty list", async () => {
    receiptsAPI.list.mockResolvedValue({ data: [] });
    renderPage();
    expect(await screen.findByText("No payments yet")).toBeInTheDocument();
  });

  it("can be retried after a failure", async () => {
    receiptsAPI.list.mockRejectedValueOnce(new Error("offline"));
    renderPage();
    expect(await screen.findByText("Receipts could not be loaded")).toBeInTheDocument();

    receiptsAPI.list.mockResolvedValueOnce({ data: ROWS });
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    await waitFor(() => expect(screen.getByText("Receipt SJK4ABCD12")).toBeInTheDocument());
  });

  it("shows the saved list offline and warns that a payment may still settle", async () => {
    receiptsAPI.list.mockResolvedValueOnce({ data: ROWS });
    const first = renderPage();
    await screen.findByText("Receipt SJK4ABCD12");
    first.unmount();

    receiptsAPI.list.mockClear();
    const onlineSpy = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    renderPage();

    expect(await screen.findByText("You are offline")).toBeInTheDocument();
    expect(screen.getByText("Receipt SJK4ABCD12")).toBeInTheDocument();
    expect(screen.getByText(/A payment can still settle while you are offline/)).toBeInTheDocument();
    expect(receiptsAPI.list).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Refresh receipts/ })).toBeDisabled();

    onlineSpy.mockRestore();
  });
});
