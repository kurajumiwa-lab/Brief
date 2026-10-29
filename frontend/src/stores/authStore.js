import { create } from "zustand";
import { clearCache as clearOfflineCache } from "@/lib/offline";
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
      // Why the last session ended, in words the sign-in screen can show. A
      // silent bounce to /auth is indistinguishable from a wrong password, and
      // that is what made people abandon an account and open a new one.
      endedReason: null,
      // The last handle or email that signed in on this device, so the form can
      // start filled in. People do not forget their password — they forget
      // which of their three identities they used.
      lastIdentifier: null,

      login: async (identifier, password) => {
        set({ loading: true });
        try {
          const { data } = await authAPI.login(identifier, password);
          set({
            token: data.access_token,
            refreshToken: data.refresh_token || null,
            endedReason: null,
            lastIdentifier: identifier.trim(),
          });
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
            set({
              token: data.access_token,
              refreshToken: data.refresh_token || null,
              endedReason: null,
              lastIdentifier: payload.email?.trim() || data.vendor_handle || null,
            });
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
          set({ vendor: data, ready: true, authError: null, endedReason: null });
          return data;
        } catch (err) {
          const status = err?.response?.status;

          // An expired access token is not a dead session: the refresh token
          // beside it lives for thirty days. Trading it in before deciding
          // anything is the difference between "signed in since March" and
          // "signed out overnight". The axios interceptor usually does this
          // first; doing it here too means a call that bypassed the
          // interceptor cannot sign anyone out either.
          if (status === 401 && get().refreshToken) {
            const renewed = await get().refresh();
            if (renewed) {
              try {
                const { data } = await vendorAPI.me();
                set({ vendor: data, ready: true, authError: null, endedReason: null });
                return data;
              } catch (retryErr) {
                const retryStatus = retryErr?.response?.status;
                if (retryStatus !== 401) {
                  set({
                    ready: true,
                    authError: `You're signed in, but your profile didn't load: ${apiError(retryErr, "the server didn't answer")}`,
                  });
                  return null;
                }
              }
            }
          }

          if (status === 401) {
            set({
              token: null,
              refreshToken: null,
              vendor: null,
              ready: true,
              authError: null,
              endedReason: get().refreshToken
                ? "Your session had expired. Sign in again — your account, records and stock are untouched."
                : "You were signed out. Sign in again — nothing was deleted.",
            });
            return null;
          }

          // 403 is "signed in, not allowed here". That is a permission answer,
          // not a dead session, and wiping the token over it signs someone out
          // for a rule they did not break.
          set({
            ready: true,
            authError:
              status === 403
                ? "You're signed in, but this account isn't allowed to open the network view. Your session is still valid."
                : `You're signed in, but your profile didn't load: ${apiError(err, "the server didn't answer")}`,
          });
          return null;
        }
      },

      clearAuthError: () => set({ authError: null }),

      setVendor: (patch) => set((s) => ({ vendor: { ...(s.vendor || {}), ...patch } })),

      logout: (reason = null) => {
        ws.disconnectAll();
        clearAllPendingReceipts();
        // This device may be shared. Anything cached for offline reading is the
        // departing account's business, so it leaves with them.
        clearOfflineCache(get().vendor?.id);
        set({
          token: null,
          refreshToken: null,
          vendor: null,
          ready: true,
          authError: null,
          endedReason: reason,
        });
      },

      clearEndedReason: () => set({ endedReason: null }),
    }),
    {
      name: "brief-auth",
      // v2 adds the remembered handle. The migrate step exists so a device that
      // stored the v1 shape (token and refresh token only) is upgraded in place
      // rather than treated as a stranger on next launch.
      version: 2,
      migrate: (persisted) => {
        const state = persisted && typeof persisted === "object" ? persisted : {};
        return {
          token: state.token || null,
          refreshToken: state.refreshToken || null,
          lastIdentifier: state.lastIdentifier || null,
        };
      },
      partialize: (s) => ({
        token: s.token,
        refreshToken: s.refreshToken,
        lastIdentifier: s.lastIdentifier,
      }),
    }
  )
);
