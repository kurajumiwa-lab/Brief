import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import * as briefApi from '../../api/briefApi';
import type { Listing, Vendor } from '../../api/types';
import { kes, ago } from './format';
import { soundEngine } from '../../utils/SoundEngine';

// ---------------------------------------------------------------------------
// STOCK INDEX — "who has it, and roughly what does it cost?"
//
// The app does not pretend to know the market price. Every line is a seller's
// own active listing: what they listed, for how much, and when that was
// stated. The range chips are the same aggregate priceSignals computes —
// min/max across active rows, never a trend, because a listing is a single
// price point and there is no per-day history to trend.
// ---------------------------------------------------------------------------

type SortMode = 'new' | 'low' | 'high';

/** A line older than a week reads stale — the colour says it, the words confirm. */
const isStale = (iso: string | null | undefined) => {
  if (!iso) return false;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && Date.now() - ms > 7 * 86_400_000;
};

export const StockBoard: React.FC<{ onOpenEntity?: (id: string) => void }> = ({ onOpenEntity }) => {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('new');

  useEffect(() => {
    let live = true;
    Promise.all([briefApi.listActiveListings('product'), briefApi.getVendors()]).then(([l, v]) => {
      if (!live) return;
      if (l.ok) setListings(l.data);
      if (v.ok) setVendors(v.data);
    });
    return () => { live = false; };
  }, []);

  const vendorName = useMemo(() => {
    const m = new Map<string, string>();
    vendors.forEach((v) => m.set(v.id, v.displayName));
    return m;
  }, [vendors]);

  const rangeFor = useMemo(() => {
    const active = (listings ?? []).filter((l) => l.type === 'product' && Number.isFinite(l.price));
    if (active.length === 0) return null;
    return { min: Math.min(...active.map((l) => l.price as number)), max: Math.max(...active.map((l) => l.price as number)) };
  }, [listings]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (listings ?? []).filter((l) =>
      !q || `${l.title} ${l.commodity ?? ''} ${l.locationName ?? ''} ${vendorName.get(l.vendorId) ?? ''}`.toLowerCase().includes(q));
    const sorted = [...list];
    if (sort === 'low') sorted.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
    else if (sort === 'high') sorted.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
    else sorted.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return sorted;
  }, [listings, search, sort, vendorName]);

  if (listings === null) return <p className="text-sm py-8" role="status">Loading stock…</p>;

  return (
    <div className="space-y-3">
      {/* What is listed right now: count + range, recomputed from rows. */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        <span className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold tabular-nums"
          style={{ background: 'var(--color-paper)', boxShadow: '0 1px 6px rgba(10,14,20,0.07)' }}>
          Listed now
          <span style={{ color: 'var(--color-text-muted)' }}>
            {rangeFor ? `${kes(rangeFor.min)}–${kes(rangeFor.max)}` : '—'} · {listings.length}
          </span>
        </span>
      </div>

      {/* Search + sort — the two controls a stock index actually needs. */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a product"
            className="w-full pl-9 pr-3 py-2.5 rounded-2xl text-[13px] font-semibold bg-[color:var(--color-paper)] border-0 focus:outline-none"
            style={{ boxShadow: 'inset 0 0 0 1px var(--color-hairline, #DCE1E8)' }}
          />
        </div>
        {(['new', 'low', 'high'] as SortMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => { soundEngine.play('tap'); setSort(m); }}
            className="px-3 py-2.5 rounded-2xl text-[11px] font-black uppercase tracking-wide cursor-pointer"
            style={sort === m
              ? { background: '#0A0E14', color: '#EAB308' }
              : { background: 'var(--color-paper)', color: 'var(--color-text-muted)', boxShadow: '0 1px 6px rgba(10,14,20,0.07)' }}
          >
            {m === 'new' ? 'New' : m === 'low' ? 'KES ↑' : 'KES ↓'}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-3xl p-6 text-center" style={{ background: 'var(--color-paper)', boxShadow: '0 2px 10px rgba(10,14,20,0.05)' }}>
          <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
            {search ? 'Nothing matches that search.' : 'No product stock listed yet.'}
          </p>
          <p className="text-[12px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
            Sellers add stock to their shop from their own workspace.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => { if (onOpenEntity) { soundEngine.play('tap'); onOpenEntity(l.vendorId); } }}
              className="w-full text-left rounded-3xl p-3.5 cursor-pointer disabled:cursor-default"
              style={{ background: 'var(--color-paper)', boxShadow: '0 2px 10px rgba(10,14,20,0.05)' }}
              disabled={!onOpenEntity}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-bold leading-snug truncate" style={{ color: 'var(--color-text)' }}>
                    {l.title}
                  </p>
                  <p className="text-[11px] font-semibold truncate mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                    {vendorName.get(l.vendorId) ?? 'Listed seller'}
                    {l.locationName ? ` · ${l.locationName}` : ''}
                    {l.minOrderQuantity ? ` · min ${l.minOrderQuantity}${l.unitLabel ? ` ${l.unitLabel}` : ''}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[13px] font-black tabular-nums" style={{ color: 'var(--color-text)' }}>
                    {kes(l.price, l.currency)}
                  </p>
                  <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: isStale(l.updatedAt) ? '#B45309' : 'var(--color-text-muted)' }}>
                    {ago(l.updatedAt)}{isStale(l.updatedAt) ? ' · stale' : ''}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <p className="text-[11px] font-semibold px-1" style={{ color: 'var(--color-text-muted)' }}>
        Listed prices, as sellers state them · each line shows when it was stated
      </p>
    </div>
  );
};

export default StockBoard;
