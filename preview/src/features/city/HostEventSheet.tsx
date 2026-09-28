import React, { useEffect, useRef, useState } from 'react';
import { X, Repeat } from 'lucide-react';
import * as briefApi from '../../api/briefApi';
import type { Campaign, EventRecurrence, Festival } from '../../api/types';
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
  onPublished?: (title: string, slug?: string) => void;
  /**
   * An existing campaign to EDIT rather than a blank form.
   *
   * Editing is deliberately a different act from publishing: the sheet writes
   * the changes and stops. It does not re-run `publish` — a transition the host
   * did not ask for, and one the state machine would refuse on an event that is
   * already live. The server records the revision and tells the people holding
   * a place if the date, place or name moved (see domain/campaign.js).
   */
  editing?: Campaign | null;
  /** Called after an edit is saved, with the updated row. */
  onSaved?: (campaign: Campaign) => void;
  embedded?: boolean;
}

const CATEGORIES: Array<{ id: string; label: string }> = [
  { id: 'popup', label: 'Popups & markets' },
  { id: 'session', label: 'Sessions & workshops' },
  { id: 'drop', label: 'Drops & releases' },
  { id: 'event', label: 'Social & gathering' },
  { id: 'contribution', label: 'Causes & pots' }
];

export function HostEventSheet({ open, onClose, onPublished, editing = null, onSaved, embedded = false }: HostEventSheetProps) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // `datetime-local` wants a LOCAL wall-clock string. An ISO instant formatted
  // with toISOString() would show the host a time in UTC and let them "confirm"
  // a start that is hours away from the one they set — so the conversion is
  // explicit in both directions.
  const localInput = (iso: string | null | undefined) => {
    if (!iso || !Number.isFinite(Date.parse(iso))) return '';
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const blankDraft = {
    title: '',
    description: '',
    location: '',
    startsAt: '',
    endsAt: '',
    price: '',
    currency: 'KES',
    capacity: '',
    unlisted: false,
    category: 'event',
    isRecurring: false,
    frequency: 'weekly' as 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'custom',
    customRule: '',
    isIndefinite: true,
    untilDate: ''
  };
  const draftFrom = (c: Campaign | null) => c ? {
    ...blankDraft,
    title: c.title ?? '',
    description: c.description ?? '',
    location: c.location ?? '',
    startsAt: localInput(c.startsAt),
    endsAt: localInput(c.endsAt),
    price: c.price ? String(c.price) : '',
    currency: c.currency ?? 'KES',
    capacity: c.capacity === null || c.capacity === undefined ? '' : String(c.capacity),
    unlisted: Boolean(c.unlisted),
    category: c.type ?? 'event'
  } : blankDraft;
  const [draft, setDraft] = useState(() => draftFrom(editing));
  const [savedId, setSavedId] = useState<string | null>(editing?.id ?? null);
  // The row this sheet is editing. A host who opens it from the plans list and
  // then switches rows gets the new row's fields, not the previous one's.
  const [editingId, setEditingId] = useState<string | null>(editing?.id ?? null);
  /** The server refuses a capacity CHANGE after publication, so the field
   *  says so instead of letting the host type a number that will bounce. */
  const editingLocksCapacity = Boolean(editingId) && editing?.status !== 'draft';
  useEffect(() => {
    setDraft(draftFrom(editing));
    setSavedId(editing?.id ?? null);
    setEditingId(editing?.id ?? null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id, open]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Festival details (lineup, zones, tiers, schedule, ...) — all owner-stated.
  const [festival, setFestival] = useState<Festival | null>(null);

  if (!open) return null;

  const close = () => {
    setDraft(blankDraft);
    setError(null);
    setSavedId(null);
    setEditingId(null);
    setBusy(false);
    setFestival(null);
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (draft.endsAt && draft.startsAt && Date.parse(draft.endsAt) <= Date.parse(draft.startsAt)) { setError('End time must be after the start.'); return; }
    if (draft.price && (!Number.isFinite(Number(draft.price)) || Number(draft.price) < 0)) { setError('Enter a valid price.'); return; }
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

    // `datetime-local` carries minutes, not seconds. Re-deriving an instant the
    // host never touched would rewrite the start time to the minute, write a
    // revision for a change nobody made, and tell the holders the date moved by
    // forty seconds. So an untouched time goes back exactly as it came in.
    const isoFor = (input: string, original: string | null | undefined) =>
      input === localInput(original) ? (original ?? null) : (input ? new Date(input).toISOString() : null);

    const shared = {
      title: draft.title.trim(),
      type: (draft.category || 'event') as any,
      description: draft.description.trim() || undefined,
      location: draft.location.trim() || null,
      startsAt: isoFor(draft.startsAt, editing?.startsAt),
      endsAt: isoFor(draft.endsAt, editing?.endsAt),
      price: draft.price.trim() === '' ? 0 : Number(draft.price),
      currency: draft.currency,
      capacity: draft.capacity.trim() === '' ? null : Number(draft.capacity),
      unlisted: draft.unlisted
    };
    // An edit sends ONLY what this form can faithfully round-trip. Recurrence
    // (stored in metadata) and the festival lineup are built by their own
    // builders, which an edit form that never loaded them cannot reproduce —
    // sending them back empty would silently delete a lineup. The form says so,
    // and leaves them alone.
    const body = editingId
      ? shared
      : { ...shared, metadata: recurrence ? { recurrence } : undefined, recurrence, festival: assembleFestival(festival) };
    const created = savedId ? await briefApi.updateCampaign(savedId, body) : await briefApi.createCampaign(body);
    if (!created.ok) {
      setBusy(false);
      setError(created.error ?? 'Could not create the event.');
      return;
    }
    // AN EDIT SAVES AND STOPS. It does not publish: that is a different act,
    // and the state machine would refuse it on an event that is already live.
    if (editingId) {
      setBusy(false);
      setDraft(draftFrom(created.data));
      onSaved?.(created.data);
      return;
    }
    setSavedId(created.data.id);
    const published = await briefApi.campaignAction(created.data.id, 'publish');
    if (!mounted.current) return;
    setBusy(false);
    if (!published.ok) {
      setError(`Event saved as a draft, but publishing failed: ${published.error ?? 'unknown'}`);
      return;
    }
    close();
    onPublished?.(published.data.title, published.data.publicSlug);
  };

  return (
    <div className={embedded ? "" : "fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4 overflow-y-auto"} style={embedded ? undefined : { background: "rgba(13,27,42,0.65)" }} role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : true} aria-label="Host an event">
      <div className={embedded ? "wl-booking bg-white rounded-xl p-5 space-y-4" : "w-full max-w-lg bg-[color:var(--color-paper)] rounded-3xl overflow-hidden p-6 space-y-4 brief-lift-3 my-auto max-h-[90vh] overflow-y-auto"}>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[11px] font-black uppercase tracking-wider" style={{ color: 'var(--color-primary)' }}>
              {editingId ? 'Edit this plan' : 'Host an event or trip'}
            </span>
            <h3 className="text-base font-black mt-1" style={{ color: 'var(--brief-ink)' }}>
              {editingId ? 'Change the details. The record keeps the old ones.' : 'A party, a trip, your people.'}
            </h3>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            aria-label="Close the event form"
            className="p-2 rounded-full cursor-pointer"
            style={{ background: 'var(--color-well)', color: 'var(--brief-muted)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs" style={{ color: 'var(--brief-muted)' }}>
          {editingId
            ? 'Times use your device’s timezone. Changing the date, place or title tells everyone who already holds a place — that is not a detail they should have to notice.'
            : 'Set the place, dates and price. Multi-day plans appear under trips. Times use your device’s timezone.'}
        </p>

        {error && <p role="alert" className="text-xs font-bold" style={{ color: 'var(--color-danger)' }}>{error}</p>}

        <form onSubmit={submit} className="space-y-3">
          <label className="block text-[12px] font-bold" style={{ color: 'var(--brief-ink)' }}>
            Event title
            <input
              type="text"
              placeholder="e.g. Nairobi rooftop night, Naivasha weekend"
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

          {editingId ? (
            <p className="text-[11px] p-3.5 rounded-2xl border" style={{ background: 'var(--color-well)', borderColor: 'var(--brief-line)', color: 'var(--brief-muted)' }}>
              Recurrence and festival details are set when a plan is created. Editing the plan below leaves them exactly as they are.
            </p>
          ) : (
          <>
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
          </>
          )}

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
            Entry price (per person)
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

          <label className="block text-[12px] font-bold">Currency
            <select aria-label="Currency" value={draft.currency} onChange={e => setDraft(d => ({ ...d, currency: e.target.value }))} className="mt-1 w-full px-3.5 py-2.5 rounded-xl border">
              {['KES', 'UGX', 'TZS', 'RWF', 'USD'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>

          <label className="block text-[12px] font-bold" style={{ color: 'var(--brief-ink)' }}>
            Capacity (optional)
            <input
              type="number"
              min={1}
              placeholder="e.g. 8 for a small safari team"
              aria-label="Team size"
              value={draft.capacity}
              // Locked once people have decided: a room that shrinks after it
              // is sold is not an edit, it is a broken promise. Shown rather
              // than hidden, so the host can see what they set.
              disabled={Boolean(editingId) && editingLocksCapacity}
              title={Boolean(editingId) && editingLocksCapacity ? 'Capacity cannot be changed after publication' : undefined}
              onChange={(e) => setDraft((d) => ({ ...d, capacity: e.target.value }))}
              className="mt-1 w-full px-3.5 py-2.5 rounded-xl text-xs font-mono border disabled:opacity-60"
              style={{ background: 'var(--color-well)', boxShadow: 'var(--room-light-dim), inset 0 0 0 1px var(--brief-line)' }}
            />
            {Boolean(editingId) && editingLocksCapacity && (
              <span className="block mt-1 text-[11px] font-normal" style={{ color: 'var(--brief-muted)' }}>
                Capacity cannot change after publication — people have already decided based on it.
              </span>
            )}
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
                Anyone with the link can view it. Hidden from browsing.
              </span>
            </span>
          </label>

          {/* Festival details — optional. Turns the event page into a
              StreetBite-style festival landing (lineup, zones, tiers,
              schedule, music, sponsors, FAQ). Only what you fill in shows. */}
          {!editingId && (
          <details className="rounded-xl border" style={{ borderColor: 'var(--brief-line)' }}>
            <summary className="px-4 py-3 text-[13px] font-black cursor-pointer select-none" style={{ color: 'var(--brief-ink)' }}>
              Add a line-up, itinerary or FAQ
            </summary>
            <div className="px-4 pb-4 pt-1">
              <p className="text-[11px] mb-3" style={{ color: 'var(--brief-muted)' }}>
                Only filled sections appear on your plan.
              </p>
              <FestivalBuilder value={festival} onChange={setFestival} />
            </div>
          </details>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 rounded-2xl text-xs font-black cursor-pointer disabled:opacity-50"
            style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
          >
            {busy ? (editingId ? 'Saving…' : 'Publishing…') : editingId ? 'Save changes' : savedId ? 'Retry publishing' : 'Publish plan'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default HostEventSheet;
