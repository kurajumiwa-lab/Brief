import React, { useEffect, useMemo, useState } from 'react';
import { Search, Phone, MapPin, ArrowUpRight } from 'lucide-react';
import * as briefApi from '../../api/briefApi';
import type { Listing, Vendor } from '../../api/types';
import { kes, ago } from './format';
import { soundEngine } from '../../utils/SoundEngine';

// ---------------------------------------------------------------------------
// SUPPLIERS — the directory a trader checks for "who has it?"
//
// Each card is a real seller row joined to the real listings they have active
// right now: how many, the price range they state, and when the most recent
// one was stated. A registered name with nothing listed stays in the list
// (it is a real business) but reads "not listed yet" instead of getting a
// fake range.
// ---------------------------------------------------------------------------

const TYPE_LABEL: Record<string, string> = {
  manufacturer: 'Manufacturer',
  wholesaler: 'Wholesaler',
  distributor: 'Distributor',
  retailer: 'Retailer',
  service_provider: 'Service',
  logistics_provider: 'Logistics',
  warehouse: 'Warehouse',
  processor: 'Processor',
  fabricator: 'Fabricator',
  repair_provider: 'Repairs',
  sourcing_agent: 'Sourcing',
  hybrid: 'Hybrid'
};

interface Stock {
  count: number;
  min: number | null;
  max: number | null;
  latest: string | null;
  samples: string[];
}

export const SupplierBoard: React.FC<{ onOpenEntity?: (id: string) => void }> = ({ onOpenEntity }) => {
  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let live = true;
    Promise.all([briefApi.getVendors(), briefApi.listActiveListings()]).then(([v, l]) => {
      if (!live) return;
      if (v.ok) setVendors(v.data);
      if (l.ok) setListings(l.data);
    });
    return () => { live = false; };
  }, []);

  const stockByVendor = useMemo(() => {
    const m = new Map<string, Listing[]>();
    for (const l of listings) {
      const arr = m.get(l.vendorId) ?? [];
      arr.push(l);
      m.set(l.vendorId, arr);
    }
    const out = new Map<string, Stock>();
    for (const [id, arr] of m) {
      const prices = arr.map((l) => l.price).filter((p) => Number.isFinite(p));
      const sortedDates = arr.map((l) => l.updatedAt).sort();
      const latest = sortedDates.length ? sortedDates[sortedDates.length - 1] : null;
      out.set(id, {
        count: arr.length,
        min: prices.length ? Math.min(...prices) : null,
        max: prices.length ? Math.max(...prices) : null,
        latest,
        samples: arr.slice(0, 3).map((l) => l.title)
      });
    }
    return out;
  }, [listings]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (vendors ?? []).filter((v) =>
      !q || `${v.displayName} ${v.description ?? ''} ${v.location ?? ''} ${stockByVendor.get(v.id)?.samples.join(' ') ?? ''}`
        .toLowerCase().includes(q));
  }, [vendors, search, stockByVendor]);

  if (vendors === null) return <p className="text-sm py-8" role="status">Loading suppliers…</p>;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find a supplier or product"
          className="w-full pl-9 pr-3 py-2.5 rounded-2xl text-[13px] font-semibold bg-[color:var(--color-paper)] border-0 focus:outline-none"
          style={{ boxShadow: 'inset 0 0 0 1px var(--color-hairline, #DCE1E8)' }}
        />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-3xl p-6 text-center" style={{ background: 'var(--color-paper)', boxShadow: '0 2px 10px rgba(10,14,20,0.05)' }}>
          <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
            {search ? 'No supplier matches that search.' : 'No suppliers registered yet.'}
          </p>
          <p className="text-[12px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
            A supplier is a seller who lists stock from their own workspace.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((v) => {
            const stock = stockByVendor.get(v.id);
            const hasStock = Boolean(stock && stock.count > 0);
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => { if (onOpenEntity) { soundEngine.play('tap'); onOpenEntity(v.id); } }}
                className="w-full text-left rounded-3xl p-4 cursor-pointer disabled:cursor-default"
                style={{ background: 'var(--color-paper)', boxShadow: '0 2px 10px rgba(10,14,20,0.05)' }}
                disabled={!onOpenEntity}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[14px] font-black tracking-tight truncate" style={{ color: 'var(--color-text)' }}>
                        {v.displayName}
                      </p>
                      {v.businessType && (
                        <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide"
                          style={{ background: '#0A0E14', color: '#EAB308' }}>
                          {TYPE_LABEL[v.businessType] ?? v.businessType}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                      {v.location && (
                        <span className="inline-flex items-center gap-1 truncate"><MapPin className="w-3 h-3 shrink-0" />{v.location}</span>
                      )}
                      {v.contactMethod && (
                        <span className="inline-flex items-center gap-1 truncate"><Phone className="w-3 h-3 shrink-0" />{v.contactMethod}{v.contactName ? ` · ${v.contactName}` : ''}</span>
                      )}
                    </div>
                    {hasStock && stock!.samples.length > 0 && (
                      <p className="text-[11px] font-semibold truncate mt-1" style={{ color: 'var(--color-text-muted)' }}>
                        {stock!.samples.join(' · ')}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    {hasStock ? (
                      <>
                        <p className="text-[12px] font-black tabular-nums" style={{ color: 'var(--color-text)' }}>
                          {stock!.count} {stock!.count === 1 ? 'item' : 'items'}
                        </p>
                        <p className="text-[11px] font-bold tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                          {kes(stock!.min)}–{kes(stock!.max)}
                        </p>
                        <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                          {stock!.latest ? ago(stock!.latest) : ''}
                        </p>
                      </>
                    ) : (
                      <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                        Not listed yet
                      </p>
                    )}
                    <span className="inline-grid place-items-center w-7 h-7 rounded-lg mt-1" style={{ background: '#0A0E14', color: '#EAB308' }}>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SupplierBoard;
