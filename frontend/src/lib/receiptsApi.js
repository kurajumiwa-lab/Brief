import api from "@/lib/api";

/**
 * THE SERVER SIDE OF A RECEIPT.
 *
 * The device still writes first — a scan must not wait for a signal — but these
 * calls are what make "one receipt, one reward" true across accounts and what
 * turn a region's receipts into an aggregate no single phone could compute.
 *
 * The server parses the raw payload and prices it. Nothing here sends a point
 * value; a client that could choose its own points would not need a server.
 */
export const receiptsAPI = {
  submit: (body) => api.post("/receipts", body),
  ledger: (limit = 200) => api.get("/receipts", { params: { limit } }),
  summary: () => api.get("/receipts/summary"),
  insights: (region, days = 30) => api.get("/receipts/insights", { params: { region, days } }),
  offers: (region) => api.get("/receipts/offers", { params: region ? { region } : {} }),
  claimOffer: (offerId) => api.post(`/receipts/offers/${offerId}/claim`),
  myOffers: () => api.get("/receipts/offers/mine"),
  createOffer: (body) => api.post("/receipts/offers", body),
  vouchers: () => api.get("/receipts/vouchers"),
  voucher: (id) => api.get(`/receipts/vouchers/${id}`),
  cancelVoucher: (id) => api.post(`/receipts/vouchers/${id}/cancel`),
  redeem: (body) => api.post("/receipts/merchant/redeem", body),
  claimMerchant: (pin, body = {}) => api.post(`/receipts/merchants/${pin}/claim`, body),
  myMerchants: () => api.get("/receipts/merchants/me"),
  updateMerchant: (id, body) => api.patch(`/receipts/merchants/${id}`, body),
  invite: (slug) => api.get(`/receipts/invites/${encodeURIComponent(slug)}`),
  tradeProofs: (status) => api.get("/receipts/trade-proofs", { params: status ? { status } : {} }),
  confirmTrade: (id) => api.post(`/receipts/trade-proofs/${id}/confirm`),
  disputeTrade: (id, reason) => api.post(`/receipts/trade-proofs/${id}/dispute`, { reason }),
};
