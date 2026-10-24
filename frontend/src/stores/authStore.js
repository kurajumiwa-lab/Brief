import { create } from "zustand";
import { persist } from "zustand/middleware";
import { apiError, authAPI, vendorAPI } from "@/lib/api";
import { ws } from "@/lib/ws";
import { clearAllPendingReceipts } from "@/lib/offlineReceipt";

export const useAuthStore = create(
  persist(
    (set, get) => ({
      token: null,
      refreshToken: null,
      vendor: null,
      ready: false, // true once we know whether the persisted token is still good
      loading: false,
      // Set when the token is valid but the profile call failed. Without this the
      // gate silently bounced a signed-in user back to the login form, which
      // reads as "my password doesn't work" when the real fault is the server.
      authError: null,

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
          set({ vendor: null, ready: true, authError: null });
          return null;
        }
        try {
          const { data } = await vendorAPI.me();
          set({ vendor: data, ready: true, authError: null });
          return data;
        } catch (err) {
          // 401/403 is a real dead session; keep the token otherwise, because a
          // 5xx or a network blip is not the member's fault and must not look
          // like bad credentials.
          const status = err?.response?.status;
          if (status === 401 || status === 403) {
            set({ token: null, refreshToken: null, vendor: null, ready: true, authError: null });
            return null;
          }
          set({
            ready: true,
            authError: `You're signed in, but your profile didn't load: ${apiError(err, "the server didn't answer")}`,
          });
          return null;
        }
      },

      clearAuthError: () => set({ authError: null }),

      setVendor: (patch) => set((s) => ({ vendor: { ...(s.vendor || {}), ...patch } })),

      logout: () => {
        ws.disconnectAll();
        clearAllPendingReceipts();
        set({ token: null, refreshToken: null, vendor: null, ready: true, authError: null });
      },
    }),
    { name: "brief-auth", partialize: (s) => ({ token: s.token, refreshToken: s.refreshToken }) }
  )
);
