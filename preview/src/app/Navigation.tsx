import React from 'react';
import { WairoMark } from '../components/WairoMark';
import { Coins, Plus, ShoppingBag, Store, User } from 'lucide-react';
import { soundEngine } from '../utils/SoundEngine';

export type BriefNavigationTab =
  | 'supply'
  | 'requests'
  | 'home'
  | 'mine'
  | 'shops'
  | 'pulse'
  | 'spaces'
  | 'discover'
  | 'activity'
  | 'city'
  | 'market'
  | 'trade'
  | 'duka'
  | 'pipeline'
  | 'ledger'
  | 'catalog'
  | 'partners'
  | 'workforce'
  | 'you';

/** The four doors of the mall, plus the one global action. */
export type PrimaryDestination = 'market' | 'shops' | 'trade' | 'you';

export interface NavigationProps {
  activeTab: BriefNavigationTab;
  /** AppShell resolves the shop's internal sections to one doorway. */
  activePrimaryTab?: PrimaryDestination | null;
  onSelectTab: (tab: PrimaryDestination) => void;
  /** The Create action opens a sheet, not a route. */
  onOpenCreate?: () => void;
  spaceName?: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// PRIMARY NAVIGATION — four doors and one global action.
//
//   Market · Shops · Trade · You   (+)
//
// The doors are the mall's floor plan, and they are in the order a person
// actually uses the building:
//
//   * MARKET is the board, and it is the first page — every offer, shop, event,
//     group, errand and bulk lot nearby. A cold load with no hash lands here.
//     It used to sit behind a Home atrium that mostly pointed at it.
//   * SHOPS is everything you run: your spaces, offers, orders and team. It
//     took the Home slot: the atrium's one load-bearing piece — the operational
//     read of what needs attention today — now opens the Shops door, so the
//     thing a seller came to check is the first thing the seller's own door
//     shows. "Home" and "Shop" used to be two doors for one person's business.
//   * TRADE is the economic spine — demand you raise, matches, quotes, work
//     orders, procurement, your supply profile.
//   * YOU is the person: standing, follows, money rails, notifications,
//     settings.
//
// The create action is global and never impersonates a destination.
//
// Legacy addresses (`#home`, `#duka`, `#spaces`, `#mine`, …) all keep resolving
// — see `surfaces.ts` — because a restructure that breaks a link already sent
// in WhatsApp is a restructure that lies about the past.
//
// Labels are English because a door you cannot read is not a door. Swahili is
// used as signage INSIDE each wing (kickers, headings), where it colours the
// place without hiding the way out.
// ---------------------------------------------------------------------------

export type BottomBarItemId = PrimaryDestination | 'create';

export interface BottomBarItem {
  id: BottomBarItemId;
  type: 'destination' | 'action';
  label: string;
  /** The wing's own signage word. Shown where there is room for a second line;
      never load-bearing for understanding the destination. */
  kicker?: string;
  icon: React.ReactNode;
}

export const BOTTOM_BAR_ITEMS: BottomBarItem[] = [
  { id: 'market', type: 'destination', label: 'Market', kicker: 'Soko', icon: <ShoppingBag className="w-5 h-5" aria-hidden="true" /> },
  { id: 'shops', type: 'destination', label: 'Shops', kicker: 'Duka', icon: <Store className="w-5 h-5" aria-hidden="true" /> },
  { id: 'trade', type: 'destination', label: 'Trade', kicker: 'Biashara', icon: <Coins className="w-5 h-5" aria-hidden="true" /> },
  { id: 'you', type: 'destination', label: 'You', kicker: 'Mimi', icon: <User className="w-5 h-5" aria-hidden="true" /> },
  { id: 'create', type: 'action', label: 'Create', icon: <Plus className="w-5 h-5" aria-hidden="true" /> }
];

/** The hash each door writes. Every one of these is handled by AppShell. */
export const DOOR_HASH: Record<PrimaryDestination, string> = {
  market: 'market',
  shops: 'shops',
  trade: 'trade',
  you: 'you'
};

/** The door a cold load opens: the first page. `#home` resolves here too. */
export const FIRST_DOOR: PrimaryDestination = 'market';

/** Map internal screens to their primary doorway. Rooms that live in the
 * directory (Pulse, Partners, Workforce, Elevate) intentionally light no door:
 * they are a wing you walk into, not the floor plan. */
export const doorFor = (tab: BriefNavigationTab): PrimaryDestination | null => {
  switch (tab) {
    // The atrium is gone; its address is the first page now.
    case 'home':
    case 'market':
    case 'city':
    case 'discover': return 'market';
    case 'trade':
    case 'requests':
    case 'supply': return 'trade';
    case 'shops':
    case 'mine':
    case 'duka':
    case 'pipeline':
    case 'spaces':
    case 'ledger':
    case 'catalog': return 'shops';
    case 'you': return 'you';
    default: return null;
  }
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
      window.location.hash = DOOR_HASH[door];
    }
    onSelectTab(door);
  };

  const openCreate = () => {
    soundEngine.play('tap');
    onOpenCreate?.();
  };

  const destinations = BOTTOM_BAR_ITEMS.filter((i) => i.type === 'destination');

  // One button per item, in data order: four doors, then the action. Five
  // slots on a 56px row; each slot is a 72px square at the narrowest phone we
  // support.
  const barButtons = () =>
    BOTTOM_BAR_ITEMS.map((item) =>
      item.type === 'action' ? (
        <button
          key={item.id}
          type="button"
          data-door={item.id}
          aria-label={`${item.label} — opens a sheet`}
          aria-haspopup="dialog"
          onClick={openCreate}
          className="relative flex flex-col items-center justify-center cursor-pointer select-none min-w-0"
        >
          <span
            className="w-9 h-9 rounded-full grid place-items-center -mt-3"
            style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)', boxShadow: 'var(--lift-2)' }}
          >
            {item.icon}
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
          data-door={item.id}
          aria-selected={activeDoor === item.id}
          aria-current={activeDoor === item.id ? 'page' : undefined}
          onClick={() => goDoor(item.id as PrimaryDestination)}
          className="relative flex flex-col items-center justify-center cursor-pointer select-none min-w-0"
        >
          <span
            style={{
              color: activeDoor === item.id ? 'var(--color-text)' : 'var(--color-text-muted)',
              transform: activeDoor === item.id ? 'scale(1.05)' : undefined
            }}
          >
            {item.icon}
          </span>
          <span
            className="text-[11px] tracking-tight mt-0.5 truncate max-w-full px-0.5"
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
        className={`md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[color:var(--color-paper)] border-t border-black/5 flex items-stretch justify-around gap-0.5 px-1.5 ${className}`}
        style={{ height: '56px', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {barButtons()}
      </nav>

      {/* ── DESKTOP SIDEBAR RAIL — the same four doors and one action, in a
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
                  The avenue
                </span>
              </span>
            </div>
            <button
              type="button"
              onClick={() => goDoor('shops')}
              className="w-full p-2.5 rounded-2xl bg-[color:var(--color-paper)] border border-black/5 shadow-2xs flex items-center justify-between text-left cursor-pointer"
              aria-label={`Your shop — ${spaceName}`}
            >
              <span className="flex items-center space-x-2 min-w-0">
                <span className="w-2 h-2 rounded-full bg-[color:var(--color-primary)] shrink-0" />
                <span className="text-xs font-black text-[color:var(--color-text)] truncate">{spaceName}</span>
              </span>
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                Duka
              </span>
            </button>
          </div>

          {/* The doors, in order */}
          <nav className="space-y-1.5">
            {destinations.map((item) => {
              const selected = activeDoor === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  data-door={item.id}
                  aria-selected={selected}
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => goDoor(item.id as PrimaryDestination)}
                  title={`${item.label}${item.kicker ? ` · ${item.kicker}` : ''}`}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-bold transition-all cursor-pointer ${
                    selected
                      ? 'bg-[color:var(--color-text)] text-[color:var(--color-primary)] shadow-xs'
                      : 'text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] hover:bg-black/5'
                  }`}
                >
                  {item.icon}
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.kicker && (
                    <span
                      className="text-[11px] font-bold uppercase tracking-[0.1em]"
                      style={{ color: selected ? 'var(--color-text-muted)' : 'var(--color-text-muted)', opacity: 0.75 }}
                    >
                      {item.kicker}
                    </span>
                  )}
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
          Market · Shops · Trade · You — plus one action to create.
        </p>
      </aside>
    </>
  );
};

export default Navigation;
