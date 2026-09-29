import '../../ui/compact.css';
import { MyTeamShops } from '../spaces/ShopTeam';
import React, { useEffect, useState } from 'react';
import { Plus, ArrowRight, Briefcase } from 'lucide-react';
import type { PublicSpace, Space } from '../../api/types';
import * as briefApi from '../../api/briefApi';
import { splitSpaces } from '../home/spaceSignals';
import { AttentionStrip } from '../home/AttentionStrip';
import { Marketplace } from '../../components/Marketplace';
import { soundEngine } from '../../utils/SoundEngine';
import { EscrowRecords } from './EscrowRecords';

// ---------------------------------------------------------------------------
// SHOPS — the door for everything a person runs: the community-and-commerce
// workspaces they operate or join, the offers and orders those workspaces
// manage, and the team that may write to them.
//
// It opens on the attention read (`AttentionStrip`) — what is waiting across
// the shops today — and then the shops themselves. That read used to be the
// top of a separate Home door; the door went, the read stayed, because it is
// the thing a seller opens the app to check.
//
// Every section is a hash under `#shops` (`#shops/selling`, `#shops/team`), and
// the legacy `#spaces/…`, `#duka/…` and `#mine` addresses resolve here too.
// ---------------------------------------------------------------------------

/** The hash the Shops door and its sections answer to. */
export const SHOPS_HASH = 'shops';
export const shopsSectionHref = (section: 'spaces' | 'orders' | 'selling' | 'team'): string =>
  section === 'spaces' ? SHOPS_HASH : `${SHOPS_HASH}/${section}`;

export interface MineSurfaceProps {
  onOpenSpace: (spaceId: string, initialTab?: 'catalog' | 'pipeline' | 'ledger') => void;
  onOpenPublicSpace?: (slug: string) => void;
  onOpenCreateSpace: () => void;
  onOpenEntity: (entityId: string) => void;
  onRequireAuth: () => void;
  /** Open a section of the trade desk (the attention read points at open demand). */
  onOpenTrade?: (section?: string) => void;
  /** Create “Post an offer” lands on Selling here, not on the city’s browse. */
  sellingSignal?: number;
  initialSection?: 'spaces' | 'orders' | 'selling' | 'team';
  className?: string;
}

export const MineSurface: React.FC<MineSurfaceProps> = ({
  onOpenSpace,
  onOpenPublicSpace,
  onOpenCreateSpace,
  onOpenEntity,
  onRequireAuth,
  onOpenTrade,
  sellingSignal = 0,
  initialSection = 'spaces',
  className = ''
}) => {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [followedSpaces, setFollowedSpaces] = useState<PublicSpace[]>([]);
  const [loading, setLoading] = useState(true);
  const [followingLoading, setFollowingLoading] = useState(true);
  const [followingFailed, setFollowingFailed] = useState(false);
  const [shopsFailed, setShopsFailed] = useState(false);
  const [shopsDenied, setShopsDenied] = useState(false);
  const [shopsAttempt, setShopsAttempt] = useState(0);
  const [marketSection, setMarketSection] = useState<'orders' | 'selling'>('selling');
  const [marketKey, setMarketKey] = useState(0);
  const [section, setSection] = useState(initialSection === 'orders' ? 'selling' : initialSection);
  useEffect(() => {
    const next = initialSection === 'orders' ? 'selling' : initialSection;
    setSection(next);
    if (next === 'selling') { setMarketSection('selling'); setMarketKey(k => k + 1); }
  }, [initialSection]);

  useEffect(() => {
    if (sellingSignal > 0) {
      setSection('selling');
      setMarketSection('selling');
      setMarketKey((k) => k + 1);
    }
  }, [sellingSignal]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setFollowingLoading(true);
    setShopsFailed(false);
    setShopsDenied(false);
    setFollowingFailed(false);
    void Promise.all([briefApi.listMySpaces(), briefApi.getFollowedSpaces()]).then(([owned, followed]) => {
      if (!live) return;
      if (owned.ok && owned.data?.spaces) {
        setSpaces(owned.data.spaces);
        setShopsFailed(false);
        setShopsDenied(false);
      } else {
        setSpaces([]);
        setShopsDenied(!owned.ok && (owned as { status?: number }).status === 401);
        setShopsFailed(!owned.ok && (owned as { status?: number }).status !== 401);
      }
      setLoading(false);

      if (followed.ok && followed.data?.spaces) {
        setFollowedSpaces(followed.data.spaces);
        setFollowingFailed(false);
      } else {
        setFollowedSpaces([]);
        setFollowingFailed(!followed.ok && (followed as { status?: number }).status !== 401);
      }
      setFollowingLoading(false);
    }).catch(() => {
      if (!live) return;
      setSpaces([]);
      setFollowedSpaces([]);
      setShopsFailed(true);
      setFollowingFailed(true);
      setLoading(false);
      setFollowingLoading(false);
    });
    return () => { live = false; };
  }, [shopsAttempt]);

  const { active } = splitSpaces(spaces);

  /** The attention read's "Review orders / offers" lands on Selling, here. */
  const openSelling = () => {
    setSection('selling');
    setMarketSection('selling');
    setMarketKey((k) => k + 1);
    if (typeof window !== 'undefined') window.location.hash = shopsSectionHref('selling');
  };

  const createBtn = (
    <button
      type="button"
      onClick={() => { soundEngine.play('heavyTap'); onOpenCreateSpace(); }}
      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-black cursor-pointer shrink-0"
      style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
    >
      <Plus className="w-3.5 h-3.5" /> Create space
    </button>
  );


  return (
    <div className={`compact-surface ${className}`}>
      <header className="compact-heading">
        <div>
          <h1>{section === 'selling' ? 'Selling' : section === 'team' ? 'Shared Spaces' : 'Shops'}</h1>
          {section === 'selling'
            ? <p>Offers and orders your business manages.</p>
            : section === 'team'
              ? <p>Spaces shared with you by their owners.</p>
              : <p>What needs you today, and the counters you run.</p>}
        </div>
        {section === 'spaces' && createBtn}
      </header>

      {section !== 'selling' && <nav className="compact-tabs" aria-label="Shops sections">
        {(['spaces', 'team'] as const).map(key => <button key={key} aria-pressed={key === section} onClick={() => { setSection(key); window.location.hash = shopsSectionHref(key); }}>{key === 'spaces' ? 'Your spaces' : 'Shared with you'}</button>)}
      </nav>}

      {/* The operational read first: it is why a seller opens this door. It
          reads for itself and says so when it cannot, so the list below can
          never be mistaken for "nothing is waiting". */}
      {section === 'spaces' && (
        <AttentionStrip
          onOpenSpace={onOpenSpace}
          onOpenSelling={openSelling}
          onOpenTrade={onOpenTrade}
          onRequireAuth={onRequireAuth}
          refreshSignal={shopsAttempt}
        />
      )}

      {section === 'spaces' && <section aria-label="Your shops" className="space-y-2.5">
        <h2 className="text-sm font-extrabold" style={{ color: 'var(--color-text)' }}>Your spaces</h2>
        {loading ? (
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Reading your shops…</p>
        ) : shopsDenied ? (
          <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
            Sign in to see the shops you operate.
          </p>
        ) : shopsFailed ? (
          <div
            className="p-4 rounded-2xl space-y-2"
            style={{ background: 'var(--color-paper)', boxShadow: 'var(--room-light), inset 0 0 0 1px var(--brief-line)' }}
            role="status"
          >
            <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
              Your shops could not be read just now.
            </p>
            <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
              Try again when you’re connected.
            </p>
            <button
              type="button"
              onClick={() => { soundEngine.play('tap'); setShopsAttempt((n) => n + 1); }}
              className="inline-flex items-center px-3.5 py-2 rounded-full text-xs font-black cursor-pointer"
              style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
            >
              Try again
            </button>
          </div>
        ) : active.length === 0 ? (
          <div
            className="p-5 rounded-3xl border border-dashed text-center space-y-3"
            style={{ borderColor: 'var(--brief-line)', background: 'var(--color-paper)', boxShadow: 'var(--room-light), var(--lift-1)' }}
          >
            <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
              No spaces yet.
            </p>
            <p className="text-sm text-[var(--color-text-muted)]">Create a space for your products or services.</p>

          </div>
        ) : (
          <div className="compact-panel" data-testid="mine-shop-grid">
            {active.map((s) => (
              <article key={s.id} data-testid={`globys-card-shop-${s.id}`} className="flex items-center" style={{ borderBottom: '1px solid var(--divider)' }}>
                <button className="compact-row min-w-0 w-full" data-testid={`card-action-shop-${s.id}`} aria-label={`Open ${s.name}`} type="button" onClick={() => onOpenSpace(s.id)}>
                  <span className="compact-avatar">{s.image ? <img src={briefApi.mediaFileUrl(s.image)} alt="" /> : s.name.slice(0, 2).toUpperCase()}</span>
                  <span className="compact-row-text">
                    <strong>{s.name}</strong>
                    <small>
                      {typeof s.metrics?.offersCount === 'number' ? `${s.metrics.offersCount} offers` : 'Offer count unavailable'}
                      {s.visibility ? ` · ${s.visibility}` : ''}
                      {typeof s.editorialOpen === 'number' && s.editorialOpen > 0 ? ` · ${s.editorialOpen} to answer` : ''}
                      {s.maintenance?.state === 'fresh' ? ' · Profile fresh' : s.maintenance?.state === 'stale' ? ' · Profile needs a refresh' : s.maintenance?.state === 'unstarted' ? ' · Profile not set up' : ''}
                    </small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              </article>
            ))}
          </div>
        )}
      </section>}

      {section === 'spaces' && (followingLoading || followingFailed || followedSpaces.length > 0) && (
        <section aria-label="Spaces you follow" className="space-y-2.5">
          <h2 className="text-sm font-extrabold" style={{ color: 'var(--color-text)' }}>Spaces you follow</h2>
          {followingLoading ? (
            <p className="text-[13px]" role="status" style={{ color: 'var(--color-text-muted)' }}>Reading the Spaces you follow…</p>
          ) : followingFailed ? (
            <div role="status" className="space-y-2">
              <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>Followed Spaces could not be read just now.</p>
              <button type="button" onClick={() => setShopsAttempt((n) => n + 1)} className="text-[13px] font-bold underline" style={{ color: 'var(--color-primary)' }}>Try again</button>
            </div>
          ) : (
            <div className="compact-panel" data-testid="followed-spaces">
              {followedSpaces.map((space) => {
                const slug = space.slug || space.id;
                const openPublicSpace = () => onOpenPublicSpace
                  ? onOpenPublicSpace(slug)
                  : (window.location.hash = `space/${encodeURIComponent(slug)}`);
                return (
                  <article key={space.id} className="flex items-center" style={{ borderBottom: '1px solid var(--divider)' }}>
                    <button type="button" className="compact-row min-w-0 w-full" aria-label={`Open ${space.name}`} onClick={openPublicSpace}>
                      <span className="compact-avatar">{space.image ? <img src={briefApi.mediaFileUrl(space.image)} alt="" /> : space.name.slice(0, 2).toUpperCase()}</span>
                      <span className="compact-row-text">
                        <strong>{space.name}</strong>
                        <small>
                          {typeof space.activeOfferCount === 'number' ? `${space.activeOfferCount} ${space.activeOfferCount === 1 ? 'offer' : 'offers'}` : 'Offer count unavailable'}
                          {typeof space.followers === 'number' ? ` · ${space.followers} ${space.followers === 1 ? 'follower' : 'followers'}` : ''}
                          {space.where ? ` · ${space.where}` : ''}
                        </small>
                      </span>
                      <ArrowRight size={16} />
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {section === 'spaces' && <button type="button" className="compact-row" onClick={() => { window.location.hash = 'workforce/org'; }}>
        <Briefcase size={18} />
        <span className="compact-row-text"><strong>Workforce</strong><small>People, roles and assignments across your business.</small></span>
        <ArrowRight size={16} />
      </button>}
      {section === 'team' && <MyTeamShops />}
      {section === 'selling' && <>
        <Marketplace key={marketKey} initialSection={marketSection} hideBrowse />
        <details className="compact-disclosure"><summary>Escrow records</summary><EscrowRecords /></details>
      </>}
    </div>
  );
};

export default MineSurface;
