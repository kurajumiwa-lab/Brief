import React, { useEffect, useState } from 'react';
import { Newspaper, Tag, Store, Users, CalendarDays, ArrowUpRight } from 'lucide-react';
import * as briefApi from '../../api/briefApi';
import type { MarketNewsItem, MarketNewsView } from '../../api/briefApi';
import { kes, shortDate, ago } from './format';
import { soundEngine } from '../../utils/SoundEngine';

// ---------------------------------------------------------------------------
// MARKET NEWS — information, not commentary.
//
// Each line is a real row (a listing, a shopfront, a group order, an event)
// that was written inside the window, with its source, its place and the
// row's own timestamp. A line is never "prices rose" — the rows are single
// price points, not a series, so the line says what is listed and when it was
// stated. The chips at the top are the same honest snapshot priceSignals
// publishes: count and range of what sellers currently list, per type.
// ---------------------------------------------------------------------------

const KIND_META: Record<MarketNewsItem['kind'], { icon: typeof Newspaper; tint: string; ink: string }> = {
  listing: { icon: Tag, tint: '#FBF3E0', ink: '#B45309' },
  price: { icon: Tag, tint: '#E7F2EC', ink: '#166534' },
  shop: { icon: Store, tint: '#E4F2F6', ink: '#0E7490' },
  group: { icon: Users, tint: '#EFEAF7', ink: '#6D28D9' },
  event: { icon: CalendarDays, tint: '#EEF2F7', ink: '#0A0E14' }
};

const TYPE_LABEL: Record<string, string> = {
  product: 'Products', service: 'Services', experience: 'Experiences', event: 'Events'
};

export const MarketNews: React.FC<{ onOpenSpace?: (slug: string) => void }> = ({ onOpenSpace }) => {
  const [view, setView] = useState<MarketNewsView | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    briefApi.getMarketNews(7).then((res) => {
      if (!live) return;
      if (res.ok) setView(res.data);
      else setError(res.error ?? 'The news could not be loaded.');
    });
    return () => { live = false; };
  }, []);

  if (error) return <p className="text-sm py-8" role="alert">{error}</p>;
  if (!view) return <p className="text-sm py-8" role="status">Loading the board…</p>;

  return (
    <div className="space-y-3">
      {/* What is listed right now, per type — a snapshot, stated as one. */}
      {view.signals.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {view.signals.map((s) => (
            <span
              key={s.type}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold tabular-nums"
              style={{ background: 'var(--color-paper)', boxShadow: '0 1px 6px rgba(10,14,20,0.07)', color: 'var(--color-text)' }}
              title="Count and range of currently-active listed prices"
            >
              {TYPE_LABEL[s.type] ?? s.type}
              <span style={{ color: 'var(--color-text-muted)' }}>
                {kes(s.minPrice, s.currency)}–{kes(s.maxPrice, s.currency)} · {s.count}
              </span>
            </span>
          ))}
        </div>
      )}

      {view.items.length === 0 ? (
        <div className="rounded-3xl p-6 text-center" style={{ background: 'var(--color-paper)', boxShadow: '0 2px 10px rgba(10,14,20,0.05)' }}>
          <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>No new lines in the last 7 days.</p>
          <p className="text-[12px] mt-1" style={{ color: 'var(--color-text-muted)' }}>Lines appear when sellers list, shops open or groups order.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {view.items.map((it) => {
            const m = KIND_META[it.kind];
            const Icon = m.icon;
            const canOpen = it.link?.type === 'space' && it.link.slug && onOpenSpace;
            return (
              <div
                key={it.id}
                className="rounded-3xl p-3.5 flex items-center gap-3"
                style={{ background: 'var(--color-paper)', boxShadow: '0 2px 10px rgba(10,14,20,0.05)' }}
              >
                <span className="w-9 h-9 rounded-xl grid place-items-center shrink-0" style={{ background: m.tint, color: m.ink }}>
                  <Icon className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold leading-snug truncate" style={{ color: 'var(--color-text)' }}>
                    {it.headline}
                  </p>
                  <p className="text-[11px] font-semibold truncate mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                    {it.source}{it.location ? ` · ${it.location}` : ''} · {shortDate(it.date)}
                    {it.date && ` · ${ago(it.date)}`}
                  </p>
                </div>
                {it.price != null && (
                  <span className="shrink-0 text-[12px] font-black tabular-nums" style={{ color: 'var(--color-text)' }}>
                    {kes(it.price, it.currency)}
                  </span>
                )}
                {canOpen && (
                  <button
                    type="button"
                    onClick={() => { soundEngine.play('tap'); onOpenSpace!(it.link!.slug); }}
                    className="shrink-0 w-8 h-8 rounded-xl grid place-items-center cursor-pointer"
                    style={{ background: '#0A0E14', color: '#EAB308' }}
                    aria-label={`Open ${it.source}`}
                  >
                    <ArrowUpRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MarketNews;
