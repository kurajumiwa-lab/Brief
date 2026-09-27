import { CategoryArt } from '../../ui/CategoryArt';
import { MyTeamShops } from '../spaces/ShopTeam';
import React, { useEffect, useState } from 'react';
import { Store, Package, Plus, ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';
import type { Space } from '../../api/types';
import * as briefApi from '../../api/briefApi';
import type { FollowsGroups } from '../../api/briefApi';
import { splitSpaces } from '../home/spaceSignals';
import { NoPhotoPlate } from '../city/NoPhotoPlate';
import { GlobysCard } from '../../ui/GlobysCard';
import { Sheet } from '../../ui/Sheet';
import { Marketplace } from '../../components/Marketplace';
import { soundEngine } from '../../utils/SoundEngine';
import { EscrowRecords } from './EscrowRecords';
import { WairoMark } from '../../components/WairoMark';
import { PHOTO_FILTER } from '../city/room';

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
  className?: string;
}

const SectionHeading: React.FC<{
  icon: React.ReactNode;
  title: string;
  sub: string;
  action?: React.ReactNode;
}> = ({ icon, title, sub, action }) => (
  <div className="flex items-center gap-2.5">
    <span
      className="w-8 h-8 rounded-xl grid place-items-center shrink-0"
      style={{ background: 'var(--color-primary-subtle)', color: 'var(--color-primary)' }}
    >
      {icon}
    </span>
    <div className="min-w-0 flex-1">
      <h2 className="text-[15px] font-extrabold leading-tight" style={{ color: 'var(--color-text)' }}>{title}</h2>
      <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{sub}</p>
    </div>
    {action}
  </div>
);

function FollowBelt({
  follows,
  onOpenEntity
}: {
  follows: FollowsGroups;
  onOpenEntity: (id: string) => void;
}) {
  const items = Object.values(follows.groups).flat();
  if (items.length === 0) return null;
  return (
    <section aria-label="What you kept" className="space-y-2">
      <p className="text-[11px] font-mono uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-muted)' }}>
        Kept
      </p>
      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1" data-testid="follow-belt">
        {items.map((f) => {
          const initial = (f.name || '?').trim().charAt(0).toUpperCase();
          const src = f.imageUrl ? briefApi.mediaFileUrl(f.imageUrl) : null;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => { soundEngine.play('tap'); onOpenEntity(f.id); }}
              className="shrink-0 w-14 flex flex-col items-center gap-1 cursor-pointer"
            >
              {src ? (
                <img src={src} alt="" className="w-12 h-12 rounded-full object-cover" />
              ) : (
                <span
                  className="w-12 h-12 rounded-full grid place-items-center text-[15px] font-black"
                  style={{ background: 'var(--color-primary-subtle)', color: 'var(--color-primary)' }}
                >
                  {initial}
                </span>
              )}
              <span className="text-[11px] font-bold truncate w-14 text-center" style={{ color: 'var(--color-text)' }}>
                {f.name}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export const MineSurface: React.FC<MineSurfaceProps> = ({
  onOpenSpace,
  onOpenCreateSpace,
  onOpenEntity,
  onRequireAuth,
  sellingSignal = 0,
  className = ''
}) => {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [shopsFailed, setShopsFailed] = useState(false);
  const [shopsDenied, setShopsDenied] = useState(false);
  const [shopsAttempt, setShopsAttempt] = useState(0);
  const [follows, setFollows] = useState<FollowsGroups | null>(null);
  const [marketSection, setMarketSection] = useState<'orders' | 'selling'>('orders');
  const [marketKey, setMarketKey] = useState(0);
  const [shopSheet, setShopSheet] = useState<Space | null>(null);

  useEffect(() => {
    if (sellingSignal > 0) {
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
    void briefApi.getMyFollows().then((res) => {
      if (live && res.ok) setFollows(res.data);
    });
    return () => { live = false; };
  }, [shopsAttempt]);

  const { active } = splitSpaces(spaces);
  const lowestOffer = (s: Space): string | null => {
    const prices = (s.offers ?? [])
      .filter((o) => o.status === 'active' && typeof o.price === 'number' && o.price > 0)
      .map((o) => o.price);
    if (prices.length === 0) return null;
    const min = Math.min(...prices);
    const cur = (s.offers ?? []).find((o) => o.price === min)?.currency ?? 'KES';
    return `from ${cur} ${min.toLocaleString('en-KE')}`;
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

  const heroCover = active[0]?.image ? briefApi.mediaFileUrl(active[0].image) : null;

  return (
    <div className={`space-y-6 max-w-2xl mx-auto ${className}`}>
      {/* ── Bolt-style hero cover + logo plate + contrast endplate ────── */}
      <header className="relative overflow-hidden rounded-3xl" style={{ background: 'var(--navy)' }}>
        <div className="relative h-[168px] overflow-hidden">
          {heroCover ? (
            <img src={heroCover} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ filter: PHOTO_FILTER }} />
          ) : (
            <div className="absolute inset-0" style={{ background: 'radial-gradient(130% 130% at 85% 10%, rgba(64,145,108,0.42), rgba(13,27,42,0) 60%), #0D1B2A' }} />
          )}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(13,27,42,0.85), rgba(13,27,42,0) 60%)' }} />
          <div className="absolute -bottom-6 left-5 w-16 h-16 rounded-2xl bg-white grid place-items-center shadow-xl border border-black/5">
            <WairoMark size={36} title="" />
          </div>
          <div className="absolute top-4 left-5 right-5 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider" style={{ background: 'rgba(255,255,255,0.14)', color: '#fff', backdropFilter: 'blur(8px)' }}>
              <Sparkles className="w-3.5 h-3.5" /> Your corner
            </span>
            <span className="w-9 h-9 rounded-xl bg-white grid place-items-center shadow-md">
              <CategoryArt kind="shops" className="!w-7 !h-7" />
            </span>
          </div>
        </div>
        <div className="pt-8 pb-5 px-5">
          <h1 className="text-[24px] font-black leading-tight text-white tracking-tight">Make yourself<br />at home.</h1>
          <p className="text-[13px] mt-2" style={{ color: 'rgba(255,255,255,0.72)' }}>Your shops, your orders. One place to keep things moving — counted, not invented.</p>
        </div>
        <div className="px-5 py-3 flex items-center justify-between" style={{ background: 'rgba(255,255,255,0.06)', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.72)' }}>
            {active.length} shop{active.length === 1 ? '' : 's'} · {follows?.total ?? 0} kept
          </span>
          <button type="button" onClick={() => { soundEngine.play('tap'); onOpenCreateSpace(); }} className="inline-flex items-center gap-1 text-[11px] font-black rounded-full px-3 py-1.5" style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}>
            <Plus className="w-3 h-3" /> New shop
          </button>
        </div>
      </header>

      {follows && <FollowBelt follows={follows} onOpenEntity={onOpenEntity} />}

      <EscrowRecords />

      <section aria-label="Your shops" className="space-y-2.5">
        <SectionHeading
          icon={<Store className="w-4 h-4" />}
          title="Shops"
          sub="The shopfronts you operate"
          action={createBtn}
        />
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
              Nothing is shown in their place — no empty shop, no invented stall.
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
              Your next idea has a shopfront.
            </p>
            <p className="text-sm text-[var(--color-text-muted)]">Start with your name and brand cover. Add products or services when you are ready.</p>
            <button
              type="button"
              onClick={() => { soundEngine.play('heavyTap'); onOpenCreateSpace(); }}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-black cursor-pointer"
              style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
            >
              <Plus className="w-4 h-4" /> Create your first space
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5" data-testid="mine-shop-grid">
            {active.map((s) => (
              <GlobysCard
                key={s.id}
                testId={`shop-${s.id}`}
                image={s.image ? briefApi.mediaFileUrl(s.image) : null}
                imageAlt={s.name}
                plate={<NoPhotoPlate mark={s.modeLabel ?? 'shop'} icon={<Store className="w-4 h-4" />} />}
                title={s.name}
                price={lowestOffer(s)}
                seller="You"
                mono={s.profileLabels?.where ?? null}
                actionLabel="View shop →"
                onAction={() => { soundEngine.play('tap'); onOpenSpace(s.id); }}
                onOpen={() => { soundEngine.play('tap'); setShopSheet(s); }}
              />
            ))}
          </div>
        )}
      </section>

      <MyTeamShops />

      <section aria-label="Your orders" className="space-y-2.5">
        <SectionHeading icon={<Package className="w-4 h-4" />} title="Orders" sub="What you bought, what you sell" />
        <Marketplace key={marketKey} initialSection={marketSection} hideBrowse />
      </section>

      <Sheet
        open={shopSheet !== null}
        title={shopSheet?.name ?? ''}
        onClose={() => setShopSheet(null)}
      >
        {shopSheet && (
          <div className="space-y-3" data-testid="mine-shop-sheet-body">
            {lowestOffer(shopSheet) ? (
              <p className="text-[16px] font-bold" style={{ color: 'var(--color-text)' }}>{lowestOffer(shopSheet)}</p>
            ) : null}
            {shopSheet.profileLabels?.where ? (
              <p className="text-[12px] font-mono" style={{ color: 'var(--color-text-muted)' }}>{shopSheet.profileLabels.where}</p>
            ) : null}
            <button
              type="button"
              onClick={() => { soundEngine.play('tap'); onOpenSpace(shopSheet.id); }}
              className="w-full flex items-center justify-center px-3 py-2.5 rounded-xl text-[13px] font-bold cursor-pointer"
              style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
            >
              View shop →
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
};

export default MineSurface;
