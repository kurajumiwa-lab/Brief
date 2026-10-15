import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const api = vi.hoisted(() => ({
  repeatable: vi.fn(), repeat: vi.fn(), records: vi.fn(), exportRecords: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  apiError: (err, fallback) => err?.response?.data?.detail || fallback,
  ordersAPI: api,
}));
vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => async () => true }));

import RepeatOrderPage from "@/pages/orders/RepeatOrderPage";
import TradeRecordsPage from "@/pages/orders/TradeRecordsPage";
import TradePulse from "@/components/home/TradePulse";
import { tradeRecordsCsv } from "@/lib/tradeRecordsCsv";

const candidate = {
  source_movement_id: "old-order", supplier_handle: "mama_mboga", supplier_name: "Mboga",
  item: "Tomatoes", sku: "TOM-1", unit: "crate", quantity: 2,
  last_unit_price_kes: 240.25, last_total_kes: 481, current_unit_price_kes: 260,
  available: 6, min_order_quantity: 1, last_ordered_at: "2026-10-10T10:00:00",
  unavailable_reason: null,
};
const record = {
  id: "old-order", reference: "old-order", date: "2026-10-10T10:00:00", direction: "incoming",
  counterparty_handle: "mama_mboga", item: "Tomatoes", quantity: 2, unit: "crate",
  unit_price_kes: 240.25, total_kes: 481, goods_status: "received", settlement_status: "not_applicable",
};
const list = { items: [record], next_cursor: null, summary: { recorded: 1, received: 1, needs_action: 0 },
  disclaimer: "This is your record of trades on Brief_. It is not a receipt, an invoice, or a tax document." };
const renderAt = (path, node) => render(
  <MemoryRouter initialEntries={[path]}><Routes>
    <Route path={path} element={node} />
    <Route path="/orders/:id" element={<Location />} />
  </Routes></MemoryRouter>,
);
function Location() { const location = useLocation(); return <p data-testid="location">{location.pathname}</p>; }
function readBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.repeatable.mockResolvedValue({ data: [candidate] });
  api.repeat.mockResolvedValue({ data: { movement_id: "new-order", status: "pending" } });
  api.records.mockResolvedValue({ data: list });
  api.exportRecords.mockResolvedValue({ data: new Blob(["CSV"]), headers: {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("repeat a known order", () => {
  it("shows last-vs-current price and requires explicit submit, with the same retry key", async () => {
    api.repeat.mockRejectedValueOnce({ message: "Network Error" });
    renderAt("/orders/repeat", <RepeatOrderPage />);
    expect(await screen.findByText(/last recorded Ksh.*240\.25/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review repeat" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/current posted price/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/481/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Quantity/)).toHaveValue(2);
    fireEvent.click(within(dialog).getByRole("button", { name: "Review & send" }));
    await waitFor(() => expect(api.repeat).toHaveBeenCalledTimes(1));
    expect(api.repeat.mock.calls[0][0]).toEqual({ source_movement_id: "old-order", quantity: 2, proposed_price: 240.25 });
    expect((await screen.findByRole("alert")).textContent).toMatch(/may already have reached the server/i);
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry same request" }));
    await waitFor(() => expect(api.repeat).toHaveBeenCalledTimes(2));
    expect(api.repeat.mock.calls[1][1]).toBe(api.repeat.mock.calls[0][1]);
    expect(await screen.findByTestId("location")).toHaveTextContent("/orders/new-order");
  });

  it("allows adjusting quantity after a definitive stock conflict instead of freezing the form", async () => {
    api.repeat.mockRejectedValueOnce({ response: { status: 409, data: { detail: "Only 1 crate left; adjust quantity" } } });
    renderAt("/orders/repeat", <RepeatOrderPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Review repeat" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Review & send" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Only 1 crate left; adjust quantity");
    expect(within(dialog).getByLabelText(/Quantity/)).toBeEnabled();
    fireEvent.change(within(dialog).getByLabelText(/Quantity/), { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Review & send" }));
    await waitFor(() => expect(api.repeat).toHaveBeenCalledTimes(2));
    expect(api.repeat.mock.calls[1][0].quantity).toBe(1);
    expect(api.repeat.mock.calls[1][1]).not.toBe(api.repeat.mock.calls[0][1]);
    expect(await screen.findByTestId("location")).toHaveTextContent("/orders/new-order");
  });

  it("keeps delisted stock visible but unrequestable", async () => {
    api.repeatable.mockResolvedValue({ data: [{ ...candidate, unavailable_reason: "This supplier has delisted this stock" }] });
    renderAt("/orders/repeat", <RepeatOrderPage />);
    expect(await screen.findByText(/delisted this stock/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review repeat" })).toBeDisabled();
  });
});

describe("vendor trade records", () => {
  it("escapes spreadsheet formulas and quotes, and refuses an uncapped export", async () => {
    const file = tradeRecordsCsv({ items: [{ ...record, item: '=2+2, "crate"', counterparty_handle: "@danger" }] });
    const csv = await readBlob(file);
    expect(csv.split("\r\n")[0]).toContain("not a receipt, an invoice, or a tax document");
    expect(csv).toContain('"\'=2+2, ""crate"""');
    expect(csv).toContain('"\'@danger"');
    expect(() => tradeRecordsCsv({ items: Array(101).fill(record) })).toThrow(/up to 100/);
  });

  it("keeps goods and settlement separate, exports only the displayed page", async () => {
    const oldCreate = URL.createObjectURL;
    const oldRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:page");
    URL.revokeObjectURL = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      renderAt("/orders/records", <TradeRecordsPage />);
      expect(await screen.findByText("Goods: received")).toBeInTheDocument();
      expect(screen.getByText("Settlement: not applicable")).toBeInTheDocument();
      expect(screen.getByText(/not a receipt, an invoice, or a tax document/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Export this page/i }));
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(api.exportRecords).not.toHaveBeenCalled(); // do not re-fetch a changed page
      const csv = await readBlob(URL.createObjectURL.mock.calls[0][0]);
      expect(csv).toContain("not a receipt, an invoice, or a tax document");
      expect(csv).toContain('"old-order","mama_mboga","Tomatoes","2","crate","240.25","481","received","not_applicable"');
      expect(screen.getByText(/CSV exports this page only/)).toBeInTheDocument();
    } finally {
      anchorClick.mockRestore();
      URL.createObjectURL = oldCreate;
      URL.revokeObjectURL = oldRevoke;
    }
  });

  it("preserves the last loaded page offline instead of presenting an invented result", async () => {
    renderAt("/orders/records", <TradeRecordsPage />);
    expect(await screen.findByText("Goods: received")).toBeInTheDocument();
    const connected = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    fireEvent(window, new Event("offline"));
    expect(screen.getByText(/last loaded view, not a live status/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Search item, SKU/), { target: { value: "fresh" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByText("Goods: received")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export this page/i })).toBeEnabled();
    expect(api.records).toHaveBeenCalledTimes(1);
    connected.mockRestore();
  });

  it("paginates by server cursor and does not silently replace an API failure with an empty record", async () => {
    api.records.mockResolvedValueOnce({ data: { ...list, next_cursor: "next-page" } }).mockRejectedValueOnce({ response: { data: { detail: "No connection" } } });
    renderAt("/orders/records", <TradeRecordsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Next" }));
    expect(await screen.findByText("No connection")).toBeInTheDocument();
    expect(api.records).toHaveBeenLastCalledWith({ q: "", cursor: "next-page", limit: 30 });
  });
});

describe("home trade overview", () => {
  it("has no zero-stat tiles before a trader's first order", async () => {
    api.records.mockResolvedValue({ data: { ...list, items: [], summary: { recorded: 0, received: 0, needs_action: 0 } } });
    renderAt("/", <TradePulse />);
    expect(await screen.findByText("Record your first trade")).toBeInTheDocument();
    expect(screen.queryByText("Orders recorded")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Find stock" })).toHaveAttribute("href", "/browse?type=goods");
  });

  it("links into the repeat and records loop after a real recorded order", async () => {
    renderAt("/", <TradePulse />);
    expect(await screen.findByText("Orders recorded")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Repeat an order/i })).toHaveAttribute("href", "/orders/repeat");
    expect(screen.getByRole("link", { name: /My records/i })).toHaveAttribute("href", "/orders/records");
  });
});
