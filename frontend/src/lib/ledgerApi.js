import api from "@/lib/api";

const noEmpty = (o = {}) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v !== null && v !== undefined));

const hasHttp = () => typeof api?.get === "function" && typeof api?.post === "function";
const fallback = (data) => Promise.resolve({ data });
const wrap = (promise, transform) =>
  promise.then(({ data, ...rest }) => ({ ...rest, data: transform ? transform(data) : data }));

const TEMPLATE_CATEGORY = {
  repair_artisan: "repairs",
  agricultural_produce_fodder: "agriculture",
  tool_lending: "tools",
  collection_point: "collection_point",
  travelling_round: "artisan_round",
  group_sourcing: "group_sourcing",
  community_learning: "learning",
  supervised_youth_task: "youth_opportunity",
  general: "community",
};

const RESPONSE_TYPE_MAP = {
  quote: "quote",
  supply_offer: "supply_offer",
  offer_help: "quote",
  stop_request: "round_stop_request",
  round_stop_request: "round_stop_request",
  pledge_quantity: "group_pledge",
  group_pledge: "group_pledge",
  join_session: "learning_enrolment",
  learning_enrolment: "learning_enrolment",
  youth_application: "youth_application",
};

function normalizeVendor(v) {
  if (!v) return null;
  return {
    ...v,
    id: v.id,
    handle: v.handle || v.vendor_handle,
    name: v.name || v.business_name || v.display_name,
    account_kind: v.account_kind || "business",
  };
}

export function normalizeActivity(a) {
  if (!a) return a;
  const owner = normalizeVendor(a.owner || a.organizer);
  const stages = Array.isArray(a.lifecycle_stages) ? a.lifecycle_stages : [];
  let ledgerStage = a.ledger_stage || a.lifecycle_status || "published";
  if (stages.length) {
    const done = stages.filter((s) => s.done);
    if (done.length) ledgerStage = done[done.length - 1].key;
  }
  const tf = a.template_fields || {};
  const quantity = a.quantity ?? tf.quantity ?? tf.target_quantity ?? null;
  const unit = a.unit || tf.unit || null;
  const responses = (a.responses || []).map((r) => ({
    ...r,
    responder: normalizeVendor(r.responder),
    response_kind: r.response_kind || r.response_type,
    message: r.message || r.note,
    offered_price_kes: r.offered_price_kes ?? r.quoted_price_kes ?? null,
    quantity_requested: r.quantity_requested ?? r.quantity ?? null,
    availability_note: r.availability_note || r.availability_window || r.proposed_completion_time || null,
    guardian_consent_confirmed:
      r.guardian_consent_confirmed ?? (r.guardian_consent_status ? r.guardian_consent_status === "confirmed" : undefined),
    guardian_name: r.guardian_name || r.guardian_name_and_contact || null,
  }));
  const bookings = (a.bookings || []).map((b) => ({
    ...b,
    initiator: normalizeVendor(b.initiator || b.organizer),
    provider: normalizeVendor(b.provider || b.participant),
    initiator_confirmed_at: b.initiator_confirmed_at || b.organizer_confirmed_at || null,
    provider_confirmed_at: b.provider_confirmed_at || b.participant_confirmed_at || null,
    scheduled_label: b.scheduled_label || b.slot_label || b.scheduled_start || null,
  }));
  const lifecycle = a.lifecycle_status || a.status;
  return {
    ...a,
    owner,
    organizer: owner,
    location: a.location || a.area_name,
    area_name: a.area_name || a.location,
    quantity,
    unit,
    price_unit: a.price_unit || (a.price_basis === "per_unit" ? unit : null),
    ledger_stage: ledgerStage,
    lifecycle_status: lifecycle,
    status: ["cancelled", "expired", "completed"].includes(lifecycle) ? lifecycle : "open",
    private_directions_locked: Boolean(
      a.private_directions_locked ?? ((a.has_private_directions || a.private_directions) && !a.private_directions),
    ),
    has_private_directions: Boolean(a.has_private_directions || a.private_directions),
    responses,
    bookings,
    ledger_events: a.ledger_events || [],
  };
}

function normalizeBookingListItem(item) {
  if (!item) return item;
  if (item.activity_title || item.counterparty) {
    return {
      ...item,
      scheduled_label: item.scheduled_label || item.slot_label || item.scheduled_start || null,
      counterparty: normalizeVendor(item.counterparty),
    };
  }
  // Reusable-record shape is normalized separately below.
  return item;
}

function normalizeRecord(item) {
  if (!item) return item;
  if (item.booking && item.activity) return item;
  const counterparty = normalizeVendor(item.counterparty);
  return {
    ...item,
    booking: {
      id: item.booking_id,
      initiator: item.role === "participant" ? counterparty : null,
      provider: item.role === "participant" ? null : counterparty,
      counterparty,
      settlement_method: item.settlement_method,
      agreed_price_kes: item.agreed_price_kes,
      agreed_quantity: item.agreed_quantity,
      completed_at: item.completed_at,
    },
    activity: {
      id: item.activity_id,
      title: item.title,
      posting_type: item.posting_type,
      inferred_template: item.inferred_template,
      category: item.category,
      area_name: item.area_name,
    },
    counterparty,
  };
}

function normalizeWatch(w) {
  if (!w) return w;
  return {
    ...w,
    posting_type: w.posting_type || (Array.isArray(w.posting_types) ? w.posting_types[0] : "") || "",
    inferred_template: w.inferred_template || (Array.isArray(w.categories) ? w.categories[0] : "") || "",
    keyword: w.keyword || w.keywords || "",
  };
}

function normalizeAlternatives(data) {
  if (!data) return { items: [], alternatives: [], open_activities: [] };
  const open = (data.open_activities || data.items || []).map(normalizeActivity);
  return {
    ...data,
    items: open,
    open_activities: open,
    alternatives: (data.alternatives || []).map(normalizeVendor),
  };
}

function normalizeMetrics(data) {
  if (!data) return data;
  const network = data.network || {};
  const mine = data.mine || data.personal || {};
  return {
    ...data,
    network,
    mine,
    personal: {
      requests_fulfilled: mine.requests_fulfilled ?? mine.completed_records ?? network.requests_fulfilled ?? 0,
      successful_matches:
        mine.successful_matches ??
        (typeof mine.active_bookings === "number" || typeof mine.completed_records === "number"
          ? (mine.active_bookings || 0) + (mine.completed_records || 0)
          : network.successful_matches ?? 0),
      repeat_bookings: mine.repeat_bookings ?? network.repeat_bookings ?? 0,
      notifications_acted_upon: mine.notifications_acted_upon ?? network.notifications_acted_upon ?? 0,
      active_bookings: mine.active_bookings ?? 0,
      completed_records: mine.completed_records ?? mine.requests_fulfilled ?? 0,
    },
  };
}

/**
 * Local Activity Ledger API client (`/api/ledger/*`).
 *
 * This module is the contract adapter between the backend's canonical
 * serialization (`organizer`, `quoted_price_kes`, `organizer_confirmed_at`, …)
 * and the detail/profile screens' presentation shape (`owner`,
 * `offered_price_kes`, `initiator_confirmed_at`, …). Keeping the translation
 * here means pages never depend on two naming schemes at once.
 *
 * It also degrades to resolved empty structures when `@/lib/api` is stubbed
 * in legacy unit specs that do not exercise the ledger.
 */
export const ledgerAPI = {
  templates: () =>
    hasHttp()
      ? api.get("/ledger/templates")
      : fallback({ posting_types: ["available", "wanted", "scheduled", "opportunity"], templates: {} }),

  infer: (params) =>
    hasHttp() ? api.get("/ledger/infer", { params: noEmpty(params) }) : fallback(null),

  listActivities: (params) =>
    hasHttp()
      ? wrap(api.get("/ledger/activities", { params: noEmpty(params) }), (d) => ({
          ...d,
          items: (d?.items || []).map(normalizeActivity),
        }))
      : fallback({ items: [] }),

  createActivity: (body) =>
    hasHttp() ? wrap(api.post("/ledger/activities", body), normalizeActivity) : fallback({}),

  getActivity: (id) =>
    hasHttp() ? wrap(api.get(`/ledger/activities/${id}`), normalizeActivity) : fallback(null),

  respond: (activityId, body = {}) => {
    const payload = {
      response_type: RESPONSE_TYPE_MAP[body.response_type || body.response_kind] || "quote",
      note: body.note || body.message,
      quoted_price_kes: body.quoted_price_kes ?? body.offered_price_kes ?? null,
      quantity: body.quantity ?? body.quantity_requested ?? null,
      unit: body.unit || null,
      availability_window: body.availability_window || body.availability_note || null,
      proposed_completion_time: body.proposed_completion_time || null,
      relevant_experience: body.relevant_experience || null,
      private_stop_directions: body.private_stop_directions || null,
      guardian_name_and_contact: body.guardian_name_and_contact || null,
    };
    return hasHttp() ? api.post(`/ledger/activities/${activityId}/responses`, noEmpty(payload)) : fallback({});
  },

  confirmGuardianConsent: (responseId, body = {}) => {
    const note =
      body.note ||
      [body.guardian_name, body.relationship_to_youth, body.guardian_phone]
        .filter(Boolean)
        .join(" · ");
    const payload = {
      consent_status: body.consent_status || "confirmed",
      note: note || null,
    };
    return hasHttp() ? api.post(`/ledger/responses/${responseId}/guardian-consent`, payload) : fallback({});
  },

  createBooking: (activityId, body = {}) => {
    const payload = {
      response_id: body.response_id || null,
      participant_vendor_id: body.participant_vendor_id || body.provider_vendor_id || null,
      settlement_method: body.settlement_method || "direct_mpesa",
      agreed_price_kes: body.agreed_price_kes ?? null,
      agreed_quantity: body.agreed_quantity ?? null,
      agreed_unit: body.agreed_unit || null,
      scheduled_start: body.scheduled_start || null,
      scheduled_end: body.scheduled_end || null,
      slot_label: body.slot_label || body.scheduled_label || null,
      stop_sequence: body.stop_sequence ?? null,
      share_private_directions: body.share_private_directions ?? true,
      source_booking_id: body.source_booking_id || null,
    };
    return hasHttp() ? api.post(`/ledger/activities/${activityId}/bookings`, noEmpty(payload)) : fallback({});
  },

  myBookings: () =>
    hasHttp()
      ? wrap(api.get("/ledger/bookings/mine"), (d) => ({
          ...d,
          items: (d?.items || []).map(normalizeBookingListItem),
        }))
      : fallback({ items: [] }),

  proposeChange: (bookingId, body = {}) =>
    hasHttp()
      ? api.post(`/ledger/bookings/${bookingId}/changes`, {
          summary: body.summary || body.note || body.kind,
          revised_price_kes: body.revised_price_kes ?? null,
          revised_scope: body.revised_scope || null,
        })
      : fallback({}),

  confirmCompletion: (bookingId, body = {}) =>
    hasHttp() ? api.post(`/ledger/bookings/${bookingId}/confirm-completion`, body) : fallback({}),

  leaveFeedback: (bookingId, body = {}) => {
    const condition = body.work_or_item_condition || body.condition;
    const outcome =
      body.outcome ||
      (condition === "issue_noted"
        ? "issue_reported"
        : condition === "partial"
          ? "completed_with_changes"
          : "completed_as_agreed");
    const payload = {
      outcome,
      would_repeat: body.would_repeat ?? body.would_work_again ?? true,
      tags: body.tags || [body.punctuality, condition].filter(Boolean),
      note: body.note || body.factual_note || null,
    };
    return hasHttp() ? api.post(`/ledger/bookings/${bookingId}/feedback`, payload) : fallback({});
  },

  repeatBooking: (bookingId, body = {}) =>
    hasHttp()
      ? wrap(api.post(`/ledger/bookings/${bookingId}/repeat`, body), (d) => ({
          ...normalizeActivity(d),
          activity_id: d?.id,
        }))
      : fallback({}),

  records: () =>
    hasHttp()
      ? wrap(api.get("/ledger/records"), (d) => ({
          ...d,
          items: (d?.items || []).map(normalizeRecord),
        }))
      : fallback({ items: [] }),

  listWatches: () =>
    hasHttp()
      ? wrap(api.get("/ledger/watches"), (d) => ({
          ...d,
          items: (d?.items || []).map(normalizeWatch),
        }))
      : fallback({ items: [] }),

  createWatch: (body = {}) => {
    const template = body.inferred_template || body.template;
    const payload = {
      label:
        body.label ||
        [body.posting_type, template, body.keyword, body.area_name].filter(Boolean).join(" · ") ||
        "Local watch",
      posting_types: body.posting_types || (body.posting_type ? [body.posting_type] : []),
      categories:
        body.categories || (template ? [TEMPLATE_CATEGORY[template] || template] : []),
      keywords: body.keywords || body.keyword || null,
      area_name: body.area_name || null,
      radius_km: body.radius_km ? Number(body.radius_km) : 10,
      days_of_week: body.days_of_week || [],
      only_youth_eligible: Boolean(body.only_youth_eligible),
    };
    return hasHttp() ? wrap(api.post("/ledger/watches", payload), normalizeWatch) : fallback({});
  },

  deleteWatch: (watchId) =>
    hasHttp() ? api.delete(`/ledger/watches/${watchId}`) : fallback({ deleted: true }),

  markNotificationActed: (notificationId) =>
    hasHttp() ? api.post(`/ledger/notifications/${notificationId}/acted`) : fallback({ ok: true }),

  listRelationships: () =>
    hasHttp()
      ? wrap(api.get("/ledger/relationships"), (d) => ({
          ...d,
          items: (d?.items || []).map((r) => ({ ...r, target: normalizeVendor(r.target) })),
        }))
      : fallback({ items: [] }),

  saveRelationship: (body) =>
    hasHttp() ? api.post("/ledger/relationships", body) : fallback({}),

  deleteRelationship: (relationshipId) =>
    hasHttp() ? api.delete(`/ledger/relationships/${relationshipId}`) : fallback({ deleted: true }),

  alternatives: (params = {}) => {
    const query = {
      category:
        params.category ||
        (params.template ? TEMPLATE_CATEGORY[params.template] || params.template : undefined) ||
        (params.inferred_template
          ? TEMPLATE_CATEGORY[params.inferred_template] || params.inferred_template
          : undefined),
      area: params.area || params.area_name,
      exclude_vendor_id: params.exclude_vendor_id,
    };
    return hasHttp()
      ? wrap(api.get("/ledger/alternatives", { params: noEmpty(query) }), normalizeAlternatives)
      : fallback({ items: [], alternatives: [], open_activities: [] });
  },

  getHomeStorefront: () =>
    hasHttp()
      ? api.get("/ledger/home-storefront")
      : fallback({
          config: {
            enabled: false,
            audience: "saved_contacts",
            share_directions_only_when_booked: true,
          },
        }),

  updateHomeStorefront: (body) =>
    hasHttp() ? api.put("/ledger/home-storefront", body) : fallback({ config: body }),

  metricsSummary: () =>
    hasHttp()
      ? wrap(api.get("/ledger/metrics/summary"), normalizeMetrics)
      : fallback({
          metric_philosophy: "outcomes_not_time_spent",
          personal: {
            requests_fulfilled: 0,
            successful_matches: 0,
            repeat_bookings: 0,
            notifications_acted_upon: 0,
            saved_relationships: 0,
          },
          network: {
            successful_matches: 0,
            requests_fulfilled: 0,
            repeat_bookings: 0,
            notifications_acted_upon: 0,
            active_local_providers_30d: 0,
          },
        }),
};

export default ledgerAPI;
