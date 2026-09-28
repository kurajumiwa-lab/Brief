// Economic execution coordination. Never creates payment, ledger or checkout records.
import { store, newId } from "../store.js";
import * as v from "./supplyValidation.js";
import * as supply from "./supply.js";
import {
  validate as quoteTerms,
  editableTerms,
  date,
} from "./quoteValidation.js";
import { readFile } from "./upload.js";
import { recordAudit } from "../routes/helpers.js";
import * as procurement from "./procurement.js";
import { announce } from './engine/announce.js';
export const WORK_STATUSES = [
  "created",
  "specification_pending",
  "confirmed",
  "in_progress",
  "ready",
  "dispatched",
  "delivered",
  "completed",
  "cancelled",
  "disputed",
];
const terminal = (w) => ["completed", "cancelled"].includes(w.status);
const preStart = (w) =>
  ["created", "specification_pending", "confirmed"].includes(w.status) &&
  !w.startedAt;
const amendable = (w) =>
  [
    "created",
    "specification_pending",
    "confirmed",
    "in_progress",
    "ready",
  ].includes(w.status);
const now = () => new Date().toISOString();
const missing = () => v.fail("Work Order not found", 404, "not_found");
const raw = (id) => store.lookup("workOrders", id) ?? missing();
function role(user, w) {
  v.actor(user);
  if (w.requesterId === user) return "requester";
  if (w.participantUserId !== user) missing();
  supply.ownEnterprise(user, w.participantId);
  return "participant";
}
const agreement = (w) => w.agreements.at(-1);
function event(w, user, action, extra = {}) {
  return {
    ...v.event(user, action),
    workOrderId: w.id,
    revision: w.revision + 1,
    agreementRevision: agreement(w).revision,
    fromStatus: w.status,
    toStatus: w.status,
    visibility: "shared",
    ...extra,
  };
}
function audit(w, e) {
  recordAudit(e.action, {
    actorId: e.actorId,
    objectType: "work_order",
    objectId: w.id,
    after: {
      revision: e.revision,
      agreementRevision: e.agreementRevision,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
    },
  });
}
// The Work Order state machine, in the log. One map, beside the machine it
// describes, so a status cannot be added without somebody deciding what it is
// called in the event vocabulary.
const WORK_ORDER_SIGNAL = {
  created: "work_order_created",
  confirmed: "work_order_confirmed",
  in_progress: "work_order_started",
  ready: "work_order_ready",
  dispatched: "work_order_dispatched",
  delivered: "work_order_delivered",
  completed: "work_order_completed",
  cancelled: "work_order_cancelled",
  disputed: "work_order_disputed",
};

/**
 * EVERY work-order transition is announced, including the ones no screen shows.
 *
 * Before this, the chain request -> quote -> work order -> task -> settlement
 * emitted nothing at all: `workOrders.events` was a private array, which meant
 * no rule could react to a delivery, no operator could see a cancellation, and
 * a new service could not be built from the history. The row is still the
 * source of truth; this is what makes it legible.
 */
function announceWorkOrder(w, user, from, to, extra = {}) {
  const type = WORK_ORDER_SIGNAL[to];
  if (!type || from === to) return null;
  return announce(type, {
    actorId: user,
    entityKind: "work_order",
    entityId: w.id,
    // The whole process shares a correlation id, so "everything that happened
    // because of this work" is one query rather than a join through five tables.
    correlationId: w.requestId ?? w.id,
    metadata: {
      workOrderId: w.id,
      requestId: w.requestId ?? null,
      participantId: w.participantId ?? null,
      from,
      to,
      ...extra,
    },
  });
}

function updateRequest(w, user, state, action) {
  const r = store.lookup("requests", w.requestId);
  if (!r || r.acceptedQuote?.quoteId !== w.acceptedQuoteId)
    v.fail(
      "Request selection does not match this Work Order",
      409,
      "selection_conflict",
    );
  const e = { ...v.event(user, action), fromStatus: r.status, toStatus: state };
  store.update("requests", r.id, {
    workOrderId: w.id,
    status: state,
    requirementsRevision: r.requirementsRevision ?? r.revision,
    revision: r.revision + 1,
    history: [...r.history, e],
  });
}
function sharedTerms(t) {
  const { privateProvenance, evidence, validUntil, ...terms } = t;
  return terms;
}
function availableActions(w, user) {
  const who = role(user, w);
  if (terminal(w)) return [];
  if (w.status === "disputed")
    return w.issue?.resolutions?.[who] ? [] : ["resolve_issue"];
  const pending = w.amendments.some((a) => a.status === "pending");
  const actions = ["add_evidence"];
  if (
    !pending &&
    !w.confirmations[who] &&
    ["created", "specification_pending"].includes(w.status)
  )
    actions.push("confirm_specifications");
  if (!pending) {
    if (who === "participant") {
      if (w.status === "confirmed") actions.push("start");
      if (w.status === "in_progress") actions.push("ready");
      if (w.status === "ready") actions.push("dispatch");
      if (w.status === "dispatched") actions.push("deliver");
    }
    if (who === "requester" && w.status === "delivered")
      actions.push("complete");
  }
  if (
    who === "participant" &&
    ["in_progress", "ready", "dispatched", "delivered"].includes(w.status)
  )
    actions.push("progress");
  if (amendable(w) && !pending) actions.push("propose_amendment");
  if (preStart(w)) actions.push("cancel");
  actions.push("raise_issue");
  return actions;
}
function view(user, w) {
  const who = role(user, w);
  const { operations, privateSource, participantUserId, ...data } = w;
  return structuredClone({
    ...data,
    ...(who === "participant" ? { privateSource } : {}),
    viewerRole: who,
    actions: availableActions(w, user),
    evidence: w.evidence.filter(
      (e) => e.visibility === "shared" || e.uploadedBy === user,
    ),
    history: w.history.filter(
      (e) => e.visibility !== "private" || e.actorId === user,
    ),
    requestStatus: store.lookup("requests", w.requestId)?.status,
  });
}
export function get(user, id) {
  return view(user, raw(id));
}
export function forRequest(user, id) {
  const r = store.lookup("requests", id);
  v.actor(user);
  if (!r || r.requesterId !== user) missing();
  return {
    workOrders: store
      .indexed("workOrders", "requestId", id)
      .map((w) => view(user, w)),
    acceptedQuoteId: r.acceptedQuote?.quoteId ?? null,
  };
}
export function forParticipant(user) {
  v.actor(user);
  return {
    workOrders: store
      .indexed("workOrders", "participantUserId", user)
      .filter((w) => {
        try {
          role(user, w);
          return true;
        } catch {
          return false;
        }
      })
      .map((w) => view(user, w)),
  };
}
// Called inside Quote acceptance's transaction and by the explicit old-quote bridge.
export function createFromAccepted(user, quoteId) {
  const q = store.lookup("requestQuotes", quoteId);
  v.actor(user);
  if (!q || q.requesterId !== user) missing();
  const r = store.lookup("requests", q.requestId),
    o = q.offers.find((o) => o.revision === q.acceptedOfferRevision);
  if (
    q.status !== "accepted" ||
    !o ||
    r?.acceptedQuote?.quoteId !== q.id ||
    r.acceptedQuote.offerRevision !== o.revision ||
    o.participant.id !== q.participantId
  )
    v.fail(
      "A genuinely accepted quote and matching Request selection are required",
      409,
      "accepted_quote_required",
    );
  const existing = store.indexed("workOrders", "acceptedQuoteId", q.id)[0];
  if (existing) return view(user, existing);
  if (
    r.status !== "ready_for_work" ||
    store.indexed("workOrders", "requestId", r.id).length
  )
    v.fail("This Request cannot create another Work Order", 409, "work_exists");
  const cap = store.lookup("capabilities", q.capabilityId),
    p = store.lookup("vendors", q.participantId);
  if (
    !cap ||
    cap.participantId !== q.participantId ||
    !p ||
    p.ownerId !== q.participantUserId
  )
    v.fail(
      "The accepted participant/capability relationship needs review",
      409,
      "participant_changed",
    );
  return store.transaction(() => {
    const at = now(),
      id = newId("work");
    const original = {
      revision: 1,
      createdAt: at,
      acceptedQuoteId: q.id,
      acceptedOfferRevision: o.revision,
      terms: sharedTerms(o.terms),
      requirements: o.requestSnapshot,
      fulfillmentLocation: o.requestSnapshot.location,
      deliveryDetails:
        o.requestSnapshot.specifications.deliveryRequirements ?? "",
      agreedStartDate: null,
    };
    const w = {
      id,
      requestId: r.id,
      acceptedQuoteId: q.id,
      acceptedOfferRevision: o.revision,
      requesterId: user,
      participantId: q.participantId,
      participantUserId: q.participantUserId,
      capabilityId: q.capabilityId,
      matchId: q.matchId,
      participant: structuredClone(o.participant),
      sourcingMode: o.terms.sourceType,
      relationship: o.disclosure,
      privateSource: structuredClone(o.terms.privateProvenance ?? null),
      acceptedEvidence: structuredClone(
        (o.terms.evidence ?? []).filter((e) => e.shareWithRequester),
      ),
      originalAgreement: structuredClone(original),
      agreements: [structuredClone(original)],
      status: "created",
      revision: 1,
      confirmations: {},
      amendments: [],
      evidence: [],
      milestones: [],
      history: [],
      operations: [],
      issue: null,
      completion: null,
      createdAt: at,
      updatedAt: at,
      confirmedAt: null,
      startedAt: null,
      readyAt: null,
      dispatchedAt: null,
      deliveredAt: null,
      completedAt: null,
      cancelledAt: null,
    };
    const accepted = {
      ...v.event(user, "quote_accepted"),
      workOrderId: id,
      revision: 1,
      agreementRevision: 1,
      at: r.acceptedQuote.acceptedAt,
      quoteId: q.id,
      offerRevision: o.revision,
      visibility: "shared",
      fromStatus: null,
      toStatus: null,
    };
    const e = {
      ...event(w, user, "work_order_created"),
      revision: 1,
      fromStatus: null,
      toStatus: "created",
    };
    w.history = [accepted, e];
    w.milestones = [
      { status: "created", actorId: user, at, agreementRevision: 1 },
    ];
    store.insert("workOrders", w);
    updateRequest(w, user, "ready_for_work", "work_order_created");
    audit(w, e);
    announceWorkOrder(w, user, null, "created", { acceptedQuoteId: q.id, requesterId: w.requesterId });
    return view(user, w);
  });
}
const termFields = [
  "quotedQuantity",
  "unit",
  "unitPriceMinor",
  "currency",
  "deliveryCostMinor",
  "sourcingFeeMinor",
  "otherCosts",
  "productionLeadDays",
  "deliveryLeadDays",
  "estimatedCompletionDate",
  "specifications",
  "exclusions",
  "notes",
  "terms",
];
const locationFields = [
  "fulfillmentLocation",
  "deliveryDetails",
  "agreedStartDate",
];
function proposedAgreement(w, user, input) {
  v.fields(input, [...termFields, ...locationFields], "amendment changes");
  if (!Object.keys(input).length) v.fail("Specify what should change");
  const old = agreement(w),
    termPatch = Object.fromEntries(
      Object.entries(input).filter(([k]) => termFields.includes(k)),
    );
  if (
    input.currency &&
    input.currency !== old.terms.currency &&
    ![
      "unitPriceMinor",
      "deliveryCostMinor",
      "sourcingFeeMinor",
      "otherCosts",
    ].every((k) => k in input)
  )
    v.fail(
      "Currency changes require all prices, fees and additional costs to be restated",
    );
  const terms = sharedTerms(
    quoteTerms(
      {
        ...editableTerms(old.terms),
        ...termPatch,
        validUntil: null,
        evidence: [],
        privateProvenance: {
          sourceParticipantId: null,
          reference: "",
          notes: "",
        },
      },
      user,
      { complete: true },
    ),
  );
  if (
    !["sourcing", "referral"].includes(w.sourcingMode) &&
    terms.sourcingFeeMinor !== 0
  )
    v.fail("Sourcing fees require an already disclosed intermediary role");
  const proposal = { ...structuredClone(old), terms };
  for (const field of locationFields)
    if (field in input)
      proposal[field] =
        field === "agreedStartDate"
          ? date(input[field], field)
          : v.text(
              input[field],
              field === "fulfillmentLocation" ? 300 : 3000,
              field,
            );
  const changes = Object.entries(input)
    .filter(
      ([k, value]) =>
        supply.hash(value) !==
        supply.hash(termFields.includes(k) ? old.terms[k] : old[k]),
    )
    .map(([field]) => ({
      field,
      previous: termFields.includes(field) ? old.terms[field] : old[field],
      proposed: termFields.includes(field)
        ? proposal.terms[field]
        : proposal[field],
    }));
  if (!changes.length) v.fail("The proposed terms are unchanged");
  return { proposal, changes };
}
function evidenceInput(user, input) {
  if (!Array.isArray(input) || input.length > 8)
    v.fail("Attach at most 8 milestone images");
  const seen = new Set();
  return input.map((e) => {
    v.fields(
      e,
      ["uploadId", "type", "visibility", "description"],
      "work evidence",
    );
    const f = readFile(e.uploadId);
    if (
      !f.ok ||
      f.row.purpose !== "private_work" ||
      f.row.ownerId !== user ||
      seen.has(e.uploadId)
    )
      v.fail("Use distinct private Work images uploaded by your account");
    seen.add(e.uploadId);
    return {
      id: newId("wev"),
      uploadId: e.uploadId,
      type: v.choice(
        e.type,
        [
          "production_progress",
          "finished_goods",
          "packaging",
          "source_confirmation",
          "dispatch",
          "delivery",
          "completion",
          "specification",
        ],
        "evidence type",
      ),
      uploadedBy: user,
      timestamp: now(),
      visibility: v.choice(e.visibility, ["private", "shared"], "visibility"),
      description: v.text(e.description ?? "", 1000, "Evidence description"),
      verification: "uploaded_not_verified",
    };
  });
}
export function mutate(user, id, input) {
  const w = raw(id),
    who = role(user, w);
  v.fields(
    input,
    [
      "action",
      "revision",
      "agreementRevision",
      "idempotencyKey",
      "note",
      "evidence",
      "visibility",
      "changes",
      "amendmentId",
    ],
    "work action",
  );
  const action = v.choice(
    input.action,
    [
      "confirm_specifications",
      "start",
      "progress",
      "ready",
      "dispatch",
      "deliver",
      "complete",
      "add_evidence",
      "cancel",
      "raise_issue",
      "resolve_issue",
      "propose_amendment",
      "accept_amendment",
      "reject_amendment",
    ],
    "work action",
  );
  const key = v.text(input.idempotencyKey, 128, "idempotencyKey", 16),
    fingerprint = supply.hash(input),
    previous = w.operations.find((o) => o.key === key && o.actorId === user);
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      v.fail(
        "Retry key belongs to a different action",
        409,
        "idempotency_conflict",
      );
    return view(user, w);
  }
  v.revision(w, input.revision);
  if (input.agreementRevision !== agreement(w).revision)
    v.fail(
      "The agreement changed. Review the current version.",
      409,
      "agreement_conflict",
    );
  if (terminal(w)) v.fail("This Work Order is closed", 409, "work_closed");
  const decision = ["accept_amendment", "reject_amendment"].includes(action);
  if (!decision && !availableActions(w, user).includes(action))
    v.fail(
      action === "cancel"
        ? "Work has progressed. Record an issue instead of cancelling silently."
        : "This action is not available at the current stage",
      409,
      "invalid_transition",
    );
  const note = v.text(input.note ?? "", 3000, "Work note");
  if (
    [
      "progress",
      "cancel",
      "raise_issue",
      "resolve_issue",
      "propose_amendment",
    ].includes(action) &&
    !note
  )
    v.fail("Explain what happened or what needs to change");
  const visibility = input.visibility ?? "shared";
  v.choice(visibility, ["private", "shared"], "visibility");
  if (
    visibility === "private" &&
    !["progress", "add_evidence"].includes(action)
  )
    v.fail("Operational decisions must be visible to both parties");
  if (input.changes !== undefined && action !== "propose_amendment")
    v.fail("Commercial changes require an amendment");
  if (input.amendmentId !== undefined && !decision)
    v.fail("Amendment reference is only valid for an amendment decision");
  if (
    input.evidence !== undefined &&
    !["progress", "add_evidence"].includes(action)
  )
    v.fail("Attach evidence using the evidence/progress action");
  const added = ["progress", "add_evidence"].includes(action)
    ? evidenceInput(user, input.evidence ?? [])
    : [];
  if (action === "add_evidence" && !added.length)
    v.fail("Choose an evidence image");
  let proposed = null,
    amendment = null;
  if (action === "propose_amendment")
    proposed = proposedAgreement(w, user, input.changes);
  if (decision) {
    amendment = w.amendments.find((a) => a.id === input.amendmentId);
    if (
      !amendable(w) ||
      !amendment ||
      amendment.status !== "pending" ||
      amendment.proposedBy === user ||
      amendment.baseAgreementRevision !== agreement(w).revision
    )
      v.fail(
        "Only the other party can decide a current pending amendment",
        409,
        "amendment_conflict",
      );
  }
  return store.transaction(() => {
    const events = [],
      patch = {
        revision: w.revision + 1,
        updatedAt: now(),
        operations: [...w.operations, { key, actorId: user, fingerprint }],
      };
    const emit = (name, extra = {}) => {
      const stage = events.at(-1)?.toStatus ?? w.status;
      const e = event(w, user, name, {
        note,
        visibility,
        fromStatus: stage,
        toStatus: stage,
        ...extra,
      });
      events.push(e);
      return e;
    };
    const move = (state, name, timestamp) => {
      patch.status = state;
      if (timestamp) patch[timestamp] = now();
      emit(name, { toStatus: state });
      patch.milestones = [
        ...w.milestones,
        {
          status: state,
          actorId: user,
          at: now(),
          agreementRevision: agreement(w).revision,
        },
      ];
    };
    if (action === "confirm_specifications") {
      if (w.status === "created")
        emit("specification_confirmation_started", {
          toStatus: "specification_pending",
        });
      patch.confirmations = {
        ...w.confirmations,
        [who]: {
          actorId: user,
          at: now(),
          agreementRevision: agreement(w).revision,
        },
      };
      const both =
        patch.confirmations.requester && patch.confirmations.participant;
      move(
        both ? "confirmed" : "specification_pending",
        "specifications_confirmed",
        both ? "confirmedAt" : null,
      );
    }
    if (action === "start") {
      if (
        !w.confirmations.requester ||
        !w.confirmations.participant ||
        Object.values(w.confirmations).some(
          (c) => c.agreementRevision !== agreement(w).revision,
        )
      )
        v.fail(
          "Both parties must confirm the current specifications",
          409,
          "confirmation_required",
        );
      move("in_progress", "work_started", "startedAt");
      updateRequest(w, user, "in_progress", "work_started");
    }
    if (action === "ready") move("ready", "work_marked_ready", "readyAt");
    if (action === "dispatch")
      move("dispatched", "dispatch_recorded", "dispatchedAt");
    if (action === "deliver") {
      move("delivered", "delivery_recorded", "deliveredAt");
      emit("completion_requested", { toStatus: "delivered" });
    }
    if (action === "complete") {
      move("completed", "work_order_completed", "completedAt");
      patch.completion = {
        completedAt: patch.completedAt,
        completedBy: user,
        agreementRevision: agreement(w).revision,
        agreement: structuredClone(agreement(w)),
      };
      updateRequest(w, user, "completed", "work_order_completed");
    }
    if (action === "progress" || action === "add_evidence") {
      emit(action === "progress" ? "progress_recorded" : "work_evidence_added");
      patch.evidence = [
        ...w.evidence,
        ...added.map((e) => ({
          ...e,
          milestone: w.status,
          agreementRevision: agreement(w).revision,
        })),
      ];
    }
    if (action === "cancel") {
      move("cancelled", "work_order_cancelled", "cancelledAt");
      updateRequest(w, user, "cancelled", "work_order_cancelled");
    }
    if (action === "raise_issue") {
      patch.issue = {
        id: newId("wissue"),
        raisedBy: user,
        at: now(),
        reason: note,
        previousStatus: w.status,
        resolutions: {},
      };
      move("disputed", "work_order_disputed");
    }
    if (action === "resolve_issue") {
      const issue = {
        ...w.issue,
        resolutions: {
          ...w.issue.resolutions,
          [who]: { actorId: user, at: now(), note },
        },
      };
      patch.issue = issue;
      emit("issue_resolution_confirmed");
      if (issue.resolutions.requester && issue.resolutions.participant) {
        issue.resolvedAt = now();
        move(issue.previousStatus, "work_resumed");
      }
    }
    if (action === "propose_amendment") {
      if (w.status === "created")
        move("specification_pending", "specification_confirmation_started");
      const a = {
        id: newId("wamend"),
        status: "pending",
        baseAgreementRevision: agreement(w).revision,
        proposedBy: user,
        proposedAt: now(),
        reason: note,
        changes: proposed.changes,
        previous: structuredClone(agreement(w)),
        proposed: proposed.proposal,
        decidedBy: null,
        decidedAt: null,
      };
      patch.amendments = [...w.amendments, a];
      emit("amendment_requested", { amendmentId: a.id });
    }
    if (decision) {
      const accepted = action === "accept_amendment";
      patch.amendments = w.amendments.map((a) =>
        a.id === amendment.id
          ? {
              ...a,
              status: accepted ? "accepted" : "rejected",
              decidedBy: user,
              decidedAt: now(),
              decisionNote: note,
            }
          : a,
      );
      if (accepted) {
        const next = {
          ...amendment.proposed,
          revision: agreement(w).revision + 1,
          createdAt: now(),
          amendmentId: amendment.id,
        };
        patch.agreements = [...w.agreements, next];
        patch.confirmations = {
          requester: {
            actorId: w.requesterId,
            at:
              amendment.proposedBy === w.requesterId
                ? amendment.proposedAt
                : now(),
            agreementRevision: next.revision,
          },
          participant: {
            actorId: w.participantUserId,
            at:
              amendment.proposedBy === w.participantUserId
                ? amendment.proposedAt
                : now(),
            agreementRevision: next.revision,
          },
        };
        if (preStart(w)) {
          if (w.status === "created")
            emit("specification_confirmation_started", {
              agreementRevision: next.revision,
              toStatus: "specification_pending",
            });
          emit("specifications_confirmed", {
            agreementRevision: next.revision,
            toStatus: "confirmed",
          });
          patch.status = "confirmed";
          patch.confirmedAt = now();
          patch.milestones = [
            ...w.milestones,
            ...(w.status === "created"
              ? [
                  {
                    status: "specification_pending",
                    actorId: user,
                    at: now(),
                    agreementRevision: next.revision,
                  },
                ]
              : []),
            {
              status: "confirmed",
              actorId: user,
              at: now(),
              agreementRevision: next.revision,
            },
          ];
        }
        emit("amendment_accepted", {
          amendmentId: amendment.id,
          agreementRevision: next.revision,
          toStatus: patch.status ?? w.status,
        });
      } else emit("amendment_rejected", { amendmentId: amendment.id });
    }
    if (["cancel", "raise_issue"].includes(action))
      patch.amendments = w.amendments.map((a) => {
        if (a.status !== "pending") return a;
        emit("amendment_rejected", {
          amendmentId: a.id,
          toStatus: patch.status,
        });
        return {
          ...a,
          status: "rejected",
          decidedBy: user,
          decidedAt: now(),
          decisionNote: `Work ${action === "cancel" ? "cancelled" : "disputed"}`,
        };
      });
    patch.history = [...w.history, ...events];
    const updated = store.update("workOrders", id, patch);
    for (const e of events) audit(updated, e);
    // One emit per transition, from the single place the row is written: the
    // engine cannot miss a status change because a caller forgot to say so.
    announceWorkOrder(updated, user, w.status, updated.status, {
      action,
      agreementRevision: patch.agreement?.revision ?? agreement(w).revision,
    });
    // Phase 6: a completed Work Order becomes a reusable procurement memory.
    // Idempotent — one reference per Work Order, never a duplicate, never a
    // mutation of the original Request/Quote/Work Order.
    if (action === "complete") {
      try {
        procurement.recordCompletion(updated);
      } catch (err) {
        // Completion must never be blocked by memory recording. The Work Order
        // is already completed; a failed memory write is surfaced, not fatal.
        console.error("Repeat-procurement memory write failed", err);
      }
    }
    return view(user, updated);
  });
}
export function canReadWorkEvidence(user, uploadId) {
  if (!user) return false;
  const rows = [
    ...store.indexed("workOrders", "requesterId", user),
    ...store.indexed("workOrders", "participantUserId", user),
  ];
  return rows.some((w) => {
    try {
      role(user, w);
      return w.evidence.some(
        (e) =>
          e.uploadId === uploadId &&
          (e.visibility === "shared" || e.uploadedBy === user),
      );
    } catch {
      return false;
    }
  });
}
