import React, { useRef } from 'react';
import { Package, CalendarPlus, Truck, Bike, Briefcase, Store, Megaphone, Layers, X } from 'lucide-react';
import { soundEngine } from '../utils/SoundEngine';
import { useDialogFocus } from '../ui/useDialogFocus';

// ---------------------------------------------------------------------------
// THE CREATE SHEET — the one action in the bottom bar.
//
// [+] is a verb, not a place: it opens this sheet, and each row of the sheet
// does one real thing. It replaces the floating "Host an event / Post a
// listing" buttons that sat on top of every screen — the clutter this reorg
// deletes — and it lives in exactly one place, so a surface that wants a
// create action gets it from the bar, not from its own corner.
//
// Each row lands on an existing flow that writes a real row:
//   Raise a request → the demand form, which is where the whole loop starts
//   Create a space → the business workspace flow
//   Post an offer  → Selling, where listings already live
//   Host an event  → the createCampaign → publish loop
//   Start a run / Post an errand → the existing errand composer
//   Start a group buy → the group-buy portal, which had no door of its own
//
// Demand is FIRST because it is the product's front: everything else (matches,
// quotes, work orders, procurement) is downstream of someone stating what they
// need. It used to be reachable only from inside the requests screen.
// ---------------------------------------------------------------------------

export type CreateActionId = 'request' | 'space' | 'offer' | 'work' | 'event' | 'run' | 'errand' | 'groupbuy';

export interface CreateAction {
  id: CreateActionId;
  label: string;
  /** One clause, not a paragraph: what the row IS, said in the app's words. */
  hint: string;
  icon: React.ReactNode;
}

/** The sheet, as data — every verb resolves to its existing creation flow. */
export const CREATE_ACTIONS: CreateAction[] = [
  {
    id: 'request', label: 'Raise a request', hint: 'Say what you need — matching starts from this row',
    icon: <Megaphone className="w-4 h-4" />
  },
  {
    id: 'space', label: 'Create a space', hint: 'Bring your offers, conversations and people together',
    icon: <Store className="w-4 h-4" />
  },
  {
    id: 'offer', label: 'Post an offer', hint: 'Add a product or service to your selling shelf',
    icon: <Package className="w-4 h-4" />
  },
  {
    id: 'work', label: 'Create work', hint: 'Buy a verified outcome from your distributed team',
    icon: <Briefcase className="w-4 h-4" />
  },
  {
    id: 'event', label: 'Host a party or trip', hint: 'A plan on Wanderly',
    icon: <CalendarPlus className="w-4 h-4" />
  },
  {
    id: 'run', label: 'Start a run', hint: 'A delivery run, with the fee you state',
    icon: <Truck className="w-4 h-4" />
  },
  {
    id: 'errand', label: 'Post an errand', hint: 'Something to carry, somewhere it needs to be',
    icon: <Bike className="w-4 h-4" />
  },
  {
    id: 'groupbuy', label: 'Start a group buy', hint: 'One lot, many pockets, staged until it closes',
    icon: <Layers className="w-4 h-4" />
  }
];

export interface CreateSheetProps {
  open: boolean;
  onClose: () => void;
  onPick: (id: CreateActionId) => void;
}

export const CreateSheet: React.FC<CreateSheetProps> = ({ open, onClose, onPick }) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(open, panelRef, onClose);

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
        ref={panelRef}
        tabIndex={-1}
        className="absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-y-auto max-w-xl mx-auto rounded-t-3xl p-4 pb-6 space-y-1"
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

        <p className="text-[11px] leading-snug px-1 pb-1" style={{ color: 'var(--color-text-muted)' }}>
          Each row opens the form that writes the row. Nothing here is a placeholder.
        </p>
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
