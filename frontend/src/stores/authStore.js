import { create } from "zustand";
import { persist } from "zustand/middleware";
import { authAPI, vendorAPI } from "@/lib/api";
import { ws } from "@/lib/ws";

export const useAuthStore = create(
  persist(
    (set, get) => ({
      token: null,
      vendor: null,
      ready: false, // true once we know whether the persisted token is still good
      loading: false,

      login: async (identifier, password) => {
        set({ loading: true });
        try {
          const { data } = await authAPI.login(identifier, password);
          set({ token: data.access_token });
          await get().fetchVendor();
          return data;
        } finally {
          set({ loading: false });
        }
      },

      register: async (payload) => {
        set({ loading: true });
        try {
          await authAPI.register(payload);
          const { data } = await authAPI.login(payload.email, payload.password);
          set({ token: data.access_token });
          await get().fetchVendor();
          return data;
        } finally {
          set({ loading: false });
        }
      },

      fetchVendor: async () => {
        if (!get().token) {
          set({ vendor: null, ready: true });
          return null;
        }
        try {
          const { data } = await vendorAPI.me();
          set({ vendor: data, ready: true });
          return data;
        } catch {
          set({ ready: true });
          return null;
        }
      },

      setVendor: (patch) => set((s) => ({ vendor: { ...(s.vendor || {}), ...patch } })),

      logout: () => {
        ws.disconnectAll();
        set({ token: null, vendor: null, ready: true });
      },
    }),
    { name: "brief-auth", partialize: (s) => ({ token: s.token }) }
  )
);
