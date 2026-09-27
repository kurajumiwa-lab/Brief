import React from 'react';
import { WairoMark } from '../components/WairoMark';
import { Plus } from 'lucide-react';
import { soundEngine } from '../utils/SoundEngine';

export type BriefNavigationTab =
  | 'supply'
  | 'requests'
  | 'home'
  | 'mine'
  | 'pulse'
  | 'spaces'
  | 'discover'
  | 'activity'
  | 'city'
  | 'pipeline'
  | 'ledger'
  | 'catalog'
  | 'partners'
  | 'workforce'
  | 'you';

export interface NavigationProps {
  activeTab: BriefNavigationTab;
  onSelectTab: (tab: BriefNavigationTab) => void;
  /** The Create action. It opens a sheet, not a route — it is the one thing in
      the bar that is a verb, not a place. */
  onOpenCreate?: () => void;
  spaceName?: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// THE BOTTOM BAR — three doors for what you do, one action for what you make.
//
//   Home · Mine · You · [+]
//
// The bar used to be five destinations (Home / Spaces / Discover / Activity /
// You). Three of those were really two: Spaces, Discover and Activity were all
// "somewhere else in the app", and a five-door bar plus a chip row plus a
// ten-item drawer was three navigation systems fighting for the same thumb.
//
// The resolution:
//   * HOME — what's happening nearby (the landing)
//   * MINE — your shops, orders, saved
//   * YOU  — identity, standing, money, settings
//   * [+]  — an action, not a door. It opens a sheet (Post an offer / Host an
//            event / Start a run / Post an errand). Standard pattern in the
//            apps this one is measured against (Gojek, Grab, Shopee).
//
// Everything else is a shelf in the drawer or a section on Home. That is the
// whole reorg, and `doorways.jsx` asserts it so the bar cannot grow a fourth
// door back in.
// ---------------------------------------------------------------------------

export type BottomBarItemId = 'home' | 'mine' | 'you' | 'create';

export interface BottomBarItem {
  id: BottomBarItemId;
  /** 'destination' = a place the bar takes you to. 'action' = a sheet it
      opens. The distinction is the point of the reorg: three places, one verb. */
  type: 'destination' | 'action';
  label: string;
}

/** The bar, as data. `doorways.jsx` asserts exactly three destinations and
    one action, that Pulse is not here, and that nothing in the drawer
    repeats a label from this list. */
export const BOTTOM_BAR_ITEMS: BottomBarItem[] = [
  { id: 'home', type: 'destination', label: 'Home' },
  { id: 'mine', type: 'destination', label: 'Mine' },
  { id: 'you', type: 'destination', label: 'You' },
  { id: 'create', type: 'action', label: 'Create' }
];

// Which door lights up for a given internal tab. Rooms (the board, supply,
// requests, partners) are not doors — they are reached from Home's tiles or
// the drawer, so nothing is highlighted while one is open. A bar that
// highlights Home while you are reading the board is the bug this bar
// replaces, so the honest answer is "none".
export const doorFor = (tab: BriefNavigationTab): 'home' | 'mine' | 'you' | null => {
  switch (tab) {
    case 'home': return 'home';
    case 'mine':
    case 'pipeline':
    case 'spaces':
    case 'ledger':
    case 'catalog':
      return 'mine';
    case 'you': return 'you';
    default: return null;
  }
};

// Filled navigation marks, distinct from the larger category illustrations.
const DoorwayIcon = ({ className = 'w-5 h-5' }) => <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2 11 12 2l10 9-2 2-1-1v10h-5v-7h-4v7H5V12l-1 1z" /></svg>;
const MineIcon = ({ className = 'w-5 h-5' }) => <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 3h16l3 7a3 3 0 0 1-5 2 3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-5-2zM4 14v8h7v-6h4v6h5v-8a5 5 0 0 1-5-1 5 5 0 0 1-6 0 5 5 0 0 1-5 1z" /></svg>;
const YouIcon = ({ className = 'w-5 h-5' }) => <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="7" r="5"/><path d="M3 22v-2c0-4 4-7 9-7s9 3 9 7v2z" /></svg>;

const DOOR_ICONS: Record<string, React.ReactNode> = {
  home: <DoorwayIcon className="w-5 h-5" />,
  mine: <MineIcon className="w-5 h-5" />,
  you: <YouIcon className="w-5 h-5" />
};

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onSelectTab,
  onOpenCreate,
  spaceName = 'Wairo',
  className = ''
}) => {
  const activeDoor = doorFor(activeTab);

  const goDoor = (door: 'home' | 'mine' | 'you') => {
    soundEngine.play('tap');
    if (typeof window !== 'undefined') {
      window.location.hash = door;
    }
    onSelectTab(door);
  };

  const openCreate = () => {
    soundEngine.play('tap');
    onOpenCreate?.();
  };

  // One button per item, in data order: three doors, then the action.
  const barButtons = () =>
    BOTTOM_BAR_ITEMS.map((item) =>
      item.type === 'action' ? (
        <button
          key={item.id}
          type="button"
          aria-label={`${item.label} — opens a sheet`}
          aria-haspopup="dialog"
          onClick={openCreate}
          className="relative flex flex-col items-center justify-center cursor-pointer select-none"
        >
          <span
            className="w-9 h-9 rounded-full grid place-items-center -mt-3"
            style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)', boxShadow: 'var(--lift-2)' }}
          >
            <Plus className="w-5 h-5" />
          </span>
          <span className="text-[11px] font-bold tracking-tight mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {item.label}
          </span>
        </button>
      ) : (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={activeDoor === item.id}
          aria-current={activeDoor === item.id ? 'page' : undefined}
          onClick={() => goDoor(item.id as 'home' | 'mine' | 'you')}
          className="relative flex flex-col items-center justify-center cursor-pointer select-none"
        >
          <span
            style={{
              color: activeDoor === item.id ? 'var(--color-text)' : 'var(--color-text-muted)',
              transform: activeDoor === item.id ? 'scale(1.05)' : undefined
            }}
          >
            {DOOR_ICONS[item.id]}
          </span>
          <span
            className="text-[11px] tracking-tight mt-0.5"
            style={{
              color: activeDoor === item.id ? 'var(--color-text)' : 'var(--color-text-muted)',
              fontWeight: activeDoor === item.id ? 800 : 500
            }}
          >
            {item.label}
          </span>
          {/* The active marker is a bar under the label, not a colour change:
              a state that relies on colour alone fails a colour-blind reader. */}
          <span
            aria-hidden="true"
            className="absolute bottom-0 w-6 h-0.5 rounded-full"
            style={{ background: activeDoor === item.id ? 'var(--color-primary)' : 'transparent' }}
          />
        </button>
      )
    );

  return (
    <>
      {/* ── MOBILE BAR — solid, anchored, 56px. Not a floating pill: a pill
          that hovers above the keyboard is a bar that is not part of the
          screen. This one is the floor. ── */}
      <nav
        role="navigation"
        aria-label="Primary"
        className={`md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[color:var(--color-paper)] border-t border-black/5 flex items-stretch justify-around px-2 ${className}`}
        style={{ height: '56px', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {barButtons()}
      </nav>

      {/* ── DESKTOP SIDEBAR RAIL — the same three doors and one action, in a
          column. The rail and the bar are one navigation with two shapes. ── */}
      <aside
        role="navigation"
        aria-label="Primary"
        className="hidden md:flex flex-col w-56 p-5 space-y-6 border-r border-black/5 bg-[color:var(--color-bg)] shrink-0 min-h-screen justify-between"
      >
        <div className="space-y-6">
          {/* Brand & active space */}
          <div className="space-y-2">
            <div className="flex items-center space-x-2.5">
              <span className="w-9 h-9 rounded-2xl flex items-center justify-center shrink-0" aria-hidden="true">
                <WairoMark size={28} title="" />
              </span>
              <span className="flex flex-col items-start leading-none">
                <span className="text-xl font-black tracking-tight" style={{ color: 'var(--wairo-slate)' }}>
                  Wairo
                </span>
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  Blue Avenue
                </span>
              </span>
            </div>
            <div className="p-2.5 rounded-2xl bg-[color:var(--color-paper)] border border-black/5 shadow-2xs flex items-center justify-between">
              <div className="flex items-center space-x-2 min-w-0">
                <span className="w-2 h-2 rounded-full bg-[color:var(--color-primary)] shrink-0" />
                <span className="text-xs font-black text-[color:var(--color-text)] truncate">
                  {spaceName}
                </span>
              </div>
            </div>
          </div>

          {/* The doors, in order */}
          <nav className="space-y-1.5">
            {BOTTOM_BAR_ITEMS.filter((i) => i.type === 'destination').map((item) => {
              const selected = activeDoor === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => goDoor(item.id as 'home' | 'mine' | 'you')}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-bold transition-all cursor-pointer ${
                    selected
                      ? 'bg-[color:var(--color-text)] text-[color:var(--color-primary)] shadow-xs'
                      : 'text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] hover:bg-black/5'
                  }`}
                >
                  {DOOR_ICONS[item.id]}
                  <span>{item.label}</span>
                </button>
              );
            })}
            {/* The action, last: it is a verb, and a verb does not get the
                destination styling. */}
            <button
              type="button"
              aria-label="Create — opens a sheet"
              aria-haspopup="dialog"
              onClick={openCreate}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-xs font-black cursor-pointer"
              style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)', boxShadow: 'var(--lift-1)' }}
            >
              <Plus className="w-4 h-4" />
              Create
            </button>
          </nav>
        </div>
        <p className="text-[11px] text-[color:var(--color-text-muted)]">
          Three doors for what you do. One action for what you make.
        </p>
      </aside>
    </>
  );
};

export default Navigation;
