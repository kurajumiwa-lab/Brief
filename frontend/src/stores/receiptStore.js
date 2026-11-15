import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isDuplicate, receiptFromServer, receiptKey, receiptValue } from "@/lib/receipts";

/**
 * THE RECEIPT LEDGER.
 *
 * One receipt, one row. The point value is fixed at the moment of the scan and
 * stamped with the freshness window that applied, because the value of a
 * receipt is a fact about *when it was scanned*, not something that should
 * silently change when the app is reopened.
 *
 * Duplicate detection is local and deliberately blunt: the same merchant PIN +
 * invoice number cannot be added twice. A server will need to hold the same
 * rule across devices, but the shape is already here.
 */

const empty = {
  receipts: [],
  points: 0,
  balance: null,
  lastAdded: null,
  status: "idle",
};

const uid = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `r_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
};

export const useReceiptStore = create(
  persist(
    (set, get) => ({
      ...empty,

      /**
       * Add a parsed receipt. Returns a result rather than throwing, because the
       * scanner has to tell the person *why* a receipt was refused.
       */
      addReceipt: (candidate, { scannedAt = new Date().toISOString() } = {}) => {
        if (!candidate) return { ok: false, error: "No receipt was read." };

        if (isDuplicate(get().receipts, candidate)) {
          return {
            ok: false,
            duplicate: true,
            error: "That receipt is already in your ledger. One receipt, one reward.",
          };
        }

        const value = receiptValue({
          total: candidate.total,
          issued_at: candidate.issued_at,
          scanned_at: scannedAt,
        });

        if (!candidate.total) {
          return {
            ok: false,
            incomplete: true,
            error: "The total is missing. Enter it from the receipt, or scan the QR on the receipt itself.",
          };
        }

        // The QR is evidence, not a favour. A code that carries the merchant PIN
        // and invoice earns the full share; a partial code earns half; a manual
        // record earns no points at all.
        const status = candidate.verified
          ? "verified"
          : candidate.source === "manual"
            ? "manual"
            : "partial";
        const multiplier = status === "verified" ? 1 : status === "manual" ? 0 : 0.5;
        const points = Math.round(value.points * multiplier);

        const record = {
          ...candidate,
          id: uid(),
          key: receiptKey(candidate),
          scanned_at: scannedAt,
          base_points: value.base,
          freshness: value.freshness?.key || "unknown",
          freshness_label: value.freshness?.label || "",
          age_minutes: value.ageMinutes,
          status,
          points,
          raw_payload: candidate.raw_payload || null,
          region: candidate.region || null,
          // Written locally first. `useReceiptSync` sends it to the server when
          // there is a session and a network; until then this row is honest
          // about being a device-local record.
          sync: "pending",
          synced: false,
        };

        set((state) => ({
          receipts: [record, ...state.receipts],
          points: state.points + points,
          lastAdded: record,
          status: "ready",
        }));

        return { ok: true, receipt: record, points, value, duplicate: false };
      },

      /**
       * Replace the server-known part of the ledger without losing a scan that
       * is still waiting to go up. A receipt present on both sides keeps the
       * server's points; a local-only row keeps its provisional value.
       */
      hydrateFromServer: ({ receipts = [], summary = null, balance = null } = {}) => {
        const serverRows = receipts.map(receiptFromServer);
        const serverKeys = new Set(serverRows.map((row) => receiptKey(row)));
        const localRows = get().receipts.filter(
          (row) => row.sync !== "synced" && !serverKeys.has(receiptKey(row)),
        );
        const beyondPage = get().receipts.filter(
          (row) => row.sync === "synced" && !serverKeys.has(receiptKey(row)),
        );
        const unsyncedPoints = localRows.reduce((sum, row) => sum + (Number(row.points) || 0), 0);
        const awarded = summary ? Number(summary.points) || 0 : serverRows.reduce(
          (sum, row) => sum + (Number(row.points) || 0), 0,
        );
        const merged = [...serverRows, ...localRows, ...beyondPage].sort(
          (a, b) => String(b.scanned_at || "").localeCompare(String(a.scanned_at || "")),
        );
        set({
          receipts: merged,
          points: Math.max(0, awarded + unsyncedPoints),
          balance,
          status: "ready",
        });
      },

      markSynced: (localId, serverReceipt) => {
        const mapped = receiptFromServer(serverReceipt);
        set((state) => {
          const current = state.receipts.find((row) => row.id === localId);
          if (!current) return state;
          const delta = mapped.points - (Number(current.points) || 0);
          return {
            receipts: state.receipts.map((row) => (
              row.id === localId
                ? {
                  ...mapped,
                  id: localId,
                  server_id: mapped.id,
                  raw_payload: current.raw_payload || null,
                  region: mapped.region || current.region || null,
                }
                : row
            )),
            points: Math.max(0, state.points + delta),
            lastAdded: state.lastAdded?.id === localId
              ? { ...state.lastAdded, ...mapped, id: localId }
              : state.lastAdded,
          };
        });
      },

      markSyncFailed: (localId, reason = "") => set((state) => ({
        receipts: state.receipts.map((row) => (
          row.id === localId ? { ...row, sync: "local", sync_error: reason || null } : row
        )),
      })),

      discardReceipt: (localId) => set((state) => {
        const row = state.receipts.find((item) => item.id === localId);
        if (!row) return state;
        return {
          receipts: state.receipts.filter((item) => item.id !== localId),
          points: Math.max(0, state.points - (Number(row.points) || 0)),
          lastAdded: state.lastAdded?.id === localId ? null : state.lastAdded,
        };
      }),

      clear: () => set({ ...empty }),
    }),
    {
      name: "homeoffice-receipts-v1",
      partialize: (state) => ({
        receipts: state.receipts,
        points: state.points,
        lastAdded: state.lastAdded,
      }),
    },
  ),
);
