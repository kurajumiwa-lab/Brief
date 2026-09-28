// Secondary destinations only. Profile/settings live in You; commerce lives in Spaces.
import React, { useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '../ui/useDialogFocus';
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
  target: SheetTarget;
}

export const SHEET_GROUPS: Array<{ id: string; label: string; items: SheetItem[] }> = [
  { id: 'explore', label: 'Explore', items: [
    { id: 'pulse', label: 'Pulse', target: { kind: 'tab', tab: 'pulse' } },
    { id: 'explore-all', label: 'Marketplace', target: { kind: 'discover', room: 'all' } },
    { id: 'wanderly', label: 'Wanderly · Parties & trips', target: { kind: 'wanderly', dest: 'explore' } },
  ] },
  { id: 'work', label: 'Work & business', items: [
    { id: 'workforce', label: 'Work', target: { kind: 'tab', tab: 'workforce' } },
    { id: 'requests', label: 'Requests', target: { kind: 'tab', tab: 'requests' } },
    { id: 'supply', label: 'Supply', target: { kind: 'tab', tab: 'supply' } },
    { id: 'partners', label: 'Partners', target: { kind: 'tab', tab: 'partners' } },
    { id: 'elevate-hub', label: 'Elevate', target: { kind: 'elevate', page: 'hub' } },
  ] },
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

export const NavSheet: React.FC<NavSheetProps> = ({ open, onClose, onGo, place, onSetPlace, canModerate = false, canAdmin = false }) => {
  const [draft, setDraft] = useState(place);
  useEffect(() => { if (open) setDraft(place); }, [open, place]);

  const panelRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(open, panelRef, onClose);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Menu">
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
        ref={panelRef}
        tabIndex={-1}
        className="absolute top-0 bottom-14 md:bottom-0 left-0 w-[min(86vw,20rem)] overflow-y-auto p-4 space-y-5"
        style={{ background: 'var(--color-bg)', boxShadow: 'var(--lift-3)' }}
      >
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-black uppercase tracking-wider" style={{ color: 'var(--color-text)' }}>
            Menu
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

        {canAdmin && <nav aria-label="Administration"><SectionHeader>Administration</SectionHeader><Row testId="admin-members" label="Admin · Members" onClick={() => { onGo({ kind: 'admin' }); onClose(); }} /></nav>}
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

        <a href="/track" className="inline-flex items-center gap-2 py-2 mr-5 text-[12px] font-bold text-emerald-700">Track an order <ChevronRight size={14}/></a>

        <a href="/reviews" className="inline-flex items-center gap-2 py-2 text-[12px] font-bold text-emerald-700">Product reviews <ChevronRight size={14}/></a>
        {canModerate && <a href="/reviews/moderation" className="block py-2 text-[12px] font-bold">Review moderation →</a>}

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
