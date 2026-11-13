// Pure rules shared by the form and its tests. They mirror the backend, which is the authority.

export const KINDS = [
  { value: "goods", label: "Goods (stock on your shelf)" },
  { value: "service", label: "Service (a visit or an appointment)" },
  { value: "tool", label: "Tool or rental" },
];

export const PRICE_MODES = [
  { value: "fixed", label: "Fixed price", hint: "A set amount. Required." },
  { value: "negotiable", label: "Negotiable", hint: "Shown as a starting point. Optional." },
  { value: "ask_me", label: "Ask me", hint: "No price is shown. People contact you for one." },
];

/** Ways a service can be given. Each one has its own price and unit. Must match the backend (SERVICE_MODES). */
export const SERVICE_MODES = [
  { value: "in_shop", label: "In shop or at my place" },
  { value: "home_visit", label: "Home visit" },
  { value: "remote", label: "Remote or online" },
  { value: "drop_off", label: "Drop-off" },
  { value: "pickup_delivery", label: "Pickup & delivery" },
];
export const MAX_MODES = 5;

export const TOOL_CATEGORIES = [
  "warehouse", "transport", "courier", "popup_shop", "hotel_sourcing",
  "equipment", "packaging", "cold_storage",
].map((v) => ({ value: v, label: v.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) }));

/** Phase 6: service domains. Must match the backend list (app/modules/schedule/domains.py). */
export const SERVICE_DOMAINS = [
  { value: "healthcare_care", label: "Healthcare & Care" },
  { value: "trades_technical", label: "Trades & Technical" },
  { value: "personal_care_beauty", label: "Personal Care & Beauty" },
  { value: "logistics_delivery", label: "Logistics & Delivery" },
  { value: "market_retail", label: "Market & Retail Support" },
  { value: "other_services", label: "Other Services" },
];

export const MAX_PHOTOS = 8;
export const MAX_RADIUS_KM = 500;

/** Returns { field: message } for anything wrong. An empty object means it can be sent. */
export function validateOffering(form, kind) {
  const errors = {};
  if (!form.title || form.title.trim().length < 2) errors.title = "Give it a name of at least 2 characters.";
  if (form.price_mode === "fixed") {
    if (form.price === "" || form.price == null || Number.isNaN(Number(form.price)) || Number(form.price) < 0) {
      errors.price = "A fixed price needs an amount, or choose Negotiable or Ask me.";
    }
  }
  if (form.price_mode !== "ask_me" && form.price !== "" && form.price != null) {
    if (Number(form.price) < 0 || Number(form.price) > 10000000) errors.price = "Price must be 0 to 10,000,000.";
  }
  if (kind === "goods" && form.quantity !== "" && form.quantity != null) {
    if (!Number.isInteger(Number(form.quantity)) || Number(form.quantity) < 0) errors.quantity = "Quantity must be a whole number.";
  }
  if (kind === "service" && form.duration_minutes !== "" && form.duration_minutes != null) {
    const d = Number(form.duration_minutes);
    if (!Number.isInteger(d) || d < 1 || d > 480) errors.duration_minutes = "Duration must be 1 to 480 minutes.";
  }
  if (kind === "service") {
    if (!form.modes?.length) errors.modes = "Add at least one way the service is given.";
    const used = new Set();
    (form.modes || []).forEach((m, i) => {
      if (!m.mode) errors[`mode_${i}`] = "Choose a way of giving the service.";
      else if (used.has(m.mode)) errors[`mode_${i}`] = "Each way can be listed once.";
      used.add(m.mode);
      if (m.price_mode === "fixed" && (m.price === "" || m.price == null || Number(m.price) < 0)) {
        errors[`price_${i}`] = "A fixed price needs an amount, or choose Negotiable or Ask me.";
      }
      if (m.price_mode !== "ask_me" && m.price !== "" && m.price != null && Number(m.price) > 10000000) {
        errors[`price_${i}`] = "Price must be 0 to 10,000,000.";
      }
    });
  }
  if (kind !== "goods" && form.service_radius_km !== "" && form.service_radius_km != null) {
    const r = Number(form.service_radius_km);
    if (!Number.isInteger(r) || r < 1 || r > MAX_RADIUS_KM) errors.service_radius_km = `Radius must be 1 to ${MAX_RADIUS_KM} km.`;
  }
  const links = photoLinks(form.photos);
  if (links.length > MAX_PHOTOS) errors.photos = `At most ${MAX_PHOTOS} photos.`;
  else if (links.some((l) => !l.startsWith("https://"))) errors.photos = "Each photo must be an https:// link.";
  if (kind === "tool" && !form.category) errors.category = "Choose a category.";
  return errors;
}

export const photoLinks = (text) =>
  String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** Builds the request body. Ask me sends no price; a blank optional number is not sent. */
export function buildPayload(form, kind) {
  const num = (v) => (v === "" || v == null ? undefined : Number(v));
  const body = {
    title: form.title.trim(),
    description: form.description?.trim() || null,
    photos: photoLinks(form.photos),
  };
  if (kind === "service") {
    // Services carry their prices per way of giving them. The top-level price is derived by the backend.
    body.modes = (form.modes || []).map((m) => ({
      mode: m.mode,
      price_mode: m.price_mode || "fixed",
      ...(m.price_mode !== "ask_me" && m.price !== "" && m.price != null ? { price: Number(m.price) } : {}),
      price_unit: m.price_unit?.trim() || null,
    }));
  } else {
    body.price_mode = form.price_mode;
    if (form.price_mode !== "ask_me") body.price = num(form.price) ?? null;
    if (form.price_unit?.trim()) body.price_unit = form.price_unit.trim();
  }
  if (kind === "goods") {
    body.category = form.category?.trim() || null;
    body.quantity = num(form.quantity) ?? 0;
  }
  if (kind === "tool") body.category = form.category;
  if (kind === "service") {
    body.duration_minutes = num(form.duration_minutes) ?? 30;
    // Blank clears the domain on edit; an unchanged domain is sent back as it was loaded.
    body.domain = form.domain || null;
  }
  if (kind !== "goods") body.service_radius_km = num(form.service_radius_km) ?? null;
  return body;
}

export const emptyForm = () => ({
  title: "", description: "", category: "", price_mode: "fixed", price: "", price_unit: "",
  quantity: "", duration_minutes: "30", service_radius_km: "", photos: "", domain: "",
  modes: [],
});

/** One empty way of giving a service, ready for the form. */
export const emptyMode = (mode = "") => ({ mode, price_mode: "fixed", price: "", price_unit: "" });

/** The form for editing an existing offering. */
export function formFromOffering(item) {
  return {
    ...emptyForm(),
    title: item.title || "",
    description: item.description || "",
    category: item.category || "",
    price_mode: item.price_mode || "fixed",
    price: item.price == null ? "" : String(item.price),
    price_unit: item.price_unit || "",
    quantity: item.quantity == null ? "" : String(item.quantity),
    service_radius_km: item.service_radius_km == null ? "" : String(item.service_radius_km),
    photos: (item.photos || []).join("\n"),
    domain: item.domain || "",
    modes: (item.modes || []).map((m) => ({
      mode: m.mode, price_mode: m.price_mode || "fixed",
      price: m.price == null ? "" : String(m.price), price_unit: m.price_unit || "",
    })),
  };
}
