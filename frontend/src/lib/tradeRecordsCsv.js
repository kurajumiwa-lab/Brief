// A CSV of the *displayed* server-bounded page. Re-fetching on download could
// export different rows if an order arrived or changed state in the meantime.
// This is a vendor's working record, never a receipt or a tax document.
const DISCLAIMER = "This is your record of trades on Brief_. It is not a receipt, an invoice, or a tax document.";
const COLUMNS = [
  "date", "reference", "counterparty handle", "item", "quantity", "unit",
  "unit price KES", "total KES", "goods status", "settlement status",
];

function cell(value) {
  const text = value == null ? "" : String(value);
  // Escaping a CSV quote is not enough: Excel-like viewers evaluate fields
  // starting with formula operators, including after leading whitespace.
  const safe = /^[\s\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function tradeRecordsCsv(page) {
  if (!Array.isArray(page?.items) || page.items.length > 100) {
    throw new Error("Export requires one loaded record page (up to 100 trades)");
  }
  const rows = [
    [DISCLAIMER], COLUMNS,
    ...page.items.map((row) => [
      row.date, row.reference, row.counterparty_handle, row.item,
      row.quantity, row.unit, row.unit_price_kes, row.total_kes,
      row.goods_status, row.settlement_status,
    ]),
  ];
  return new Blob([rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n"], {
    type: "text/csv;charset=utf-8",
  });
}
