import React from 'react';
import { WairoMark } from '../components/WairoMark';
import { Home, Plus, ShoppingBag, Store, User } from 'lucide-react';
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

export type PrimaryDestination = 'home' | 'selling' | 'spaces' | 'you';

export interface NavigationProps {
  activeTab: BriefNavigationTab;
  /** AppShell resolves Mine's legacy/internal sections to Selling or Spaces. */
  activePrimaryTab?: PrimaryDestination | null;
  onSelectTab: (tab: PrimaryDestination) => void;
  /** The Create action opens a sheet, not a route. */
  onOpenCreate?: () => void;
  spaceName?: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// PRIMARY NAVIGATION — four places and one global action.
//
//   Home · Selling · Spaces · You · [+]
//
// Home is the operational read; Selling holds orders and offers; Spaces keeps
// Wairo's commerce-and-community workspaces distinct; You holds the person.
// The board, work network and other rooms remain reachable from the app's
// secondary navigation. The create action is global and never impersonates a
// destination.
// ---------------------------------------------------------------------------

export type BottomBarItemId = PrimaryDestination | 'create';

export interface BottomBarItem {
  id: BottomBarItemId;
  type: 'destination' | 'action';
  label: string;
}

export const BOTTOM_BAR_ITEMS: BottomBarItem[] = [
  { id: 'home', type: 'destination', label: 'Home' },
  { id: 'selling', type: 'destination', label: 'Selling' },
  { id: 'spaces', type: 'destination', label: 'Spaces' },
  { id: 'you', type: 'destination', label: 'You' },
  { id: 'create', type: 'action', label: 'Create' }
];

/** Map internal screens to their primary doorway. Discovery and other rooms
 * are reached from Home or the drawer and intentionally light no primary tab. */
export const doorFor = (tab: BriefNavigationTab): PrimaryDestination | null => {
  switch (tab) {
    case 'home': return 'home';
    case 'mine':
    case 'pipeline':
    case 'spaces': return 'spaces';
    case 'ledger':
    case 'catalog': return 'selling';
    case 'you': return 'you';
    default: return null;
  }
};

const DOOR_ICONS: Record<PrimaryDestination, React.ReactNode> = {
  home: <Home className="w-5 h-5" aria-hidden="true" />,
  selling: <ShoppingBag className="w-5 h-5" aria-hidden="true" />,
  spaces: <Store className="w-5 h-5" aria-hidden="true" />,
  you: <User className="w-5 h-5" aria-hidden="true" />
};

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  activePrimaryTab,
  onSelectTab,
  onOpenCreate,
  spaceName = 'Your business',
  className = ''
}) => {
  const activeDoor = activePrimaryTab === undefined ? doorFor(activeTab) : activePrimaryTab;

  const goDoor = (door: PrimaryDestination) => {
    soundEngine.play('tap');
    if (typeof window !== 'undefined') {
      window.location.hash = door === 'selling' ? 'spaces/selling' : door === 'spaces' ? 'spaces' : door;
    }
    onSelectTab(door);
  };

  const openCreate = () => {
    soundEngine.play('tap');
    onOpenCreate?.();
  };

  // One button per item, in data order: four destinations, then the action.
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
          onClick={() => goDoor(item.id as PrimaryDestination)}
          className="relative flex flex-col items-center justify-center cursor-pointer select-none"
        >
          <span
            style={{
              color: activeDoor === item.id ? 'var(--color-text)' : 'var(--color-text-muted)',
              transform: activeDoor === item.id ? 'scale(1.05)' : undefined
            }}
          >
            {DOOR_ICONS[item.id as PrimaryDestination]}
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

      {/* ── DESKTOP SIDEBAR RAIL — the same four destinations and one action,
          in a column. The rail and the bar are one navigation with two shapes. ── */}
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
                  Seller workspace
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
                  onClick={() => goDoor(item.id as PrimaryDestination)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-bold transition-all cursor-pointer ${
                    selected
                      ? 'bg-[color:var(--color-text)] text-[color:var(--color-primary)] shadow-xs'
                      : 'text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] hover:bg-black/5'
                  }`}
                >
                  {DOOR_ICONS[item.id as PrimaryDestination]}
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
          Home · Selling · Spaces · You — plus one action to create.
        </p>
      </aside>
    </>
  );
};

export default Navigation;
