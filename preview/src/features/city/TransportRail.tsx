import React, { useCallback, useEffect, useState } from 'react';
import { Bike, Check, Package, Truck } from 'lucide-react';
import * as briefApi from '../../api/briefApi';
import type { Pickup } from '../../api/briefApi';
import type { Space, SpaceDispatch, SpaceDispatchStatus } from '../../api/types';
import { CopyId } from '../../ui/CopyId';
import { soundEngine } from '../../utils/SoundEngine';

// ---------------------------------------------------------------------------
// TRANSPORT RAIL — the delivery loop the legacy screens drew from a hardcoded
// object (`INITIAL_ACTIVE_DELIVERY`, with a progress bar that moved because a
// timer told it to). This one reads the rows Brief actually keeps:
//
//   * inter-county cargo — a space's dispatches: waybill, carrier sacco, the
//     stage it has reached, advanced by a real PATCH that also writes an
//     activity row;
//   * WAIRO pickups — a rider's own jobs, completed by the rider or the person
//     who assigned them.
//
// Both are shown only when rows exist. A vendor with nothing in transit sees an
// empty rail that says so, because a progress ring at 0% would be a costume.
// There is no ETA, no map breadcrumb and no "driver is 6 minutes away": Brief
// has no GPS feed, so the only movement on this screen is a stage somebody
// marked.
// ---------------------------------------------------------------------------

const stagesFor = (d:SpaceDispatch):SpaceDispatchStatus[] => d.deliveryMode==='door' ? ['staged','in_transit','out_for_delivery','delivered'] : ['staged','in_transit','ready_at_stage','collected'];
const STAGE_LABEL: Record<SpaceDispatchStatus, string> = {
  staged: 'At the origin stage',
  in_transit: 'On the road',
  ready_at_stage: 'Waiting at the far stage',
  collected: 'Collected by the receiver',
  cancelled: 'Cancelled',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered'
};

const ago = (iso: string | null | undefined) => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const h = Math.max(0, Math.round((Date.now() - ms) / 3600000));
  if (h < 1) return 'just now';
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

export function TransportRail({ className = '' }: { className?: string }) {
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [dispatches, setDispatches] = useState<SpaceDispatch[]>([]);
  const [pickups, setPickups] = useState<Pickup[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const mine = await briefApi.listMySpaces();
    if (!mine.ok) {
      setSpaces([]);
      setFailed(mine.status === 401 ? null : mine.error ?? 'Your spaces could not be read.');
      return;
    }
    const list = mine.data?.spaces ?? [];
    setSpaces(list);
    // Read every space's own cargo list — small N, and it keeps the server as
    // the only source: no cached roll-up that could drift from the rows.
    const perSpace = await Promise.all(list.slice(0, 8).map((s) => briefApi.getSpaceDispatches(s.id)));
    setDispatches(perSpace.flatMap((r) => (r.ok ? r.data.dispatches : [])));
    const picked = await briefApi.listMyPickups();
    setPickups(picked.ok ? picked.data : []);
    setFailed(null);
  }, []);

  useEffect(() => {
    void load();
    const onVisible = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', onVisible);
    return () => window.removeEventListener('focus', onVisible);
  }, [load]);

  const advance = async (d: SpaceDispatch) => {
    const STAGES=stagesFor(d);
    const next = STAGES[Math.min(STAGES.length - 1, STAGES.indexOf(d.status) + 1)];
    if (next === d.status) return;
    setBusy(d.id);
    setError(null);
    const res = await briefApi.updateSpaceDispatchStatus(d.spaceId, d.id, { status: next });
    setBusy(null);
    if (!res.ok) { setError(res.error ?? 'That stage was refused.'); return; }
    soundEngine.play('tap');
    await load();
  };

  const complete = async (p: Pickup) => {
    setBusy(p.id);
    setError(null);
    const res = await briefApi.completePickup(p.id);
    setBusy(null);
    if (!res.ok) { setError(res.error ?? 'That pickup was refused.'); return; }
    soundEngine.play('tap');
    await load();
  };

  if (failed) {
    return (
      <p className="text-[13px] font-bold" role="alert" style={{ color: 'var(--color-danger)' }}>
        {failed}{' '}
        <button type="button" onClick={() => void load()} className="underline cursor-pointer">Retry</button>
      </p>
    );
  }

  const openCargo = dispatches.filter((d) => d.status !== 'collected' && d.status !== 'delivered' && d.status !== 'cancelled');
  const livePickups = pickups.filter((p) => p.status !== 'delivered' && p.status !== 'cancelled');

  return (
    <section className={`space-y-3 ${className}`} aria-label="Transport in motion">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[12px] font-black uppercase tracking-wider" style={{ color: 'var(--brief-ink)' }}>
          In motion
        </h3>
        <button type="button" onClick={() => void load()} className="text-[11px] font-mono cursor-pointer" style={{ color: 'var(--color-quiet)' }}>
          re-read
        </button>
      </div>

      {error && <p className="text-[12px] font-bold" role="alert" style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {openCargo.length === 0 && livePickups.length === 0 ? (
        <p className="text-[13px] p-3 rounded-2xl" style={{ background: 'var(--color-well)', color: 'var(--brief-muted)' }}>
          No parcels in motion.
        </p>
      ) : (
        <ul className="space-y-2">
          {openCargo.map((d) => {
            const STAGES=stagesFor(d);
            const idx = STAGES.indexOf(d.status);
            return (
              <li key={d.id} className="p-3 rounded-2xl border" style={{ borderColor: 'transparent', background: 'var(--color-paper)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[14px] font-bold truncate inline-flex items-center gap-1.5" style={{ color: 'var(--brief-ink)' }}>
                      <Truck className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--color-primary)' }} />
                      {d.destinationTown} · {d.destinationCounty}
                    </p>
                    <p className="text-[12px] truncate mt-0.5" style={{ color: 'var(--brief-muted)' }}>
                      {d.carrierSacco} → {d.receiverName}
                      {d.stageFeeKes ? ` · stage fee KES ${d.stageFeeKes.toLocaleString('en-KE')}` : ''}
                      {` · moved ${ago(d.updatedAt) ?? '—'}`}
                    </p>
                  </div>
                  <span
                    className="shrink-0 text-[11px] font-black uppercase tracking-wider px-2 py-1 rounded-full"
                    style={{ background: 'var(--color-primary-subtle)', color: 'var(--color-primary)' }}
                  >
                    {STAGE_LABEL[d.status]}
                  </span>
                </div>

                {/* The stage strip: reached stages have a row behind them. The
                    next one is a button because the next one is a person's act. */}
                <div className="flex items-center gap-1.5 mt-2">
                  {STAGES.map((s, i) => (
                    <span
                      key={s}
                      title={STAGE_LABEL[s]}
                      className="flex-1 h-1.5 rounded-full"
                      style={{ background: i <= idx ? 'var(--color-primary)' : 'var(--brief-line)' }}
                    />
                  ))}
                </div>

                <div className="flex items-center gap-2 mt-2">
                  <CopyId value={d.waybillRef} label="waybill" />
                  <button
                    type="button"
                    disabled={busy === d.id || idx >= STAGES.length - 1}
                    onClick={() => void advance(d)}
                    className="ml-auto text-[12px] font-black px-3 py-1.5 rounded-full cursor-pointer disabled:opacity-50"
                    style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
                  >
                    {idx >= STAGES.length - 1 ? STAGE_LABEL[d.status] : `Mark “${STAGE_LABEL[STAGES[idx + 1]]}”`}
                  </button>
                </div>
                <p className="text-[11px] mt-1.5" style={{ color: 'var(--color-quiet)' }}>
                  No live carrier feed: estimates and locations are seller-reported. A stage changes when someone who
                  handled the parcel says so.
                </p>
              </li>
            );
          })}

          {livePickups.map((p) => (
            <li key={p.id} className="p-3 rounded-2xl border" style={{ borderColor: 'transparent', background: 'var(--color-paper)' }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[14px] font-bold truncate inline-flex items-center gap-1.5" style={{ color: 'var(--brief-ink)' }}>
                    <Bike className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--color-primary)' }} />
                    Pickup for {p.destinationTown}
                  </p>
                  <p className="text-[12px] truncate mt-0.5" style={{ color: 'var(--brief-muted)' }}>
                    receiver {p.receiverName} · {p.status.replace('_', ' ')} · assigned {ago(p.createdAt) ?? '—'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy === p.id}
                  onClick={() => void complete(p)}
                  className="shrink-0 inline-flex items-center gap-1 text-[12px] font-black px-3 py-1.5 rounded-full cursor-pointer disabled:opacity-50"
                  style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
                >
                  <Check className="w-3.5 h-3.5" /> Delivered
                </button>
              </div>
              {p.notes && <p className="text-[12px] mt-1.5" style={{ color: 'var(--brief-muted)' }}>{p.notes}</p>}
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] inline-flex items-center gap-1" style={{ color: 'var(--color-quiet)' }}>
        <Package className="w-3 h-3" /> Cargo comes from your spaces&rsquo; dispatch logs ({(spaces ?? []).length} space
        {(spaces ?? []).length === 1 ? '' : 's'} read); pickups come from what is routed to you.
      </p>
    </section>
  );
}

export default TransportRail;
