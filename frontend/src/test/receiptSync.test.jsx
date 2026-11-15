import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/receiptsApi", () => ({
  receiptsAPI: {
    ledger: vi.fn(),
    submit: vi.fn(),
  },
}));

import { receiptsAPI } from "@/lib/receiptsApi";
import { receiptFromServer, serverReceiptBody } from "@/lib/receipts";
import { useAuthStore } from "@/stores/authStore";
import { useReceiptStore } from "@/stores/receiptStore";
import { useReceiptSync } from "@/hooks/useReceiptSync";

const serverRow = (overrides = {}) => ({
  id: "srv-1",
  merchant_name: "Milimani Chemist",
  merchant_pin: "P051234567X",
  invoice_no: "INV-1",
  total: 1250,
  tax: null,
  issued_at: new Date().toISOString(),
  scanned_at: new Date().toISOString(),
  status: "verified",
  points: 25,
  base_points: 25,
  freshness: "fresh",
  source: "qr",
  verification_url: null,
  region: "nyanza",
  ...overrides,
});

function Probe() {
  const { syncing } = useReceiptSync();
  return <span data-testid="state">{syncing ? "syncing" : "idle"}</span>;
}

describe("receipt server sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useReceiptStore.getState().clear();
    useAuthStore.setState({ token: "test-token", ready: true, vendor: null });
  });

  it("maps a server row without losing the freshness label", () => {
    const row = receiptFromServer(serverRow());
    expect(row).toMatchObject({
      merchant: "Milimani Chemist",
      pin: "P051234567X",
      invoice: "INV-1",
      points: 25,
      freshness_label: "Still in the shop — full value",
      status: "verified",
      sync: "synced",
    });
  });

  it("sends the raw QR for the server to parse, and typed fields for a manual record", () => {
    expect(serverReceiptBody({
      source: "qr", raw_payload: "Pin=P051234567X&Invoice=1&Total=500", total: 500,
    })).toEqual({ payload: "Pin=P051234567X&Invoice=1&Total=500", total: 500, region: undefined });
    expect(serverReceiptBody({
      source: "manual", merchant: "Kiosk", total: 500, pin: "", invoice: "",
    })).toMatchObject({ source: "manual", merchant_name: "Kiosk", total: 500 });
    // A legacy local row with no raw evidence cannot be passed off as a QR.
    expect(serverReceiptBody({ source: "qr", merchant: "Old" })).toBeNull();
  });

  it("keeps a device-only row while taking the server's points and receipts", () => {
    useReceiptStore.getState().addReceipt({
      merchant: "Kondele Kiosk",
      total: 500,
      issued_at: new Date().toISOString(),
      source: "manual",
      verified: false,
    });
    useReceiptStore.getState().hydrateFromServer({
      receipts: [serverRow()],
      summary: { points: 25 },
      balance: { awarded: 25, spent: 0, available: 25 },
    });

    const state = useReceiptStore.getState();
    expect(state.points).toBe(25);
    expect(state.balance.available).toBe(25);
    expect(state.receipts.map((row) => row.merchant)).toEqual(
      expect.arrayContaining(["Milimani Chemist", "Kondele Kiosk"]),
    );
  });

  it("pushes a pending manual receipt and marks it synced", async () => {
    useReceiptStore.getState().addReceipt({
      merchant: "Kondele Kiosk",
      total: 500,
      issued_at: new Date().toISOString(),
      source: "manual",
      verified: false,
    });
    receiptsAPI.ledger.mockResolvedValue({
      data: { receipts: [], summary: { points: 0 }, balance: { available: 0 } },
    });
    receiptsAPI.submit.mockResolvedValue({
      data: {
        receipt: serverRow({
          merchant_name: "Kondele Kiosk", merchant_pin: null, invoice_no: null,
          total: 500, status: "manual", points: 0, base_points: 0, source: "manual",
        }),
      },
    });

    render(<Probe />);
    await waitFor(() => expect(receiptsAPI.submit).toHaveBeenCalledTimes(1));
    expect(receiptsAPI.submit.mock.calls[0][0]).toMatchObject({
      source: "manual", merchant_name: "Kondele Kiosk", total: 500,
    });
    await waitFor(() => {
      expect(useReceiptStore.getState().receipts.every((row) => row.sync === "synced")).toBe(true);
    });
    expect(screen.getByTestId("state")).toBeInTheDocument();
  });
});
