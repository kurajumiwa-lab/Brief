import React, { useState } from 'react';
import { X, Repeat } from 'lucide-react';
import * as briefApi from '../../api/briefApi';
import type { EventRecurrence, Festival } from '../../api/types';
import { FestivalBuilder, assembleFestival } from '../events/FestivalBuilder';
import { soundEngine } from '../../utils/SoundEngine';

// ---------------------------------------------------------------------------
// HOST AN EVENT — the real createCampaign → publish loop, as a sheet.
//
// Event creation is completely photo-free: no image upload required, no
// placeholders. An event has title, description, location, timing, pricing,
// category, and optional recurrence (daily, weekly, bi-weekly, monthly, custom).
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

const CATEGORIES: Array<{ id: string; label: string }> = [
  { id: 'popup', label: 'Popups & markets' },
  { id: 'session', label: 'Sessions & workshops' },
  { id: 'drop', label: 'Drops & releases' },
  { id: 'event', label: 'Social & gathering' },
  { id: 'contribution', label: 'Causes & pots' }
];

export function HostEventSheet({ open, onClose, onPublished }: HostEventSheetProps) {
  const [draft, setDraft] = useState({
    title: '',
    description: '',
    location: '',
    startsAt: '',
    endsAt: '',
    price: '',
    capacity: '',
    unlisted: false,
    category: 'event',
    isRecurring: false,
    frequency: 'weekly' as 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'custom',
    customRule: '',
    isIndefinite: true,
    untilDate: ''
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Festival details (lineup, zones, tiers, schedule, ...) — all owner-stated.
  const [festival, setFestival] = useState<Festival | null>(null);

  if (!open) return null;

  const close = () => {
    setDraft({
      title: '',
      description: '',
      location: '',
      startsAt: '',
      endsAt: '',
      price: '',
      capacity: '',
      unlisted: false,
      category: 'event',
      isRecurring: false,
      frequency: 'weekly',
      customRule: '',
      isIndefinite: true,
      untilDate: ''
    });
    setError(null);
    setBusy(false);
    setFestival(null);
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim()) { setError('Give your event a title.'); return; }
    setBusy(true);
    setError(null);

    let recurrence: EventRecurrence | null = null;
    if (draft.isRecurring) {
      const ruleText = draft.frequency === 'custom'
        ? (draft.customRule.trim() || 'Custom recurrence')
        : draft.frequency === 'daily' ? 'Repeats daily'
        : draft.frequency === 'weekly' ? 'Repeats weekly'
        : draft.frequency === 'biweekly' ? 'Repeats every 2 weeks'
        : 'Repeats monthly';

      recurrence = {
        frequency: draft.frequency,
        until: !draft.isIndefinite && draft.untilDate ? draft.untilDate : null,
        ruleText
      };
    }

    const created = await briefApi.createCampaign({
      title: draft.title.trim(),
      type: (draft.category || 'event') as any,
      description: draft.description.trim() || undefined,
      location: draft.location.trim() || null,
      startsAt: draft.startsAt || null,
      endsAt: draft.endsAt || null,
      price: draft.price.trim() === '' ? 0 : Number(draft.price),
      capacity: draft.capacity.trim() === '' ? null : Number(draft.capacity),
      unlisted: draft.unlisted,
      metadata: recurrence ? { recurrence } : undefined,
      recurrence: recurrence ?? undefined,
      festival: assembleFestival(festival)
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
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4 overflow-y-auto" style={{ background: 'rgba(13,27,42,0.65)' }} role="dialog" aria-modal="true" aria-label="Host an event">
      <div className="w-full max-w-lg bg-[color:var(--color-paper)] rounded-3xl overflow-hidden p-6 space-y-4 brief-lift-3 my-auto max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[11px] font-black uppercase tracking-wider" style={{ color: 'var(--color-primary)' }}>
              Host an event or trip
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
          No photo required. It publishes immediately to the board. Stated dates, locations and prices only — no seeded numbers.
        </p>

        {error && <p role="alert" className="text-xs font-bold" style={{ color: 'var(--color-danger)' }}>{error}</p>}

        <form onSubmit={submit} className="space-y-3">
          <label className="block text-[12px] font-bold" style={{ color: 'var(--brief-ink)' }}>
            Event title
            <input
              type="text"
              placeholder="e.g. Kilimani Street Market, Saturday Chama Meetup"
              aria-label="Event title"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              className="mt-1 w-full px-3.5 py-2.5 rounded-xl text-xs border"
              style={{ background: 'var(--color-well)', boxShadow: 'var(--room-light-dim), inset 0 0 0 1px var(--brief-line)' }}
              required
            />
          </label>

          <label className="block text-[12px] font-bold" style={{ color: 'var(--brief-ink)' }}>
            Category
            <select
              aria-label="Event category"
              value={draft.category}
              onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
              className="mt-1 w-full px-3.5 py-2.5 rounded-xl text-xs border"
              style={{ background: 'var(--color-well)', boxShadow: 'var(--room-light-dim), inset 0 0 0 1px var(--brief-line)' }}
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>

          <label className="block text-[12px] font-bold" style={{ color: 'var(--brief-ink)' }}>
            Location
            <input
              type="text"
              placeholder="e.g. Ruiru, Gikomba, Kilimani, Nairobi"
              aria-label="Event location"
              value={draft.location}
              onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))}
              className="mt-1 w-full px-3.5 py-2.5 rounded-xl text-xs border"
              style={{ background: 'var(--color-well)', boxShadow: 'var(--room-light-dim), inset 0 0 0 1px var(--brief-line)' }}
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[12px] font-bold" style={{ color: 'var(--brief-ink)' }}>
              Starts
              <input
                type="datetime-local"
                aria-label="Event start"
                value={draft.startsAt}
                onChange={(e) => setDraft((d) => ({ ...d, startsAt: e.target.value }))}
                className="mt-1 w-full px-3.5 py-2.5 rounded-xl text-xs border"
                style={{ background: 'var(--color-well)', boxShadow: 'var(--room-light-dim), inset 0 0 0 1px var(--brief-line)' }}
              />
            </label>
            <label className="block text-[12px] font-bold" style={{ color: 'var(--brief-ink)' }}>
              Ends (optional)
              <input
                type="datetime-local"
                aria-label="Event end"
                value={draft.endsAt}
                onChange={(e) => setDraft((d) => ({ ...d, endsAt: e.target.value }))}
                className="mt-1 w-full px-3.5 py-2.5 rounded-xl text-xs border"
                style={{ background: 'var(--color-well)', boxShadow: 'var(--room-light-dim), inset 0 0 0 1px var(--brief-line)' }}
              />
            </label>
          </div>

          {/* Recurring event toggle */}
          <div className="p-3.5 rounded-2xl space-y-2.5 border" style={{ background: 'var(--color-well)', borderColor: 'var(--brief-line)' }}>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={draft.isRecurring}
                onChange={(e) => setDraft((d) => ({ ...d, isRecurring: e.target.checked }))}
                className="w-4 h-4 rounded text-[var(--color-primary)]"
              />
              <span className="text-[13px] font-extrabold inline-flex items-center gap-1.5" style={{ color: 'var(--brief-ink)' }}>
                <Repeat className="w-3.5 h-3.5" style={{ color: 'var(--color-primary)' }} />
                Repeat this event
              </span>
            </label>

            {draft.isRecurring && (
              <div className="pt-2 space-y-2.5 animate-fadeIn">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {[
                    ['daily', 'Daily'],
                    ['weekly', 'Weekly'],
                    ['biweekly', 'Bi-weekly'],
                    ['monthly', 'Monthly']
                  ].map(([freq, label]) => (
                    <button
                      key={freq}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, frequency: freq as any }))}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-all ${
                        draft.frequency === freq
                          ? 'bg-[color:var(--color-primary)] text-white'
                          : 'bg-[color:var(--color-paper)] text-[color:var(--brief-ink)]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="pt-1 space-y-2">
                  <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                    <input
                      type="radio"
                      name="recurrence-until"
                      checked={draft.isIndefinite}
                      onChange={() => setDraft((d) => ({ ...d, isIndefinite: true }))}
                    />
                    <span>Repeat indefinitely</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                    <input
                      type="radio"
                      name="recurrence-until"
                      checked={!draft.isIndefinite}
                      onChange={() => setDraft((d) => ({ ...d, isIndefinite: false }))}
                    />
                    <span>Until:</span>
                    {!draft.isIndefinite && (
                      <input
                        type="date"
                        aria-label="Repeat until date"
                        value={draft.untilDate}
                        onChange={(e) => setDraft((d) => ({ ...d, untilDate: e.target.value }))}
                        className="px-2 py-1 rounded-lg text-xs bg-[color:var(--color-paper)] border"
                      />
                    )}
                  </label>
                </div>
              </div>
            )}
          </div>

          <label className="block text-[12px] font-bold" style={{ color: 'var(--brief-ink)' }}>
            Description
            <textarea
              placeholder="What happens, who it is for, agenda"
              aria-label="Event description"
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              rows={3}
              className="mt-1 w-full px-3.5 py-2.5 rounded-xl text-xs border resize-none"
              style={{ background: 'var(--color-well)', boxShadow: 'var(--room-light-dim), inset 0 0 0 1px var(--brief-line)' }}
            />
          </label>

          <label className="block text-[12px] font-bold" style={{ color: 'var(--brief-ink)' }}>
            Entry price (KES, per person)
            <input
              type="number"
              min={0}
              placeholder="0 = free"
              aria-label="Event price"
              value={draft.price}
              onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
              className="mt-1 w-full px-3.5 py-2.5 rounded-xl text-xs font-mono border"
              style={{ background: 'var(--color-well)', boxShadow: 'var(--room-light-dim), inset 0 0 0 1px var(--brief-line)' }}
            />
          </label>

          <label className="block text-[12px] font-bold" style={{ color: 'var(--brief-ink)' }}>
            Team size (max people)
            <input
              type="number"
              min={1}
              placeholder="e.g. 8 for a small safari team"
              aria-label="Team size"
              value={draft.capacity}
              onChange={(e) => setDraft((d) => ({ ...d, capacity: e.target.value }))}
              className="mt-1 w-full px-3.5 py-2.5 rounded-xl text-xs font-mono border"
              style={{ background: 'var(--color-well)', boxShadow: 'var(--room-light-dim), inset 0 0 0 1px var(--brief-line)' }}
            />
          </label>

          <label
            className="flex items-start gap-2 p-3 rounded-xl cursor-pointer"
            style={{ background: 'var(--color-well)', boxShadow: 'var(--room-light-dim), inset 0 0 0 1px var(--brief-line)' }}
          >
            <input
              type="checkbox"
              checked={draft.unlisted}
              onChange={(e) => setDraft((d) => ({ ...d, unlisted: e.target.checked }))}
              className="mt-0.5"
            />
            <span className="text-[12px]" style={{ color: 'var(--brief-ink)' }}>
              <strong>Keep unlisted — share by link only.</strong>{' '}
              <span style={{ color: 'var(--color-text-muted)' }}>
                Available to anyone with the link, but not posted to the public board.
                Good for invite-only group experiences like a safari team or rally.
              </span>
            </span>
          </label>

          {/* Festival details — optional. Turns the event page into a
              StreetBite-style festival landing (lineup, zones, tiers,
              schedule, music, sponsors, FAQ). Only what you fill in shows. */}
          <details className="rounded-xl border" style={{ borderColor: 'var(--brief-line)' }}>
            <summary className="px-4 py-3 text-[13px] font-black cursor-pointer select-none" style={{ color: 'var(--brief-ink)' }}>
              Festival details (lineup, map, tickets, FAQ)
            </summary>
            <div className="px-4 pb-4 pt-1">
              <p className="text-[11px] mb-3" style={{ color: 'var(--brief-muted)' }}>
                Everything you add is your own wording. A section you leave empty won&apos;t appear on the event page.
              </p>
              <FestivalBuilder value={festival} onChange={setFestival} />
            </div>
          </details>

          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 rounded-2xl text-xs font-black cursor-pointer disabled:opacity-50"
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
