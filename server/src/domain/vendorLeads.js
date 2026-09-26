// ---------------------------------------------------------------------------
// VENDOR LEADS — the digitized manual entry of shops.
//
// A lead is a shop somebody met on the street: a photo, a name, a contact, a
// category, maybe a site link. It is captured by a scout (any signed-in
// account) and it is deliberately NOT a shop, NOT a vendor, and NOT an
// enterprise. There is no cap on how many leads an account can capture: the
// constraint this replaces is the old "one enterprise per account" rule,
// which stays exactly where it is (too many readers assume it to move).
//
// The lead's own state machine, and nothing else's:
//
//   captured → validated → claimed
//        ↘ dropped
//
// - captured: ink is dry, produce is not confirmed. A captured lead cannot
//   take orders and is never shown to buyers as a shop.
// - validated: produce (or a real order) was linked by an explicit command
//   that names a REAL row — a capability, a request, or a Work Order. A
//   guessed id fails closed. Validated still means "produce confirmed", not
//   "shop open" and not "trusted".
// - claimed: reserved. The handover where the actual vendor takes over is a
//   later phase with its own identity proof; no transition writes it yet.
// - dropped: the scout's own bin, with a reason. Dropped is terminal.
//
// Exposure terms (the money for showing the shop) are recorded only when an
// operator explicitly sets them: amount, period, note, setter, timestamp.
// There are no default amounts and no inferred prices anywhere in this file.
//
// First domain written directly against
// docs/AGREEMENT-STATE-INTEGRITY-CONTRACT.md: idempotent create, explicit
// causes, side-effect-free reads, history on every transition.
// ---------------------------------------------------------------------------
import { store, newId } from "../store.js";
import * as v from "./supplyValidation.js";

export const LEAD_STATUSES = ["captured", "validated", "claimed", "dropped"];

// causeType → the collection the cause id MUST exist in.
export const LEAD_CAUSES = {
  capability: "capabilities",
  request: "requests",
  workOrder: "workOrders",
};

export const EXPOSURE_PERIODS = ["once", "weekly", "monthly"];

const LEAD_FIELDS = [
  "name",
  "contact",
  "category",
  "photo",
  "siteUrl",
  "note",
  "idempotencyKey",
  "source",
  "lat",
  "lon",
];

function optText(value, max, name) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === "" ? null : v.text(s, max, name);
}

function siteLink(value) {
  const u = optText(value, 300, "siteUrl");
  if (u === null) return null;
  if (!/^https?:\/\/.+\..+/.test(u))
    v.fail("siteUrl must be a full http(s) link.", 422, "bad_url");
  return u;
}

function materialOf(input) {
  return {
    name: v.text(input.name, 120, "name", 2).trim(),
    contact: v.text(input.contact, 120, "contact", 3).trim(),
    category: v.text(input.category, 80, "category", 2).trim(),
    photo: optText(input.photo, 200, "photo"),
    siteUrl: siteLink(input.siteUrl),
  };
}

export function createLead(actorId, input = {}) {
  v.actor(actorId);
  v.fields(input, LEAD_FIELDS, "lead");
  const m = materialOf(input);
  const note =
    input.note === undefined || input.note === null
      ? ""
      : v.text(String(input.note), 4000, "note");
  const key =
    input.idempotencyKey === undefined || input.idempotencyKey === null
      ? null
      : v.text(String(input.idempotencyKey), 120, "idempotencyKey");
  const source =
    input.source === undefined || input.source === null
      ? "manual"
      : v.choice(String(input.source), ["manual", "scrape-note"], "source");
  // Coordinates arrive as a pair from the scout's GPS, or not at all. A
  // half pin is refused rather than stored lopsided.
  let lat = null;
  let lon = null;
  if (input.lat !== undefined || input.lon !== undefined) {
    if (typeof input.lat !== "number" || typeof input.lon !== "number")
      v.fail("lat and lon come as a pair of numbers.", 422, "bad_coords");
    lat = v.num(input.lat, "lat", -90, 90);
    lon = v.num(input.lon, "lon", -180, 180);
  }
  if (key) {
    const dupe = store.find(
      "vendorLeads",
      (l) => l.scoutId === actorId && l.idempotencyKey === key,
    );
    if (dupe) {
      const same =
        dupe.name === m.name &&
        dupe.contact === m.contact &&
        dupe.category === m.category &&
        (dupe.photo ?? null) === (m.photo ?? null) &&
        (dupe.siteUrl ?? null) === (m.siteUrl ?? null);
      if (!same)
        v.fail(
          "That reference was already used for a different lead.",
          409,
          "idempotency_key_reused",
        );
      return { lead: dupe, replayed: true };
    }
  }
  const now = new Date().toISOString();
  const row = {
    id: newId("vlead"),
    scoutId: actorId,
    ...m,
    note,
    source,
    lat,
    lon,
    status: "captured",
    produce: null,
    exposureTerms: null,
    idempotencyKey: key,
    history: [v.event(actorId, "lead_captured", ["name", "contact", "category"])],
    createdAt: now,
    updatedAt: now,
  };
  return {
    lead: store.transaction(() => store.insert("vendorLeads", row)),
    replayed: false,
  };
}

export function listLeads(actorId) {
  v.actor(actorId);
  return store
    .filter("vendorLeads", (l) => l.scoutId === actorId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function getLead(actorId, id) {
  v.actor(actorId);
  const row = store.lookup("vendorLeads", id);
  if (!row || row.scoutId !== actorId)
    v.fail("lead not found", 404, "not_found");
  return row;
}

export function validateLead(actorId, id, input = {}) {
  const lead = getLead(actorId, id);
  if (lead.status !== "captured")
    v.fail(
      `Only a captured lead can be validated; this one is ${lead.status}.`,
      409,
      "bad_lead_state",
    );
  v.fields(input, ["causeType", "causeId"], "validation");
  const causeType = v.choice(input.causeType, Object.keys(LEAD_CAUSES), "causeType");
  const causeId = v.text(input.causeId, 120, "causeId", 1);
  const cause = store.lookup(LEAD_CAUSES[causeType], causeId);
  if (!cause)
    v.fail(
      "That record does not exist, so it cannot validate this lead.",
      404,
      "cause_not_found",
    );
  const now = new Date().toISOString();
  return store.transaction(() =>
    store.update("vendorLeads", id, {
      status: "validated",
      produce: { kind: causeType, id: causeId, at: now, by: actorId },
      history: [
        ...lead.history,
        v.event(actorId, "lead_validated", ["status", "produce"]),
      ],
    }),
  );
}

export function setExposureTerms(actorId, id, input = {}) {
  const lead = getLead(actorId, id);
  if (lead.status === "dropped")
    v.fail("A dropped lead takes no terms.", 409, "bad_lead_state");
  v.fields(input, ["amountKes", "period", "note"], "exposureTerms");
  const amountKes = v.num(input.amountKes, "amountKes", 1, 1e9);
  if (!Number.isInteger(amountKes))
    v.fail("amountKes must be a whole number of shillings.", 422, "bad_terms");
  const period = v.choice(input.period, EXPOSURE_PERIODS, "period");
  const note =
    input.note === undefined || input.note === null
      ? ""
      : v.text(String(input.note), 500, "note");
  const now = new Date().toISOString();
  return store.transaction(() =>
    store.update("vendorLeads", id, {
      exposureTerms: { amountKes, period, note, setBy: actorId, setAt: now },
      history: [
        ...lead.history,
        v.event(actorId, "exposure_terms_set", ["exposureTerms"]),
      ],
    }),
  );
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function mintCode() {
  let s = "";
  for (let i = 0; i < 5; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

/**
 * A pickup code: five unambiguous characters a poster can read over the
 * phone so a courier can find the shop's pin and storefront photo. Minted
 * only on pinned leads, only by the scout who captured them. Idempotent:
 * asking twice returns the same code.
 */
export function mintLeadCode(actorId, id) {
  const lead = getLead(actorId, id);
  if (typeof lead.lat !== "number" || typeof lead.lon !== "number")
    v.fail("A pickup code needs a pin — drop one on the lead first.", 422, "code_needs_pin");
  if (lead.code) return lead;
  return store.transaction(() => {
    for (let i = 0; i < 25; i++) {
      const code = mintCode();
      if (!store.find("vendorLeads", (l) => l.code === code)) {
        return store.update("vendorLeads", id, {
          code,
          history: [...lead.history, v.event(actorId, "lead_code_minted", ["code"])],
        });
      }
    }
    v.fail("No code available right now — try again.", 503, "code_exhausted");
  });
}

/**
 * Resolves a code to the minimum a courier needs: name, pin and photo.
 * Contact, note, terms and scout stay private — the vendor never consented
 * to a listing, so the code opens a door, not a dossier. Dropped leads
 * resolve to nothing.
 */
export function resolveLeadCode(actorId, code) {
  v.actor(actorId);
  const key = String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!key) v.fail("Type the code the poster gave you.", 422, "bad_code");
  const lead = store.find("vendorLeads", (l) => l.code === key);
  if (!lead || lead.status === "dropped" || typeof lead.lat !== "number" || typeof lead.lon !== "number")
    v.fail("No shop answers to that code.", 404, "code_not_found");
  return {
    code: lead.code,
    name: lead.name,
    category: lead.category,
    photo: lead.photo ?? null,
    lat: lead.lat,
    lon: lead.lon,
    status: lead.status,
  };
}

export function dropLead(actorId, id, input = {}) {
  const lead = getLead(actorId, id);
  if (lead.status === "claimed")
    v.fail(
      "A claimed lead belongs to the vendor now; it cannot be dropped.",
      409,
      "bad_lead_state",
    );
  if (lead.status === "dropped") return lead;
  v.fields(input, ["reason"], "drop");
  const reason =
    input.reason === undefined || input.reason === null
      ? ""
      : v.text(String(input.reason), 300, "reason");
  return store.transaction(() =>
    store.update("vendorLeads", id, {
      status: "dropped",
      history: [
        ...lead.history,
        v.event(actorId, reason ? `lead_dropped:${reason}` : "lead_dropped", ["status"]),
      ],
    }),
  );
}
