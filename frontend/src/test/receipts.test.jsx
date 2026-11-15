/**
 * RECEIPT REWARDS — the zero-API version.
 *
 * The product promise is narrow enough to test exactly:
 *
 *   1. a KRA eTIMS QR is data, and the phone can read it without a cloud OCR
 *      bill; a link that carries only an opaque token is not turned into a
 *      made-up receipt;
 *   2. value falls with the age of the receipt, so scanning at the counter is
 *      worth more than scanning a shoebox next month;
 *   3. one receipt earns once, and a typed receipt is a record, not points;
 *   4. the merchant network is built from money actually spent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  formatKes, merchantStats, networkSummary, parseReceiptPayload, receiptKey,
  receiptValue,
} from "@/lib/receipts";

const now = new Date("2026-11-14T12:00:00.000Z");
const minutesAgo = (minutes) => new Date(now.getTime() - minutes * 60000).toISOString();

const ETIMS_URL =
  "https://etims.kra.go.ke/common/link/etims/verify?TraderSystemPin=P051234567X" +
  "&ControlUnitInvoiceNumber=001234&TotalAmount=1,250.00&IssuedAt=" +
  encodeURIComponent(new Date().toISOString()) +
  "&MerchantName=Milimani%20Chemist";

describe("reading a receipt QR", () => {
  it("extracts the fields eTIMS puts in the link", () => {
    const parsed = parseReceiptPayload(ETIMS_URL);
    expect(parsed.ok).toBe(true);
    expect(parsed.receipt).toMatchObject({
      invoice: "001234",
      pin: "P051234567X",
      merchant: "Milimani Chemist",
      total: 1250,
      verified: true,
      source: "qr_link",
    });
    expect(parsed.missing).toEqual([]);
  });

  it("reads JSON and key/value payloads too", () => {
    const json = parseReceiptPayload(JSON.stringify({
      trader_system_pin: "P051234567X", control_unit_invoice_number: "77",
      total_amount: 900, merchant_name: "Kisumu Hardware",
    }));
    expect(json.receipt).toMatchObject({ invoice: "77", pin: "P051234567X", total: 900, verified: true });

    const kv = parseReceiptPayload("PIN=P0999;Invoice=88;Total=300;Merchant=Kondele Salon");
    expect(kv.receipt).toMatchObject({ pin: "P0999", invoice: "88", total: 300 });
  });

  it("recovers the seller PIN from KRA's opaque Data link", () => {
    const parsed = parseReceiptPayload(
      "https://etims.kra.go.ke/common/link/etims/receipt/indexEtimsReceiptData?Data=P051234567X01ABC123",
    );
    expect(parsed.receipt.pin).toBe("P051234567X");
    expect(parsed.receipt.total).toBeNull();
    expect(parsed.receipt.verified).toBe(false);
  });

  it("reads the invoice number from a DigiTax receipt link", () => {
    const parsed = parseReceiptPayload("https://etims.ke/r/42/INV-2024-001");
    expect(parsed.receipt.invoice).toBe("INV-2024-001");
    expect(parsed.receipt.merchant).toBe("Local merchant");
  });

  it("does not invent a total for an opaque verification link", () => {
    const parsed = parseReceiptPayload("https://etims.kra.go.ke/common/link/etims/abc123token");
    expect(parsed.ok).toBe(true);
    expect(parsed.receipt.total).toBeNull();
    expect(parsed.receipt.verified).toBe(false);
    expect(parsed.missing).toContain("total");
  });

  it("rejects a code that is not a receipt", () => {
    expect(parseReceiptPayload("just some words").ok).toBe(false);
    expect(parseReceiptPayload("").ok).toBe(false);
  });
});

describe("a receipt loses value after the shop", () => {
  it("pays full value while the receipt is still fresh", () => {
    const value = receiptValue({ total: 1250, issued_at: minutesAgo(10), scanned_at: now.toISOString() });
    expect(value.base).toBe(25);
    expect(value.freshness.key).toBe("fresh");
    expect(value.points).toBe(25);
  });

  it("falls through 70%, 40%, 15% and zero", () => {
    const at = (minutes) =>
      receiptValue({ total: 1250, issued_at: minutesAgo(minutes), scanned_at: now.toISOString() });

    expect(at(40).points).toBe(18); // 70% of 25
    expect(at(40).freshness.key).toBe("hour");
    expect(at(60 * 12).points).toBe(10); // 40%
    expect(at(60 * 24 * 3).points).toBe(4); // 15%
    expect(at(60 * 24 * 8).points).toBe(0);
    expect(at(60 * 24 * 8).freshness.key).toBe("expired");
  });

  it("keeps a modest share when the receipt has no readable date", () => {
    const value = receiptValue({ total: 1000, issued_at: null, scanned_at: now.toISOString() });
    expect(value.freshness.key).toBe("undated");
    expect(value.points).toBe(10);
  });
});

describe("the merchant network is built from receipts", () => {
  const rows = [
    { id: "1", merchant: "Milimani Chemist", pin: "P1", total: 500, points: 10, scanned_at: "2026-11-14T10:00:00Z" },
    { id: "2", merchant: "Milimani Chemist", pin: "P1", total: 300, points: 6, scanned_at: "2026-11-13T10:00:00Z" },
    { id: "3", merchant: "Kondele Salon", pin: "P2", total: 200, points: 4, scanned_at: "2026-11-12T10:00:00Z" },
  ];

  it("aggregates visits, spend and points per shop", () => {
    const stats = merchantStats(rows);
    expect(stats).toHaveLength(2);
    expect(stats[0]).toMatchObject({ name: "Milimani Chemist", visits: 2, spend: 800, points: 16 });
    expect(stats[1]).toMatchObject({ name: "Kondele Salon", visits: 1, spend: 200 });
  });

  it("summarises the network", () => {
    expect(networkSummary(rows)).toMatchObject({ merchants: 2, receipts: 3, spend: 1000, points: 20 });
  });

  it("recognises the same receipt by merchant PIN and invoice", () => {
    expect(receiptKey({ pin: "P1", invoice: "9" })).toBe("P1:9");
    expect(formatKes(800)).toContain("800");
  });
});

// ── the store and the scan sheet ──────────────────────────────────────────────
const { useReceiptStore } = await import("@/stores/receiptStore");
const initial = useReceiptStore.getState();

beforeEach(() => {
  useReceiptStore.setState({ ...initial, receipts: [], points: 0, lastAdded: null, status: "idle" });
  try { localStorage.clear(); } catch { /* no storage */ }
});

describe("the ledger", () => {
  it("adds a verified receipt once and awards the freshness value", () => {
    const parsed = parseReceiptPayload(ETIMS_URL);
    const added = useReceiptStore.getState().addReceipt(parsed.receipt, { scannedAt: now.toISOString() });
    expect(added.ok).toBe(true);
    expect(added.points).toBe(25);

    const again = useReceiptStore.getState().addReceipt(parsed.receipt, { scannedAt: now.toISOString() });
    expect(again.ok).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(useReceiptStore.getState().receipts).toHaveLength(1);
  });

  it("gives a typed receipt a row but no points", () => {
    const saved = useReceiptStore.getState().addReceipt({
      merchant: "Kondele Salon", invoice: "5", pin: "", total: 500,
      issued_at: now.toISOString(), verified: false, source: "manual",
    }, { scannedAt: now.toISOString() });
    expect(saved.ok).toBe(true);
    expect(saved.receipt.status).toBe("manual");
    expect(saved.points).toBe(0);
    expect(useReceiptStore.getState().points).toBe(0);
  });

  it("halves the value of a partial QR and refuses a receipt with no total", () => {
    const saved = useReceiptStore.getState().addReceipt({
      merchant: "Partial Shop", invoice: "7", pin: "", total: 1000,
      issued_at: now.toISOString(), verified: false, source: "qr",
    }, { scannedAt: now.toISOString() });
    expect(saved.points).toBe(10); // 20 base × 50%

    const refused = useReceiptStore.getState().addReceipt({
      merchant: "No total", invoice: "8", pin: "P8", total: null, verified: false, source: "qr",
    }, { scannedAt: now.toISOString() });
    expect(refused.ok).toBe(false);
    expect(refused.incomplete).toBe(true);
  });
});

describe("the scan sheet", () => {
  async function openScanner() {
    const { default: ReceiptScanner } = await import("@/components/receipts/ReceiptScanner");
    return render(<ReceiptScanner open onClose={() => {}} />);
  }

  it("takes a pasted eTIMS link through to a confirmed, earning receipt", async () => {
    const { default: ReceiptScanner } = await import("@/components/receipts/ReceiptScanner");
    render(<ReceiptScanner open onClose={() => {}} />);

    fireEvent.change(await screen.findByTestId("receipt-paste"), { target: { value: ETIMS_URL } });
    fireEvent.click(screen.getByRole("button", { name: /^read$/i }));

    expect(await screen.findByTestId("receipt-confirm")).toBeInTheDocument();
    expect(screen.getByText("Milimani Chemist")).toBeInTheDocument();
    expect(screen.getByTestId("receipt-points")).toHaveTextContent("25");

    fireEvent.click(screen.getByTestId("receipt-add"));
    expect(await screen.findByTestId("receipt-success")).toBeInTheDocument();
    await waitFor(() => expect(useReceiptStore.getState().points).toBe(25));
    // The raw code is kept so the server can parse the same evidence, rather
    // than trusting this phone's summary of it.
    expect(useReceiptStore.getState().receipts[0].raw_payload).toBe(ETIMS_URL);
    expect(useReceiptStore.getState().receipts[0].sync).toBe("pending");
  });

  it("types a receipt without pretending it earns points", async () => {
    await openScanner();
    fireEvent.click(await screen.findByTestId("receipt-manual-open"));
    const form = await screen.findByTestId("receipt-manual");

    fireEvent.change(within(form).getByLabelText(/^merchant$/i), { target: { value: "Kibuye Hardware" } });
    fireEvent.change(within(form).getByLabelText(/total paid/i), { target: { value: "700" } });
    fireEvent.click(screen.getByTestId("receipt-manual-add"));

    expect(await screen.findByTestId("receipt-success")).toHaveTextContent(/recorded/i);
    expect(useReceiptStore.getState().points).toBe(0);
    expect(useReceiptStore.getState().receipts[0].merchant).toBe("Kibuye Hardware");
    expect(useReceiptStore.getState().receipts[0].raw_payload).toBeNull();
    expect(useReceiptStore.getState().receipts[0].sync).toBe("pending");
  });
});

describe("the ledger screen", () => {
  it("shows the network, the receipts and an honest rewards shelf", async () => {
    const { default: ReceiptsView } = await import("@/components/receipts/ReceiptsView");
    const rows = [
      { id: "1", merchant: "Milimani Chemist", pin: "P0512", invoice: "001", total: 500, points: 10, scanned_at: "2026-11-14T10:00:00Z", freshness_label: "Still in the shop — full value" },
      { id: "2", merchant: "Kondele Salon", pin: "P0999", invoice: "002", total: 300, points: 3, scanned_at: "2026-11-13T10:00:00Z", freshness_label: "Within 24 hours — 40% value" },
    ];
    render(
      <MemoryRouter>
        <ReceiptsView receipts={rows} points={13} onScan={() => {}} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("receipt-points-total")).toHaveTextContent("13");
    expect(screen.getAllByTestId("merchant-row")).toHaveLength(2);
    expect(screen.getAllByTestId("receipt-row")).toHaveLength(2);
    expect(screen.getByText(/points are banked/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /scan a receipt/i })).toBeInTheDocument();
    expect(screen.getByTestId("receipt-share").getAttribute("href")).toMatch(
      /^https:\/\/wa\.me\/\?text=/,
    );
    expect(screen.getByText(/no pos integration/i)).toBeInTheDocument();
    expect(screen.getByText(/rotating four-digit code/i)).toBeInTheDocument();
  });
});

describe("the home-feed card", () => {
  it("puts the scanner in the feed and opens it from there", async () => {
    const { default: TodayView } = await import("@/components/home/TodayView");
    const { rankFor } = await import("@/config/identity");
    const rank = rankFor({ vendor: { business_name: "Ogallo", vendor_handle: "ogallo" }, identity: {} });

    render(
      <MemoryRouter>
        <TodayView name="Ogallo" rank={rank} region={null} />
      </MemoryRouter>,
    );

    const card = await screen.findByTestId("receipt-card");
    expect(within(card).getByRole("heading", { name: /receipt rewards/i })).toBeInTheDocument();
    fireEvent.click(within(card).getByTestId("receipt-card-scan"));
    expect(await screen.findByTestId("receipt-scanner")).toBeInTheDocument();
  });
});
