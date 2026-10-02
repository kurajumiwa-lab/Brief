import React, { useEffect, useState } from 'react';
import { Newspaper, Truck, Package, Store, Users, Briefcase } from 'lucide-react';
import * as briefApi from '../../api/briefApi';
import type { ShopHomeView } from '../../api/briefApi';
import { readPlace } from '../../app/AppBelt';
import { soundEngine } from '../../utils/SoundEngine';

// ---------------------------------------------------------------------------
// MY SHOP APP — HOME.
//
// The home is a shelf, not a feed. Each tile is a section that answers one
// business question (News / Suppliers / Stock / Shops / Groups / Brief); the
// number on it is a count of real rows, and zero renders as "—" because a
// section with nothing underneath must read empty, not decorated.
//
// Rules this screen obeys (the build spec):
//   * no explanatory copy — labels are 1–2 words, details live inside the
//     section you tap;
//   * numbers, badges and timestamps over prose;
//   * the dark plate is the only place the brand appears on this screen, so
//     the shelf itself stays scannable.
// ---------------------------------------------------------------------------

export const SHOP_SECTIONS = [
  { id: 'news', label: 'News', icon: Newspaper, tint: '#EEF2F7', ink: '#0A0E14' },
  { id: 'suppliers', label: 'Suppliers', icon: Truck, tint: '#E7F2EC', ink: '#166534' },
  { id: 'stock', label: 'Stock', icon: Package, tint: '#FBF3E0', ink: '#B45309' },
  { id: 'shops', label: 'Shops', icon: Store, tint: '#E4F2F6', ink: '#0E7490' },
  { id: 'groups', label: 'Groups', icon: Users, tint: '#EFEAF7', ink: '#6D28D9' },
  { id: 'brief', label: 'Brief', icon: Briefcase, tint: '#EEF1F5', ink: '#0A0E14' }
] as const;

export type ShopSectionId = typeof SHOP_SECTIONS[number]['id'];

export interface ShopHomeProps {
  onOpenBrief?: () => void;
}

const money = (n: number, c: string) => `${c} ${Number(n).toLocaleString('en-KE')}`;

export const ShopHome: React.FC<ShopHomeProps> = ({ onOpenBrief }) => {
  const [view, setView] = useState<ShopHomeView | null>(null);
  const [loading, setLoading] = useState(true);
  const place = readPlace() || 'Nairobi';

  useEffect(() => {
    let live = true;
    briefApi.getShopHome().then((res) => {
      if (!live) return;
      if (res.ok) setView(res.data);
      setLoading(false);
    });
    return () => { live = false; };
  }, []);

  const openSection = (id: ShopSectionId) => {
    soundEngine.play('tap');
    if (id === 'brief') {
      onOpenBrief?.();
      return;
    }
    window.location.hash = `section/${id}`;
  };

  return (
    <div className="space-y-4">
      {/* ── THE PLATE — brand + place + today's real count. Dark on light is
          the whole premium move; nothing below it carries the brand. ── */}
      <div
        className="rounded-3xl px-5 py-4 flex items-end justify-between"
        style={{ background: '#0A0E14', boxShadow: '0 10px 24px rgba(10,14,20,0.18)' }}
      >
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.28em] mb-1" style={{ color: '#EAB308' }}>
            My Shop App
          </p>
          <h1 className="text-xl font-black tracking-tight truncate" style={{ color: '#FFFFFF' }}>
            The market, checked.
          </h1>
        </div>
        <div className="text-right shrink-0 pl-3">
          <p className="text-[11px] font-bold" style={{ color: 'rgba(255,255,255,0.62)' }}>{place}</p>
          <p className="text-[13px] font-black tabular-nums" style={{ color: '#FFFFFF' }}>
            {loading ? '…' : `${view?.newToday ?? 0} new today`}
          </p>
        </div>
      </div>

      {/* ── THE SHELF — six doors, one question each. ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {SHOP_SECTIONS.map((s) => {
          const Icon = s.icon;
          const count = view?.tiles[s.id] ?? 0;
          const has = count > 0;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => openSection(s.id)}
              className="text-left rounded-3xl p-4 cursor-pointer transition-transform active:scale-[0.985]"
              style={{ background: 'var(--color-paper)', boxShadow: 'var(--lift-1, 0 2px 10px rgba(10,14,20,0.06))' }}
              aria-label={`${s.label} — ${has ? count : 'none yet'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span
                  className="w-11 h-11 rounded-2xl grid place-items-center shrink-0"
                  style={{ background: s.tint, color: s.ink }}
                >
                  <Icon className="w-5 h-5" />
                </span>
                <span
                  className="text-[15px] font-black tabular-nums leading-none pt-1"
                  style={{ color: has ? 'var(--color-text)' : 'var(--color-text-muted)', opacity: has ? 1 : 0.55 }}
                >
                  {loading ? '·' : has ? count : '—'}
                </span>
              </div>
              <p className="mt-3 text-[13px] font-black tracking-tight" style={{ color: 'var(--color-text)' }}>
                {s.label}
              </p>
            </button>
          );
        })}
      </div>

      {/* The one line that keeps the numbers honest: they are listed prices,
          stated by sellers, with the row's own timestamp — not an index. */}
      <p className="text-[11px] font-semibold px-1" style={{ color: 'var(--color-text-muted)' }}>
        Prices are listed prices, as sellers state them · counts are live rows
      </p>
    </div>
  );
};

export default ShopHome;
