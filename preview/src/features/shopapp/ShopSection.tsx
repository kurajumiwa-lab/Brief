import React, { lazy, Suspense } from 'react';
import { ChevronLeft } from 'lucide-react';
import { soundEngine } from '../../utils/SoundEngine';

// ---------------------------------------------------------------------------
// THE SECTION OVERLAY — one hash per section (`#section/news`), which is the
// app's standing rule: a second screen that has no URL has no back button on a
// phone. X and back gesture write the same source (the hash), and closing
// returns to Home, the tab underneath.
//
// Each section answers ONE business question with cards: one headline plus
// two–three metadata fields, a badge and a timestamp. Nothing here is a
// paragraph. Details belong inside the object the card opens, not on the
// shelf.
// ---------------------------------------------------------------------------

const MarketNews = lazy(() => import('./MarketNews').then((m) => ({ default: m.MarketNews })));
const SupplierBoard = lazy(() => import('./SupplierBoard').then((m) => ({ default: m.SupplierBoard })));
const StockBoard = lazy(() => import('./StockBoard').then((m) => ({ default: m.StockBoard })));
const ShopsBoard = lazy(() => import('./ShopsBoard').then((m) => ({ default: m.ShopsBoard })));
const GroupsBoard = lazy(() => import('./GroupsBoard').then((m) => ({ default: m.GroupsBoard })));

export const SECTION_TITLES: Record<string, { title: string; sub: string }> = {
  news: { title: 'Market News', sub: 'What changed' },
  suppliers: { title: 'Suppliers', sub: 'Who has stock' },
  stock: { title: 'Stock', sub: 'Listed prices' },
  shops: { title: 'Shops', sub: 'Spaces & shops' },
  groups: { title: 'Groups', sub: 'Trade groups' }
};

export interface ShopSectionProps {
  id: string;
  onBack: () => void;
  /** Open a public space's page (the real directory card). */
  onOpenSpace?: (slug: string) => void;
  /** Open a vendor's object page. */
  onOpenEntity?: (id: string) => void;
}

export const ShopSection: React.FC<ShopSectionProps> = ({ id, onBack, onOpenSpace, onOpenEntity }) => {
  const meta = SECTION_TITLES[id] ?? { title: 'Section', sub: '' };

  return (
    <div className="min-h-full">
      {/* Top bar: back, title, sub. No search here — each section that needs
          one carries it at the top of its own list. */}
      <div className="sticky top-0 z-10 px-4 pt-4 pb-3" style={{ background: 'var(--color-bg)' }}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { soundEngine.play('tap'); onBack(); }}
            className="w-9 h-9 rounded-2xl grid place-items-center cursor-pointer"
            style={{ background: 'var(--color-paper)', boxShadow: '0 2px 8px rgba(10,14,20,0.08)' }}
            aria-label="Back to home"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h2 className="text-lg font-black tracking-tight leading-tight" style={{ color: 'var(--color-text)' }}>
              {meta.title}
            </h2>
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
              {meta.sub}
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 pb-24">
        <Suspense fallback={<p className="text-sm py-8" role="status">Loading…</p>}>
          {id === 'news' && <MarketNews onOpenSpace={onOpenSpace} />}
          {id === 'suppliers' && <SupplierBoard onOpenEntity={onOpenEntity} />}
          {id === 'stock' && <StockBoard onOpenEntity={onOpenEntity} />}
          {id === 'shops' && <ShopsBoard onOpenSpace={onOpenSpace} />}
          {id === 'groups' && <GroupsBoard />}
        </Suspense>
      </div>
    </div>
  );
};

export default ShopSection;
