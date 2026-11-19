import api from "@/lib/api";

const noEmpty = (value) =>
  Object.fromEntries(Object.entries(value || {}).filter(([, v]) => v !== "" && v !== null && v !== undefined));

/**
 * The event vendor desk. Prices are set by the vendor; accepting a quote records
 * a booking and opens contact details. No endpoint here moves money.
 */
export const eventDeskAPI = {
  myRateCard: () => api.get("/event-desk/rate-card"),
  saveRateCard: (data) => api.put("/event-desk/rate-card", data),
  savePackages: (packages) => api.put("/event-desk/rate-card/packages", { packages }),
  publicRateCard: (handle) => api.get(`/event-desk/public/rate-cards/${encodeURIComponent(handle)}`),

  openRequests: (params) => api.get("/event-desk/requests", { params: noEmpty(params) }),
  myRequests: () => api.get("/event-desk/requests/mine"),
  createRequest: (eventId, data) => api.post(`/event-desk/events/${eventId}/requests`, data),
  request: (id) => api.get(`/event-desk/requests/${id}`),
  setRequestStatus: (id, status) => api.post(`/event-desk/requests/${id}/status`, { status }),

  submitQuote: (requestId, data) => api.post(`/event-desk/requests/${requestId}/quotes`, data),
  myQuotes: () => api.get("/event-desk/quotes/mine"),
  setQuoteStatus: (quoteId, status) => api.post(`/event-desk/quotes/${quoteId}/status`, { status }),

  // Second-hand passes. The buyer and seller settle directly; the API only
  // records the claim and performs the atomic pass swap after both confirm.
  resaleEligible: () => api.get("/event-desk/resale/eligible"),
  resaleBoard: () => api.get("/event-desk/resale/board"),
  resaleMine: () => api.get("/event-desk/resale/mine"),
  resaleList: (data) => api.post("/event-desk/resale/list", data),
  resaleClaim: (id) => api.post(`/event-desk/resale/${id}/claim`),
  resaleRelease: (id) => api.post(`/event-desk/resale/${id}/release`),
  resaleCancel: (id) => api.post(`/event-desk/resale/${id}/cancel`),
  resaleHandover: (id) => api.post(`/event-desk/resale/${id}/handover`),
};
