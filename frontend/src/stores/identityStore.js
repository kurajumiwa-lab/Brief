import { create } from "zustand";
import { persist } from "zustand/middleware";
import { identityAPI } from "@/lib/api";
import { CLAIM_STATUS, INTENT } from "@/config/identity";

/**
 * THE IDENTITY STORE — one small, honest record of who a person says they are.
 *
 * Three states are kept apart on purpose:
 *
 *   what they chose        intent + capabilities. Editable at any time, because
 *                          a person's work changes and the app must not trap
 *                          them inside last month's answer.
 *   what they published    a contact route and a region. It is exposed only
 *                          when they switch it on.
 *   what was checked       an affiliation or a licence, with a status that
 *                          starts at `pending` and only a third party can move.
 *
 * The server is the record of truth. When it cannot be reached the store keeps
 * the local answer and says so (`status: "local"`), rather than showing a green
 * tick for a claim nobody has checked. That distinction is the whole feature.
 */

const EMPTY_CONTACT = { phone: "", email: "", show_phone: false, show_email: false };

const normalise = (data = {}) => ({
  intent: data.intent || null,
  capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
  contact: { ...EMPTY_CONTACT, ...(data.contact || {}) },
  affiliation: data.affiliation || null,
  licence: data.licence || null,
});

const hasServer = (record) => Boolean(record && (record.id || record.status === CLAIM_STATUS.VERIFIED));

export const useIdentityStore = create(
  persist(
    (set, get) => ({
      ...normalise(),
      loaded: false,
      status: "idle", // idle | loading | saving | ready | local | error
      error: null,

      /** Read the server's record once per session. Failure is quiet. */
      load: async ({ force = false } = {}) => {
        if (!force && (get().loaded || get().status === "loading")) return;
        set({ status: "loading", error: null });
        try {
          const { data } = await identityAPI.me();
          set({ ...normalise(data), loaded: true, status: "ready" });
          return data;
        } catch {
          // No server record yet, or no server. Either way the local answers
          // stand, and the UI says they are local.
          set({ loaded: true, status: "local" });
          return null;
        }
      },

      _save: async (patch) => {
        // A partial save (intent only, contact only) must not blank the rest of
        // the record on this device, so normalise the patch before it is stored.
        const next = patch.contact
          ? { ...patch, contact: { ...EMPTY_CONTACT, ...patch.contact } }
          : patch;
        set({ ...next, status: "saving", error: null });
        const { intent, capabilities, contact } = get();
        try {
          const { data } = await identityAPI.save({ intent, capabilities, contact });
          // The server wins where it answers, and says nothing where it does
          // not — an empty response is not permission to forget the choice.
          set({ ...normalise({ ...get(), ...(data || {}) }), status: "ready", error: null });
        } catch {
          // Keep the local answer, and label it as local rather than synced.
          set({ status: "local" });
        }
      },

      setIntent: (intent) => {
        if (!Object.values(INTENT).includes(intent)) return;
        // An intent is only an intent. Choosing "represent" does not tick a
        // capability on the person's behalf — every later answer is explicit.
        return get()._save({ intent });
      },

      toggleCapability: (value) => {
        const current = get().capabilities;
        const next = current.includes(value)
          ? current.filter((item) => item !== value)
          : [...current, value];
        // Capabilities never rewrite the intent either. A person can look
        // around and still sell on the side without being reclassified.
        return get()._save({ capabilities: next });
      },

      setContact: (patch) => get()._save({ contact: { ...get().contact, ...patch } }),

      /** One write for the onboarding screen: intent and capabilities together. */
      setAll: (patch) => get()._save(patch),

      /**
       * Claim an institution. The status is `pending` before the request leaves
       * the device, and it stays pending unless the server accepts the check.
       */
      claimAffiliation: async (payload) => {
        const draft = {
          ...payload,
          status: CLAIM_STATUS.PENDING,
          requested_at: new Date().toISOString(),
        };
        set({ affiliation: draft, status: "saving", error: null });
        try {
          const { data } = await identityAPI.claimAffiliation(payload);
          set({ affiliation: { ...draft, ...data }, status: "ready" });
          return data;
        } catch (err) {
          set({
            status: "local",
            error:
              "The claim is saved on this device, but the check service did not answer. It stays pending until it does.",
          });
          return null;
        }
      },

      /** Submit the code the institution received. Only the server can pass this. */
      confirmAffiliation: async (code) => {
        const claim = get().affiliation;
        if (!claim) return null;
        if (!hasServer(claim)) {
          set({
            error:
              "This claim has not reached the check service yet. Keep it pending; it cannot be confirmed on the device alone.",
          });
          return null;
        }
        set({ status: "saving", error: null });
        try {
          const { data } = await identityAPI.confirmAffiliation(claim.id, code);
          const next = { ...claim, ...data };
          set({ affiliation: next, status: "ready" });
          return next;
        } catch (err) {
          set({
            status: "ready",
            error:
              err?.response?.data?.detail ||
              "That code was not accepted. Ask the institution for the current one.",
          });
          return null;
        }
      },

      claimLicence: async (payload) => {
        const draft = {
          ...payload,
          status: CLAIM_STATUS.PENDING,
          requested_at: new Date().toISOString(),
        };
        set({ licence: draft, status: "saving", error: null });
        try {
          const { data } = await identityAPI.claimLicence(payload);
          set({ licence: { ...draft, ...data }, status: "ready" });
          return data;
        } catch {
          set({
            status: "local",
            error:
              "The licence is saved on this device, but the check service did not answer. It is not shown as confirmed.",
          });
          return null;
        }
      },

      clear: () =>
        set({ ...normalise(), loaded: false, status: "idle", error: null }),
    }),
    {
      name: "homeoffice-identity-v1",
      // Never persist transient network state across a reload.
      partialize: (state) => ({
        intent: state.intent,
        capabilities: state.capabilities,
        contact: state.contact,
        affiliation: state.affiliation,
        licence: state.licence,
      }),
    },
  ),
);
