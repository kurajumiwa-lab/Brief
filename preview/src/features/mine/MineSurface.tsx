import '../../ui/compact.css';
import { MyTeamShops } from '../spaces/ShopTeam';
import React, { useEffect, useState } from 'react';
import { Plus, ArrowRight, Briefcase } from 'lucide-react';
import type { Space } from '../../api/types';
import * as briefApi from '../../api/briefApi';
import { splitSpaces } from '../home/spaceSignals';
import { Marketplace } from '../../components/Marketplace';
import { soundEngine } from '../../utils/SoundEngine';
import { EscrowRecords } from './EscrowRecords';

// ---------------------------------------------------------------------------
// MINE — the second door: what you kept, the shops you operate, orders.
//
// No page title. The bar already says Mine.
//
// The dual-shelf bug this file exists to close: Home → Shops used to open a
// second street (SpacesLanding, starting with the morning brief) while this
// door opened a third (a gradient “Your shop overview” plus the same shops).
// Both lit the Mine door. There is one shelf now.
// ---------------------------------------------------------------------------

export interface MineSurfaceProps {
  onOpenSpace: (spaceId: string) => void;
  onOpenCreateSpace: () => void;
  onOpenEntity: (entityId: string) => void;
  onRequireAuth: () => void;
  /** Create “Post an offer” lands on Selling here, not on the city’s browse. */
  sellingSignal?: number;
  initialSection?: 'spaces' | 'orders' | 'selling' | 'team';
  className?: string;
}

export const MineSurface: React.FC<MineSurfaceProps> = ({
  onOpenSpace,
  onOpenCreateSpace,
  onOpenEntity,
  onRequireAuth,
  sellingSignal = 0,
  initialSection = 'spaces',
  className = ''
}) => {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [shopsFailed, setShopsFailed] = useState(false);
  const [shopsDenied, setShopsDenied] = useState(false);
  const [shopsAttempt, setShopsAttempt] = useState(0);
  const [marketSection, setMarketSection] = useState<'orders' | 'selling'>('orders');
  const [marketKey, setMarketKey] = useState(0);
  const [section, setSection] = useState(initialSection);
  useEffect(() => { setSection(initialSection); if (initialSection === 'orders' || initialSection === 'selling') { setMarketSection(initialSection); setMarketKey(k => k + 1); } }, [initialSection]);

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
    setShopsFailed(false);
    setShopsDenied(false);
    void briefApi.listMySpaces().then((res) => {
      if (!live) return;
      if (res.ok && res.data?.spaces) {
        setSpaces(res.data.spaces);
        setShopsFailed(false);
        setShopsDenied(false);
      } else {
        setSpaces([]);
        setShopsDenied(!res.ok && (res as { status?: number }).status === 401);
        setShopsFailed(!res.ok && (res as { status?: number }).status !== 401);
      }
      setLoading(false);
    }).catch(() => {
      if (!live) return;
      setSpaces([]);
      setShopsFailed(true);
      setLoading(false);
    });
    return () => { live = false; };
  }, [shopsAttempt]);

  const { active } = splitSpaces(spaces);
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
        <div><h1>Spaces</h1></div>
        {createBtn}
      </header>

      <nav className="compact-tabs" aria-label="Spaces sections">
        {(['spaces', 'orders', 'team'] as const).map(key => <button key={key} aria-pressed={key === section || (key === 'orders' && section === 'selling')} onClick={() => { setSection(key); window.location.hash = key === 'spaces' ? 'spaces' : `spaces/${key}`; }}>{key === 'spaces' ? 'Your spaces' : key === 'orders' ? 'Orders & selling' : 'Shared with you'}</button>)}
      </nav>
      {section === 'spaces' && <section aria-label="Your shops" className="space-y-2.5">
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
                  <span className="compact-row-text"><strong>{s.name}</strong><small>{s.metrics?.offersCount ?? 0} offers · {s.visibility ?? 'private'}{s.editorialOpen ? ` · ${s.editorialOpen} to answer` : ''}</small></span>
                  <ArrowRight size={16} />
                </button>
              </article>
            ))}
          </div>
        )}
      </section>}

      {section === 'spaces' && <button type="button" className="compact-row" onClick={() => { window.location.hash = 'workforce/org'; }}><Briefcase size={16} /><span className="compact-row-text">Manage your workforce</span><ArrowRight size={16} /></button>}
      {section === 'team' && <MyTeamShops />}
      {(section === 'orders' || section === 'selling') && <>
        <Marketplace key={marketKey} initialSection={marketSection} hideBrowse />
        <details className="compact-disclosure"><summary>Escrow records</summary><EscrowRecords /></details>
      </>}
    </div>
  );
};

export default MineSurface;
