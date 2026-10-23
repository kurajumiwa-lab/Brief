import { create } from "zustand";

/**
 * THE UNIFIED CREATION STORE — primary 4 Local Activity Ledger types
 * (`available`, `wanted`, `scheduled`, `opportunity`) + backward-compatible
 * classic content types (`post`, `event`, `listing`, `community`, `collection`),
 * with live drafts and fractional agricultural quantities.
 */

const DRAFT_KEY = "outside.create.draft.v1";
const DISMISS_KEY = "outside.onboarding.dismissed.v1";

/** Shared by every content type. Order is display order. */
export const SHARED_FIELDS = ["title", "body", "media", "category", "tags", "location", "visibility"];

export const LEDGER_PRIMARY_TYPES = new Set(["available", "wanted", "scheduled"]);

/**
 * What each type adds — and what it *requires*.
 * Note what is absent: no type requires a price.
 */
export const TYPE_FIELDS = {
  // ── 4 Primary Local Activity Ledger posting types ─────────────────────────
  available: {
    required: ["title"],
    fields: [
      "quantity", "unit", "schedule_label", "private_directions", "use_home_storefront",
      "starts_at", "expires_at", "audience", "price_kes",
    ],
    bodyLabel: "What are you offering or sharing?",
    bodyPlaceholder: "e.g. Fence & gate repair around Kisii, 15 bales of Napier grass, or a wheelbarrow neighbours can borrow…",
  },
  wanted: {
    required: ["title"],
    fields: [
      "urgency", "quantity", "unit", "private_directions",
      "starts_at", "expires_at", "audience", "price_kes",
    ],
    bodyLabel: "What help, repair, or shared order do you need?",
    bodyPlaceholder: "e.g. Broken timber fence along compound edge, or looking for 3 neighbours to split a 2.5-tonne fodder lorry…",
  },
  scheduled: {
    required: ["title"],
    fields: [
      "schedule_label", "starts_at", "ends_at", "capacity", "private_directions",
      "audience", "price_kes",
    ],
    bodyLabel: "How will the round, session, or pickup window work?",
    bodyPlaceholder: "e.g. Visiting Muthaiga North & Ridgeways this Thursday 9am–4pm for shoe & leather repairs — request a private household stop…",
  },

  // ── Classic 6 types (`opportunity` doubles as the 4th primary type!) ──────
  post: {
    required: ["body"],
    fields: ["post_type", "starts_at", "expires_at", "audience", "response_kind", "price_kes"],
    bodyLabel: "What's happening?",
    bodyPlaceholder: "Say what you're up to, what you need, or what you recommend…",
  },
  event: {
    required: ["title", "starts_at"],
    fields: ["starts_at", "ends_at", "capacity", "is_virtual", "virtual_link", "audience", "response_kind", "price_kes"],
    bodyLabel: "What should people know?",
    bodyPlaceholder: "What to bring, where to meet, what to expect…",
  },
  listing: {
    required: ["title"],
    fields: ["quantity", "unit", "min_order_quantity", "price_kes", "wholesale_price_kes"],
    bodyLabel: "Describe it",
    bodyPlaceholder: "Condition, quantity, how to collect…",
  },
  community: {
    required: ["title"],
    fields: ["group_type", "requires_approval", "tags"],
    bodyLabel: "What is this community about?",
    bodyPlaceholder: "Who it's for, what happens, how often…",
  },
  collection: {
    required: ["title"],
    fields: ["capacity", "requires_approval"],
    bodyLabel: "What's in this collection?",
    bodyPlaceholder: "What you've gathered and why it's worth reading…",
  },
  opportunity: {
    required: ["body"],
    fields: [
      "request_type", "urgency", "schedule_label", "private_directions",
      "starts_at", "expires_at", "audience", "response_kind", "price_kes",
    ],
    bodyLabel: "What opportunity, task, or supervised help are you posting?",
    bodyPlaceholder: "Be specific about what would help, the time window, and any supervision…",
  },
};

/** The options each optional field offers. One source, used by the form. */
export const FIELD_OPTIONS = {
  post_type: [
    { value: "post", label: "An update" },
    { value: "question", label: "A question" },
    { value: "recommendation", label: "A recommendation" },
    { value: "notice", label: "A notice" },
  ],
  visibility: [
    { value: "public", label: "Everyone" },
    { value: "saved_contacts", label: "Saved local contacts only" },
    { value: "community", label: "My communities" },
    { value: "private", label: "Only me" },
  ],
  audience: [
    { value: "everyone", label: "Everyone" },
    { value: "nearby", label: "People nearby" },
    { value: "neighbourhood", label: "My neighbourhood" },
    { value: "saved_contacts", label: "Saved contacts only" },
    { value: "community", label: "A community" },
    { value: "invited", label: "People I invite" },
  ],
  response_kind: [
    { value: "reply", label: "Reply" },
    { value: "quote", label: "Send quote" },
    { value: "join", label: "Join" },
    { value: "rsvp", label: "RSVP" },
    { value: "offer_help", label: "Offer help" },
    { value: "enquire", label: "Enquire" },
    { value: "buy", label: "Buy" },
    { value: "none", label: "No response needed" },
  ],
  group_type: [
    { value: "open", label: "Open — anyone can join" },
    { value: "niche", label: "Interest group" },
    { value: "regional", label: "Neighbourhood or area" },
    { value: "trade", label: "Trade or profession" },
    { value: "sourcing", label: "Buying together" },
    { value: "event", label: "Around an event" },
  ],
  request_type: [
    { value: "", label: "Not a commercial request" },
    { value: "stock", label: "Goods or stock" },
    { value: "worker", label: "Someone to work" },
    { value: "delivery", label: "Delivery or transport" },
    { value: "rental", label: "Something to rent" },
    { value: "errand", label: "An errand" },
    { value: "service", label: "A service" },
  ],
  urgency: [
    { value: "today", label: "Today" },
    { value: "tomorrow", label: "Tomorrow" },
    { value: "this_week", label: "This week" },
    { value: "flexible", label: "Flexible" },
  ],
  unit: [
    "units", "bales", "kg", "tonnes", "trays", "sacks", "crates", "pieces",
    "boxes", "litres", "metres", "cartons", "days",
  ].map((u) => ({ value: u, label: u })),
};

const blank = () => ({
  content_type: "post",
  use_ledger: false,
  title: "",
  body: "",
  category: "",
  tags: "",
  location: "",
  private_directions: "",
  schedule_label: "",
  use_home_storefront: false,
  visibility: "public",
  audience: "nearby",
  response_kind: "reply",
  post_type: "post",
  starts_at: "",
  ends_at: "",
  expires_at: "",
  capacity: "",
  is_virtual: false,
  virtual_link: "",
  quantity: "",
  unit: "units",
  min_order_quantity: "",
  price_kes: "",
  wholesale_price_kes: "",
  group_type: "open",
  requires_approval: false,
  request_type: "",
  urgency: "flexible",
  template_fields: {},
  permission_rules: {},
  media: [],
});

const readDraft = () => {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeDraft = (draft) => {
  try {
    if (hasContent(draft)) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage full or blocked */
  }
};

/** True when a draft is worth keeping — an empty form is not a draft. */
export function hasContent(draft) {
  if (!draft) return false;
  return Boolean(
    (draft.title || "").trim() ||
    (draft.body || "").trim() ||
    (draft.location || "").trim() ||
    (draft.private_directions || "").trim() ||
    (draft.media || []).length,
  );
}

/** The fields this content type shows. Shared first, then its own. */
export function fieldsFor(contentType) {
  const spec = TYPE_FIELDS[contentType] || TYPE_FIELDS.post;
  return [...SHARED_FIELDS.filter((f) => !(spec.required.includes(f) && f === "tags")), ...spec.fields];
}

/** Required-but-empty fields — the same list the server would return. */
export function missingFields(draft) {
  const spec = TYPE_FIELDS[draft.content_type] || TYPE_FIELDS.post;
  return spec.required.filter((field) => !(draft[field] || "").toString().trim());
}

export const useCreateStore = create((set, get) => ({
  draft: { ...blank(), ...(readDraft() || {}) },
  submitting: false,
  error: "",
  lastPublished: null,

  /** Switch type without losing what you have already written. */
  setType: (content_type, opts = {}) => {
    const use_ledger =
      opts.use_ledger !== undefined
        ? Boolean(opts.use_ledger)
        : LEDGER_PRIMARY_TYPES.has(content_type);
    const next = { ...get().draft, content_type, use_ledger };
    set({ draft: next, error: "" });
    writeDraft(next);
  },

  setField: (field, value) => {
    const next = { ...get().draft, [field]: value };
    set({ draft: next });
    writeDraft(next);
  },

  setTemplateField: (key, value) => {
    const current = get().draft.template_fields || {};
    const nextFields = { ...current, [key]: value };
    const next = { ...get().draft, template_fields: nextFields };
    set({ draft: next });
    writeDraft(next);
  },

  setPermissionRule: (key, value) => {
    const current = get().draft.permission_rules || {};
    const nextRules = { ...current, [key]: value };
    const next = { ...get().draft, permission_rules: nextRules };
    set({ draft: next });
    writeDraft(next);
  },

  addMedia: (reference) => {
    const next = { ...get().draft, media: [...(get().draft.media || []), reference] };
    set({ draft: next });
    writeDraft(next);
  },

  removeMedia: (index) => {
    const media = [...(get().draft.media || [])];
    media.splice(index, 1);
    const next = { ...get().draft, media };
    set({ draft: next });
    writeDraft(next);
  },

  /** What goes over the wire. Empty strings become absent fields. */
  payload: () => {
    const draft = get().draft;
    const spec = TYPE_FIELDS[draft.content_type] || TYPE_FIELDS.post;
    const isLedger = LEDGER_PRIMARY_TYPES.has(draft.content_type) || Boolean(draft.use_ledger);
    const allowed = new Set([
      ...SHARED_FIELDS,
      ...spec.fields,
      "content_type",
      ...(isLedger ? ["use_ledger", "posting_type", "template_fields", "permission_rules"] : []),
    ]);

    const out = {};
    for (const [key, value] of Object.entries(draft)) {
      if (!allowed.has(key)) continue;
      if (value === "" || value === null || value === undefined) continue;
      if (key === "use_home_storefront" && !value) continue;
      if (key === "use_ledger" && !value) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      if (key === "template_fields" || key === "permission_rules") {
        const cleaned = Object.fromEntries(
          Object.entries(value || {}).filter(([, v]) => v !== "" && v !== null && v !== undefined && v !== false),
        );
        if (Object.keys(cleaned).length > 0) out[key] = cleaned;
        continue;
      }
      if (key === "tags" && typeof value === "string") {
        const tags = value.split(",").map((t) => t.trim()).filter(Boolean);
        if (tags.length) out.tags = tags;
        continue;
      }
      if (key === "price_kes" || key === "wholesale_price_kes" || key === "capacity" || key === "min_order_quantity") {
        const n = Number(value);
        if (Number.isFinite(n)) out[key] = Math.round(n);
        continue;
      }
      if (key === "quantity") {
        const n = Number(value);
        if (Number.isFinite(n)) {
          // Ledger activities support fractional agricultural quantities (e.g., 2.5 tonnes / 12.5 bales);
          // legacy `listing` expects integer stock count.
          out[key] = isLedger ? n : Math.round(n);
        }
        continue;
      }
      if (key === "request_type" && value === "") continue;
      out[key] = value;
    }

    if (isLedger) {
      out.posting_type = draft.content_type;
      out.use_ledger = true;
    }
    return out;
  },

  publish: async (create) => {
    const missing = missingFields(get().draft);
    if (missing.length) {
      set({ error: `A ${get().draft.content_type} needs ${missing.join(" and ")}.`, submitting: false });
      return { ok: false, missing };
    }
    set({ submitting: true, error: "" });
    try {
      const result = await create(get().payload());
      set({ submitting: false, lastPublished: result, draft: blank() });
      writeDraft(null);
      return { ok: true, result };
    } catch (err) {
      const detail = err?.response?.data?.detail;
      const message = typeof detail === "string"
        ? detail
        : detail?.message || "That didn't publish. Your draft is still here — try again.";
      set({ submitting: false, error: message });
      return { ok: false, error: message };
    }
  },

  discard: () => {
    set({ draft: blank(), error: "", lastPublished: null });
    writeDraft(null);
  },

  restore: () => readDraft(),
  hasDraft: () => hasContent(get().draft),
}));

/** The first-run location prompt is dismissed once, and stays dismissed. */
export const onboardingDismissed = () => {
  try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
};
export const dismissOnboarding = () => {
  try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* nothing to do */ }
};
