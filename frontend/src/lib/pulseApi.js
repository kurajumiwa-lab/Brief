import api from "@/lib/api";

/** Public rhythm windows and inventory-capped flash drops. */
export const pulseAPI = {
  current: () => api.get("/pulse"),
  flashDrops: () => api.get("/pulse/flash-drops"),
  claimDrop: (id) => api.post(`/pulse/flash-drops/${id}/claim`),
  createDrop: (data) => api.post("/pulse/flash-drops", data),
  myDrops: () => api.get("/pulse/flash-drops/mine"),
};
