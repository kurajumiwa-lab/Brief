import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SyncPipeline } from './SyncPipeline';
import { TierGuardrail } from './TierGuardrail';
import { SyncEngine, type EngineRun, type EngineDelta } from '../engine/syncEngine';
import {
  getEngineStatus,
  getEngineRoutes,
  createEngineRoute,
  deleteEngineRoute,
  getEngineDeliveries,
  getEngineTicketBar,
  type EngineStatus,
  type EngineRoute,
  type GroupBuy
} from '../api/briefApi';
import { listGroupBuys } from '../api/briefApi';
import type { EngineTicketBar as EngineTicketBarT } from '../api/briefApi';
import { StageStepper } from './StageStepper';

// ---------------------------------------------------------------------------
// ENGINE PANEL — the engine room.
//
// Composes the three premium surfaces over one architectural layer:
//
//   * the LIVE PIPELINE (real telemetry from the background sync machine)
//   * the INLINE TIER CONTROLLER (server-authoritative caps, blurred upgrades)
//   * the UNIVERSAL ROUTER (your rules: signal -> signed dispatch)
//
// The SyncEngine instance beats in the background while this panel is mounted:
// heartbeat + focus prediction, silent delta merges. Deltas that touch the
// object stream silently refresh the caller's feed via onObjectsChanged —
// the "never loading" feel, wired to real data.
// ---------------------------------------------------------------------------

const SIGNAL_CHOICES = [
  { id: '*', label: 'Any signal' },
  { id: 'object_created', label: 'Object created' },
  { id: 'object_updated', label: 'Object updated' },
  { id: 'campaign_published', label: 'Campaign published' },
  { id: 'order_paid', label: 'Order paid' },
  { id: 'task_assigned', label: 'Task assigned' }
];

function timeAgo(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

export interface EnginePanelProps {
  /** Called when the object stream changed — refresh the feed silently. */
  onObjectsChanged?: () => void;
}

export function EnginePanel({ onObjectsChanged }: EnginePanelProps) {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [run, setRun] = useState<EngineRun | null>(null);
  const [pending, setPending] = useState(false);
  const [routes, setRoutes] = useState<EngineRoute[]>([]);
  const [groupBuys, setGroupBuys] = useState<GroupBuy[]>([]);
  const [ticket, setTicket] = useState<EngineTicketBarT | null>(null);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', signalType: '*', url: '' });
  const [creating, setCreating] = useState(false);
  const [tick, setTick] = useState(0);

  const engineRef = useRef<SyncEngine | null>(null);
  const objectsChangedRef = useRef(onObjectsChanged);
  objectsChangedRef.current = onObjectsChanged;

  // --- status + router state ---
  const refreshStatus = useCallback(async () => {
    const res = await getEngineStatus();
    if (res.ok) setStatus(res.data);
  }, []);
  const refreshRouter = useCallback(async () => {
    const [r, d] = await Promise.all([getEngineRoutes(), getEngineDeliveries()]);
    if (r.ok) setRoutes(r.data);
    if (d.ok) setDeliveries(d.data);
  }, []);

  // The tenancy cockpit: financial pipelines + the active
  // ticket — one orchestration layer, every workflow it tracks.
  const refreshTenancy = useCallback(async () => {
    const [g, t] = await Promise.all([listGroupBuys(), getEngineTicketBar()]);
    if (g.ok) setGroupBuys(g.data);
    if (t.ok) setTicket(t.data);
  }, []);

  // --- the background sync machine ---
  useEffect(() => {
    const engine = new SyncEngine({
      intervalMs: 30_000,
      onRun: (r) => {
        setRun(r);
        setPending(false);
      },
      onDelta: (deltas: Record<string, EngineDelta>) => {
        if (deltas.objects && (deltas.objects.added.length || deltas.objects.updated.length || deltas.objects.removed.length)) {
          objectsChangedRef.current?.();
        }
      }
    });
    engineRef.current = engine;
    engine.start();
    setPending(true);
    void refreshStatus();
    void refreshRouter();
    void refreshTenancy();
    return () => {
      engine.stop();
      engineRef.current = null;
    };
  }, [refreshStatus, refreshRouter, refreshTenancy]);

  // A 1s ticker so "synced Xs ago" is live.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const manualSync = async () => {
    if (!engineRef.current || pending) return;
    setPending(true);
    const r = await engineRef.current.syncNow();
    if (!r) setPending(false);
  };

  const addRoute = async () => {
    if (!form.name.trim() || !form.url.trim() || creating) return;
    setCreating(true);
    setRouteError(null);
    const res = await createEngineRoute({
      name: form.name.trim(),
      match: { signalType: form.signalType },
      channels: [{ kind: 'webhook', to: form.url.trim() }]
    });
    setCreating(false);
    if (!res.ok) {
      setRouteError(res.error);
      return;
    }
    setForm({ name: '', signalType: '*', url: '' });
    await refreshRouter();
    await refreshStatus();
  };

  const removeRoute = async (id: string) => {
    await deleteEngineRoute(id);
    await refreshRouter();
    await refreshStatus();
  };

  const guardrail = status?.guardrail ?? null;
  const signingOk = status?.router?.signingConfigured ?? false;

  return (
    <div className="space-y-4" data-tick={tick}>
      {/* --- header: the engine's live state --- */}
      <div className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: run ? '#40916C' : 'var(--brief-line)' }} />
              <h2 className="text-sm font-extrabold text-[var(--brief-ink)]">Brief Engine</h2>
              {guardrail && (
                <span className="rounded-md bg-[#40916C] px-1.5 py-0.5 text-[11px] font-extrabold text-[var(--accent-ink)]">
                  {guardrail.label}
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-[var(--ink-60)]">
              {run
                ? run.inSync
                  ? `In sync — verified ${timeAgo(run.at)}`
                  : `Merged ${run.deltaRows} row${run.deltaRows === 1 ? '' : 's'} silently ${timeAgo(run.at)}`
                : 'First beat in flight…'}
              {status?.version ? ` · manifest ${status.version.slice(0, 8)}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void manualSync()}
            disabled={pending}
            className="shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-extrabold cursor-pointer disabled:opacity-40"
            style={{ border: '1px solid #40916C', color: 'var(--brief-ink)', background: 'var(--color-paper)' }}
          >
            {pending ? 'Beating…' : 'Sync now'}
          </button>
        </div>
      </div>

      {/* --- the linear pipeline orchestrator --- */}
      <SyncPipeline run={run} pending={pending} />

      {/* --- the inline tier controller --- */}
      <TierGuardrail guardrail={guardrail} />

      {/* --- the tenancy cockpit: one engine, every workflow --- */}
      <div className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[12px] font-extrabold uppercase tracking-[0.16em] text-[var(--brief-ink)]">
            Tenancy cockpit
          </h3>
          <span className="text-[11px] text-[var(--ink-60)]">financial pipelines · live gaming · entry</span>
        </div>

        {/* financial summaries: group buys with live steppers */}
        <div className="space-y-2">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--ink-60)]">Group buys</p>
          {groupBuys.length === 0 && (
            <p className="text-[11px] text-[var(--ink-60)]">No active circle cycles or group orders.</p>
          )}
          {groupBuys.slice(0, 2).map((b) => (
            <div key={b.id} className="rounded-xl border border-[var(--brief-line)] bg-[var(--color-well)] p-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 truncate text-[12px] font-extrabold text-[var(--brief-ink)]">{b.title}</p>
                <span className="shrink-0 font-mono text-[11px] text-[var(--brief-ink)]">
                  KSh {b.total.toLocaleString()} / {b.targetAmount.toLocaleString()}
                </span>
              </div>
              <div className="mt-1.5">
                <StageStepper stages={b.stages} currentIndex={b.stageIndex} compact />
              </div>
            </div>
          ))}
        </div>

        {/* the active entry */}
        <div className="space-y-1">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--ink-60)]">Event entry</p>
          {ticket?.active && ticket.ticket ? (
            <p className="text-[11px] text-[var(--brief-ink)]">
              <span className="font-extrabold">{ticket.ticket.eventTitle}</span>
              <span className="text-[var(--ink-60)]"> · {ticket.ticket.entryState} · #{ticket.ticket.ticketCode.replace(/^BRF-/, '').slice(0, 4)}</span>
              {(ticket.deltas?.length ?? 0) > 0 && <span className="text-[var(--brief-ink)]"> · details changed</span>}
            </p>
          ) : (
            <p className="text-[11px] text-[var(--ink-60)]">No active entry.</p>
          )}
        </div>
      </div>

      {/* --- the universal data router --- */}
      <div className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[12px] font-extrabold uppercase tracking-[0.16em] text-[var(--brief-ink)]">
            Universal Router
          </h3>
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-extrabold"
            style={{
              border: '1px solid var(--brief-line)',
              color: signingOk ? 'var(--brief-ink)' : 'rgba(17,17,17,0.6)',
              background: 'var(--color-well)'
            }}
            title={signingOk ? 'Payloads are HMAC-signed' : 'Webhook dispatch refuses unsigned until a secret is set'}
          >
            {signingOk ? 'HMAC-signed' : 'signing off'}
          </span>
        </div>

        {routes.length === 0 && (
          <p className="text-[11px] text-[var(--ink-60)] leading-snug">
            No routing rules yet. A rule watches the live signal stream and dispatches a signed,
            lightweight payload to your endpoint the moment it matches.
          </p>
        )}

        {routes.map((r) => (
          <div key={r.id} className="rounded-xl border border-[var(--brief-line)] bg-[var(--color-well)] p-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[12px] font-extrabold text-[var(--brief-ink)] truncate">{r.name}</p>
              <p className="text-[11px] font-mono text-[var(--ink-60)] truncate">
                on {r.match.signalType === '*' ? 'any signal' : r.match.signalType} → {r.channels[0]?.kind} {r.channels[0]?.to}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void removeRoute(r.id)}
              className="shrink-0 text-[11px] font-extrabold text-[var(--ink-60)] cursor-pointer hover:text-[var(--brief-ink)]"
            >
              Remove
            </button>
          </div>
        ))}

        {/* compact create form */}
        <div className="rounded-xl border border-[var(--brief-line)] bg-[var(--color-well)] p-2.5 space-y-2">
          <div className="flex gap-2">
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Route name"
              className="flex-1 rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-2.5 py-1.5 text-[12px] text-[var(--brief-ink)] placeholder:text-[var(--ink-60)] focus:outline-none"
            />
            <select
              value={form.signalType}
              onChange={(e) => setForm((f) => ({ ...f, signalType: e.target.value }))}
              className="rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-2 py-1.5 text-[12px] text-[var(--brief-ink)] focus:outline-none"
            >
              {SIGNAL_CHOICES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <input
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://your-endpoint/hook"
              className="flex-1 rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-2.5 py-1.5 text-[12px] text-[var(--brief-ink)] placeholder:text-[var(--ink-60)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void addRoute()}
              disabled={creating || !form.name.trim() || !form.url.trim()}
              className="shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-extrabold cursor-pointer disabled:opacity-40"
              style={{ background: '#40916C', color: 'var(--brief-ink)' }}
            >
              {creating ? '…' : 'Add'}
            </button>
          </div>
          {routeError && (
            <p className="text-[11px] text-[var(--brief-ink)] leading-snug">{routeError}</p>
          )}
        </div>

        {/* the dispatch ledger — real outcomes only */}
        {deliveries.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--ink-60)]">
              Dispatch ledger
            </p>
            {deliveries.slice(0, 5).map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span className="text-[var(--ink-60)] truncate">{d.channel} → {String(d.target).slice(0, 34)}</span>
                <span
                  className="shrink-0 font-bold"
                  style={{ color: d.status === 'delivered' ? 'var(--brief-ink)' : 'rgba(17,17,17,0.55)' }}
                >
                  {d.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default EnginePanel;
