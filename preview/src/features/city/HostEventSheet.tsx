import React, { useState } from 'react';
import { X } from 'lucide-react';
import * as briefApi from '../../api/briefApi';
import { soundEngine } from '../../utils/SoundEngine';

// ---------------------------------------------------------------------------
// HOST AN EVENT — the real createCampaign → publish loop, as a sheet.
//
// This used to be an inline modal inside the Discover screen, opened by the
// floating "Host an event" pill that sat on that one screen. The pill is gone
// (the bar's [+] is the create door), so the form follows the action that
// opens it: the Create sheet in the shell renders this component, and the
// event is published the moment it is written.
//
// An end date on a later day than the start makes the row a trip: it renders
// on the journeys rail with its real span in days. Same row, same honesty.
// ---------------------------------------------------------------------------

export interface HostEventSheetProps {
  open: boolean;
  onClose: () => void;
  /** Called after the row exists AND is published, with its title. */
  onPublished?: (title: string) => void;
}

export function HostEventSheet({ open, onClose, onPublished }: HostEventSheetProps) {
  const [draft, setDraft] = useState({ title: '', description: '', location: '', startsAt: '', endsAt: '', price: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const close = () => {
    setDraft({ title: '', description: '', location: '', startsAt: '', endsAt: '', price: '' });
    setError(null);
    setBusy(false);
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim()) { setError('Give your event a title.'); return; }
    setBusy(true);
    setError(null);
    const created = await briefApi.createCampaign({
      title: draft.title.trim(),
      type: 'event',
      description: draft.description.trim() || undefined,
      location: draft.location.trim() || null,
      startsAt: draft.startsAt || null,
      endsAt: draft.endsAt || null,
      price: draft.price.trim() === '' ? 0 : Number(draft.price)
    });
    if (!created.ok) {
      setBusy(false);
      setError(created.error ?? 'Could not create the event.');
      return;
    }
    const published = await briefApi.campaignAction(created.data.id, 'publish');
    setBusy(false);
    if (!published.ok) {
      setError(`Event saved as a draft, but publishing failed: ${published.error ?? 'unknown'}`);
      return;
    }
    onPublished?.(created.data.title);
    close();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(24,19,12,0.6)' }} role="dialog" aria-modal="true" aria-label="Host an event">
      <div className="w-full max-w-md bg-[color:var(--color-paper)] rounded-3xl overflow-hidden p-6 space-y-4 brief-lift-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[11px] font-black uppercase tracking-wider" style={{ color: 'var(--color-primary)' }}>
              Host an event
            </span>
            <h3 className="text-base font-black mt-1" style={{ color: 'var(--brief-ink)' }}>Put your event on the board</h3>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close the event form"
            className="p-2 rounded-full cursor-pointer"
            style={{ background: 'var(--color-well)', color: 'var(--brief-muted)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs" style={{ color: 'var(--brief-muted)' }}>
          It publishes immediately, so it appears on Discover and in the case for everyone. Nobody gets a
          seeded audience: registrations count people who actually registered.
        </p>

        {error && <p role="alert" className="text-xs font-bold" style={{ color: 'var(--color-danger)' }}>{error}</p>}

        <form onSubmit={submit} className="space-y-3">
          <input
            type="text"
            placeholder="Event title (e.g. Kilimani Street Market)"
            aria-label="Event title"
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            className="w-full px-3.5 py-2.5 rounded-xl text-xs border"
            style={{ background: 'var(--color-well)', boxShadow: 'var(--room-light-dim), inset 0 0 0 1px var(--brief-line)' }}
            required
          />
          <input
            type="text"
            placeholder="Location (e.g. Kilimani, Nairobi)"
            aria-label="Event location"
            value={draft.location}
            onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))}
            className="w-full px-3.5 py-2.5 rounded-xl text-xs border"
            style={{ background: 'var(--color-well)', boxShadow: 'var(--room-light-dim), inset 0 0 0 1px var(--brief-line)' }}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="datetime-local"
              aria-label="Event start"
              value={draft.startsAt}
              onChange={(e) => setDraft((d) => ({ ...d, startsAt: e.target.value }))}
              className="w-full px-3.5 py-2.5 rounded-xl text-xs border"
              style={{ background: 'var(--color-well)', boxShadow: 'var(--room-light-dim), inset 0 0 0 1px var(--brief-line)' }}
            />
            <input
              type="datetime-local"
              aria-label="Event end"
              value={draft.endsAt}
              onChange={(e) => setDraft((d) => ({ ...d, endsAt: e.target.value }))}
              className="w-full px-3.5 py-2.5 rounded-xl text-xs border"
              style={{ background: 'var(--color-well)', boxShadow: 'var(--room-light-dim), inset 0 0 0 1px var(--brief-line)' }}
            />
          </div>
          <p className="-mt-1 text-[11px]" style={{ color: 'var(--brief-muted)' }}>
            Ends (optional) — an end date on a later day shows the row as a trip, with its real span in days.
          </p>
          <textarea
            placeholder="Description (what happens, who it is for)"
            aria-label="Event description"
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            rows={3}
            className="w-full px-3.5 py-2.5 rounded-xl text-xs border resize-none"
            style={{ background: 'var(--color-well)', boxShadow: 'var(--room-light-dim), inset 0 0 0 1px var(--brief-line)' }}
          />
          <input
            type="number"
            min={0}
            placeholder="Entry price (KES, 0 = free)"
            aria-label="Event price"
            value={draft.price}
            onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
            className="w-full px-3.5 py-2.5 rounded-xl text-xs font-mono border"
            style={{ background: 'var(--color-well)', boxShadow: 'var(--room-light-dim), inset 0 0 0 1px var(--brief-line)' }}
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 rounded-2xl text-xs font-black cursor-pointer disabled:opacity-50"
            style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
          >
            {busy ? 'Publishing…' : 'Publish event'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default HostEventSheet;
