import api from "@/lib/api";

/**
 * Town commerce API.
 *
 * The browser never sends a balance, a funded amount or a verification flag.
 * Those come back from the server. Public referral reads are deliberately
 * unauthenticated; every write is behind a session.
 */
export const townAPI = {
  // ── receipt rewards ───────────────────────────────────────────────────
  captureReceipt: (body) => api.post("/town/receipts/capture", body),
  scanPhoto: (file, consent = false) => {
    const form = new FormData();
    form.append("file", file);
    form.append("consent", consent ? "true" : "false");
    return api.post("/town/receipts/ocr", form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 60000,
    });
  },
  scanText: (text, consent = false) => api.post("/town/receipts/ocr/text", { text, consent }),

  // ── merchant credit, policy and analytics ─────────────────────────────
  merchantDashboard: (days = 30) => api.get("/town/merchant/me", { params: { days } }),
  merchantDashboardById: (merchantId, days = 30) =>
    api.get(`/town/merchant/${merchantId}/dashboard`, { params: { days } }),
  setRewardPolicy: (merchantId, body) =>
    api.patch(`/town/merchant/${merchantId}/policy`, body),
  credits: (merchantId) => api.get(`/town/merchant/${merchantId}/credits`),
  buyCredit: (merchantId, body) =>
    api.post(`/town/merchant/${merchantId}/credits/purchase`, body),
  subscribeAnalytics: (merchantId, body) =>
    api.post(`/town/merchant/${merchantId}/analytics/subscribe`, body),

  // ── referral index ────────────────────────────────────────────────────
  publicListings: (params = {}) => api.get("/town/referral-index/public/listings", { params }),
  publicVisit: (code) => api.get(`/town/referral-index/public/go/${encodeURIComponent(code)}`),
  listings: (params = {}) => api.get("/town/referral-index/listings", { params }),
  mine: () => api.get("/town/referral-index/mine"),
  createListing: (body) => api.post("/town/referral-index/listings", body),
  updateListing: (id, body) => api.patch(`/town/referral-index/listings/${id}`, body),
  shareListing: (id) => api.post(`/town/referral-index/listings/${id}/share`),
  claimListing: (id, body) => api.post(`/town/referral-index/listings/${id}/claim`, body),
  myConversions: () => api.get("/town/referral-index/conversions/mine"),
  verifyConversion: (id, body) => api.post(`/town/referral-index/conversions/${id}/verify`, body),
  markBountyPaid: (id, body) => api.post(`/town/referral-index/conversions/${id}/paid`, body),
  sponsorListing: (id, body) => api.post(`/town/referral-index/listings/${id}/sponsor`, body),
  fundBounty: (id, body) => api.post(`/town/referral-index/listings/${id}/bounty`, body),
  disputeConversion: (id, body) => api.post(`/town/referral-index/conversions/${id}/dispute`, body),

  // ── scout records ─────────────────────────────────────────────────────
  scoutBoard: (params = {}) => api.get("/town/scout/board", { params }),
  scoutTask: (id) => api.get(`/town/scout/tasks/${id}`),
  rateScout: (id, body) => api.post(`/town/scout/tasks/${id}/rating`, body),
  confirmScoutPayment: (id, body) =>
    api.post(`/town/scout/tasks/${id}/payment-confirmation`, body),
  acknowledgeScoutPayment: (id) =>
    api.post(`/town/scout/tasks/${id}/payment-confirmation/ack`),
  disputeScoutTask: (id, body) => api.post(`/town/scout/tasks/${id}/dispute`, body),
  scoutProfile: () => api.get("/town/scout/profile"),
  scoutFees: () => api.get("/town/scout/fees"),

  // ── trust and disputes ────────────────────────────────────────────────
  trust: () => api.get("/town/trust/me"),
  openDispute: (body) => api.post("/town/disputes", body),
  myDisputes: () => api.get("/town/disputes/mine"),
};

export const commerceOpsAPI = {
  overview: () => api.get("/ops/commerce/overview"),
  pendingCredits: () => api.get("/ops/commerce/credits/pending"),
  reviewCredit: (id, body) => api.post(`/ops/commerce/credits/purchases/${id}/review`, body),
  pendingSubscriptions: () => api.get("/ops/commerce/subscriptions/pending"),
  reviewSubscription: (merchantId, body) =>
    api.post(`/ops/commerce/subscriptions/${merchantId}/review`, body),
  pendingListings: () => api.get("/ops/commerce/listings/pending"),
  verifyListing: (id, body) => api.post(`/ops/commerce/listings/${id}/verify`, body),
  pendingConversions: () => api.get("/ops/commerce/conversions/pending"),
  verifyConversion: (id, body) => api.post(`/ops/commerce/conversions/${id}/verify`, body),
  disputes: (status) => api.get("/ops/commerce/disputes", { params: status ? { status } : {} }),
  resolveDispute: (id, body) => api.post(`/ops/commerce/disputes/${id}/resolve`, body),
  settings: () => api.get("/ops/commerce/settings"),
  updateSettings: (body) => api.patch("/ops/commerce/settings", body),
  fees: (status) => api.get("/ops/commerce/fees", { params: status ? { status } : {} }),
  audit: (limit = 100) => api.get("/ops/commerce/audit", { params: { limit } }),
};

export default townAPI;
