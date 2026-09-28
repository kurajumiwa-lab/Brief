import React, { useEffect } from 'react';
import { Package, CalendarPlus, Truck, Bike, Briefcase, X } from 'lucide-react';
import { soundEngine } from '../utils/SoundEngine';

// ---------------------------------------------------------------------------
// THE CREATE SHEET — the one action in the bottom bar.
//
// [+] is a verb, not a place: it opens this sheet, and each row of the sheet
// does one real thing. It replaces the floating "Host an event / Post a
// listing" buttons that sat on top of every screen — the clutter this reorg
// deletes — and it lives in exactly one place, so a surface that wants a
// create action gets it from the bar, not from its own corner.
//
// Each row lands on the flow that actually writes the row:
//   Post an offer  → Mine’s Selling tab, where a listing (and the shop it
//                    belongs to) is really written — not a fourth browse shelf
//   Host an event  → the createCampaign → publish loop (it is public the
//                    moment it is written)
//   Start a run    → the errand board with the delivery kind chosen and the
//                    composer open
//   Post an errand → the errand board with the composer open
// ---------------------------------------------------------------------------

export type CreateActionId = 'offer' | 'event' | 'run' | 'errand' | 'work';

export interface CreateAction {
  id: CreateActionId;
  label: string;
  /** One clause, not a paragraph: what the row IS, said in the app's words. */
  hint: string;
  icon: React.ReactNode;
}

/** The sheet, as data — every verb resolves to its creation surface. */
export const CREATE_ACTIONS: CreateAction[] = [
  {
    id: 'work', label: 'Create work', hint: 'Buy a verified outcome from your distributed team',
    icon: <Briefcase className="w-4 h-4" />
  },
  {
    id: 'offer',
    label: 'Post an offer',
    hint: 'A row in your catalog, with the shop it belongs to',
    icon: <Package className="w-4 h-4" />
  },
  {
    id: 'event',
    label: 'Host a party or trip',
    hint: 'A plan on Wanderly',
    icon: <CalendarPlus className="w-4 h-4" />
  },
  {
    id: 'run',
    label: 'Start a run',
    hint: 'A delivery run, with the fee you state',
    icon: <Truck className="w-4 h-4" />
  },
  {
    id: 'errand',
    label: 'Post an errand',
    hint: 'Something to carry, somewhere it needs to be',
    icon: <Bike className="w-4 h-4" />
  }
];

export interface CreateSheetProps {
  open: boolean;
  onClose: () => void;
  onPick: (id: CreateActionId) => void;
}

export const CreateSheet: React.FC<CreateSheetProps> = ({ open, onClose, onPick }) => {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (typeof window !== 'undefined') window.addEventListener('keydown', onKey);
    return () => { if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey); };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Create">
      <button
        type="button"
        aria-label="Close the create sheet"
        onClick={onClose}
        className="absolute inset-0 bg-black/45"
      />
      <div
        className="absolute bottom-0 left-0 right-0 max-w-xl mx-auto rounded-t-3xl p-4 pb-6 space-y-1"
        style={{ background: 'var(--color-bg)', boxShadow: 'var(--lift-3)' }}
      >
        <div className="flex items-center justify-between pb-2">
          <p className="text-[13px] font-black uppercase tracking-wider" style={{ color: 'var(--color-text)' }}>
            Create
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the create sheet"
            className="p-2 rounded-full cursor-pointer"
            style={{ background: 'var(--color-paper)', color: 'var(--color-text)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {CREATE_ACTIONS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => { soundEngine.play('tap'); onPick(a.id); }}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left cursor-pointer"
            style={{ background: 'var(--color-paper)', boxShadow: 'var(--room-light), inset 0 0 0 1px var(--brief-line)' }}
          >
            <span
              className="w-9 h-9 rounded-xl grid place-items-center shrink-0"
              style={{ background: 'var(--color-primary-subtle)', color: 'var(--color-primary)' }}
            >
              {a.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-bold" style={{ color: 'var(--color-text)' }}>
                {a.label}
              </span>
              <span className="block text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                {a.hint}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default CreateSheet;
