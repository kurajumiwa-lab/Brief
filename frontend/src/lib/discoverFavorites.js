/**
 * SAVED DISCOVERY CARDS.
 *
 * A save is a convenience on this device, not a server-side standing signal:
 * nothing here awards rank, notifies the owner, or claims the item is verified.
 * The snapshot is intentionally small — the card can render from it, and a
 * fresh feed replaces it as soon as the item appears again.
 */
const KEY = "brief-discover-saved-v1";
const EVENT = "brief-discover-saved";

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((row) => row && row.kind && row.id) : [];
  } catch {
    return [];
  }
}

function write(rows) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows.slice(0, 60)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // Private mode / storage full: the heart still works for this render.
  }
}

export const favoritesEvent = EVENT;

export function loadFavorites() {
  return read();
}

export function favoriteKey(item) {
  return `${item?.kind}:${item?.id}`;
}

export function isFavorite(item) {
  if (!item?.kind || !item?.id) return false;
  const key = favoriteKey(item);
  return read().some((row) => favoriteKey(row) === key);
}

export function toggleFavorite(item) {
  if (!item?.kind || !item?.id) return false;
  const key = favoriteKey(item);
  const rows = read();
  const exists = rows.some((row) => favoriteKey(row) === key);
  if (exists) {
    write(rows.filter((row) => favoriteKey(row) !== key));
    return false;
  }
  const snapshot = {
    id: item.id,
    kind: item.kind,
    to: item.to,
    title: item.title,
    summary: item.summary,
    image: item.image,
    category: item.category,
    location: item.location,
    price_kes: item.price_kes,
    owner: item.owner || null,
    counts: item.counts || {},
    meta: item.meta || {},
    distance_km: item.distance_km,
    is_fair_corridor_price: item.is_fair_corridor_price,
    corridor_scope_label: item.corridor_scope_label,
    corridor_median_kes: item.corridor_median_kes,
  };
  write([snapshot, ...rows.filter((row) => favoriteKey(row) !== key)]);
  return true;
}
