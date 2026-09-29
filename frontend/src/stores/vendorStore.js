import { create } from "zustand";
import { vendorAPI } from "@/lib/api";
import { useAuthStore } from "./authStore";

export const useVendorStore = create((set, get) => ({
  network: [],
  connections: [],
  suggested: [],
  stats: null,
  patron: null,
  loading: false,

  fetchNetwork: async (params = {}) => {
    set({ loading: true });
    try {
      const { data } = await vendorAPI.network({ limit: 50, ...params });
      set({ network: data });
      return data;
    } finally {
      set({ loading: false });
    }
  },
  fetchConnections: async () => {
    const { data } = await vendorAPI.connections();
    set({ connections: data });
    return data;
  },
  fetchSuggested: async (limit = 6) => {
    const { data } = await vendorAPI.suggested(limit);
    set({ suggested: data });
    return data;
  },
  fetchStats: async () => {
    const { data } = await vendorAPI.stats();
    set({ stats: data });
    return data;
  },
  fetchPatron: async () => {
    const { data } = await vendorAPI.patronStatus();
    set({ patron: data });
    return data;
  },

  /** Flip `connected` on a vendor wherever it appears in cached lists */
  markConnected: (id, connected) =>
    set((s) => {
      const same = (v) => (v.id || v.vendor_id) === id;
      const flip = (arr) => arr.map((v) => (same(v) ? { ...v, connected } : v));
      // suggestions are "people you're not connected to yet"
      return { network: flip(s.network), suggested: connected ? s.suggested.filter((v) => !same(v)) : s.suggested };
    }),

  connect: async (id) => {
    const { data } = await vendorAPI.connect(id);
    get().markConnected(id, true);
    return data;
  },
  disconnect: async (id) => {
    const { data } = await vendorAPI.disconnect(id);
    get().markConnected(id, false);
    set((s) => ({ connections: s.connections.filter((c) => c.vendor_id !== id) }));
    return data;
  },

  switchRole: async (role) => {
    const { data } = await vendorAPI.switchRole(role);
    useAuthStore.getState().setVendor({ current_role: data.role || role });
    return data;
  },

  becomePatron: async () => {
    const { data } = await vendorAPI.becomePatron();
    useAuthStore.getState().setVendor({ is_patron: true });
    await get().fetchPatron().catch(() => {});
    return data;
  },
}));
