import axios from "axios";
import { useAuthStore } from "@/stores/authStore";

const api = axios.create({
  baseURL: "/api",
  timeout: 30000,
  headers: { "Content-Type": "application/json" },
});

// Bearer token on every request (store is read lazily to keep the import cycle inert)
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 401 anywhere → try the refresh token once (v2.1), then replay the request;
// if that fails too the session is dead: drop it and let the router bounce to /auth.
let refreshing = null;
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config || {};
    const store = useAuthStore.getState();
    const isAuthCall = String(original.url || "").startsWith("/auth/");
    if (err.response?.status === 401 && store.token && !isAuthCall && !original._retried) {
      original._retried = true;
      try {
        refreshing = refreshing || store.refresh();
        const token = await refreshing;
        refreshing = null;
        if (token) {
          original.headers = { ...(original.headers || {}), Authorization: `Bearer ${token}` };
          return api.request(original);
        }
      } catch {
        refreshing = null;
      }
      useAuthStore.getState().logout();
    }
    return Promise.reject(err);
  }
);

/** Human-readable message from an axios error (FastAPI `detail` may be a string or a list). */
export function apiError(err, fallback = "Something went wrong") {
  const d = err?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d.length) {
    const first = d[0];
    const where = Array.isArray(first?.loc) ? first.loc.slice(-1)[0] : null;
    return where ? `${where}: ${first.msg}` : first.msg || fallback;
  }
  if (err?.code === "ECONNABORTED") return "The server took too long to respond";
  if (err?.message === "Network Error") return "Can't reach the Brief_ API";
  return fallback;
}

const noEmpty = (o = {}) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v !== null && v !== undefined));

// ── Auth ───────────────────────────────────────────────────────────────────
export const authAPI = {
  register: (data) => api.post("/auth/register", data),
  login: (identifier, password) => {
    const form = new URLSearchParams();
    form.append("username", identifier);
    form.append("password", password);
    return api.post("/auth/login", form, { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  },
  refresh: (refreshToken) => api.post("/auth/refresh", { refresh_token: refreshToken }),
  changePassword: (data) => api.post("/auth/change-password", data), // { current_password, new_password }
};

// ── Vendors ────────────────────────────────────────────────────────────────
export const vendorAPI = {
  me: () => api.get("/vendors/me"),
  update: (data) => api.put("/vendors/me", data),
  profile: () => api.get("/vendors/me/profile"),
  updateProfile: (data) => api.put("/vendors/me/profile", data),
  switchRole: (role) => api.post(`/vendors/switch-role/${role}`),
  network: (params) => api.get("/vendors/network", { params: noEmpty(params) }),
  byHandle: (handle) => api.get(`/vendors/${handle}`),
  connect: (id) => api.post(`/vendors/connect/${id}`),
  disconnect: (id) => api.delete(`/vendors/connect/${id}`),
  connections: () => api.get("/vendors/connections"),
  suggested: (limit = 6) => api.get("/vendors/suggested", { params: { limit } }),
  /** Discovery algorithm (v2.2): ranked vendors with the factors behind each score. */
  discover: (params) => api.get("/vendors/discover", { params: noEmpty(params) }), // limit, category, location, group_id, min_score, include_connected
  discoverWeights: () => api.get("/vendors/discover/weights"),
  graph: () => api.get("/vendors/graph"),
  stats: () => api.get("/vendors/stats"),
  becomePatron: () => api.post("/vendors/become-patron"),
  patronStatus: () => api.get("/vendors/me/patron"),
  performance: (handle) => api.get(`/vendors/${handle}/performance`), // SRM-lite metrics
};

// ── Stock ──────────────────────────────────────────────────────────────────
export const stockAPI = {
  add: (data) => api.post("/stock/add", data),
  get: (id) => api.get(`/stock/${id}`),
  update: (id, data) => api.put(`/stock/${id}`, data),
  remove: (id) => api.delete(`/stock/${id}`),
  mine: () => api.get("/stock/my-stock"),
  network: (params) => api.get("/stock/network-stock", { params: noEmpty(params) }),
  categories: () => api.get("/stock/categories"),
  source: (id, data) => api.post(`/stock/${id}/source`, data),
  movements: (params) => api.get("/stock/movements", { params: noEmpty(params) }), // status, direction
  advance: (id, action) => api.post(`/stock/movements/${id}/${action}`), // confirm | ship | receive | cancel
  alternatives: (id, limit = 6) => api.get(`/stock/${id}/alternatives`, { params: { limit } }),
  /** Self-declare / lab-certify provenance. `fields`: batch_number*, origin_country, expiry_date, lab_certified, spec_sheet_url; `file`: spec sheet */
  verify: (id, fields, file) => {
    const form = new FormData();
    Object.entries(noEmpty(fields)).forEach(([k, v]) => form.append(k, v));
    if (file) form.append("spec_sheet", file);
    return api.post(`/stock/${id}/verify`, form, { headers: { "Content-Type": "multipart/form-data" } });
  },
  patronVerify: (id) => api.post(`/stock/${id}/patron-verify`),
  revokePatronVerify: (id) => api.delete(`/stock/${id}/patron-verify`),
  bulkImport: (file) => {
    const form = new FormData();
    form.append("file", file);
    return api.post("/stock/bulk-import", form, { headers: { "Content-Type": "multipart/form-data" } });
  },
};

// ── Groups ─────────────────────────────────────────────────────────────────
export const groupAPI = {
  browse: (params) => api.get("/groups/browse", { params: noEmpty(params) }),
  mine: () => api.get("/groups/mine"),
  get: (id) => api.get(`/groups/${id}`),
  members: (id) => api.get(`/groups/${id}/members`),
  create: (data) => api.post("/groups/create", data),
  join: (id) => api.post(`/groups/${id}/join`),
  leave: (id) => api.post(`/groups/${id}/leave`),
  approve: (id, vendorId) => api.post(`/groups/${id}/approve/${vendorId}`),
  createList: (id, data) => api.post(`/groups/${id}/create-vendor-list`, data), // JSON body, not query params
};

// ── Vendor lists ───────────────────────────────────────────────────────────
export const listAPI = {
  browse: (params) => api.get("/vendor-lists/browse", { params: noEmpty(params) }),
  mine: () => api.get("/vendor-lists/mine"),
  members: (id) => api.get(`/vendor-lists/${id}/members`),
  create: (data) => api.post("/vendor-lists/create", data),
  register: (id) => api.post(`/vendor-lists/${id}/register`),
  approve: (id, vendorId) => api.post(`/vendor-lists/${id}/approve/${vendorId}`),
  reject: (id, vendorId) => api.post(`/vendor-lists/${id}/reject/${vendorId}`),
  setOpen: (id, isOpen) => api.post(`/vendor-lists/${id}/close`, null, { params: { is_open: isOpen } }),
  // reviews (v2.2)
  reviews: (id, params) => api.get(`/vendor-lists/${id}/reviews`, { params: noEmpty(params) }), // skip, limit
  myReview: (id) => api.get(`/vendor-lists/${id}/reviews/mine`),
  createReview: (id, data) => api.post(`/vendor-lists/${id}/reviews`, data), // { rating, title, body }
  updateReview: (id, data) => api.put(`/vendor-lists/${id}/reviews/mine`, data),
  deleteReview: (id) => api.delete(`/vendor-lists/${id}/reviews/mine`),
  markHelpful: (id, reviewId) => api.post(`/vendor-lists/${id}/reviews/${reviewId}/helpful`),
};

// ── Chat ───────────────────────────────────────────────────────────────────
export const chatAPI = {
  rooms: (params) => api.get("/chat/rooms", { params: noEmpty(params) }), // room_type, mine_only
  room: (id) => api.get(`/chat/${id}`),
  messages: (id, params) => api.get(`/chat/${id}/messages`, { params: noEmpty(params) }), // skip, limit
  send: (id, data) => api.post(`/chat/${id}/message`, data),
  sendVoice: (id, blob, durationSeconds) => {
    const form = new FormData();
    const mime = blob.type.split(";", 1)[0].toLowerCase();
    const extension = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : mime.includes("aac") ? "aac" : mime.includes("mpeg") ? "mp3" : mime.includes("wav") ? "wav" : "webm";
    form.append("file", blob, `voice-note.${extension}`);
    form.append("duration_seconds", String(durationSeconds));
    return api.post(`/chat/${id}/voice`, form, { headers: { "Content-Type": "multipart/form-data" }, timeout: 60000 });
  },
  voice: (roomId, messageId) => api.get(`/chat/${roomId}/voice/${messageId}`, { responseType: "blob", timeout: 60000 }),
  join: (id) => api.post(`/chat/${id}/join`),
  createTopic: (data) => api.post("/chat/niche-topic", data), // { name, topic, topic_tags }
  directRoom: (vendorId) => api.post(`/chat/direct/${vendorId}`),
  dealRoom: (stockId) => api.post(`/chat/deal/${stockId}`),
  // deal protocol (v2.1)
  acceptDeal: (roomId, messageId) => api.post(`/chat/${roomId}/deals/${messageId}/accept`),
  counterDeal: (roomId, messageId, data) => api.post(`/chat/${roomId}/deals/${messageId}/counter`, data), // { proposed_price_per_unit*, quantity, delivery_terms, payment_terms, notes }
  declineDeal: (roomId, messageId) => api.post(`/chat/${roomId}/deals/${messageId}/decline`),
};

// ── Daily Flash market Locks ───────────────────────────────────────────────
export const locksAPI = {
  home: () => api.get("/locks/me"),
  zones: () => api.get("/locks/zones"),
  assignZone: (zoneId) => api.post("/locks/me/zone", { zone_id: zoneId }),
  submitPick: (windowId, data) => api.post(`/locks/windows/${windowId}/picks`, data),
  withdrawPick: (pickId) => api.delete(`/locks/picks/${pickId}`),
  opsMe: () => api.get("/locks/ops/me"),
  opsBoard: () => api.get("/locks/ops/board"),
  createZone: (data) => api.post("/locks/ops/zones", data),
  updateZone: (id, data) => api.patch(`/locks/ops/zones/${id}`, data),
  createProduct: (data) => api.post("/locks/ops/products", data),
  updateProduct: (id, isActive) => api.patch(`/locks/ops/products/${id}`, { is_active: isActive }),
  upsertOffer: (data) => api.post("/locks/ops/offers", data),
  updateOffer: (id, isActive) => api.patch(`/locks/ops/offers/${id}`, { is_active: isActive }),
  createWindow: (data) => api.post("/locks/ops/windows", data),
  closeWindow: (id) => api.post(`/locks/ops/windows/${id}/close`),
  addQuote: (clusterId, data) => api.post(`/locks/ops/clusters/${clusterId}/quotes`, data),
  selectQuote: (clusterId, quoteId) => api.post(`/locks/ops/clusters/${clusterId}/select/${quoteId}`),
};

// ── Governance, appeals, transparent rules and non-cash benefits ─────────────
export const governanceAPI = {
  proposals: (params) => api.get("/governance/proposals", { params: noEmpty(params) }),
  proposal: (id) => api.get(`/governance/proposals/${id}`),
  createProposal: (data) => api.post("/governance/proposals", data),
  vote: (id, vote) => api.post(`/governance/proposals/${id}/votes`, { vote }),
  results: (id) => api.get(`/governance/proposals/${id}/results`),
  council: (zoneId) => api.get("/governance/council", { params: noEmpty({ zone_id: zoneId }) }),
  scoreRules: () => api.get("/governance/rules/biashara-score"),
  myScore: () => api.get("/governance/score/me"),
  myBenefits: () => api.get("/governance/benefits/me"),
  allocationPolicy: () => api.get("/governance/benefits/allocation-policy"),
  consents: () => api.get("/governance/consents"),
  setConsent: (purpose, data) => api.put(`/governance/consents/${purpose}`, data),
  submitAppeal: (data) => api.post("/governance/appeals", data),
  myAppeals: () => api.get("/governance/appeals/me"),
  opsAppeals: (status) => api.get("/governance/ops/appeals", { params: noEmpty({ status }) }),
  resolveAppeal: (id, data) => api.post(`/governance/ops/appeals/${id}/resolve`, data),
  audit: (limit = 100) => api.get("/governance/ops/audit", { params: { limit } }),
  approvals: () => api.get("/governance/ops/approvals"),
  requestPolicy: (data) => api.post("/governance/ops/allocation-policy-requests", data),
  requestScoreRules: (data) => api.post("/governance/ops/rule-version-requests", data),
  decideApproval: (id, data) => api.post(`/governance/ops/approvals/${id}/decision`, data),
  recordRevenue: (data) => api.post("/governance/ops/revenue-events", data),
  recordBenefitEvent: (data) => api.post("/governance/ops/benefit-events", data),
  calculateBenefitPeriod: (data) => api.post("/governance/ops/benefit-periods/calculate", data),
  createCouncilTerm: (data) => api.post("/governance/ops/council-terms", data),
  recallCouncilTerm: (id, data) => api.post(`/governance/ops/council-terms/${id}/recall`, data),
};

// ── Tools ──────────────────────────────────────────────────────────────────
export const toolAPI = {
  browse: (params) => api.get("/tools/browse", { params: noEmpty(params) }), // category, location, search
  mine: () => api.get("/tools/mine"),
  create: (data) => api.post("/tools/list", data),
  setAvailability: (id, isAvailable) => api.post(`/tools/${id}/availability`, null, { params: { is_available: isAvailable } }),
  couriers: (params) => api.get("/tools/couriers", { params: noEmpty(params) }), // area, service_type
  registerCourier: (data) => api.post("/tools/courier/register", data),
  bookWarehouse: (id, data) => api.post(`/tools/${id}/book-warehouse`, data), // { start_date, end_date, space_allocated }
  // dated bookings & calendars (v2.2)
  book: (id, data) => api.post(`/tools/${id}/book`, data), // { start_date, end_date, quantity, unit, details, notes }
  calendar: (id, params) => api.get(`/tools/${id}/availability-calendar`, { params: noEmpty(params) }), // from, to, days
  bookings: (role = "all") => api.get("/tools/bookings", { params: { role } }), // host | booker | all
  booking: (id) => api.get(`/tools/bookings/${id}`),
  setBookingStatus: (id, status, note) =>
    api.post(`/tools/bookings/${id}/status`, null, { params: noEmpty({ status, note }) }),
  // route optimisation (v2.2)
  planRoute: (courierId, data) => api.post(`/tools/couriers/${courierId}/routes`, data),
  planRouteFromShipments: (courierId, params) =>
    api.post(`/tools/couriers/${courierId}/routes/from-shipments`, null, { params: noEmpty(params) }),
  routes: (params) => api.get("/tools/routes", { params: noEmpty(params) }), // role, status
  route: (id) => api.get(`/tools/routes/${id}`),
  setRouteStatus: (id, status) => api.post(`/tools/routes/${id}/status`, null, { params: { status } }),
  solveStop: (routeId, stopId, solved = true) =>
    api.post(`/tools/routes/${routeId}/stops/${stopId}/solve`, null, { params: { solved } }),
  // courier shipments (v2.1)
  shipments: (role) => api.get("/tools/shipments", { params: noEmpty({ role }) }), // sent | received | courier
  bookShipment: (courierId, data) => api.post(`/tools/couriers/${courierId}/shipments`, data), // { receiver_vendor_id*, origin, destination, weight_kg, cost, notes, movement_id }
  shipmentStatus: (id, status, note) => api.post(`/tools/shipments/${id}/status`, null, { params: noEmpty({ status, note }) }),
  rateShipment: (id, data) => api.post(`/tools/shipments/${id}/rate`, data), // { rating 1-5, review }
  track: (trackingNumber) => api.get(`/tools/shipments/track/${encodeURIComponent(trackingNumber)}`),
};

// ── Events ─────────────────────────────────────────────────────────────────
export const eventAPI = {
  browse: (params) => api.get("/events/browse", { params: noEmpty(params) }), // event_type, location, include_past
  mine: () => api.get("/events/mine"),
  get: (id) => api.get(`/events/${id}`),
  registrations: (id) => api.get(`/events/${id}/registrations`),
  create: (data) => api.post("/events/create", data),
  register: (id) => api.post(`/events/${id}/register`),
  cancelRegistration: (id) => api.post(`/events/${id}/cancel-registration`),
  setStatus: (id, status) => api.post(`/events/${id}/status`, null, { params: { status } }),
  checkIn: (id) => api.post(`/events/${id}/check-in`),
  checkInVendor: (id, vendorId) => api.post(`/events/${id}/check-in/${vendorId}`),
  analytics: (id) => api.get(`/events/${id}/analytics`),
};

// ── Notifications (v2.1) ───────────────────────────────────────────────────
export const notificationAPI = {
  list: (params) => api.get("/notifications", { params: noEmpty(params) }), // unread_only, skip, limit → { unread_count, notifications }
  unreadCount: () => api.get("/notifications/unread-count"),
  markRead: (id) => api.post(`/notifications/${id}/read`),
  markAllRead: () => api.post("/notifications/read-all"),
};

// ── Files (v2.1) ───────────────────────────────────────────────────────────
export const fileAPI = {
  upload: (file) => {
    const form = new FormData();
    form.append("file", file);
    return api.post("/files/upload", form, { headers: { "Content-Type": "multipart/form-data" } });
  },
  limits: () => api.get("/files/limits"),
};

// ── Market news (derived from real rows; see backend/app/routes/news.py) ───
export const newsAPI = {
  feed: (days = 7) => api.get("/news", { params: { days } }), // { items, counts, new_today, window_days }
};

// ── Hustle League (Squad) — the real-work game ─────────────────────────────
export const squadAPI = {
  me: () => api.get("/squad/me"),
  calls: (params) => api.get("/squad/job-calls", { params: noEmpty(params) }),
  postCall: (body) => api.post("/squad/job-calls", body),
  accept: (id) => api.post(`/squad/job-calls/${id}/accept`),
  start: (id) => api.post(`/squad/contracts/${id}/start`),
  complete: (id, body) => api.post(`/squad/contracts/${id}/complete`, body),
  confirm: (id, body) => api.post(`/squad/contracts/${id}/confirm`, body),
  rateClient: (id, stars) => api.post(`/squad/contracts/${id}/rate-client`, { stars }),
  cancel: (id, reason) => api.post(`/squad/contracts/${id}/cancel`, { reason }),
  league: (month) => api.get("/squad/league", { params: noEmpty({ month }) }),
  squads: () => api.get("/squad/squads/mine"),
  createSquad: (name) => api.post("/squad/squads", { name }),
  invite: (id, handle) => api.post(`/squad/squads/${id}/invite`, { handle }),
  leave: (id) => api.post(`/squad/squads/${id}/leave`),
};

// ── Geo + open data (free sources only: Nominatim + Overpass, both OSM) ────
export const geoAPI = {
  geocode: (query) => api.post("/geo/geocode", { query }),
  nearby: (params) => api.get("/geo/nearby", { params: noEmpty(params) }),
  zones: () => api.get("/geo/zones"),
  publicPlaces: (params) => api.get("/geo/public-places", { params: noEmpty(params) }),
  claim: (id) => api.post(`/geo/public-places/${id}/claim`),
  ingestZone: (id) => api.post(`/geo/zones/${id}/ingest`),
  ingestAll: () => api.post("/geo/ingest-all"),
};

// ── Collective sourcing (v2.1) ─────────────────────────────────────────────
export const collectiveAPI = {
  list: (params) => api.get("/collective", { params: noEmpty(params) }), // group_id, status
  get: (id) => api.get(`/collective/${id}`),
  create: (data) => api.post("/collective/create", data), // { group_id*, item_name*, target_quantity*, target_price_per_unit, unit_of_measure, description, deadline }
  pledge: (id, data) => api.post(`/collective/${id}/pledge`, data), // { pledged_quantity*, max_price_per_unit, notes }
  withdraw: (id) => api.post(`/collective/${id}/withdraw`),
  setStatus: (id, status) => api.post(`/collective/${id}/status`, null, { params: { status } }),
};

// ── POS bridge ─────────────────────────────────────────────────────────────
export const posAPI = {
  connect: (data) => api.post("/pos/connect", data),
  connections: () => api.get("/pos/connections"),
  disconnect: (id) => api.delete(`/pos/${id}`),
  sync: (id) => api.post(`/pos/${id}/sync`),
  push: (id, items) => api.post(`/pos/${id}/push`, { items }),
  pushCsv: (id, file) => {
    const form = new FormData();
    form.append("file", file);
    return api.post(`/pos/${id}/push-csv`, form, { headers: { "Content-Type": "multipart/form-data" } });
  },
  syncLogs: (id) => api.get(`/pos/sync-logs/${id}`),
};

// ── Trade analytics (v2.2) ─────────────────────────────────────────────────
export const analyticsAPI = {
  overview: (days = 90) => api.get("/analytics/overview", { params: { days } }),
  trend: (days = 90) => api.get("/analytics/trend", { params: { days } }),
  counterparties: (params) => api.get("/analytics/counterparties", { params: noEmpty(params) }), // days, limit
  categories: (days = 90) => api.get("/analytics/categories", { params: { days } }),
  pricePosition: (days = 90) => api.get("/analytics/price-position", { params: { days } }),
  network: (days = 30) => api.get("/analytics/network", { params: { days } }),
  counterparty: (handle, days = 180) => api.get(`/analytics/counterparty/${encodeURIComponent(handle)}`, { params: { days } }),
  weights: () => api.get("/analytics/weights"),
};

// ── Ops / monitoring (v2.2) ────────────────────────────────────────────────
export const opsAPI = {
  status: () => api.get("/ops/status"),
  slow: (thresholdMs) => api.get("/ops/slow", { params: noEmpty({ threshold_ms: thresholdMs }) }),
  /** /metrics answers Prometheus text, not JSON — ask axios for the raw string. */
  metrics: () => api.get("/metrics", { responseType: "text", transformResponse: [(d) => d] }),
};

export default api;
