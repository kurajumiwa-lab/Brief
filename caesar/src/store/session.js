/**
 * SESSION — whose account the interface is speaking as.
 *
 * Two modes, and the difference is not cosmetic:
 *
 *   · `local` — the seeded network. Nothing leaves the browser. This is what
 *     the tests run against and what the preview shows by default.
 *   · `live` — a real account on the Brief backend. Posts, reactions and
 *     reports go to the server and are ranked there.
 *
 * The token is kept under its own key rather than inside the prototype snapshot:
 * "reset the prototype" wipes the demo data, and it should not silently sign
 * you out of a real account.
 */
import { create } from "zustand";

export const SESSION_KEY = "caesar.session";

function readStored() {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.token === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function writeStored(value) {
  try {
    if (value) window.localStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage refused; the session still works for this tab */
  }
}

const stored = typeof window === "undefined" ? null : readStored();

export const useSession = create((set, get) => ({
  /** "local" | "live" */
  mode: stored?.token ? "live" : "local",
  token: stored?.token ?? null,
  account: stored?.account ?? null,
  /** Set when the server rejects the token, so the UI can say why. */
  notice: null,

  start: ({ token, account }) => {
    writeStored({ token, account });
    set({ mode: "live", token, account, notice: null });
  },

  updateAccount: (account) => {
    const { token } = get();
    if (!token) return;
    writeStored({ token, account });
    set({ account });
  },

  signOut: () => {
    writeStored(null);
    set({ mode: "local", token: null, account: null, notice: null });
  },

  demote: (notice) => {
    writeStored(null);
    set({ mode: "local", token: null, account: null, notice: notice || null });
  },

  dismissNotice: () => set({ notice: null }),

  setMode: (mode) => set({ mode: mode === "live" && get().token ? "live" : "local" }),
}));

export default useSession;
