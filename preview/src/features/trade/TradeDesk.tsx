import React, { useCallback } from 'react';
import '../supply/supply.css';
import './trade.css';

const RequestsWorkspaceImport = React.lazy(() =>
  import('../requests/RequestsWorkspace').then((m) => ({ default: m.RequestsWorkspace })),
);
const RelevantImport = React.lazy(() =>
  import('../matching/RelevantRequests').then((m) => ({ default: m.RelevantRequests })),
);
import { QuoteWorkspace } from '../quotes/LazyQuotes';
import { WorkWorkspace } from '../work/LazyWork';
import { ProcurementWorkspace } from '../procurement/ProcurementWorkspace';
const SupplyWorkspaceImport = React.lazy(() =>
  import('../supply/SupplyWorkspace').then((m) => ({ default: m.SupplyWorkspace })),
);

// ---------------------------------------------------------------------------
// THE TRADE DESK — one wing for the economic spine.
//
// Before this screen existed the loop the product is built around
// (raise demand → get matched → quote → work order → procurement → payment)
// was split across four destinations that the bottom bar never named:
// `#requests` and `#supply` were rows at the bottom of the drawer, quotes and
// work orders only appeared inside a selected request, and repeat buying was
// reachable from nowhere but the request detail. A member who wanted to
// "do business" had to already know the schema.
//
// So the six workspaces are mounted here, in the order the loop actually runs,
// unchanged underneath: this is a door and a signpost, not a rewrite. Nothing
// is re-implemented and nothing is invented — every number a section shows is
// the number the section already reads from its own endpoint, and a section
// that cannot be read says so in its own words.
//
// Deep links: `#trade/<section>[/<id>]`. The legacy addresses (`#requests`,
// `#requests/<id>`, `#supply/<route>`) keep working — the shell resolves them
// into this desk — because links like those are already inside sent
// notifications and WhatsApp messages.
// ---------------------------------------------------------------------------

export type TradeSectionId = 'demand' | 'open' | 'quotes' | 'work' | 'procurement' | 'supply';

export interface TradeSection {
  id: TradeSectionId;
  label: string;
  /** Who this section is for, in the words a person would use. */
  hint: string;
}

export const TRADE_SECTIONS: TradeSection[] = [
  { id: 'demand', label: 'My demand', hint: 'What you have asked for, and what is still open' },
  { id: 'open', label: 'Open demand', hint: 'What nearby members are asking for that you can serve' },
  { id: 'quotes', label: 'Quotes', hint: 'Prices you were invited to give, and the ones you gave' },
  { id: 'work', label: 'Work orders', hint: 'Agreed jobs: who promised what, by when' },
  { id: 'procurement', label: 'Repeat buying', hint: 'What you bought before, and buying it again' },
  { id: 'supply', label: 'Supply profile', hint: 'What you can supply, so matches can find you' }
];

/** The loop, as the wing explains itself. Copy only — no counts, no claims. */
export const TRADE_LOOP: Array<{ stage: string; section: TradeSectionId }> = [
  { stage: 'Ask', section: 'demand' },
  { stage: 'Match', section: 'open' },
  { stage: 'Quote', section: 'quotes' },
  { stage: 'Work order', section: 'work' },
  { stage: 'Reorder', section: 'procurement' }
];

export const isTradeSection = (value: string | null | undefined): value is TradeSectionId =>
  (TRADE_SECTIONS as Array<{ id: string }>).some((s) => s.id === value);

export const tradePath = (section: TradeSectionId, tail?: string) => {
  window.location.hash = tail ? `trade/${section}/${encodeURIComponent(tail)}` : `trade/${section}`;
};

export interface TradeDeskProps {
  section: TradeSectionId;
  /** `#requests/<id>` and `#trade/demand/<id>` both land here. */
  requestRoute?: string;
  /** `#supply/<route>` keeps its own sub-route. */
  supplyRoute?: string;
  onSection?: (section: TradeSectionId) => void;
}

export function TradeDesk({ section, requestRoute = '', supplyRoute = 'mine', onSection }: TradeDeskProps) {
  const go = useCallback(
    (next: TradeSectionId) => {
      tradePath(next);
      onSection?.(next);
    },
    [onSection]
  );

  const openRequest = useCallback(
    (id: string) => {
      tradePath('demand', id);
      onSection?.('demand');
    },
    [onSection]
  );

  const active = TRADE_SECTIONS.find((s) => s.id === section) ?? TRADE_SECTIONS[0];

  return (
    <div className="trade-desk" data-testid="trade-desk" data-trade-section={active.id}>
      <header className="mall-signage trade-desk__signage">
        <p className="mall-signage__eyebrow">THE COUNTING ROOM · BIASHARA</p>
        <div className="trade-desk__signage-row">
          <p className="mall-signage__note">
            Demand, matches, prices and agreed work — the loop this avenue runs on.
          </p>
          <button
            type="button"
            className="trade-desk__primary"
            onClick={() => go('demand')}
            data-trade-action="raise"
          >
            {active.id === 'demand' && requestRoute ? 'Continue your request' : 'Raise a request'}
          </button>
        </div>
        <ol className="trade-desk__loop" aria-label="How a deal moves">
          {TRADE_LOOP.map((step) => (
            <li key={step.stage}>
              <button
                type="button"
                onClick={() => go(step.section)}
                aria-current={active.id === step.section ? 'step' : undefined}
              >
                {step.stage}
              </button>
            </li>
          ))}
        </ol>
      </header>

      <nav className="trade-desk__rail-wrap" aria-label="Trade desk">
        <div className="trade-desk__rail" role="tablist">
        {TRADE_SECTIONS.map((item) => {
          const selected = item.id === active.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`trade-tab-${item.id}`}
              aria-selected={selected}
              aria-controls="trade-desk-panel"
              data-trade-tab={item.id}
              onClick={() => go(item.id)}
              title={item.hint}
              className={selected ? 'is-active' : ''}
            >
              <span className="trade-desk__tab-label">{item.label}</span>
              <span className="trade-desk__tab-hint">{item.hint}</span>
            </button>
          );
        })}
        </div>
      </nav>

      <div
        className="trade-desk__panel"
        id="trade-desk-panel"
        role="tabpanel"
        aria-labelledby={`trade-tab-${active.id}`}
      >
        <React.Suspense fallback={<p role="status">Opening the desk…</p>}>
          {active.id === 'demand' && <RequestsWorkspaceImport route={requestRoute} />}
          {active.id === 'open' && <RelevantImport />}
          {active.id === 'quotes' && <QuoteWorkspace />}
          {active.id === 'work' && <WorkWorkspace />}
          {active.id === 'procurement' && <ProcurementWorkspace onOpenRequest={openRequest} />}
          {active.id === 'supply' && <SupplyWorkspaceImport route={supplyRoute || 'mine'} />}
        </React.Suspense>
      </div>
    </div>
  );
}

export default TradeDesk;
