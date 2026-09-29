import { create } from "zustand";
import { persist } from "zustand/middleware";
import { authAPI, vendorAPI } from "@/lib/api";
import { ws } from "@/lib/ws";

export const useAuthStore = create(
  persist(
    (set, get) => ({
      token: null,
      refreshToken: null,
      vendor: null,
      ready: false, // true once we know whether the persisted token is still good
      loading: false,

      login: async (identifier, password) => {
        set({ loading: true });
        try {
          const { data } = await authAPI.login(identifier, password);
          set({ token: data.access_token, refreshToken: data.refresh_token || null });
          await get().fetchVendor();
          return data;
        } finally {
          set({ loading: false });
        }
      },

      register: async (payload) => {
        set({ loading: true });
        try {
          const { data } = await authAPI.register(payload); // registering signs you in (v2.1)
          if (data?.access_token) {
            set({ token: data.access_token, refreshToken: data.refresh_token || null });
          } else {
            const { data: tok } = await authAPI.login(payload.email, payload.password);
            set({ token: tok.access_token, refreshToken: tok.refresh_token || null });
          }
          await get().fetchVendor();
          return data;
        } finally {
          set({ loading: false });
        }
      },

      /** Trade the refresh token for a new access token; returns it or null. */
      refresh: async () => {
        const rt = get().refreshToken;
        if (!rt) return null;
        try {
          const { data } = await authAPI.refresh(rt);
          set({ token: data.access_token, refreshToken: data.refresh_token || rt });
          return data.access_token;
        } catch {
          return null;
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
        set({ token: null, refreshToken: null, vendor: null, ready: true });
      },
    }),
    { name: "brief-auth", partialize: (s) => ({ token: s.token, refreshToken: s.refreshToken }) }
  )
);
