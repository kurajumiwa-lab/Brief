import { useEffect, useRef, useState } from "react";
import { apiError } from "@/lib/api";
import { receiptsAPI } from "@/lib/receiptsApi";
import { serverReceiptBody } from "@/lib/receipts";
import { useAuthStore } from "@/stores/authStore";
import { useReceiptStore } from "@/stores/receiptStore";

/**
 * Push the device's pending receipts, then take the server's ledger back.
 *
 * The order matters. Hydrating first means a person who signed in on a new
 * phone sees the receipts the network already knows; sending pending rows next
 * means a scan made in a basement is not lost. The server prices every row, so
 * the local provisional points are replaced by the authoritative ones.
 *
 * A 409 is success with a correction: the receipt was already recorded, so the
 * local copy is discarded and the next hydrate brings the server row in.
 */
let inFlight = null;

async function runSync() {
  const ledger = await receiptsAPI.ledger();
  useReceiptStore.getState().hydrateFromServer(ledger.data);

  const pending = useReceiptStore.getState().receipts.filter(
    (row) => row.sync !== "synced" && serverReceiptBody(row),
  );
  let changed = false;

  for (const row of pending) {
    try {
      const response = await receiptsAPI.submit(serverReceiptBody(row));
      useReceiptStore.getState().markSynced(row.id, response.data.receipt);
      changed = true;
    } catch (error) {
      const status = error?.response?.status;
      if (status === 409) {
        useReceiptStore.getState().discardReceipt(row.id);
        changed = true;
      } else if (!error?.response) {
        // No network is not an error worth a red line. The row stays local and
        // the next mount tries again.
        useReceiptStore.getState().markSyncFailed(row.id, "Waiting for a connection");
      } else {
        useReceiptStore.getState().markSyncFailed(row.id, apiError(error, "The server refused this receipt"));
      }
    }
  }

  if (changed) {
    const fresh = await receiptsAPI.ledger();
    useReceiptStore.getState().hydrateFromServer(fresh.data);
  }
}

export function syncReceiptLedger() {
  if (!inFlight) {
    inFlight = runSync().finally(() => { inFlight = null; });
  }
  return inFlight;
}

export function useReceiptSync() {
  const token = useAuthStore((state) => state.token);
  const ready = useAuthStore((state) => state.ready);
  // A scan made while the Home card is on screen must go up without waiting
  // for a route change, so the hook watches the unsynced count as well.
  const pending = useReceiptStore((state) => state.receipts.filter(
    (row) => row.sync !== "synced" && serverReceiptBody(row),
  ).length);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const hydrated = useRef(false);

  useEffect(() => {
    if (!token || !ready) return undefined;
    // Nothing pending and the account's ledger has already been fetched: the
    // next run would be the same request.
    if (pending === 0 && hydrated.current) return undefined;
    hydrated.current = true;
    let alive = true;
    setSyncing(true);
    syncReceiptLedger()
      .catch((err) => {
        if (!err?.response) return; // offline: local-first is the feature
        if (alive) setError(apiError(err, "The ledger could not reach the server"));
      })
      .finally(() => { if (alive) setSyncing(false); });
    return () => { alive = false; };
  }, [token, ready, pending]);

  return { syncing, error };
}
