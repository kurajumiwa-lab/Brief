/**
 * A customer's review profile key. No account: the key lives on this device only.
 * Brief stores just a hash of it. Clearing site data starts a fresh profile.
 */
const STORAGE_KEY = "brief.customerKey";

function randomHex(bytes = 16) {
  const buf = new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < bytes; i += 1) buf[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getCustomerKey() {
  try {
    let key = window.localStorage.getItem(STORAGE_KEY);
    if (!key || key.length < 16) {
      key = `c-${randomHex(16)}`;
      window.localStorage.setItem(STORAGE_KEY, key);
    }
    return key;
  } catch {
    // Private mode or storage blocked: a per-page key still lets one review go through.
    return `c-${randomHex(16)}`;
  }
}
