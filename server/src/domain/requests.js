// Canonical demand/input primitive. Vault requests remain event-scoped tasks.
// No supplier/listing is required: capability, stock, logistics and sourcing
// access can all fulfil demand. No matching, quotes or verification are invented.
import { generateForRequest } from "./matching.js";
import { createHash } from "node:crypto";
import { store, newId } from "../store.js";
import { recordAudit } from "../routes/helpers.js";
import { readFile } from "./upload.js";
import { todayKey } from '../dayBoundary.js';

import { announce } from './engine/announce.js';

export const REQUEST_STATUSES = [
  "draft",
  "open",
  "matching",
  "quoted",
  "ready_for_work",
  "in_progress",
  "completed",
  "cancelled",
  "expired",
];
export const SUPPLY_ROLES = ["direct_supplier", "verified_sourcing_agent"];
export const SOURCE_KINDS = [
  "direct_supplier",
  "distributor",
  "manufacturer",
  "sourcing_agent",
  "referral",
  "local_stockist",
  "logistics_provider",
];
export const SPEC_FIELDS = [
  "material",
  "dimensions",
  "color",
  "brandRequirements",
  "qualityRequirements",
  "packaging",
  "deliveryRequirements",
  "certifications",
  "minimumOrderRequirements",
  "otherNotes",
];
const TRANSITIONS = {
  draft: ["open", "cancelled"],
  open: ["matching", "cancelled"],
  matching: ["cancelled"],
  quoted: ["cancelled"],
};
const TEXT = {
  title: 180,
  description: 5000,
  category: 100,
  subcategory: 100,
  unit: 40,
  location: 240,
  deliveryLocation: 300,
};
const ENUMS = {
  requesterType: ["business", "individual"],
  urgency: ["flexible", "standard", "urgent"],
  preferredSupplierType: ["any", ...SUPPLY_ROLES],
  visibility: ["private", "public"],
};
const NUMBERS = ["quantity", "budgetMin", "budgetMax"];
const FIELDS = [
  ...Object.keys(TEXT),
  ...Object.keys(ENUMS),
  ...NUMBERS,
  "currency",
  "requiredBy",
  "requirements",
  "specifications",
  "attachments",
  "businessContext",
  "origin",
];
export class RequestError extends Error {
  constructor(message, status = 400, code = "validation_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (message, status, code) => {
  throw new RequestError(message, status, code);
};
function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${name} must be an object`);
}
function keys(value, allowed, name) {
  object(value, name);
  if (Object.keys(value).some((k) => !allowed.includes(k)))
    fail(`${name} contains unsupported fields`);
}
function text(value, max, field) {
  if (typeof value !== "string" || value.length > max)
    fail(`${field} must be text of at most ${max} characters`);
  return value.trim();
}
function number(value, field, positive = false) {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1e12 ||
    (positive && value === 0)
  )
    fail(
      `${field} must be ${positive ? "positive" : "non-negative"} and at most 1 trillion`,
    );
  return value;
}
function actor(userId) {
  if (!userId) fail("authentication required", 401, "no_token");
}
function own(userId, id) {
  actor(userId);
  const row = store.find(
    "requests",
    (r) => r.id === id && r.requesterId === userId,
  );
  if (!row) fail("request not found", 404, "not_found");
  return row;
}
function validate(input, userId) {
  keys(input, FIELDS, "request");
  const out = {};
  for (const [field, value] of Object.entries(input)) {
    if (field in TEXT) out[field] = text(value, TEXT[field], field);
    else if (field in ENUMS) {
      if (!ENUMS[field].includes(value)) fail(`invalid ${field}`);
      out[field] = value;
    } else if (NUMBERS.includes(field))
      out[field] = number(value, field, field === "quantity");
    else if (field === "currency") {
      if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value))
        fail("currency must be a three-letter uppercase code");
      try {
        if (!Intl.supportedValuesOf("currency").includes(value))
          fail("unsupported currency");
      } catch (e) {
        if (e instanceof RequestError) throw e;
      }
      out.currency = value;
    } else if (field === "requiredBy") {
      if (
        value !== null &&
        (typeof value !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value)
      )
        fail("requiredBy must be a valid calendar date (YYYY-MM-DD)");
      out.requiredBy = value;
    } else if (field === "requirements") {
      if (!Array.isArray(value) || value.length > 12) fail('At most 12 structured requirements are allowed');
      const seen=new Set(); out.requirements=value.map(item=>{
        keys(item,['id','label','category','quantity','unit'],'requirement');
        const id=text(item.id,80,'requirement id'), label=text(item.label,180,'requirement label');
        if(!id||!label||seen.has(id))fail('Requirement IDs must be distinct and labels nonempty');seen.add(id);
        return {id,label,category:text(item.category??'',100,'requirement category'),quantity:number(item.quantity??null,'requirement quantity',true),unit:text(item.unit??'',40,'requirement unit')};
      });
    } else if (field === "specifications") {
      keys(value, SPEC_FIELDS, field);
      out[field] = Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, text(v, 1000, k)]),
      );
    } else if (field === "businessContext") {
      keys(
        value,
        [
          "companyName",
          "industry",
          "location",
          "buyingFrequency",
          "recurringQuantity",
          "recurringUnit",
          // Table-banking provenance: a collective request carries the id +
          // name of the group that placed it, so the whole Request->Match->
          // Quote->Work chain can attribute demand to a group, not one member.
          "tableBankingId",
          "tableBankingName",
        ],
        field,
      );
      out[field] = Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          k,
          k === "recurringQuantity" ? number(v, k, true) : text(v, 240, k),
        ]),
      );
    } else if (field === "origin") {
      // An existing public discovery object may generate demand, not ownership.
      keys(value, ["objectId"], field);
      const id = text(value.objectId, 120, "origin.objectId");
      if (
        !store.find("objects", (o) => o.id === id && o.publication === "public")
      )
        fail("origin must refer to a public discovery object");
      out.origin = { objectId: id };
    } else if (field === "attachments") {
      if (!Array.isArray(value) || value.length > 8)
        fail("at most 8 image attachments are allowed");
      const seen = new Set();
      out.attachments = value.map((a) => {
        keys(a, ["uploadId"], "attachment");
        const id = text(a.uploadId, 120, "uploadId");
        const file = readFile(id);
        if (!file.ok || file.row.ownerId !== userId || !['public','private_request'].includes(file.row.purpose ?? 'public') || seen.has(id))
          fail("attachments must be distinct, available images you uploaded");
        seen.add(id);
        return { uploadId: id };
      });
    }
  }
  return out;
}
function check(row, publishing = false) {
  if (!row.title || row.title.length < 5)
    fail("Describe what you need in a title of at least 5 characters");
  if (
    row.budgetMin !== null &&
    row.budgetMax !== null &&
    row.budgetMin > row.budgetMax
  )
    fail("Minimum budget cannot exceed maximum budget");
  if (row.status !== "draft") {
    if (row.description.length < 10)
      fail("Add a short description of at least 10 characters");
    if (!row.location) fail("Add a location before submitting");
  }
  if (
    publishing &&
    row.requiredBy &&
    row.requiredBy < todayKey()
  )
    fail("Choose a deadline today or later before submitting");
}
function event(actorId, action, fromStatus, toStatus, changedFields = []) {
  return {
    id: newId("reqevt"),
    actorId,
    action,
    fromStatus,
    toStatus,
    changedFields,
    at: new Date().toISOString(),
  };
}
function audit(row, e) {
  try {
    recordAudit(`request_${e.action}`, {
      actorId: e.actorId,
      objectType: "request",
      objectId: row.id,
      before: e.fromStatus,
      after: {
        status: row.status,
        revision: row.revision,
        changedFields: e.changedFields,
      },
    });
  } catch (err) {
    console.error(
      "Request saved with embedded history; secondary audit unavailable",
      err,
    );
  }
}
function view(row) {
  const { creationKey, creationFingerprint, matchingState, ...publicRow } = row;
  return structuredClone({
    ...publicRow,
    attachments: row.attachments.map((a) => {
      const f = readFile(a.uploadId);
      return {
        ...a,
        available: f.ok,
        private: f.row?.purpose === 'private_request',
        name: f.row?.originalName || "Request image",
        url: f.ok && f.row.purpose !== 'private_request' ? `/api/media/file/${a.uploadId}` : null,
      };
    }),
  });
}
export function createRequest(userId, input) {
  actor(userId);
  keys(input, [...FIELDS, "intent", "idempotencyKey"], "request");
  const { intent = "draft", idempotencyKey = null, ...fields } = input;
  if (
    idempotencyKey !== null &&
    (typeof idempotencyKey !== "string" ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey))
  )
    fail("invalid idempotencyKey");
  if (!["draft", "submit"].includes(intent))
    fail("intent must be draft or submit");
  const at = new Date().toISOString();
  const row = {
    id: newId("req"),
    requesterId: userId,
    title: "",
    description: "",
    category: "",
    subcategory: "",
    quantity: null,
    unit: "",
    budgetMin: null,
    budgetMax: null,
    currency: "KES",
    location: "",
    deliveryLocation: "",
    requiredBy: null,
    urgency: "standard",
    specifications: {},
    requirements: [],
    attachments: [],
    preferredSupplierType: "any",
    requesterType: "business",
    businessContext: {},
    origin: null,
    visibility: "private",
    ...validate(fields, userId),
    status: intent === "submit" ? "open" : "draft",
    createdAt: at,
    updatedAt: at,
    revision: 1,
  };
  check(row, intent === "submit");
  // Retry-safe create using the same owner-scoped convention as Orders.
  // A changed payload with the same key is a conflict, not a silent overwrite.
  if (idempotencyKey) {
    const stable = (value) =>
      Array.isArray(value)
        ? value.map(stable)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.keys(value)
                .sort()
                .map((k) => [k, stable(value[k])]),
            )
          : value;
    const demand = Object.fromEntries(FIELDS.map((k) => [k, row[k]]));
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(stable({ ...demand, intent })))
      .digest("hex");
    const existing = store.find(
      "requests",
      (r) => r.requesterId === userId && r.creationKey === idempotencyKey,
    );
    if (existing) {
      if (existing.creationFingerprint !== fingerprint)
        fail(
          "This form was already saved with different details. Open My Requests to edit the saved Request.",
          409,
          "idempotency_conflict",
        );
      return view(existing);
    }
    row.creationKey = idempotencyKey;
    row.creationFingerprint = fingerprint;
  }
  row.history = [event(userId, "created", null, row.status)];
  // Lifecycle history is in the SAME atomic document write as the request.
  store.insert("requests", row);
  audit(row, row.history[0]);
  // THE FIRST EVENT OF THE CHAIN. Before this, a request's whole life was a
  // private array inside its own row: nothing could subscribe to it, nothing
  // could replay it, and no screen could show it without reading the row.
  announce("request_created", {
    actorId: userId,
    entityKind: "request",
    entityId: row.id,
    correlationId: row.id,
    metadata: { requestId: row.id, status: row.status, capabilityId: row.capabilityId ?? null, title: row.title ?? null }
  });
  // Submitted-and-complete is its own fact: the status machine only reaches
  // `open` after the completeness check passed.
  if (row.status === "open") {
    announce("request_validated", {
      actorId: userId, entityKind: "request", entityId: row.id, correlationId: row.id,
      metadata: { requestId: row.id, status: row.status, checks: "passed" }
    });
  }
  return view(row);
}
// Request state -> the event that says so. One map, next to the machine it
// describes, so a new status cannot be added without someone deciding what it
// is called in the log.
const REQUEST_SIGNAL = {
  open: "request_validated",
  matching: "request_matching",
  quoted: "request_quoted",
  ready_for_work: "request_ready_for_work",
  in_progress: "request_in_progress",
  completed: "request_completed",
  cancelled: "request_cancelled",
  expired: "request_expired"
};

export function getRequest(userId, id) {
  return view(own(userId, id));
}
export function listRequests(userId) {
  actor(userId);
  return store
    .filter("requests", (r) => r.requesterId === userId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(view);
}
function revision(row, value) {
  if (!Number.isSafeInteger(value) || value < 1) fail("revision is required");
  if (row.revision !== value)
    fail(
      "This request changed. Reload it before saving.",
      409,
      "revision_conflict",
    );
}
export function updateRequest(userId, id, input) {
  const row = own(userId, id);
  keys(input, [...FIELDS, "revision"], "request");
  revision(row, input.revision);
  if (!["draft", "open", "matching", "quoted"].includes(row.status))
    fail("This request can no longer be edited", 409, "invalid_transition");
  const { revision: _, ...fields } = input;
  if (!Object.keys(fields).length) fail("No changes supplied");
  const patch = validate(fields, userId);
  check({ ...row, ...patch });
  // Past deadlines may remain on old requests, but cannot be newly assigned.
  if (
    patch.requiredBy &&
    patch.requiredBy !== row.requiredBy &&
    patch.requiredBy < todayKey()
  )
    fail("Choose a deadline today or later");
  const e = event(
    userId,
    "updated",
    row.status,
    row.status === "quoted" ? "matching" : row.status,
    Object.keys(patch),
  );
  const updated = store.update("requests", id, {
    ...patch,
    status: row.status === "quoted" ? "matching" : row.status,
    requirementsRevision: row.revision + 1,
    revision: row.revision + 1,
    history: [...row.history, e],
  });
  audit(updated, e);
  return view(updated);
}
export function changeRequestStatus(userId, id, input) {
  const row = own(userId, id);
  keys(input, ["status", "revision"], "status change");
  revision(row, input.revision);
  if (!TRANSITIONS[row.status]?.includes(input.status))
    fail("That status transition is not available", 409, "invalid_transition");
  if (input.status !== "cancelled")
    check({ ...row, status: input.status }, input.status === "open");
  const e = event(
    userId,
    input.status === "cancelled" ? "cancelled" : "status_changed",
    row.status,
    input.status,
  );
  return store.transaction(()=>{
    const updated = store.update("requests", id, {
      status: input.status, requirementsRevision: row.revision + 1, revision: row.revision + 1, history: [...row.history, e],
    });
    audit(updated,e);
    // EVERY transition is announced, including the ones with no UI. A state
    // machine whose moves are only visible in its own history column cannot be
    // watched, escalated from, or replayed.
    const announced = REQUEST_SIGNAL[input.status];
    if (announced) {
      announce(announced, {
        actorId: userId, entityKind: "request", entityId: id, correlationId: id,
        metadata: { requestId: id, from: row.status, to: input.status, revision: updated.revision }
      });
    }
    if(input.status==='matching')generateForRequest(userId,updated);
    return view(updated);
  });
}
