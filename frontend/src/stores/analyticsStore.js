import { create } from "zustand";
import { analyticsAPI } from "@/lib/api";

/**
 * Trade analytics (v2.2). One overview call answers the whole dashboard —
 * summary, trend, counterparties, categories, price position and network
 * pulse — so switching the time window is a single request.
 */
export const useAnalyticsStore = create((set) => ({
  days: 90,
  overview: null,
  counterparty: null,
  weights: null,
  loading: false,
  loadingCounterparty: false,

  fetch: async (days = 90) => {
    set({ loading: true, days });
    try {
      const { data } = await analyticsAPI.overview(days);
      set({ overview: data });
      return data;
    } finally {
      set({ loading: false });
    }
  },

  fetchWeights: async () => {
    const { data } = await analyticsAPI.weights();
    set({ weights: data?.factors || null });
    return data;
  },

  /** Drill into one counterparty — both directions, by month. */
  fetchCounterparty: async (handle, days) => {
    set({ loadingCounterparty: true, counterparty: null });
    try {
      const { data } = await analyticsAPI.counterparty(handle, days);
      set({ counterparty: data });
      return data;
    } finally {
      set({ loadingCounterparty: false });
    }
  },

  clearCounterparty: () => set({ counterparty: null }),
}));
