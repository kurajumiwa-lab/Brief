import api from "@/lib/api";

/**
 * Verified handshakes and the monthly statement. The server derives the
 * beneficiary, the fee and the dedupe fingerprint; this client only names the
 * target and action.
 */
export const leadAPI = {
  record: (data) => api.post("/leads/record", data),
  mine: (month) => api.get("/leads/mine", { params: month ? { month } : {} }),
  statement: (month) => api.get("/leads/statement", { params: month ? { month } : {} }),
  scouted: (month) => api.get("/leads/scouted", { params: month ? { month } : {} }),
};
