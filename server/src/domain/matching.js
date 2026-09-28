// First-class Request -> Match -> Participant relationships. All decisions are
// server-authoritative. Requester selections and participant interest differ.
import { store, newId } from "../store.js";
import * as supply from "./supply.js";
import * as v from "./supplyValidation.js";
import { capabilityCandidates } from "./search.js";
import { ALGORITHM, assessCapability, demandTerms } from "./matchRanking.js";
import * as participantTrust from "./participantTrust.js";
import { available } from "../features.js";
import { announce } from './engine/announce.js';
export const MATCH_STATUSES = [
  "suggested",
  "viewed",
  "saved",
  "dismissed",
  "contacted",
  "expired",
];
const LIMIT = 12;
export const requestVersion = r => r.requirementsRevision ?? r.revision;
export const activeDemand = r => ["matching", "quoted"].includes(r.status);
export const currentMatchSupply = m => publicSupply(m.participantId, m.capabilityIds);
function owner(userId, id) {
  v.actor(userId);
  const r = store.lookup("requests", id);
  if (!r || r.requesterId !== userId)
    v.fail("request not found", 404, "not_found");
  return r;
}
function match(id) {
  const m = store.lookup("matches", id);
  if (!m) v.fail("match not found", 404, "not_found");
  return m;
}
function publicSupply(participantId, capabilityIds) {
  const p = supply.getEnterprise(null, participantId, {
    includeCapabilities: false,
  });
  const caps = capabilityIds.map((id) => supply.getCapability(null, id));
  const fingerprint = supply.hash({
    revision: supply.rawEnterprise(participantId).enterprise.revision,
    verification: p.verification,
    caps: caps.map((c) => ({
      id: c.id,
      revision: c.revision,
      verification: c.verification,
      capacity: c.capacityInformation.verification,
    })),
  });
  return { p, caps, fingerprint };
}
function staleReason(r, m, now = Date.now()) {
  if (!activeDemand(r)) return "Request is not actively matching.";
  if (requestVersion(r) !== m.requestRevision)
    return "Requirements changed. Refresh matches.";
  if (m.status === "expired" || now >= Date.parse(m.expiresAt))
    return "This assessment expired. Refresh matches.";
  if (m.algorithmVersion !== ALGORITHM)
    return "Matching criteria changed. Refresh matches.";
  try {
    if (
      publicSupply(m.participantId, m.capabilityIds).fingerprint !==
      m.supplyFingerprint
    )
      return "Supply details or verification changed. Refresh matches.";
  } catch {
    return "This participant or capability is no longer publicly available.";
  }
  return null;
}
function interestRow(m) {
  return (
    store
      .indexed("requestParticipants", "requestId", m.requestId)
      .find(
        (x) =>
          x.participantId === m.participantId &&
          x.origin === "participant_interest",
      ) ?? null
  );
}
function view(r, m) {
  const stale = staleReason(r, m);
  let p = null,
    caps = [];
  try {
    const current = publicSupply(m.participantId, m.capabilityIds);
    p = current.p;
    caps = current.caps;
  } catch {}
  const interest = interestRow(m);
  return {
    id: m.id,
    requestId: m.requestId,
    participantId: m.participantId,
    capabilityId: m.capabilityId,
    capabilityIds: m.capabilityIds,
    requestRevision: m.requestRevision,
    revision: m.revision,
    status: stale ? "expired" : m.status,
    requesterState: m.requesterState,
    matchType: m.matchType,
    tier: stale ? null : m.tier,
    requesterSelected: Boolean(m.requesterSelected),
    stale: !!stale,
    staleReason: stale,
    participant: p
      ? {
          id: p.id,
          displayName: p.displayName,
          supplyRole: p.supplyRole,
          roleLabel: p.roleLabel,
          disclosure: p.disclosure,
          location: p.location,
          serviceAreas: p.serviceAreas,
          verification: p.verification,
        }
      : null,
    capabilities: caps.map((c) => ({
      id: c.id,
      name: c.name,
      supplyMode: c.supplyMode,
      unit: c.unit,
      typicalCapacity: c.typicalCapacity,
      availableCapacity: c.availableCapacity,
      minimumQuantity: c.minimumQuantity,
      maximumQuantity: c.maximumQuantity,
      capacityPeriod: c.capacityPeriod,
      leadTime: c.leadTime,
      verification: c.verification,
    })),
    matchReasons: stale ? [] : m.matchReasons,
    warnings: stale ? [] : m.warnings,
    signals: stale ? null : m.signals,
    // Phase 6 (spec §15): a previous successful fulfillment is an EXPLAINABLE
    // signal, never a ranking input. Derived from the requester's own
    // procurement memory; read directly from the store to avoid an import
    // cycle with the procurement module.
    previousFulfillment: store.filter(
      "procurements",
      (x) =>
        x.ownerId === r.requesterId && x.participantId === m.participantId,
    ).length > 0
      ? {
          label: "Previously completed a similar request for this business.",
          count: store.filter(
            "procurements",
            (x) =>
              x.ownerId === r.requesterId &&
              x.participantId === m.participantId,
          ).length,
        }
      : null,
    // Phase 7 (§17): explainable trust context. Derived, privacy-safe, and
    // explicitly separate from capability fit — trust never overrides the
    // capability assessment that produced this match.
    trust: (() => {
      try {
        const t = participantTrust.decisionContext(
          m.participantId,
          m.capabilityId,
        );
        return {
          verifiedCapability: t.verifiedCapability,
          completedWorkOrders: t.completedWorkOrders,
          requesterConfirmedCompletions: t.requesterConfirmedCompletions,
          repeatRelationships: t.repeatRelationships,
          limited: t.limited,
          statements: t.statements.slice(0, 4),
        };
      } catch {
        return null;
      }
    })(),
    interested: interest?.status === "interested",
    interest: interest
      ? {
          id: interest.id,
          status: interest.status,
          requestRevision: interest.requestRevision,
          current:
            !stale &&
            interest.requestRevision === requestVersion(r) &&
            interest.supplyFingerprint === m.supplyFingerprint,
          createdAt: interest.createdAt,
          updatedAt: interest.updatedAt,
        }
      : null,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    expiresAt: m.expiresAt,
    history: m.history,
  };
}
function deadline(now) {
  const day = 86400000,
    zone = 3 * 3600000;
  return new Date(
    (Math.floor((now + zone) / day) + 1) * day - zone,
  ).toISOString();
}
export function generateForRequest(userId, r, { idempotencyKey = null } = {}) {
  if (!available("supply") || !available("request_matching"))
    v.fail("Matching is unavailable", 503, "feature_disabled");
  if (!activeDemand(r))
    v.fail(
      "Mark this Request ready for matching first",
      409,
      "invalid_transition",
    );
  const now = Date.now(),
    old = store.indexed("matches", "requestId", r.id);

  // Phase 9 integration: the requester's own shortlist (requester_selected
  // potential participants — e.g. a repeat-procurement "previous supplier")
  // must flow into matching. Quotes require a match, so a selected-but-
  // unsurfaced participant could never be quoted. These are the requester's
  // deliberate choices, not a trust-based override.
  const requesterSelected = new Map(); // participantId -> Set(capabilityIds)
  for (const link of store.filter(
    "requestParticipants",
    (x) =>
      x.requestId === r.id &&
      x.origin === "requester_selected" &&
      x.status === "potential",
  )) {
    if (!requesterSelected.has(link.participantId))
      requesterSelected.set(link.participantId, new Set());
    requesterSelected.get(link.participantId).add(link.capabilityId);
  }

  const candidates = capabilityCandidates({
    text: demandTerms(r).join(" "),
    category: r.category,
    location: r.deliveryLocation || r.location,
    limit: 300,
  });
  const groups = new Map();
  const seenCapability = new Set();
  const addAssessment = (a, participantId) => {
    if (!a || seenCapability.has(a.capabilityId)) return;
    seenCapability.add(a.capabilityId);
    if (!groups.has(participantId)) groups.set(participantId, []);
    groups.get(participantId).push(a);
  };
  for (const c of candidates.capabilities) {
    const raw = supply.rawEnterprise(c.participantId);
    if (raw.ownerId === userId) continue;
    const p = supply.getEnterprise(null, c.participantId, {
        includeCapabilities: false,
      }),
      cv = supply.getCapability(null, c.id),
      a = assessCapability(r, p, cv, { now });
    if (!a) continue;
    // A capability surfaced by BOTH the text search AND the requester's own
    // shortlist must carry the explainable requester-selected reason.
    if (requesterSelected.get(p.id)?.has(c.id)) {
      a.requesterSelected = true;
      a.matchReasons = [
        ...(a.matchReasons ?? []),
        { code: "requester_selected", text: "You selected this participant." },
      ];
    }
    addAssessment(a, p.id);
  }
  // Surface requester-selected participants even when the text search did not
  // surface them (capability wording may have drifted). Assessed honestly; if
  // the capability cannot overlap the request terms, an explicit "you selected
  // this participant" reason replaces a silent drop.
  for (const [participantId, capabilityIds] of requesterSelected) {
    for (const capabilityId of capabilityIds) {
      if (seenCapability.has(capabilityId)) continue;
      try {
        const raw = supply.rawEnterprise(participantId);
        if (raw.ownerId === userId) continue;
        const p = supply.getEnterprise(null, participantId, {
            includeCapabilities: false,
          }),
          cv = supply.getCapability(null, capabilityId);
        const a = assessCapability(r, p, cv, { now });
        if (a) {
          a.requesterSelected = true;
          addAssessment(a, participantId);
        } else {
          addAssessment(
            {
              capabilityId,
              score: 0,
              relevance: 0,
              quantity: "unknown",
              location: "unknown",
              time: "unknown",
              tier: "potential",
              requesterSelected: true,
              matchReasons: [
                {
                  code: "requester_selected",
                  text: "You selected this participant. Capability overlap with this Request needs confirmation.",
                },
              ],
              warnings: [
                {
                  code: "selected_no_overlap",
                  text: "This participant was selected by you but its stated capability does not clearly overlap the Request terms. Confirm before requesting a quote.",
                },
              ],
            },
            participantId,
          );
        }
      } catch {
        // Archived / no-longer-public participant: skip rather than surface a
        // broken match. The shortlist still lists it as unavailable.
      }
    }
  }
  const ranked = [...groups]
    .map(([participantId, assessments]) => ({
      participantId,
      assessments: assessments
        .sort(
          (a, b) =>
            b.score - a.score || a.capabilityId.localeCompare(b.capabilityId),
        )
        .slice(0, 3),
    }))
    .sort(
      (a, b) =>
        b.assessments[0].score - a.assessments[0].score ||
        a.participantId.localeCompare(b.participantId),
    )
    .slice(0, LIMIT);
  return store.transaction(() => {
    const generatedAt = new Date(now).toISOString(),
      expiresAt = deadline(now),
      keep = new Set();
    for (const group of ranked) {
      const { participantId, assessments } = group,
        best = assessments[0],
        ids = assessments.map((a) => a.capabilityId),
        current = publicSupply(participantId, ids),
        previous = old.find((m) => m.participantId === participantId);
      const e = v.event(userId, previous ? "match_refreshed" : "match_created");
      const row = {
        id: previous?.id ?? newId("match"),
        requestId: r.id,
        participantId,
        capabilityId: best.capabilityId,
        capabilityIds: ids,
        requestRevision: requestVersion(r),
        algorithmVersion: ALGORITHM,
        supplyFingerprint: current.fingerprint,
        rankingValue: best.score,
        assessments,
        matchType:
          current.p.supplyRole === "hybrid"
            ? "hybrid"
            : current.caps[0].supplyMode === "source"
              ? "source"
              : "direct",
        tier: best.tier,
        matchReasons: best.matchReasons,
        warnings: best.warnings,
        requesterSelected: Boolean(best.requesterSelected),
        signals: {
          quantity: best.quantity,
          location: best.location,
          time: best.time,
          verified: current.caps[0].verification.status === "verified",
        },
        requesterState: previous?.requesterState ?? "suggested",
        status: previous?.requesterState ?? "suggested",
        revision: (previous?.revision ?? 0) + 1,
        createdAt: previous?.createdAt ?? generatedAt,
        updatedAt: generatedAt,
        expiresAt,
        history: [...(previous?.history ?? []), e],
      };
      if (assessments.length > 1)
        row.warnings = [
          ...row.warnings,
          {
            code: "multiple_capabilities",
            text: "Several capabilities overlap. Compatibility reasons describe the best-fit capability, not a combined fulfillment promise.",
          },
        ];
      const stored = previous
        ? store.update("matches", row.id, row)
        : store.insert("matches", row);
      keep.add(row.id);
      v.audit("match", row.id, e, row.revision);
      // A NEW candidate is an event; a re-scored existing one is not. Without
      // this, "match_workers" had no event to react to, so nothing downstream
      // could know that a request had suppliers to choose between.
      if (!previous) {
        announce("match_suggested", {
          entityKind: "match",
          entityId: row.id,
          // The request is the process: everything that happens because of it
          // shares its correlation id.
          correlationId: row.requestId,
          metadata: {
            matchId: row.id,
            requestId: row.requestId ?? null,
            participantId: row.participantId ?? null,
            capabilityId: row.capabilityId ?? null,
            score: row.score ?? null,
            candidates: keep.size
          }
        });
      }
    }
    for (const m of old)
      if (!keep.has(m.id) && m.status !== "expired") {
        const e = v.event(userId, "match_expired");
        store.update("matches", m.id, {
          status: "expired",
          revision: m.revision + 1,
          history: [...m.history, e],
        });
        v.audit("match", m.id, e, m.revision);
      }
    const e = {
      ...v.event(
        userId,
        r.matchingState ? "match_refreshed" : "matching_started",
      ),
      fromStatus: r.status,
      toStatus: r.status,
    };
    const matchingState = {
      revision: (r.matchingState?.revision ?? 0) + 1,
      requestRevision: requestVersion(r),
      algorithmVersion: ALGORITHM,
      generatedAt,
      expiresAt,
      candidateCount: candidates.candidateCount,
      evaluatedCount: candidates.capabilities.length,
      limited: candidates.limited || groups.size > LIMIT,
      matchCount: ranked.length,
      idempotencyKey,
    };
    store.update("requests", r.id, {
      matchingState,
      history: [...r.history, e],
    });
    v.audit("request", r.id, e, r.revision);
    return list(userId, r.id);
  });
}
export function generate(userId, id, input) {
  const r = owner(userId, id);
  v.fields(
    input,
    ["requestRevision", "generationRevision", "idempotencyKey"],
    "matching refresh",
  );
  v.revision(r, input.requestRevision);
  const key =
    input.idempotencyKey == null
      ? null
      : v.text(input.idempotencyKey, 128, "idempotencyKey", 16);
  if (key && key === r.matchingState?.idempotencyKey) {
    if (r.matchingState.requestRevision !== requestVersion(r))
      v.fail(
        "This refresh key belongs to earlier requirements",
        409,
        "idempotency_conflict",
      );
    return list(userId, id);
  }
  if (
    !Number.isSafeInteger(input.generationRevision) ||
    input.generationRevision < 0
  )
    v.fail("generationRevision is required");
  if (input.generationRevision !== (r.matchingState?.revision ?? 0))
    v.fail(
      "Matches changed. Reload before refreshing.",
      409,
      "revision_conflict",
    );
  return generateForRequest(userId, r, { idempotencyKey: key });
}
export function list(userId, id, filters = {}) {
  const r = owner(userId, id);
  v.fields(
    filters,
    ["role", "location", "verification", "capacity", "turnaround", "tab"],
    "match filters",
  );
  const role = filters.role
    ? v.choice(filters.role, ["direct", "source", "hybrid"], "role")
    : null;
  const loc = filters.location
    ? v.text(filters.location, 160, "location").toLowerCase()
    : null;
  const verification = filters.verification
    ? v.choice(filters.verification, ["verified"], "verification")
    : null;
  const capacity = filters.capacity
    ? v.choice(filters.capacity, ["compatible", "known"], "capacity")
    : null;
  const time = filters.turnaround
    ? v.choice(filters.turnaround, ["compatible", "known"], "turnaround")
    : null;
  const tab = filters.tab
    ? v.choice(
        filters.tab,
        ["suggested", "saved", "interested", "dismissed"],
        "tab",
      )
    : null;
  const all = store
    .indexed("matches", "requestId", id)
    .sort(
      (a, b) =>
        b.rankingValue - a.rankingValue ||
        a.participantId.localeCompare(b.participantId),
    )
    .map((m) => view(r, m));
  const generation = r.matchingState
    ? { ...r.matchingState, idempotencyKey: undefined }
    : null;
  const stale =
    !!generation &&
    (!activeDemand(r) ||
      requestVersion(r) !== generation.requestRevision ||
      Date.now() >= Date.parse(generation.expiresAt) ||
      generation.algorithmVersion !== ALGORITHM ||
      all.some(
        (m) =>
          m.stale &&
          m.requestRevision === generation.requestRevision &&
          store.lookup("matches", m.id).status !== "expired",
      ));
  const matches = all.filter(
    (m) =>
      (!role || m.matchType === role) &&
      (!loc || m.participant?.location.toLowerCase().includes(loc)) &&
      (!verification || m.signals?.verified) &&
      (!capacity ||
        (capacity === "compatible"
          ? m.signals?.quantity === "compatible"
          : m.capabilities.some(
              (c) =>
                c.typicalCapacity !== null ||
                c.maximumQuantity !== null ||
                c.availableCapacity !== null,
            ))) &&
      (!time ||
        (time === "compatible"
          ? m.signals?.time === "compatible"
          : m.capabilities.some((c) => c.leadTime.maxDays !== null))) &&
      (!tab ||
        (tab === "interested"
          ? m.interested
          : tab === "suggested"
            ? ["suggested", "viewed"].includes(m.requesterState)
            : m.requesterState === tab)),
  );
  return {
    requestId: id,
    requestRevision: r.revision,
    requestStatus: r.status,
    generation,
    stale,
    matches,
    counts: {
      suggested: all.filter(
        (m) => !m.stale && ["suggested", "viewed"].includes(m.requesterState),
      ).length,
      saved: all.filter((m) => m.requesterState === "saved").length,
      interested: all.filter((m) => m.interested).length,
      dismissed: all.filter((m) => m.requesterState === "dismissed").length,
    },
  };
}
export function get(userId, id) {
  const m = match(id),
    r = owner(userId, m.requestId);
  return view(r, m);
}
export function act(userId, id, input) {
  const m = match(id),
    r = owner(userId, m.requestId);
  v.fields(input, ["status", "revision", "requestRevision"], "match action");
  v.revision(r, input.requestRevision);
  const status = v.choice(
    input.status,
    ["viewed", "saved", "dismissed", "suggested"],
    "match status",
  );
  if (!Number.isSafeInteger(input.revision) || input.revision < 1)
    v.fail("revision is required");
  const stale = staleReason(r, m);
  if (stale && status !== "dismissed")
    v.fail(
      "Requirements or supply changed. Refresh matches.",
      409,
      "stale_match",
    );
  if (m.status === status && m.requesterState === status) return view(r, m); // lost response retry; never undo another action
  v.revision(m, input.revision);
  if (status === "viewed" && !["suggested", "viewed"].includes(m.status))
    v.fail("Only suggestions can be marked viewed", 409, "invalid_transition");
  const e = v.event(userId, `match_${status}`);
  store.update("matches", id, {
    status: stale ? "expired" : status,
    requesterState: status,
    revision: m.revision + 1,
    history: [...m.history, e],
  });
  v.audit("match", id, e, m.revision);
  return view(r, m);
}
function participant(userId, m) {
  const p = supply.ownEnterprise(userId, m.participantId);
  return p;
}
function visibleToParticipant(r, m) {
  if (!r || !activeDemand(r)) return false;
  // A private, explicitly addressed quote request is a scoped grant, not
  // public demand. Its validity is independent of the daily suggestion TTL.
  const invited = store.indexed("quoteRequests", "matchId", m.id).find(i=>i.requestRevision===requestVersion(r));
  if (invited) {
    try { if (currentMatchSupply(m).fingerprint===invited.supplyFingerprint) return true; } catch {}
  }
  return r.visibility === "public" && m.status !== "dismissed" && !staleReason(r,m);
}
function brief(r, m) {
  const interest = interestRow(m);
  return {
    matchId: m.id,
    matchRevision: m.revision,
    participantId: m.participantId,
    requestId: r.id,
    requestRevision: r.revision,
    title: r.title,
    category: r.category,
    quantity: r.quantity,
    unit: r.unit,
    location: r.location,
    requiredBy: r.requiredBy,
    capabilities: m.capabilityIds.map((id) => {
      const c = supply.getCapability(null, id);
      return { id: c.id, name: c.name, supplyMode: c.supplyMode };
    }),
    reason:
      "Your stated capability overlaps the requested product or service. Details and availability still need confirmation.",
    interest: interest
      ? {
          id: interest.id,
          status: interest.status,
          revision: interest.revision,
          requestRevision: interest.requestRevision,
          current:
            interest.requestRevision === requestVersion(r) &&
            interest.supplyFingerprint === m.supplyFingerprint,
        }
      : null,
  };
}
export function relevantRequests(userId) {
  v.actor(userId);
  const p = store
    .indexed("vendors", "ownerId", userId)
    .find((p) => p.enterprise);
  if (!p) return { requests: [] };
  return {
    requests: store
      .indexed("matches", "participantId", p.id)
      .filter((m) =>
        visibleToParticipant(store.lookup("requests", m.requestId), m),
      )
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
      )
      .slice(0, 50)
      .map((m) => brief(store.lookup("requests", m.requestId), m)),
  };
}
export function expressInterest(userId, id, input) {
  const m = match(id);
  participant(userId, m);
  const r = store.lookup("requests", m.requestId);
  v.fields(input, ["requestRevision", "revision"], "interest");
  if (!visibleToParticipant(r, m))
    v.fail("Request not available to this participant", 404, "not_found");
  v.revision(r, input.requestRevision);
  if (!Number.isSafeInteger(input.revision) || input.revision < 1)
    v.fail("revision is required");
  const old = interestRow(m);
  if (
    old?.status === "interested" &&
    old.requestRevision === requestVersion(r) &&
    old.supplyFingerprint === m.supplyFingerprint
  )
    return brief(r, m);
  v.revision(m, input.revision);
  const e = v.event(userId, "participant_interested"),
    now = new Date().toISOString();
  const data = {
    requestId: r.id,
    participantId: m.participantId,
    capabilityId: m.capabilityId,
    capabilityIds: m.capabilityIds,
    matchId: m.id,
    supplyMode: supply.getCapability(null, m.capabilityId).supplyMode,
    origin: "participant_interest",
    status: "interested",
    supplyFingerprint: m.supplyFingerprint,
    requestRevision: requestVersion(r),
    revision: (old?.revision ?? 0) + 1,
    createdAt: old?.createdAt ?? now,
    updatedAt: now,
    history: [...(old?.history ?? []), e],
    provenance: null,
  };
  const row = old
    ? store.update("requestParticipants", old.id, data)
    : store.insert("requestParticipants", { ...data, id: newId("rpart") });
  v.audit("requestParticipant", row.id, e, row.revision);
  return brief(r, m);
}
export function withdrawInterest(userId, id, input) {
  const m = match(id);
  participant(userId, m);
  v.fields(input, ["revision"], "withdraw interest");
  const old = interestRow(m);
  if (!old) v.fail("Interest not found", 404, "not_found");
  if (old.status === "withdrawn") return { withdrawn: true };
  v.revision(old, input.revision);
  const e = v.event(userId, "participant_interest_withdrawn");
  store.update("requestParticipants", old.id, {
    status: "withdrawn",
    revision: old.revision + 1,
    history: [...old.history, e],
  });
  v.audit("requestParticipant", old.id, e, old.revision);
  return { withdrawn: true };
}
