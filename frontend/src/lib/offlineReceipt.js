// A provider's pending handover acknowledgement, scoped to their account and
// this tab's session. Never persist the buyer's *generated* code; this is only
// the six digits the provider entered at handover. The server is authoritative.
const PREFIX = "brief:pending-receipt:";
const name = (vendorId, orderId) => `${PREFIX}${vendorId}:${orderId}`;

export function readPendingReceipt(vendorId, orderId) {
  if (!vendorId || !orderId) return null;
  try {
    const pending = JSON.parse(sessionStorage.getItem(name(vendorId, orderId)) || "null");
    if (pending && /^\d{6}$/.test(pending.code) && Number.isFinite(pending.at) &&
      pending.at <= Date.now() && Date.now() - pending.at < 24 * 60 * 60 * 1000) return pending;
    sessionStorage.removeItem(name(vendorId, orderId));
  } catch { /* Session storage can be disabled by the browser. */ }
  return null;
}

export function queuePendingReceipt(vendorId, orderId, code) {
  const pending = { code, at: Date.now() };
  try {
    sessionStorage.setItem(name(vendorId, orderId), JSON.stringify(pending));
    return { ...pending, saved: true };
  } catch {
    // Still queue it in memory in the mounted order screen for this outage.
    return { ...pending, saved: false };
  }
}

export function clearPendingReceipt(vendorId, orderId) {
  try { sessionStorage.removeItem(name(vendorId, orderId)); } catch { /* no storage */ }
}

export function clearAllPendingReceipts() {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(PREFIX)) sessionStorage.removeItem(key);
    }
  } catch { /* no storage */ }
}
