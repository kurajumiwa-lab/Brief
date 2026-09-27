// ---------------------------------------------------------------------------
// THE SHEET — the "All" drawer, and the one place the long list of
// destinations lives.
//
// The reorg that owns this file: the bottom bar holds exactly three doors
// (Home · Mine · You) plus one action ([+]). Everything else lives HERE, in
// groups, or as a section on Home. The rule that keeps the two from growing
// back into each other: a destination the sheet owns does not also get a door
// in the bar, and `doorways.jsx` asserts the overlap is zero.
//
// A second rule, from the operator: the sheet does not repeat the primary
// shelves either. Shops, Events, Groups, Errands and Group Buys already sit
// on Home, so they are NOT listed again here. What stays is rooms with no
// home of their own: the full marketplace, wholesale, and source-direct.
//
// The rows are quiet on purpose: a group label, then text rows with a
// chevron and a hairline. No icon per row, no card per row, no description
// per row — typography and spacing carry the hierarchy. Test ids, targets,
// Pulse-first and the settings trio are unchanged.
//
// Deliberately absent: counts, badges, "new" tags, unread dots. A nav list
// with numbers is a nav list that has to keep those numbers true, and every
// one of them would arrive before the member has rows to fill it.
// ---------------------------------------------------------------------------
import React, { useEffect, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { SectionHeader } from '../ui/MenuTile';

export type SheetTarget =
  | { kind: 'tab'; tab: 'requests' | 'supply' | 'partners' | 'workforce' | 'pulse' | 'mine' }
  | {
      kind: 'you';
      section:
        | 'profile' | 'standing' | 'following' | 'subscriptions'
        | 'earn' | 'orders' | 'selling' | 'archive' | 'tableBanking'
        | 'network' | 'how' | 'notifications' | 'privacy' | 'language';
    }
  | { kind: 'discover'; room: 'all' | 'events' | 'circles' | 'errands' | 'bulk' | 'direct' | 'group' }
  | { kind: 'storefront' }
  | { kind: 'moderation' }
  | { kind: 'elevate'; page: 'market' | 'ledger' | 'onboard' | 'hub' }
  | { kind: 'wanderly'; dest: 'tokyo' }
  | { kind: 'signout' };

export interface SheetItem {
  id: string;
  label: string;
  /** What the shelf holds, in the app's own words. Kept in the data for
      readers and suites; the rows themselves stay quiet. */
  sub?: string;
  target: SheetTarget;
}

/**
 * The sheet, as data. `doorways.jsx` asserts every `id` is unique, that Pulse
 * is in the first group, that the settings group is Language / Notifications /
 * Privacy, and that nothing here repeats a label from the bottom bar.
 */
export const SHEET_GROUPS: Array<{ id: string; label: string; items: SheetItem[] }> = [
  {
    id: 'pulse',
    label: 'Pulse',
    items: [
      {
        id: 'pulse',
        label: 'Pulse',
        sub: 'What’s moving today',
        target: { kind: 'tab', tab: 'pulse' }
      }
    ]
  },
  {
    id: 'explore', label: 'Market', items: [
      { id: 'storefront', label: 'Storefront', sub: 'The street, end to end', target: { kind: 'storefront' } },
      { id: 'explore-all', label: 'Offers & marketplace', sub: 'Products, services and sellers', target: { kind: 'discover', room: 'all' } },
      { id: 'explore-bulk', label: 'Wholesale', sub: 'Buy in volume for your shop', target: { kind: 'discover', room: 'bulk' } },
      { id: 'explore-direct', label: 'Source direct', sub: 'Buy closer to the producer', target: { kind: 'discover', room: 'direct' } },
    ]
  },
  {
    id: 'work',
    label: 'Your work',
    items: [
      { id: 'requests', label: 'Requests', sub: 'Asks on the board that need a seller', target: { kind: 'tab', tab: 'requests' } },
      { id: 'supply', label: 'Supply', sub: 'Sellers and what they move', target: { kind: 'tab', tab: 'supply' } },
      { id: 'partners', label: 'Partners', sub: 'Programs and networks behind the rows', target: { kind: 'tab', tab: 'partners' } },
      { id: 'workforce', label: 'Workforce', sub: 'Tasks, onboarding, territories and proof — from the phone', target: { kind: 'tab', tab: 'workforce' } }
    ]
  },
  {
    id: 'elevate',
    label: 'Wairo Elevate',
    items: [
      { id: 'elevate-hub', label: 'Elevate', sub: 'Market · Ledger · Onboard — integrated', target: { kind: 'elevate', page: 'hub' } },
      { id: 'elevate-market', label: 'Elevate Market', sub: 'Wholesale without guessing', target: { kind: 'elevate', page: 'market' } },
      { id: 'elevate-ledger', label: 'Elevate Ledger', sub: 'Money stated once, derived', target: { kind: 'elevate', page: 'ledger' } },
    ]
  },
  {
    id: 'wanderly',
    label: 'Wanderly Destinations',
    items: [
      { id: 'tokyo', label: 'Tokyo, Japan', sub: 'Where ancient temples meet neon-lit streets — editorial guide', target: { kind: 'wanderly', dest: 'tokyo' } },
    ]
  },
  {
    id: 'you',
    label: 'You, your standing, your money',
    items: [
      { id: 'standing', label: 'Standing', sub: 'What you owe, what is owed you', target: { kind: 'you', section: 'standing' } },
      { id: 'earn', label: 'Earn', sub: 'Your money, the real way', target: { kind: 'you', section: 'earn' } },
      { id: 'tableBanking', label: 'Table Banking', sub: 'Shared pots, kept in the open', target: { kind: 'you', section: 'tableBanking' } }
    ]
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [
      { id: 'language', label: 'Language', sub: 'One language, said plainly', target: { kind: 'you', section: 'language' } },
      { id: 'notifications', label: 'Notifications', sub: 'The real bell for this device', target: { kind: 'you', section: 'notifications' } },
      { id: 'privacy', label: 'Privacy', sub: 'What this device keeps, and how to clear it', target: { kind: 'you', section: 'privacy' } }
    ]
  },
  {
    // No group label: these two stand on their own, like the mock it came
    // from. The renderer skips the header for an empty label.
    id: 'closing',
    label: '',
    items: [
      { id: 'how', label: 'How Wairo works', sub: 'How a row becomes trust', target: { kind: 'you', section: 'how' } },
      { id: 'signout', label: 'Sign out', sub: 'End the session on this device', target: { kind: 'signout' } }
    ]
  }
];

export interface NavSheetProps {
  canModerate?: boolean;
  open: boolean;
  onClose: () => void;
  onGo: (target: SheetTarget) => void;
  /** The member's stated area, or empty. Never a guessed location. */
  place: string;
  onSetPlace: (place: string) => void;
}

const Row: React.FC<{ testId: string; label: string; onClick: () => void }> = ({ testId, label, onClick }) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    className="w-full flex items-center justify-between py-2.5 text-left cursor-pointer"
    style={{ borderBottom: '1px solid var(--divider)' }}
  >
    <span className="text-[15px] font-semibold" style={{ color: 'var(--brief-ink)' }}>{label}</span>
  </button>
);

export const NavSheet: React.FC<NavSheetProps> = ({ open, onClose, onGo, place, onSetPlace, canModerate = false }) => {
  const [draft, setDraft] = useState(place);
  useEffect(() => { if (open) setDraft(place); }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (typeof window !== 'undefined') window.addEventListener('keydown', onKey);
    return () => { if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey); };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="All sections">
      <button
        type="button"
        aria-label="Close the menu"
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
        className="absolute top-0 bottom-14 md:bottom-0 left-0 w-[min(86vw,20rem)] overflow-y-auto p-4 space-y-5"
        style={{ background: 'var(--color-bg)', boxShadow: 'var(--lift-3)' }}
      >
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-black uppercase tracking-wider" style={{ color: 'var(--color-text)' }}>
            All sections
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the menu"
            className="p-2 rounded-full cursor-pointer"
            style={{ background: 'var(--color-paper)', color: 'var(--color-text)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {canModerate && (
          <nav aria-label="Moderation">
            <Row testId="page-moderation" label="Page moderation" onClick={() => { onGo({ kind: 'moderation' }); onClose(); }} />
          </nav>
        )}

        {SHEET_GROUPS.map((group) => (
          <nav key={group.id} aria-label={group.label || 'More'}>
            {group.label ? <SectionHeader>{group.label}</SectionHeader> : null}
            {group.items.map((item) => (
              <Row
                key={item.id}
                testId={item.id}
                label={item.label}
                onClick={() => { onGo(item.target); onClose(); }}
              />
            ))}
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
