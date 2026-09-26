import React from 'react';
import { TrendingUp, ShoppingBag, Target, Users } from 'lucide-react';
import * as briefApi from '../api/briefApi';
import type { CoopPost } from '../api/briefApi';
import type { Listing } from '../api/types';

/**
 * MONEY BAND — the "what can I act on right now?" strip at the top of the
 * Nearby stream. It exists to answer one question with real rows:
 * what is being asked for, offered, and opened around me?
 *
 * Honesty invariants (same ethic as CivicMetric — there is no third case):
 * 1. Every count is a real array length. Nothing estimates, inflates or
 *    pads. A band with zero rows is omitted; the whole strip hides when
 *    there is not enough real activity to be worth the space.
 * 2. Scope is stated. With an area hint the fetch is scoped and the strip
 *    says "around {area}"; without one it says "across Brief" — it never
 *    implies locality it did not measure.
 * 3. Density-gated: below MONEY_BAND_MIN_TOTAL the strip renders NOTHING.
 *    An empty money feed teaches people the app is empty; silence is
 *    cheaper.
 */

export const MONEY_BAND_MIN_TOTAL = 5;

export interface MoneyBandItem {
  id: string;
  title: string;
  /** A real, present detail: a budget, a price, an area. null when none exists. */
  sub: string | null;
}

export interface MoneyBandRow {
  key: 'looking' | 'selling' | 'opportunities';
  label: string;
  count: number;
  items: MoneyBandItem[];
  /** Which Nearby section the row's CTA opens. */
  section: 'mshikano' | 'market';
}

export interface MoneyBandModel {
  rows: MoneyBandRow[];
  total: number;
}

export interface MoneyBandInput {
  /** Open coop posts asking for something (need / looking_for). */
  looking: CoopPost[];
  /** Orderable listings. */
  listings: Listing[];
  /** Nearby stream objects of type 'opportunity', pre-filtered by the caller. */
  opportunities: { id: string; title: string; locationName?: string | null }[];
  /** Defaults to MONEY_BAND_MIN_TOTAL. */
  minTotal?: number;
}

/** Pure: same inputs, same answer. Counts are array lengths — nothing else. */
export function moneyBandModel({ looking, listings, opportunities, minTotal = MONEY_BAND_MIN_TOTAL }: MoneyBandInput): MoneyBandModel | null {
  const rows: MoneyBandRow[] = [];
  if (looking.length > 0) {
    rows.push({
      key: 'looking',
      label: 'people looking for something',
      count: looking.length,
      items: looking.slice(0, 3).map((p) => ({
        id: p.id,
        title: p.title,
        sub: p.town ?? p.county ?? null
      })),
      section: 'mshikano'
    });
  }
  if (listings.length > 0) {
    rows.push({
      key: 'selling',
      label: 'things and services on offer',
      count: listings.length,
      items: listings.slice(0, 3).map((l) => ({
        id: l.id,
        title: l.title,
        sub: `KES ${l.price}`
      })),
      section: 'market'
    });
  }
  if (opportunities.length > 0) {
    rows.push({
      key: 'opportunities',
      label: 'open opportunities',
      count: opportunities.length,
      items: opportunities.slice(0, 3).map((o) => ({
        id: o.id,
        title: o.title,
        sub: o.locationName ?? null
      })),
      section: 'mshikano'
    });
  }
  const total = rows.reduce((n, r) => n + r.count, 0);
  if (total < minTotal) return null;
  return { rows, total };
}

export interface MoneyBandProps {
  /** Nearby stream objects; the opportunities band is derived from these. */
  objects: { id: string; title: string; type?: string; locationName?: string | null }[];
  /** Area hint (town/county) used to scope the coop/looking fetch. Honest: shown in the caption. */
  areaHint?: string | null;
  /** Open a Nearby section when a row CTA is tapped. */
  onOpenSection: (section: 'mshikano' | 'market') => void;
  /** Open one underlying row (post/listing/object) when tapped. Optional. */
  onOpenItem?: (row: MoneyBandRow, item: MoneyBandItem) => void;
  /** Testing hook: override the density floor. Defaults to MONEY_BAND_MIN_TOTAL. */
  minTotal?: number;
}

const ROW_ICON = { looking: Users, selling: ShoppingBag, opportunities: Target } as const;

export function MoneyBand({ objects, areaHint, onOpenSection, onOpenItem, minTotal }: MoneyBandProps) {
  const [model, setModel] = React.useState<MoneyBandModel | null>(null);

  React.useEffect(() => {
    let live = true;
    const load = async () => {
      const scoped = areaHint ? String(areaHint).trim() : '';
      const [need, lookingFor, sell] = await Promise.all([
        briefApi.listCoopPosts({ intent: 'need', ...(scoped ? { county: scoped } : {}) }),
        briefApi.listCoopPosts({ intent: 'looking_for', ...(scoped ? { county: scoped } : {}) }),
        briefApi.getListings({ status: 'active' })
      ]);
      if (!live) return;
      // A failed fetch is zero rows for that band, not a pretend number —
      // the band is silent about what it could not measure.
      const looking = [
        ...(need.ok ? need.data.posts : []),
        ...(lookingFor.ok ? lookingFor.data.posts : [])
      ].filter((p) => p.status === 'open');
      const listings = (sell.ok ? sell.data : []).filter((l) => l.orderable);
      const opportunities = (objects ?? []).filter((o) => o.type === 'opportunity');
      setModel(moneyBandModel({ looking, listings, opportunities, ...(minTotal !== undefined ? { minTotal } : {}) }));
    };
    void load();
  }, [areaHint, objects, minTotal]);

  // The density gate: not enough real activity -> render nothing at all.
  if (!model) return null;

  return (
    <section aria-label="Money opportunities" className="mx-auto mb-6 max-w-5xl">
      <div className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[#40916C]" aria-hidden="true" />
            <h2 className="text-[12px] font-extrabold uppercase tracking-[0.18em] text-[var(--brief-ink)]">
              Money opportunities
            </h2>
          </div>
          <p className="text-[11px] font-semibold text-[var(--ink-70)]">
            {areaHint ? `around ${areaHint}` : 'across Brief — set your area to focus'}
          </p>
        </div>

        <div className="space-y-2">
          {model.rows.map((row) => {
            const Icon = ROW_ICON[row.key];
            return (
              <div key={row.key} className="rounded-xl border border-[var(--surface-3)] bg-[color:var(--color-paper)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-[13px] font-extrabold text-[var(--brief-ink)]">
                    <Icon className="h-3.5 w-3.5 text-[#40916C]" aria-hidden="true" />
                    {row.count} {row.label}
                  </p>
                  <button
                    type="button"
                    onClick={() => onOpenSection(row.section)}
                    className="cursor-pointer rounded-full border border-[var(--brief-line)] px-2.5 py-1 text-[11px] font-extrabold text-[#40916C] hover:bg-[var(--color-well)]"
                  >
                    Open
                  </button>
                </div>
                <ul className="mt-2 space-y-1">
                  {row.items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => onOpenItem?.(row, item)}
                        className="flex w-full cursor-pointer items-baseline justify-between gap-2 text-left"
                      >
                        <span className="min-w-0 truncate text-[12px] font-semibold text-[var(--ink-80)]">{item.title}</span>
                        {/* A sub-line is only rendered when the detail really exists. */}
                        {item.sub && <span className="shrink-0 text-[11px] font-bold text-[var(--ink-55)]">{item.sub}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
