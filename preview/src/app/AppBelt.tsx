// ---------------------------------------------------------------------------
// THE BELT — the top band: a location, a search that resolves, a hamburger
// that owns the long list, and a message slot above the content.
//
// What it no longer is: a departments rail. The band used to carry a chip row
// (All · Events · Circles · Errands) that duplicated the board's own picker
// and Home's mode tiles — three chip lists for one taxonomy is the third
// navigation system the reorg deleted. Now the band is the header the mock it
// copies has: location + search + hamburger. Categories are Home's tiles and
// the board's picker, and that is enough.
//
// Everything else in the header is refused, on purpose:
//   * no "Delivering to <city>" that was inferred from an IP. The chip says the
//     area the member typed, or says it is unset;
//   * no cart badge, no "X people viewed this", no deal countdown, no "Early
//     Prime Deals" urgency, no Sponsored label, no ad beacon. Those are the
//     parts of that design that make people act against their own interest, and
//     this product's whole claim is the opposite;
//   * the search box resolves. It is not decoration: it writes `#search/<q>`,
//     which the shell answers with the real `/api/search` surface. A box that
//     filtered nothing would be the worst thing on this screen, because it
//     would teach the member that nothing here can be trusted.
// ---------------------------------------------------------------------------
import React, { useEffect, useState } from 'react';
import { ArrowLeft, Menu, Search, MapPin, Heart } from 'lucide-react';
import { WairoMark } from '../components/WairoMark';
import * as briefApi from '../api/briefApi';
import type { CampaignBanner } from '../api/types';
import { soundEngine } from '../utils/SoundEngine';
import { Sheet } from '../ui/Sheet';
import { FollowingSurface } from '../components/FollowingSurface';

export const PLACE_KEY = 'brief.world.place';
export const readPlace = () => {
  try { return typeof localStorage !== 'undefined' ? String(localStorage.getItem(PLACE_KEY) ?? '').trim() : ''; }
  catch { return ''; }
};

const DAY = new Intl.DateTimeFormat('en-KE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' });
const dayWords = (iso: string | null): string | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? DAY.format(new Date(ms)) : null;
};

export interface AppBeltProps {
  onOpenSheet: () => void;
  onHome: () => void;
  onSearch: (q: string) => void;
  /**
   * The way out, when a second screen is on top of a tab. The back GESTURE works
   * on its own (every surface is a hash — see `app/surfaces`); this makes the
   * same exit visible, so a person does not have to know the gesture to leave.
   * Absent when there is nothing above the tab, rather than greyed out: a
   * disabled control is a promise the app decided not to keep.
   */
  backTo?: { label: string; onBack: () => void } | null;
  className?: string;
}

export const AppBelt: React.FC<AppBeltProps> = ({
  onOpenSheet,
  onHome,
  onSearch,
  backTo = null,
  className = ''
}) => {
  const [q, setQ] = useState('');
  const [place] = useState(readPlace);
  const [banners, setBanners] = useState<CampaignBanner[] | null>(null);
  const [followCount, setFollowCount] = useState<number | null>(null);
  const [authed, setAuthed] = useState(true);
  const [followOpen, setFollowOpen] = useState(false);

  // One read per mount. A failure leaves `banners` null, and a null list renders
  // no slot at all: an empty promotional frame would be a placeholder claiming a
  // campaign exists.
  useEffect(() => {
    let live = true;
    void briefApi.getCampaignBanners().then((res) => {
      if (live && res.ok) setBanners(res.data ?? []);
    });
    void briefApi.getMyFollows().then((res) => {
      if (live && res.ok) setFollowCount(res.data.total);
    });
    void briefApi.whoAmI().then((res) => {
      if (live) setAuthed(res.ok);
    });
    return () => { live = false; };
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    soundEngine.play('tap');
    onSearch(term);
  };

  return (
    <div
      className={`sticky top-0 z-40 ${className}`}
      style={{ background: 'var(--color-paper)', boxShadow: 'var(--room-light), 0 1px 0 0 var(--brief-line)' }}
    >
      {/* ── band ── */}
      <div className="flex items-center gap-2 px-3 py-2">
        {backTo && (
          <button
            type="button"
            onClick={() => { soundEngine.play('tap'); backTo.onBack(); }}
            aria-label={`Back to ${backTo.label}`}
            className="flex items-center gap-1 px-2 py-2 rounded-xl shrink-0 cursor-pointer"
            style={{ color: 'var(--color-text)' }}
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="text-[12px] font-black uppercase tracking-wider">Back</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => { soundEngine.play('tap'); onOpenSheet(); }}
          aria-label="Open all sections"
          aria-haspopup="dialog"
          className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl shrink-0 cursor-pointer"
          style={{ color: 'var(--color-text)' }}
        >
          <Menu className="w-5 h-5" />
          <span className="text-[12px] font-black uppercase tracking-wider">All</span>
        </button>

        <button
          type="button"
          onClick={() => { soundEngine.play('tap'); onHome(); }}
          aria-label="Wairo home"
          className="flex items-center gap-1.5 shrink-0 cursor-pointer"
        >
          <WairoMark size={22} title="" />
          <span className="flex flex-col items-start leading-none">
            <span data-testid="wairo-wordmark" className="text-[15px] font-black tracking-tight" style={{ color: 'var(--wairo-slate)' }}>
              Wairo
            </span>
            <span data-testid="wairo-avenue" className="text-[11px] font-bold uppercase tracking-[0.12em] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              Blue Avenue
            </span>
          </span>
        </button>

        <form onSubmit={submit} role="search" className="flex-1 min-w-0 flex items-center gap-1.5">
          <label htmlFor="belt-search" className="sr-only">Search Wairo</label>
          <input
            id="belt-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search listings, vendors, places"
            aria-label="Search Wairo"
            className="min-w-0 flex-1 px-3 py-2 rounded-xl text-[13px] border"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--brief-line)', color: 'var(--color-text)' }}
          />
          <button
            type="submit"
            aria-label="Search"
            className="shrink-0 p-2 rounded-xl cursor-pointer disabled:opacity-40"
            disabled={!q.trim()}
            style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
          >
            <Search className="w-4 h-4" />
          </button>
        </form>

        {/* ── Following — heart is the ONLY entry, primary sheet ───── */}
        <button
          type="button"
          aria-label={`Following ${followCount ?? ''}`}
          onClick={() => { soundEngine.play('tap'); setFollowOpen(true); }}
          className="relative p-2 rounded-xl shrink-0 cursor-pointer hover:bg-[var(--color-well)]"
          style={{ color: 'var(--brief-ink)' }}
          data-testid="belt-heart"
        >
          <Heart className="w-5 h-5" />
          {followCount != null && followCount > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full grid place-items-center text-[10px] font-black"
              style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
            >
              {followCount}
            </span>
          )}
        </button>
      </div>

      {/* ── the area chip. Only ever what the member typed. ── */}
      <div className="px-3 pb-2 flex items-center">
        <button
          type="button"
          onClick={() => { soundEngine.play('tap'); onOpenSheet(); }}
          className="inline-flex items-center gap-1.5 text-[12px] font-bold cursor-pointer"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <MapPin className="w-3.5 h-3.5" />
          {place ? `Your area: ${place}` : 'Set your area'}
        </button>
      </div>

      {/* ── heart sheet — primary response, not a detour to Mine ─── */}
      <Sheet open={followOpen} title="Following" onClose={() => setFollowOpen(false)}>
        <FollowingSurface authed={authed} variant="embedded" onOpenEntity={(id) => { setFollowOpen(false); window.location.hash = `entity/${encodeURIComponent(id)}`; }} onRequireAuth={() => { setFollowOpen(false); window.location.hash = 'you'; }} />
      </Sheet>

      {/* ── the message slot. Nothing to say, nothing rendered. ── */}
      {banners && banners.length > 0 && (
        <div className="px-3 pb-2 space-y-1.5" aria-label="Announcements">
          {banners.slice(0, 2).map((b) => {
            const when = dayWords(b.startsAt);
            return (
              <div
                key={b.id}
                className="flex items-start gap-2 rounded-xl px-3 py-2"
                style={{ background: 'var(--color-primary-subtle)', boxShadow: 'inset 0 0 0 1px var(--brief-line)' }}
              >
                <p className="min-w-0 flex-1 text-[12px] leading-snug" style={{ color: 'var(--color-text)' }}>
                  <span className="font-black">{b.title}</span>
                  {b.body ? <span className="font-normal"> — {b.body}</span> : null}
                  {when ? <span className="font-bold"> · {when}</span> : null}
                  {b.location ? <span> · {b.location}</span> : null}
                </p>
                {/* Only a real, configured link gets a button. `share.available`
                    is false when no public origin is set, and then the banner is
                    words with no CTA rather than a URL that 404s. */}
                {b.share.available ? (
                  <a
                    href={b.share.url}
                    className="shrink-0 px-2.5 py-1 rounded-full text-[11px] font-black"
                    style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
                  >
                    Open
                  </a>
                ) : (
                  <span className="shrink-0 text-[11px] font-bold" style={{ color: 'var(--color-text-muted)' }}>
                    no public link yet
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AppBelt;
