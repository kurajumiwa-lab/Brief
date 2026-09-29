export const INTRO_SEEN_KEY = 'wairo.brand-intro.v1';
export const CARD_DURATION_MS = 4600;
export const isIntroPath = (path: string) => /^\/intro(?:\/|\/index\.html)?$/.test(path);

/** A brand welcome, never a gate in front of a ticket, shop or private desk.
 *  It plays only on the first page — the market — and on the atrium's old
 *  address, which resolves there. */
export function shouldPlayIntro(path: string, hash: string, seen: boolean): boolean {
  if (isIntroPath(path)) return true;
  return !seen && (path === '/' || path === '/index.html') && ['', '#', '#market', '#home'].includes(hash);
}
export function hasSeenIntro(): boolean {
  try { return window.sessionStorage.getItem(INTRO_SEEN_KEY) === '1'; }
  catch { return false; }
}
export function rememberIntro(): void {
  try { window.sessionStorage.setItem(INTRO_SEEN_KEY, '1'); }
  catch { /* The app still opens if storage is blocked. */ }
}
