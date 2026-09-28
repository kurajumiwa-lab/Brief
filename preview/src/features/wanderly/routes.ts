/** One home for parties, trips, publishing and tickets. Old doors are aliases. */
export type WanderlyRoute = { page: 'explore' | 'trips' | 'tickets' | 'host' | 'hosting' } | { page: 'experience'; slug: string };
export function wanderlyRoute(hash: string): WanderlyRoute | null {
  const h = hash.replace(/^#\/?/, '');
  if (['events', 'city/events', 'discover/events', 'tokyo', 'asia/tokyo', 'destinations/tokyo', 'wanderly/tokyo'].includes(h) || h.startsWith('destinations/')) return { page: 'explore' };
  if (h === 'host') return { page: 'host' };
  if (h === 'wanderly' || h === 'wanderly/explore') return { page: 'explore' };
  const match = /^wanderly\/experience\/([^/]+)$/.exec(h);
  if (match) { try { return { page: 'experience', slug: decodeURIComponent(match[1]) }; } catch { return null; } }
  if (['trips', 'tickets', 'host', 'hosting'].includes(h.slice(9)) && h.startsWith('wanderly/')) return { page: h.slice(9) as 'trips' | 'tickets' | 'host' | 'hosting' };
  return null;
}
export const experienceHref = (slug: string) => `#wanderly/experience/${encodeURIComponent(slug)}`;
export const isTrip = (event: { startsAt: string | null; endsAt: string | null }) => {
  if (!event.startsAt || !event.endsAt) return false;
  const start = Date.parse(event.startsAt), end = Date.parse(event.endsAt);
  return Number.isFinite(start) && Number.isFinite(end) && end - start >= 86400000;
};
