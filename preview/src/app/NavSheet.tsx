// ---------------------------------------------------------------------------
// THE DIRECTORY — the board by the entrance, not a pile of leftovers.
//
// A mall's directory exists because a building has more shops than a person can
// hold in their head at once. It lists everything, in the order of the floors,
// and it never lists a shop that has closed: a directory row that opens nothing
// is worse than no row, because it teaches the reader that the app lies.
//
// So the same rule the old drawer had, stated again because it is the whole
// point of this file: every row here resolves to a screen that exists in the
// shell — a door, a wing's section, an overlay with its own hash, a You shelf,
// or one of the three standalone pages the app actually serves (/track,
// /reviews, /cloudbites, /pillars). And anything that is reachable ONLY from this board
// is marked as such in the suites: the board is a door for Pulse, Partners,
// Workforce, Elevate and the admin rooms, and those five screens have no other
// way in.
//
// The four doors of the mall are NOT repeated here as destinations with a
// different name; the rows below go into the parts of a wing a person does not
// land on by tapping the door itself.
// ---------------------------------------------------------------------------
import React, { useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '../ui/useDialogFocus';
import { ChevronRight, X } from 'lucide-react';
import { SectionHeader } from '../ui/MenuTile';
import type { TradeSectionId } from '../features/trade/TradeDesk';
import '../ui/mall.css';

export type SheetTarget =
  | { kind: 'tab'; tab: 'requests' | 'supply' | 'partners' | 'workforce' | 'pulse' | 'mine' | 'market' | 'trade' | 'shops' }
  | {
      kind: 'you';
      section:
        | 'profile' | 'standing' | 'following' | 'subscriptions'
        | 'earn' | 'orders' | 'selling' | 'archive' | 'tableBanking'
        | 'network' | 'how' | 'notifications' | 'privacy' | 'language';
    }
  | { kind: 'discover'; room: 'all' | 'events' | 'circles' | 'errands' | 'bulk' | 'direct' | 'group' | 'shops' | 'niche' }
  | { kind: 'trade'; section: TradeSectionId }
  | { kind: 'shops'; section: 'spaces' | 'orders' | 'selling' | 'team' }
  | { kind: 'surface'; surface: 'groupbuys' }
  | { kind: 'storefront' }
  | { kind: 'moderation' }
  | { kind: 'admin' }
  | { kind: 'elevate'; page: 'market' | 'ledger' | 'onboard' | 'hub' }
  | { kind: 'wanderly'; dest: 'explore' }
  | { kind: 'signout' };

export interface SheetItem {
  id: string;
  label: string;
  /** What the shelf holds, in the app's own words. Kept in the data for
      readers and suites; the rows themselves stay quiet. */
  sub?: string;
  /** The unit number on the directory board — wayfinding, not an id. */
  no?: string;
  target?: SheetTarget;
  /** A page of its own, linked rather than routed. Used for the three
      standalone pages, so a long-press can open one in another tab. */
  href?: string;
}

export const SHEET_GROUPS: Array<{ id: string; label: string; kicker?: string; items: SheetItem[] }> = [
  {
    id: 'market',
    label: 'Ground floor · the market',
    kicker: 'SOKO',
    items: [
      { id: 'market-all', no: 'M-01', label: 'Everything on the board', sub: 'Offers, events and shops nearby, in the board’s own order', target: { kind: 'discover', room: 'all' } },
      { id: 'pulse', no: 'M-02', label: 'Pulse', sub: 'The avenue’s own numbers: demand, closures, money settled', target: { kind: 'tab', tab: 'pulse' } },
      { id: 'market-shops', no: 'M-03', label: 'Shops & storefronts', sub: 'The traders you can walk into', target: { kind: 'discover', room: 'shops' } },
      { id: 'market-bulk', no: 'M-04', label: 'Bulk & wholesale', sub: 'Shared lots, declared routes, minimum orders', target: { kind: 'discover', room: 'bulk' } },
      { id: 'market-direct', no: 'M-05', label: 'Direct from the maker', sub: 'Goods without a middle counter', target: { kind: 'discover', room: 'direct' } },
      { id: 'market-niche', no: 'M-06', label: 'Small trades & services', sub: 'The side work people actually offer', target: { kind: 'discover', room: 'niche' } },
      { id: 'market-group', no: 'M-07', label: 'Group deals', sub: 'Prices that only happen together', target: { kind: 'discover', room: 'group' } }
    ]
  },
  {
    id: 'shops',
    label: 'Your counter · the shops',
    kicker: 'DUKA',
    items: [
      { id: 'shops-spaces', no: 'D-01', label: 'Your spaces', sub: 'Every shop, group-run counter and stall you operate', target: { kind: 'shops', section: 'spaces' } },
      { id: 'shops-selling', no: 'D-02', label: 'Offers & prices', sub: 'What is listed, what buyers asked about, what is still draft', target: { kind: 'shops', section: 'selling' } },
      { id: 'shops-orders', no: 'D-03', label: 'Orders & fulfilment', sub: 'Placed, marked in, settled, disputed', target: { kind: 'shops', section: 'orders' } },
      { id: 'shops-team', no: 'D-04', label: 'Team & roles', sub: 'Who may write, who may only read', target: { kind: 'shops', section: 'team' } },
      { id: 'you-tableBanking', no: 'D-05', label: 'Table banking circles', sub: 'The rotating savings group you are in, and the invites', target: { kind: 'you', section: 'tableBanking' } }
    ]
  },
  {
    id: 'trade',
    label: 'The counting room · trade',
    kicker: 'BIASHARA',
    items: [
      { id: 'trade-demand', no: 'T-01', label: 'My demand', sub: 'What you have asked for, and what is still open', target: { kind: 'trade', section: 'demand' } },
      { id: 'trade-open', no: 'T-02', label: 'Open demand', sub: 'What members nearby are asking for', target: { kind: 'trade', section: 'open' } },
      { id: 'trade-quotes', no: 'T-03', label: 'Quotes', sub: 'Invitations to price, and what you said', target: { kind: 'trade', section: 'quotes' } },
      { id: 'trade-work', no: 'T-04', label: 'Work orders', sub: 'Agreed jobs, promised dates, proof of delivery', target: { kind: 'trade', section: 'work' } },
      { id: 'trade-procurement', no: 'T-05', label: 'Repeat buying', sub: 'Buy it again from the same counter', target: { kind: 'trade', section: 'procurement' } },
      { id: 'trade-supply', no: 'T-06', label: 'Supply profile', sub: 'What you can supply, so matches find you', target: { kind: 'trade', section: 'supply' } },
      { id: 'groupbuys', no: 'T-07', label: 'Group buys', sub: 'Put money towards a lot and watch the stage move', target: { kind: 'surface', surface: 'groupbuys' } },
      { id: 'wanderly', no: 'T-08', label: 'Wanderly · parties & trips', sub: 'Gatherings, tickets and runs out of town', target: { kind: 'wanderly', dest: 'explore' } },
      { id: 'market-circles', no: 'T-09', label: 'Chamas & circles', sub: 'The rooms people pool money and work in', target: { kind: 'discover', room: 'circles' } },
      { id: 'market-errands', no: 'T-10', label: 'Errands & runs', sub: 'A bike is going that way anyway', target: { kind: 'discover', room: 'errands' } }
    ]
  },
  {
    id: 'you',
    label: 'Mezzanine · you',
    kicker: 'MIMI',
    items: [
      { id: 'you-notifications', no: 'Y-01', label: 'Notices', sub: 'What arrived for you, and what it was about', target: { kind: 'you', section: 'notifications' } },
      { id: 'you-following', no: 'Y-02', label: 'Following', sub: 'People, places and shops you keep up with', target: { kind: 'you', section: 'following' } },
      { id: 'you-archive', no: 'Y-03', label: 'Saved & set aside', sub: 'What you kept, and what you said is not for you', target: { kind: 'you', section: 'archive' } },
      { id: 'you-subscriptions', no: 'Y-04', label: 'Subscriptions', sub: 'Plans you are on, and what they cost', target: { kind: 'you', section: 'subscriptions' } },
      { id: 'you-language', no: 'Y-05', label: 'Language', sub: 'English or Kiswahili, per device', target: { kind: 'you', section: 'language' } },
      { id: 'you-privacy', no: 'Y-06', label: 'Privacy', sub: 'What is public, to whom, and how to change it', target: { kind: 'you', section: 'privacy' } },
      { id: 'you-how', no: 'Y-07', label: 'How Brief works', sub: 'The whole loop, in one page', target: { kind: 'you', section: 'how' } }
    ]
  },
  {
    id: 'services',
    label: 'Service desk',
    kicker: 'HUDUMA',
    items: [
      { id: 'workforce', no: 'S-01', label: 'Work & roles', sub: 'The worker register, vacancies and your crew', target: { kind: 'tab', tab: 'workforce' } },
      { id: 'partners', no: 'S-02', label: 'Partners', sub: 'Revenue share for those who bring members', target: { kind: 'tab', tab: 'partners' } },
      { id: 'elevate-hub', no: 'S-03', label: 'Elevate', sub: 'Programs, onboarding and the cohort ledger', target: { kind: 'elevate', page: 'hub' } },
      { id: 'track-order', no: 'S-04', label: 'Track an order', sub: 'Where a parcel you are waiting on actually is', href: '/track' },
      { id: 'product-reviews', no: 'S-05', label: 'Product reviews', sub: 'What buyers said about the goods, unrounded', href: '/reviews' },
      { id: 'food-court', no: 'S-06', label: 'Food court · CloudBites', sub: 'The kitchen wing — a concept preview, not a live market', href: '/cloudbites' },
      { id: 'trade-pillars', no: 'S-07', label: 'Trade floor · three pillars', sub: 'Supply, Shop and Gather — the commerce architecture, fitted to a phone', href: '/pillars' },
      { id: 'signout', no: 'S-08', label: 'Sign out', sub: 'Your rows stay on the server', target: { kind: 'signout' } }
    ]
  }
];

export interface NavSheetProps {
  canModerate?: boolean;
  canAdmin?: boolean;
  open: boolean;
  onClose: () => void;
  onGo: (target: SheetTarget) => void;
  /** The member's stated area, or empty. Never a guessed location. */
  place: string;
  onSetPlace: (place: string) => void;
}

const Row: React.FC<{ testId: string; label: string; sub?: string; no?: string; href?: string; onClick?: () => void }> = ({
  testId, label, sub, no, href, onClick
}) => {
  const inner = (
    <>
      {no && <span className="mall-index__no" aria-hidden="true">{no}</span>}
      <span className="mall-index__copy">
        <span className="mall-index__label" style={{ display: 'block' }}>{label}</span>
        {sub && <span className="mall-index__hint" style={{ display: 'block' }}>{sub}</span>}
      </span>
      <ChevronRight size={15} aria-hidden="true" style={{ color: 'var(--color-text-faint)', flex: 'none' }} />
    </>
  );
  if (href) {
    return (
      <a data-testid={`menu-tile-${testId}`} href={href} className="mall-index__row">
        {inner}
      </a>
    );
  }
  return (
    <button type="button" data-testid={`menu-tile-${testId}`} onClick={onClick} className="mall-index__row">
      {inner}
    </button>
  );
};

export const NavSheet: React.FC<NavSheetProps> = ({ open, onClose, onGo, place, onSetPlace, canModerate = false, canAdmin = false }) => {
  const [draft, setDraft] = useState(place);
  useEffect(() => { if (open) setDraft(place); }, [open, place]);

  const panelRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(open, panelRef, onClose);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Directory">
      <button
        type="button"
        aria-label="Close the directory"
        onClick={onClose}
        className="absolute inset-0 bg-black/45"
      />
      {/* bottom-14 = the 56px bar. The drawer stops ABOVE the floor it is
          drawn over: on a phone the two must not share a pixel. On md+ the bar
          is gone (it is the sidebar rail), so the drawer takes the full
          height there. `doorways.jsx` asserts the gap class, which is the
          geometric claim in a test that has no layout engine. */}
      <div
        data-testid="nav-sheet-panel"
        ref={panelRef}
        tabIndex={-1}
        className="absolute top-0 bottom-14 md:bottom-0 left-0 w-[min(90vw,22rem)] overflow-y-auto p-4 space-y-5"
        style={{ background: 'var(--color-bg)', boxShadow: 'var(--lift-3)' }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: 'var(--color-text-muted)' }}>
              Directory
            </p>
            <p className="text-[15px] font-black" style={{ color: 'var(--color-text)' }}>
              Wairo Blue Avenue
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the directory"
            className="p-2 rounded-full cursor-pointer"
            style={{ background: 'var(--color-paper)', color: 'var(--color-text)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {canAdmin && <nav aria-label="Administration"><SectionHeader>Administration</SectionHeader><Row testId="admin-members" label="Admin · Members" onClick={() => { onGo({ kind: 'admin' }); onClose(); }} /></nav>}
        {canModerate && (
          <nav aria-label="Moderation">
            <SectionHeader>Moderation</SectionHeader>
            <Row testId="page-moderation" label="Page moderation" onClick={() => { onGo({ kind: 'moderation' }); onClose(); }} />
            <a href="/reviews/moderation" className="mall-index__row" data-testid="menu-tile-review-moderation">
              <span className="mall-index__no" aria-hidden="true">A-01</span>
              <span className="mall-index__copy">
                <span className="mall-index__label" style={{ display: 'block' }}>Review moderation</span>
                <span className="mall-index__hint" style={{ display: 'block' }}>Reported product reviews, in the queue</span>
              </span>
            </a>
          </nav>
        )}

        {SHEET_GROUPS.map((group) => (
          <nav key={group.id} aria-label={group.label || 'More'}>
            <SectionHeader>{group.label}</SectionHeader>
            <div className="mall-index">
              {group.items.map((item) => (
                <Row
                  key={item.id}
                  testId={item.id}
                  label={item.label}
                  sub={item.sub}
                  no={item.no}
                  href={item.href}
                  onClick={() => { if (item.target) onGo(item.target); onClose(); }}
                />
              ))}
            </div>
          </nav>
        ))}

        {/* The area, set once and used by the only weather line this app shows.
            An empty field stays described as unset rather than defaulted to a
            city the member may not be in. */}
        <div className="pt-3 space-y-2" style={{ borderTop: '1px solid var(--divider)' }}>
          <label htmlFor="belt-place" className="block text-[11px] font-black uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
            Your area
          </label>
          <input
            id="belt-place"
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. Kisii"
            className="w-full px-3 py-2 rounded-xl text-[13px]"
            style={{ background: 'var(--color-paper)', color: 'var(--color-text)' }}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => { onSetPlace(draft.trim()); onClose(); }}
              className="px-4 py-1.5 rounded-full text-[12px] font-black cursor-pointer"
              style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => { onSetPlace(''); onClose(); }}
              className="text-[12px] font-bold cursor-pointer"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Clear it
            </button>
          </div>
          <p className="text-[11px] leading-snug" style={{ color: 'var(--color-text-muted)' }}>
            Used to read the forecast. A weather line appears only on a day you have something planned.
          </p>
        </div>
      </div>
    </div>
  );
};

export default NavSheet;
