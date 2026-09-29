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

// 401 anywhere → the session is dead; drop it and let the router bounce to /auth
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && useAuthStore.getState().token) {
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
  graph: () => api.get("/vendors/graph"),
  stats: () => api.get("/vendors/stats"),
  becomePatron: () => api.post("/vendors/become-patron"),
  patronStatus: () => api.get("/vendors/me/patron"),
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
};

// ── Chat ───────────────────────────────────────────────────────────────────
export const chatAPI = {
  rooms: (params) => api.get("/chat/rooms", { params: noEmpty(params) }), // room_type, mine_only
  room: (id) => api.get(`/chat/${id}`),
  messages: (id, params) => api.get(`/chat/${id}/messages`, { params: noEmpty(params) }), // skip, limit
  send: (id, data) => api.post(`/chat/${id}/message`, data),
  join: (id) => api.post(`/chat/${id}/join`),
  createTopic: (data) => api.post("/chat/niche-topic", data), // { name, topic, topic_tags }
  directRoom: (vendorId) => api.post(`/chat/direct/${vendorId}`),
  dealRoom: (stockId) => api.post(`/chat/deal/${stockId}`),
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

export default api;
