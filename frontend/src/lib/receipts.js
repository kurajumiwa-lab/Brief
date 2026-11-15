/**
 * RECEIPTS — the smallest honest version of a rewards engine.
 *
 * A KRA eTIMS receipt carries a QR code. The code is data, not a photograph,
 * so the phone can read it without a cloud OCR bill and without sending the
 * receipt anywhere. We parse what the code actually contains and refuse to
 * invent the rest: a QR that is only an opaque verification link produces a
 * record with a link, not a made-up total.
 *
 * The mechanic that makes this a *local merchant* network rather than a generic
 * loyalty card: a receipt is worth the most while you are still in the shop.
 * Value falls with time — full inside 15 minutes, then 70%, 40%, 15%, nothing
 * after a week. It gives people a reason to scan at the counter, which is where
 * a shopkeeper can see it happen, and it stops a shoe box of old receipts from
 * becoming a points farm.
 */

export const FRESHNESS = [
  { key: "fresh", minutes: 15, multiplier: 1, label: "Still in the shop — full value" },
  { key: "hour", minutes: 60, multiplier: 0.7, label: "Within the hour — 70% value" },
  { key: "day", minutes: 60 * 24, multiplier: 0.4, label: "Within 24 hours — 40% value" },
  { key: "week", minutes: 60 * 24 * 7, multiplier: 0.15, label: "Within 7 days — 15% value" },
  { key: "expired", minutes: Infinity, multiplier: 0, label: "Older than 7 days — no points" },
];

const KEY_ALIASES = {
  invoice: [
    "controlunitinvoicenumber", "controlunitinvoiceno", "cuin", "invoicenumber",
    "invoiceno", "invoice", "receiptnumber", "receiptno", "receipt", "billnumber",
    "controlnumber", "transactionnumber",
  ],
  pin: ["tradersystempin", "merchantpin", "businesspin", "krapin", "pin", "supplierpin"],
  merchant: [
    "merchantname", "tradename", "businessname", "tradername", "sellername",
    "suppliername", "shopname", "merchant",
  ],
  total: [
    "totalamount", "totalgrossamount", "grosstotal", "grandtotal", "receipttotal",
    "total", "amount", "amountpaid",
  ],
  issued_at: [
    "issuedat", "issueddate", "invoicedate", "transactiondate", "purchasedate",
    "date", "timestamp", "datetime", "time",
  ],
  tax: ["taxamount", "totalTax", "totaltax", "vat", "vatamount"],
  token: ["data", "token", "signature", "verify", "verification", "code"],
};

const normKey = (key) =>
  String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const cleanText = (value) =>
  typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();

function pick(map, aliases) {
  for (const alias of aliases) {
    const value = map[normKey(alias)];
    if (value != null && String(value).trim() !== "") return value;
  }
  return null;
}

function parseAmount(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value)
    .replace(/kes|ksh|shs?/gi, "")
    .replace(/[,\s]/g, "")
    .replace(/[^\d.-]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const direct = Date.parse(text);
  if (Number.isFinite(direct)) return new Date(direct).toISOString();

  // eTIMS and receipt printers commonly use DD/MM/YYYY, sometimes with a time.
  const match = text.match(
    /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (match) {
    const [, day, month, year, hour = "0", minute = "0", second = "0"] = match;
    const date = new Date(
      Number(year), Number(month) - 1, Number(day),
      Number(hour), Number(minute), Number(second),
    );
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  return null;
}

function toMap(input) {
  if (!input || typeof input !== "object") return {};
  const map = {};
  for (const [key, value] of Object.entries(input)) {
    if (value && typeof value === "object" && !Array.isArray(value)) continue;
    map[normKey(key)] = value;
  }
  return map;
}

function fromUrl(raw) {
  try {
    const url = new URL(raw);
    const map = {};
    for (const [key, value] of url.searchParams.entries()) map[normKey(key)] = value;
    // Some verification links put their payload after a hash.
    if (url.hash.includes("?")) {
      for (const [key, value] of new URLSearchParams(url.hash.split("?").slice(1).join("?")).entries()) {
        map[normKey(key)] = value;
      }
    }
    return { map, pathname: url.pathname, url: `${url.origin}${url.pathname}` };
  } catch {
    return null;
  }
}

function fromKeyValue(raw) {
  const map = {};
  const pairs = raw.split(/[&;|]/).filter(Boolean);
  for (const pair of pairs) {
    const index = pair.indexOf("=");
    if (index < 1) continue;
    const key = pair.slice(0, index);
    const value = pair.slice(index + 1);
    try {
      map[normKey(key)] = decodeURIComponent(value);
    } catch {
      map[normKey(key)] = value;
    }
  }
  return map;
}

/**
 * Read a QR payload. Accepts a KRA verification URL with query parameters, a
 * JSON object, a `key=value&…` string, or a plain receipt link. The returned
 * case is always the same shape, so the scanner never branches on source.
 */
export function parseReceiptPayload(raw) {
  const text = cleanText(raw);
  if (!text) return { ok: false, error: "There is nothing to read yet." };

  let map = {};
  let verificationUrl = null;
  let pathname = "";

  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      const value = Array.isArray(parsed) ? parsed[0] : parsed;
      map = toMap(value);
    } catch {
      return { ok: false, error: "That QR code is not valid JSON." };
    }
  } else if (/^https?:\/\//i.test(text)) {
    const fromLink = fromUrl(text);
    if (!fromLink) return { ok: false, error: "That link could not be read." };
    map = fromLink.map;
    pathname = fromLink.pathname;
    verificationUrl = text;
  } else if (text.includes("=")) {
    map = fromKeyValue(text);
  } else {
    return {
      ok: false,
      error: "That code is not a receipt. Point the camera at the QR printed on the receipt.",
    };
  }

  let invoice = cleanText(pick(map, KEY_ALIASES.invoice)) || "";
  let pin = cleanText(pick(map, KEY_ALIASES.pin)) || "";

  // DigiTax puts the trader invoice number in the path:
  // https://etims.ke/r/<business_id>/<trader_invoice_number>
  if (!invoice && pathname) {
    const digi = pathname.match(/^\/r\/[^/]+\/([^/]+)/);
    if (digi) {
      try { invoice = decodeURIComponent(digi[1]); } catch { invoice = digi[1]; }
    }
  }
  const merchant = cleanText(pick(map, KEY_ALIASES.merchant)) || "";
  const total = parseAmount(pick(map, KEY_ALIASES.total));
  const issuedAt = parseDate(pick(map, KEY_ALIASES.issued_at));
  const tax = parseAmount(pick(map, KEY_ALIASES.tax));
  const token = cleanText(pick(map, KEY_ALIASES.token)) || "";

  // KRA's own link carries `Data=<KRA PIN><branch><signature>` as one opaque
  // string. The PIN is the only field we can honestly recover without a server
  // call; the invoice number and total remain on the printed receipt.
  if (!pin && token) {
    const kra = token.match(/^([APap]\d{9}[A-Za-z])/);
    if (kra) pin = kra[1].toUpperCase();
  }

  if (!invoice && !pin && total == null && !verificationUrl) {
    return {
      ok: false,
      error: "This code does not contain receipt details. Use the receipt's own QR code.",
    };
  }

  return {
    ok: true,
    receipt: {
      invoice,
      pin,
      merchant: merchant || (pin ? `Merchant ${pin.slice(-4)}` : "Local merchant"),
      total,
      tax,
      issued_at: issuedAt,
      verification_url: verificationUrl,
      token,
      // "verified" here means the QR itself carried the merchant and invoice.
      // It is not a KRA verification call; that is a server step.
      verified: Boolean(invoice && pin && total != null),
      source: verificationUrl ? "qr_link" : "qr",
    },
    missing: [
      !invoice && "invoice",
      !pin && "merchant PIN",
      total == null && "total",
    ].filter(Boolean),
  };
}

export const receiptKey = (receipt = {}) =>
  [receipt.pin, receipt.invoice].filter(Boolean).join(":") ||
  receipt.token ||
  receipt.verification_url ||
  `${receipt.merchant}:${receipt.total}`;

/** Full value in the shop, then a falling share. Never negative. */
export function receiptValue({ total, issued_at, scanned_at = new Date().toISOString() } = {}) {
  const amount = Number(total);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { base: 0, multiplier: 0, points: 0, freshness: FRESHNESS[FRESHNESS.length - 1], ageMinutes: null };
  }

  const base = Math.max(1, Math.floor(amount / 50));
  const issued = issued_at ? Date.parse(issued_at) : NaN;
  const scanned = Date.parse(scanned_at);
  const ageMinutes = Number.isFinite(issued) && Number.isFinite(scanned)
    ? Math.max(0, (scanned - issued) / 60000)
    : null;

  // A receipt with no date cannot prove it is fresh. It keeps a modest share
  // rather than pretending to be full value or punishing the user for a
  // merchant's weak print.
  const freshness = ageMinutes == null
    ? { key: "undated", minutes: null, multiplier: 0.5, label: "Date missing — half value" }
    : FRESHNESS.find((step) => ageMinutes <= step.minutes) || FRESHNESS[FRESHNESS.length - 1];

  const points = Math.round(base * freshness.multiplier);
  return { base, multiplier: freshness.multiplier, points, freshness, ageMinutes };
}

/** The map of shops a person has actually paid, built from their receipts. */
export function merchantStats(receipts = []) {
  const byMerchant = new Map();
  for (const receipt of receipts) {
    const key = receipt.pin || receipt.merchant || "unknown";
    const current = byMerchant.get(key) || {
      key,
      name: receipt.merchant || "Local merchant",
      pin: receipt.pin || "",
      visits: 0,
      spend: 0,
      points: 0,
      lastAt: null,
    };
    current.visits += 1;
    current.spend += Number(receipt.total) || 0;
    current.points += Number(receipt.points) || 0;
    if (!current.lastAt || String(receipt.scanned_at) > String(current.lastAt)) {
      current.lastAt = receipt.scanned_at;
    }
    byMerchant.set(key, current);
  }
  return [...byMerchant.values()].sort((a, b) => b.spend - a.spend || b.visits - a.visits);
}

export function networkSummary(receipts = []) {
  const merchants = merchantStats(receipts);
  return {
    merchants: merchants.length,
    receipts: receipts.length,
    spend: receipts.reduce((sum, receipt) => sum + (Number(receipt.total) || 0), 0),
    points: receipts.reduce((sum, receipt) => sum + (Number(receipt.points) || 0), 0),
    fresh: receipts.filter((receipt) => receipt.freshness === "fresh").length,
  };
}

const FRESHNESS_LABEL = Object.fromEntries(FRESHNESS.map((step) => [step.key, step.label]));

export const freshnessLabel = (key) => {
  if (!key || key === "undated") return "Date missing — half value";
  return FRESHNESS_LABEL[key] || "value recorded";
};

/**
 * A server row, in the shape this device already uses.
 *
 * The mapping is explicit because the two records answer different questions:
 * the local row remembers how the person scanned (`raw_payload`, `sync`), and
 * the server row knows the authoritative points and the global identity.
 * Keeping both means a sync can replace the numbers without losing the evidence.
 */
export function receiptFromServer(row = {}) {
  return {
    id: row.id,
    server_id: row.id,
    merchant: row.merchant_name || "Local merchant",
    pin: row.merchant_pin || "",
    invoice: row.invoice_no || "",
    total: row.total,
    tax: row.tax,
    issued_at: row.issued_at,
    scanned_at: row.scanned_at,
    status: row.status || "partial",
    points: Number(row.points) || 0,
    base_points: Number(row.base_points) || 0,
    freshness: row.freshness || "unknown",
    freshness_label: freshnessLabel(row.freshness),
    source: row.source || "qr",
    verified: row.status === "verified",
    verification_url: row.verification_url || null,
    region: row.region || null,
    raw_payload: null,
    sync: "synced",
    synced: true,
  };
}

/** The body the server accepts. No points, no status — it decides those. */
export function serverReceiptBody(receipt = {}) {
  if (receipt.source === "manual") {
    return {
      source: "manual",
      merchant_name: receipt.merchant,
      total: receipt.total,
      merchant_pin: receipt.pin || undefined,
      invoice_no: receipt.invoice || undefined,
      region: receipt.region || undefined,
    };
  }
  if (!receipt.raw_payload) return null;
  return {
    payload: receipt.raw_payload,
    total: receipt.total,
    region: receipt.region || undefined,
  };
}

export const formatKes = (value) =>
  `KES ${Math.round(Number(value) || 0).toLocaleString("en-KE")}`;

/** The readable slug used by `/invite/<shop>`; the server slugifies the same way. */
export const merchantSlug = (name = "") =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

export const maskPin = (pin = "") =>
  pin ? `${pin.slice(0, 2)}••••${pin.slice(-2)}` : "";

export function isDuplicate(receipts = [], candidate = {}) {
  const key = receiptKey(candidate);
  return Boolean(key) && receipts.some((receipt) => receiptKey(receipt) === key);
}
