// ---------------------------------------------------------------------------
// SCRAPE-NOTE PARSER — reads a pasted note into lead fields. Deterministic
// only: labeled lines plus Kenyan phone patterns. No AI, no guessing, no
// upgrading a bare handle into a link. Everything it picks lands in the form
// for a human to check; nothing saves itself. The raw note is always kept
// verbatim as the lead's note, so the picks stay auditable.
// ---------------------------------------------------------------------------

export interface ScrapePick {
  name?: string;
  contact?: string;
  category?: string;
  siteUrl?: string;
  note?: string;
  found: string[];
  missing: string[];
}

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu;
const KE_PHONE = /\b(?:\+254|0)(?:7\d{8}|1\d{8})\b/g;
const URL = /https?:\/\/[^\s)"']+/gi;

function cleanName(s: string): string {
  return s
    .replace(EMOJI, " ")
    .replace(/'s board$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseScrapeNote(raw: string): ScrapePick {
  const text = (raw ?? "").trim();
  const found: string[] = [];
  const missing: string[] = [];
  if (!text) return { found, missing: ["everything — the tray is empty"] };
  const labels: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([^:]{2,48}):\s*(.+?)\s*$/);
    if (m) labels[m[1].trim().toLowerCase()] = m[2].trim();
  }
  const pick: ScrapePick = { found, missing };
  // Name: brand line first, then account, then board title — cleaned for the
  // form, raw kept in the note.
  const name = cleanName(
    labels["brand logo name"] || labels["brand"] || labels["account name"] || labels["board title"] || "",
  );
  if (name) {
    pick.name = name.slice(0, 120);
    found.push(`name: ${pick.name}`);
  } else {
    missing.push("name");
  }
  // Contact: the phone line exactly as written, else any Kenyan numbers
  // found in the text.
  const phoneLine =
    labels["phone numbers (to order)"] || labels["phone numbers"] || labels["phone"] || labels["contact"] || "";
  const scanned = Array.from(new Set(text.match(KE_PHONE) ?? []));
  if (phoneLine) {
    pick.contact = phoneLine.slice(0, 120);
    found.push(`contact: ${pick.contact}`);
  } else if (scanned.length > 0) {
    pick.contact = scanned.join(" / ").slice(0, 120);
    found.push(`contact: ${pick.contact}`);
  } else {
    missing.push("contact");
  }
  // Category: the category line as written. The form takes free text with
  // suggestions, so an unknown category is typed, never forced into a list.
  const cat = (labels["category"] || "").trim();
  if (cat) {
    pick.category = cat.slice(0, 80);
    found.push(`category: ${pick.category}`);
  } else {
    missing.push("category");
  }
  // Site link: only a real http(s) URL. A bare handle stays in the note.
  const urls = text.match(URL) ?? [];
  const firstUrl = urls[0];
  if (firstUrl) {
    pick.siteUrl = firstUrl.slice(0, 300);
    found.push(`site link: ${pick.siteUrl}`);
  } else {
    missing.push("site link");
  }
  missing.push("photo — take one below");
  pick.note = text.slice(0, 4000);
  found.push("note holds the pasted text verbatim");
  return pick;
}
