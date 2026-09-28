// ---------------------------------------------------------------------------
// SURFACES — every secondary screen the shell opens, named in the URL.
//
// Why the URL: the operator tests on an Android phone, where the way out of a
// screen is a gesture, not a pixel. A second screen that lives only in React
// state has no exit for that gesture — the back key changes the URL and the app
// carries on showing the sheet, which reads as a broken back button. (It also
// means a reload lands somewhere other than where you were looking.)
//
// So each overlay is one hash, and the hash is the only thing that opens or
// closes it: the X in the corner and the back on a phone write to the same
// source. `closeSurface` puts the URL back on the tab underneath, rather than
// clearing it to nothing — clearing it to '' is how "back" throws a person to
// Home and makes them think the app lost their place.
//
// The shop is the same rule with an id, because "which space am I operating" is
// a place, not a flag: `#shop/<spaceId>` opens SpaceShell and reloads into it.
// ---------------------------------------------------------------------------

/** The overlays, in the words that appear after the `#`. */
export type SurfaceKey =
  | 'create'        // the bar's [+] — eight verbs, request first
  | 'host'          // Host an event (createCampaign → publish)
  | 'groupbuys'     // the group-buy portal
  | 'menu'         // the drawer: the long list of destinations
  | 'new-space'     // create-a-space flow
  | 'manual-order'; // the walk-in order at the counter

export const SURFACE_KEYS: SurfaceKey[] = [
  'create', 'host', 'groupbuys', 'menu', 'new-space', 'manual-order'
];

/** `#shop/<spaceId>` — the owner's workspace for one space. */
export const SHOP_PREFIX = 'shop/';

/** The hash each tab answers to, so closing a surface lands on the tab, not on
 *  a blank URL. Mirrors the shell's own table; asserted in `backdoors.jsx`.
 *  The five mall doors come first; the rest are the rooms a wing contains and
 *  the legacy addresses that must keep resolving (notifications, shared links,
 *  and the deep links the surfaces themselves write). */
export const TAB_HASH: Record<string, string> = {
  home: 'home',
  market: 'market',
  trade: 'trade',
  duka: 'duka',
  you: 'you',
  city: 'city',
  discover: 'discover',
  pipeline: 'spaces',
  ledger: 'ledger',
  catalog: 'catalog',
  mine: 'mine',
  spaces: 'spaces',
  pulse: 'pulse',
  partners: 'partners',
  workforce: 'workforce',
  supply: 'supply',
  requests: 'requests'
};

/**
 * Every address the app has ever written, and where it lands now.
 *
 * A restructure that renames a wing and leaves the old address dead is a
 * restructure that breaks every link someone already sent in WhatsApp. So the
 * aliases are data, in one place, and `resolveTabHash` is the only function
 * allowed to turn a hash into a door. Legacy `#spaces`, `#mine`, `#city`,
 * `#requests` and `#supply` all still open a real screen.
 */
export const HASH_ALIAS: Record<string, string> = {
  city: 'market',
  discover: 'market',
  shops: 'market',
  activity: 'pulse',
  spaces: 'duka',
  mine: 'duka',
  selling: 'duka',
  orders: 'duka',
  pipeline: 'duka',
  catalog: 'duka',
  ledger: 'duka',
  shopbrief: 'duka',
  requests: 'trade',
  supply: 'trade',
  quotes: 'trade',
  work: 'trade',
  procurement: 'trade',
  matches: 'trade'
};

/** The first segment of a hash, mapped to the tab the shell renders. */
export function resolveTabHash(hash: string | null | undefined): string | null {
  const want = tabFromHash(hash);
  if (!want) return null;
  return HASH_ALIAS[want] ?? want;
}

export function surfaceFromHash(hash: string | null | undefined): SurfaceKey | null {
  const want = String(hash ?? '').replace(/^#/, '');
  return (SURFACE_KEYS as string[]).includes(want) ? (want as SurfaceKey) : null;
}

export function shopIdFromHash(hash: string | null | undefined): string | null {
  const want = String(hash ?? '').replace(/^#/, '');
  if (!want.startsWith(SHOP_PREFIX)) return null;
  const id = want.slice(SHOP_PREFIX.length);
  try {
    const decoded = decodeURIComponent(id);
    return decoded || null;
  } catch {
    return id || null;
  }
}

export function isSurfaceHash(hash: string | null | undefined): boolean {
  return surfaceFromHash(hash) !== null;
}

/** The hash to write to open a surface. */
export function surfaceHref(key: SurfaceKey): string {
  return `#${key}`;
}

export function shopHref(spaceId: string): string {
  return `#${SHOP_PREFIX}${encodeURIComponent(spaceId)}`;
}

/** The tab a hash names, or null when it names a surface or nothing. */
export function tabFromHash(hash: string | null | undefined): string | null {
  const want = String(hash ?? '').replace(/^#/, '').split('/')[0];
  if (!want) return null;
  if (isSurfaceHash(want) || want === SHOP_PREFIX.slice(0, -1)) return null;
  return want;
}

/**
 * Where a notification's `dest` actually goes in this shell — and `null` when it
 * does not, which is the answer a caller needs. The legacy shell can open an
 * object from the feed it already holds; this one has no object detail yet, so a
 * route would be invented rather than found. Returning null keeps the truth in
 * one place instead of in a comment on each caller.
 */
export function hrefForDest(dest: string | null | undefined): string | null {
  const d = String(dest ?? '');
  if (!d) return null;
  if (d === 'shopbrief') return TAB_HASH.pipeline;
  if (d.startsWith('entity:')) {
    const id = d.slice('entity:'.length);
    return id ? `entity/${encodeURIComponent(id)}` : null;
  }
  return null;
}

/** The tab a hash names, for a label that must not lag behind the screen. */
export const HASH_TAB: Record<string, string> = Object.fromEntries(
  Object.entries(TAB_HASH).map(([tab, href]) => [href, tab])
);

/**
 * What to call the place the back control returns to. Words a person already
 * sees on the bar or in the drawer — not "previous route", and not a screen name
 * the app invented for itself.
 */
export const TAB_LABEL: Record<string, string> = {
  home: 'Home',
  market: 'the market',
  trade: 'your deals',
  duka: 'your shop',
  city: 'the board',
  discover: 'the board',
  spaces: 'Spaces',
  ledger: 'the money',
  catalog: 'the catalog',
  mine: 'Mine',
  pulse: 'Pulse',
  you: 'You',
  partners: 'Partners',
  supply: 'your supply',
  requests: 'your requests'
};

export function backLabel(tabHash: string | null | undefined): string {
  const full = String(tabHash ?? '').replace(/^#/, '');
  if (full === 'spaces/selling' || full === 'spaces/orders') return 'Selling';
  const want = full.split('/')[0];
  return TAB_LABEL[want] ?? 'where you came from';
}


