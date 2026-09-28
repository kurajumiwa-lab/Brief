import { createFromAccepted } from "./workOrders.js";
import { available } from "../features.js";
import { announce } from './engine/announce.js';
// Request commercial proposals. No payments, orders, chat threads or settlement.
import { store, newId } from "../store.js";
import * as v from "./supplyValidation.js";
import * as supply from "./supply.js";
import * as matching from "./matching.js";
import * as participantTrust from "./participantTrust.js";
import { recordAudit } from "../routes/helpers.js";
import {
  validate,
  editableTerms,
  expiry,
  RELATIONSHIPS,
  CURRENCIES,
  quantity,
} from "./quoteValidation.js";
const now = () => new Date().toISOString();
const reqVersion = matching.requestVersion;
const live = (r) => r && matching.activeDemand(r) && !r.acceptedQuote;
const missing = () => v.fail("Commercial record not found", 404, "not_found");
const event = (user, action, extra = {}) => ({
  ...v.event(user, action),
  ...extra,
});
function audit(id, e) {
  recordAudit(e.action, {
    actorId: e.actorId,
    objectType: "request_quote",
    objectId: id,
    after: { revision: e.revision, offerRevision: e.offerRevision },
    reason: e.reason ?? null,
  });
}
function demand(id) {
  return store.lookup("requests", id) ?? missing();
}
function owner(user, id) {
  v.actor(user);
  const r = demand(id);
  if (r.requesterId !== user) missing();
  return r;
}
function invitation(id) {
  return store.lookup("quoteRequests", id) ?? missing();
}
function rawQuote(id) {
  return store.lookup("requestQuotes", id) ?? missing();
}
function participant(user, i) {
  v.actor(user);
  if (i.participantUserId !== user) missing();
  supply.ownEnterprise(user, i.participantId);
}
function party(user, q) {
  v.actor(user);
  if (q.requesterId !== user) participant(user, q);
  return q;
}
function interested(i) {
  return store
    .indexed("requestParticipants", "requestId", i.requestId)
    .some(
      (x) =>
        x.origin === "participant_interest" &&
        x.participantId === i.participantId &&
        x.status === "interested" &&
        x.requestRevision === i.requestRevision &&
        x.supplyFingerprint === i.supplyFingerprint,
    );
}
function unavailable(i) {
  const r = demand(i.requestId);
  if (!live(r)) return "This Request is closed to new proposals.";
  if (i.requestRevision !== reqVersion(r))
    return "Requirements changed. The requester must refresh matches and request a new proposal.";
  try {
    if (
      matching.currentMatchSupply({
        participantId: i.participantId,
        capabilityIds: i.capabilityIds,
      }).fingerprint !== i.supplyFingerprint
    )
      return "Supply details changed. The requester must refresh matches and renew the quote request.";
  } catch {
    return "The matched capability is no longer available.";
  }
  return null;
}
function assertAvailable(i) {
  const why = unavailable(i);
  if (why) v.fail(why, 409, "stale_quote_request");
}
function publicTerms(t, userIsParticipant) {
  const { privateProvenance, ...shared } = t;
  return {
    ...shared,
    ...(userIsParticipant ? { privateProvenance } : {}),
    evidence: t.evidence
      .filter((e) => userIsParticipant || e.shareWithRequester)
      .map((e) => ({ ...e, verification: "participant_uploaded" })),
  };
}
export function status(q) {
  if (["accepted", "declined", "withdrawn"].includes(q.status)) return q.status;
  const offer = q.offers.at(-1);
  return offer && expiry(offer.terms.validUntil) <= Date.now()
    ? "expired"
    : q.status;
}
function view(user, q) {
  const supplier = user === q.participantUserId;
  if (!supplier && !q.offers.length) missing();
  const i = invitation(q.quoteRequestId),
    r = demand(q.requestId);
  const offer = q.offers.at(-1);
  const stale =
    unavailable(i) ||
    (offer &&
    (offer.requestRevision !== reqVersion(r) ||
      offer.supplyFingerprint !== i.supplyFingerprint)
      ? "This offer addresses earlier requirements or supply details. Request a revised quote."
      : null);
  return structuredClone({
    id: q.id,
    quoteRequestId: q.quoteRequestId,
    requestId: q.requestId,
    requesterId: q.requesterId,
    participantId: q.participantId,
    matchId: q.matchId,
    capabilityId: q.capabilityId,
    revision: q.revision,
    status: status(q),
    requestRevision: r.revision,
    requirementsRevision: reqVersion(r),
    stale: q.status === "accepted" ? false : !!stale,
    staleReason: q.status === "accepted" ? null : stale,
    ...(supplier ? { draft: q.draft ? publicTerms(q.draft, true) : null } : {}),
    offers: q.offers.map((o) => ({
      ...o,
      terms: publicTerms(o.terms, supplier),
    })),
    acceptedOfferRevision: q.acceptedOfferRevision ?? null,
    workOrderId: store.indexed("workOrders","acceptedQuoteId",q.id)[0]?.id ?? null,
    // Phase 7 (§18): relevant trust context for comparing proposals. Derived,
    // privacy-safe, never a star rating. Shown to the requester as evidence,
    // not as a ranking that overrides the commercial terms.
    participantTrust: (() => {
      try {
        return participantTrust.decisionContext(q.participantId, q.capabilityId);
      } catch {
        return null;
      }
    })(),
    history: q.history,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  });
}
function brief(i, user) {
  const q = store.indexed("requestQuotes", "quoteRequestId", i.id)[0];
  return structuredClone({
    id: i.id,
    requestId: i.requestId,
    matchId: i.matchId,
    matchRevision: store.lookup("matches", i.matchId)?.revision,
    participantId: i.participantId,
    revision: i.revision,
    requestRevision: i.requestRevision,
    currentRequestRevision: demand(i.requestId).revision,
    requirements: i.requirements,
    capability: i.capability,
    participant: i.participant,
    interested: interested(i),
    unavailableReason: unavailable(i),
    quoteId:
      q && (user === i.participantUserId || q.offers.length) ? q.id : null,
    createdAt: i.createdAt,
  });
}
export function requestQuote(user, matchId, input) {
  const m = store.lookup("matches", matchId) ?? missing(),
    r = owner(user, m.requestId);
  v.fields(
    input,
    ["requestRevision", "matchRevision", "shareRequirements"],
    "quote request",
  );
  v.revision(r, input.requestRevision);
  v.revision(m, input.matchRevision);
  if (input.shareRequirements !== true)
    v.fail("Explicitly approve sharing the requirements with this participant");
  const assessed = matching.get(user, matchId);
  if (!live(r) || assessed.stale || m.requesterState === "dismissed")
    v.fail(
      "Refresh a relevant, non-dismissed match before requesting a quote",
      409,
      "stale_match",
    );
  const p = supply.getEnterprise(null, m.participantId),
    cap = supply.getCapability(null, m.capabilityId);
  const vendor = supply.rawEnterprise(p.id);
  if (vendor.ownerId === user)
    v.fail("You cannot request a quote from your own enterprise");
  const old = store.indexed("quoteRequests", "matchId", matchId)[0];
  if (
    old &&
    old.requestRevision === reqVersion(r) &&
    old.supplyFingerprint === m.supplyFingerprint
  )
    return brief(old, user);
  const e = event(user, "quote_requested");
  return store.transaction(() => {
    const data = {
      requestId: r.id,
      matchId,
      requesterId: user,
      participantId: p.id,
      participantUserId: vendor.ownerId,
      capabilityId: cap.id,
      capabilityIds: m.capabilityIds,
      requestRevision: reqVersion(r),
      supplyFingerprint: m.supplyFingerprint,
      revision: (old?.revision ?? 0) + 1,
      // Explicitly shared, allowlisted snapshot. No budget, buyer identity,
      // contacts, description, exact address, attachments or business context.
      requirements: {
        title: r.title,
        category: r.category,
        quantity: r.quantity,
        unit: r.unit,
        location: r.location,
        requiredBy: r.requiredBy,
        specifications: r.specifications,
        requirements: r.requirements ?? [],
        currency: r.currency,
      },
      capability: {
        id: cap.id,
        name: cap.name,
        supplyMode: cap.supplyMode,
        capacityKind: cap.capacityKind,
        leadTime: cap.leadTime,
      },
      participant: {
        id: p.id,
        displayName: p.displayName,
        roleLabel: p.roleLabel,
        supplyRole: p.supplyRole,
      },
      createdAt: old?.createdAt ?? now(),
      updatedAt: now(),
      history: [...(old?.history ?? []), e],
    };
    const i = old
      ? store.update("quoteRequests", old.id, data)
      : store.insert("quoteRequests", { ...data, id: newId("qreq") });
    audit(i.id, e);
    return brief(i, user);
  });
}
export function listForRequest(user, id) {
  const r = owner(user, id);
  return structuredClone({
    requestId: id,
    requestRevision: r.revision,
    status: r.status,
    acceptedQuote: r.acceptedQuote ?? null,
    invitations: store
      .indexed("quoteRequests", "requestId", id)
      .map((i) => brief(i, user)),
    quotes: store
      .indexed("requestQuotes", "requestId", id)
      .filter((q) => q.offers.length)
      .map((q) => view(user, q)),
  });
}
export function workspace(user) {
  v.actor(user);
  const invitations = store
    .indexed("quoteRequests", "participantUserId", user)
    .filter((i) => {
      try {
        participant(user, i);
        return true;
      } catch {
        return false;
      }
    });
  return {
    invitations: invitations.map((i) => brief(i, user)),
    quotes: invitations.flatMap((i) =>
      store
        .indexed("requestQuotes", "quoteRequestId", i.id)
        .map((q) => view(user, q)),
    ),
  };
}
export function get(user, id) {
  return view(user, party(user, rawQuote(id)));
}
export function start(user, id, input) {
  const i = invitation(id);
  participant(user, i);
  v.fields(input, ["revision"], "start quote");
  const old = store.indexed("requestQuotes", "quoteRequestId", id)[0];
  if (old) return view(user, old); // deterministic unique identity; no duplicate drafts on retry
  v.revision(i, input.revision);
  assertAvailable(i);
  if (!interested(i))
    v.fail(
      "Indicate “I can help” before starting a quote",
      409,
      "interest_required",
    );
  const e = event(user, "quote_started"),
    t = now();
  const defaultType =
    i.capability.supplyMode === "source"
      ? "sourcing"
      : i.capability.capacityKind === "logistics"
        ? "logistics"
        : "direct";
  let quotedQuantity = null;
  try {
    quotedQuantity = quantity(i.requirements.quantity);
  } catch (e) {
    if (!(e instanceof v.SupplyError)) throw e;
  }
  const draft = validate(
    {
      quotedQuantity,
      unit:
        i.requirements.unit || supply.getCapability(null, i.capabilityId).unit,
      currency:
        i.requirements.currency in CURRENCIES ? i.requirements.currency : "KES",
      sourceType: defaultType,
      specifications:
        "As specified in the shared Request, except for any alternatives and exclusions stated here.",
    },
    user,
  );
  return store.transaction(() => {
    const q = store.insert("requestQuotes", {
      id: newId("rqquote"),
      quoteRequestId: id,
      requestId: i.requestId,
      requesterId: i.requesterId,
      participantId: i.participantId,
      participantUserId: user,
      capabilityId: i.capabilityId,
      matchId: i.matchId,
      status: "draft",
      revision: 1,
      draft,
      offers: [],
      history: [e],
      operations: [],
      createdAt: t,
      updatedAt: t,
    });
    audit(q.id, e);
    return view(user, q);
  });
}
function requestState(r, user, state, extra = {}) {
  const e = {
    ...event(user, `quote_${state === "quoted" ? "submitted" : "accepted"}`),
    fromStatus: r.status,
    toStatus: state,
  };
  const updated = store.update("requests", r.id, {
    status: state,
    requirementsRevision: reqVersion(r),
    revision: r.revision + 1,
    history: [...r.history, e],
    ...extra,
  });
  // The demand side of the same transition: a request that was `matching` and
  // is now `quoted` has received an offer. That is what a reminder rule, a
  // matching rule or an operator would react to, and it did not exist.
  announce("request_quoted", {
    actorId: user, entityKind: "request", entityId: r.id, correlationId: r.id,
    metadata: { requestId: r.id, from: r.status, to: state }
  });
  return updated;
}
export function mutate(user, id, input) {
  const q = party(user, rawQuote(id)),
    i = invitation(q.quoteRequestId),
    r = demand(q.requestId);
  v.fields(
    input,
    [
      "action",
      "revision",
      "requestRevision",
      "idempotencyKey",
      "terms",
      "reason",
    ],
    "quote action",
  );
  const action = v.choice(
    input.action,
    ["save", "submit", "view", "accept", "decline", "withdraw"],
    "quote action",
  );
  const seller = ["save", "submit", "withdraw"].includes(action);
  if (seller) participant(user, i);
  else if (r.requesterId !== user) missing();
  const key = v.text(input.idempotencyKey, 128, "idempotencyKey", 16),
    fingerprint = supply.hash(input);
  const prior = q.operations.find((o) => o.key === key && o.actorId === user);
  if (prior) {
    if (prior.fingerprint !== fingerprint)
      v.fail(
        "This retry key was used for different terms",
        409,
        "idempotency_conflict",
      );
    if(action === "accept" && q.status === "accepted" && available("work_orders")) createFromAccepted(user,q.id);
    return view(user, q);
  }
  v.revision(q, input.revision);
  if (q.status === "accepted")
    v.fail(
      "The selected proposal is locked. Use a controlled Work Order amendment for agreed changes.",
      409,
      "accepted_quote_locked",
    );
  if (!seller && !q.offers.length) missing();
  if (["save", "submit", "accept"].includes(action)) {
    assertAvailable(i);
    if (input.requestRevision !== (seller ? reqVersion(r) : r.revision))
      v.fail(
        "Request changed. Reload before continuing.",
        409,
        "revision_conflict",
      );
  }
  if (["save", "submit"].includes(action) && !interested(i))
    v.fail("Reconfirm your interest before quoting", 409, "interest_required");
  if (
    ["accept", "decline", "view"].includes(action) &&
    !["submitted", "viewed", "revised"].includes(status(q))
  )
    v.fail("This proposal is not active", 409, "invalid_transition");
  if (
    action === "withdraw" &&
    !["submitted", "viewed", "revised", "expired", "draft"].includes(status(q))
  )
    v.fail("This proposal cannot be withdrawn", 409, "invalid_transition");
  if (action === "accept") {
    const o = q.offers.at(-1);
    if (
      o.requestRevision !== reqVersion(r) ||
      o.supplyFingerprint !== i.supplyFingerprint
    )
      v.fail(
        "A revised offer is needed for the current requirements",
        409,
        "stale_quote",
      );
  }
  let terms = null;
  if (["save", "submit"].includes(action)) {
    terms = validate(
      input.terms ?? editableTerms(q.draft ?? q.offers.at(-1)?.terms ?? {}),
      user,
      { complete: action === "submit" },
    );
    if (
      i.capability.supplyMode === "source" &&
      !["sourcing", "referral"].includes(terms.sourceType)
    )
      v.fail("A sourcing capability must disclose its intermediary role");
    if (i.capability.supplyMode === "direct" && terms.sourceType === "sourcing")
      v.fail("Use a matched sourcing capability for a sourcing proposal");
    if (
      !["sourcing", "referral"].includes(terms.sourceType) &&
      terms.sourcingFeeMinor !== 0
    )
      v.fail("Sourcing fees require an explicitly disclosed intermediary role");
    if (
      terms.sourceType === "logistics" &&
      supply.getCapability(null, i.capabilityId).capacityKind !== "logistics"
    )
      v.fail("Use a relevant logistics capability");
  } else if (input.terms !== undefined)
    v.fail("Terms can only be changed by saving or submitting a revision");
  const reason =
    input.reason == null ? "" : v.text(input.reason, 300, "Decision reason");
  return store.transaction(() => {
    const next = q.revision + 1,
      offerRevision = q.offers.length + (action === "submit" ? 1 : 0);
    const e = event(
      user,
      action === "submit"
        ? q.offers.length
          ? "quote_revised"
          : "quote_submitted"
        : `quote_${{ save: "draft_saved", view: "viewed", accept: "accepted", decline: "declined", withdraw: "withdrawn" }[action]}`,
      { revision: next, offerRevision, reason },
    );
    const patch = {
      revision: next,
      updatedAt: now(),
      history: [...q.history, e],
      operations: [...q.operations, { key, actorId: user, fingerprint }],
    };
    if (action === "save") patch.draft = terms;
    if (action === "submit") {
      const p = supply.getEnterprise(null, q.participantId),
        c = supply.getCapability(null, i.capabilityId);
      patch.capabilityId = i.capabilityId;
      patch.offers = [
        ...q.offers,
        {
          revision: offerRevision,
          terms,
          requestRevision: reqVersion(r),
          requestSnapshot: i.requirements,
          supplyFingerprint: i.supplyFingerprint,
          submittedAt: now(),
          participant: {
            id: p.id,
            displayName: p.displayName,
            roleLabel: p.roleLabel,
            supplyRole: p.supplyRole,
            capabilityName: c.name,
            capabilityVerification: c.verification.status,
          },
          disclosure: RELATIONSHIPS[terms.sourceType],
        },
      ];
      patch.status = q.offers.length ? "revised" : "submitted";
      patch.draft = null;
      if (r.status === "matching") requestState(r, user, "quoted");
    }
    if (action === "view") patch.status = "viewed";
    if (action === "withdraw") {
      patch.status = "withdrawn";
      patch.draft = null;
    }
    if (action === "decline") {
      patch.status = "declined";
      patch.draft = null;
    }
    if (action === "accept") {
      patch.status = "accepted";
      patch.acceptedOfferRevision = offerRevision;
      patch.draft = null;
      const selection = {
        quoteId: q.id,
        offerRevision,
        requestRevision: reqVersion(r),
        acceptedAt: now(),
      };
      requestState(r, user, "ready_for_work", { acceptedQuote: selection });
      for (const other of store.indexed("requestQuotes", "requestId", r.id))
        if (
          other.id !== q.id &&
          ["draft", "submitted", "viewed", "revised"].includes(status(other))
        ) {
          const ce = event(user, "quote_declined", {
            revision: other.revision + 1,
            offerRevision: other.offers.length,
            reason: "Selected another option",
          });
          store.update("requestQuotes", other.id, {
            status: "declined",
            draft: null,
            revision: other.revision + 1,
            updatedAt: now(),
            history: [...other.history, ce],
          });
          audit(other.id, ce);
        }
    }
    const updated = store.update("requestQuotes", id, patch);
    audit(id, e);
    if(action === "accept" && available("work_orders")) createFromAccepted(user,id);
    return view(user, updated);
  });
}
// Existing private media endpoint delegates only this purpose's two-party ACL.
export function canReadQuoteEvidence(user, uploadId) {
  if (!user) return false;
  return store
    .indexed("requestQuotes", "requesterId", user)
    .some((q) =>
      q.offers.some((o) =>
        o.terms.evidence.some(
          (e) => e.uploadId === uploadId && e.shareWithRequester,
        ),
      ),
    );
}
