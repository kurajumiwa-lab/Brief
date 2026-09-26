import React from 'react';
import { Zap, Play, Plus } from 'lucide-react';
import * as briefApi from '../api/briefApi';

// ---------------------------------------------------------------------------
// CREATOR COCKPIT — the working area for creating & analysing streams.
//
// This is the "magic of the whole system": the automation engine surfaced as a
// real tool, not a buried setting. A creator sees their workflows (trigger →
// condition → action over the signal log), what has fired, and builds new ones.
//
// Honesty: the trigger list is the REAL signal types the server emits; a blast
// action reports its honest result (no provider = failed, not "sent").
// ---------------------------------------------------------------------------

const TRIGGERS = [
  '*', 'member_joined', 'object_saved', 'object_viewed', 'object_confirmed',
  'campaign_published', 'campaign_shared', 'campaign_banner_created', 'campaign_registered', 'campaign_checkin',
  'order_placed', 'order_paid', 'order_settled', 'order_fulfilled',
  'vendor_created',
  'listing_published', 'auction_closed', 'circle_created',
  'advertiser_campaign_submitted', 'advertiser_campaign_funded',
  'creator_match_proposed', 'creator_match_accepted', 'campaign_fulfilment_verified',
  'tracked_asset_clicked', 'waitlist_offered', 'advertiser_campaign_expired'
];

const ACTION_TYPES = ['notify', 'tag', 'blast'];
const CONDITION_OPS = ['eq', 'ne', 'contains', 'exists'];
const CONDITION_FIELDS = ['actorId', 'type', 'objectId', 'circleId'];

interface Workflow {
  id: string;
  name: string;
  trigger: string;
  conditions: { field: string; op: string; value: string | null }[];
  actions: { type: string; [k: string]: any }[];
  enabled: boolean;
}

export function CreatorCockpit() {
  const [workflows, setWorkflows] = React.useState<Workflow[]>([]);
  const [runs, setRuns] = React.useState<any[]>([]);
  const [stats, setStats] = React.useState<{ totalRuns: number } | null>(null);
  const [state, setState] = React.useState<'loading' | 'ready'>('loading');

  // builder form
  const [name, setName] = React.useState('');
  const [trigger, setTrigger] = React.useState('member_joined');
  const [actionType, setActionType] = React.useState('notify');
  const [actionTitle, setActionTitle] = React.useState('');
  const [actionBody, setActionBody] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const res = await briefApi.getWorkflows();
    if (res.ok) {
      setWorkflows(res.data.workflows as Workflow[]);
      setRuns(res.data.runs as any[]);
      setStats(res.data.stats);
    }
    setState('ready');
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const buildAction = () => {
    if (actionType === 'notify') return { type: 'notify', title: actionTitle || name || 'Update', body: actionBody || null };
    if (actionType === 'tag') return { type: 'tag', tag: actionTitle || 'Interested' };
    if (actionType === 'blast') return { type: 'blast', channel: 'whatsapp', to: '', text: actionBody || actionTitle };
    return { type: 'notify', title: name };
  };

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    await briefApi.createWorkflow({ name, trigger, actions: [buildAction()] });
    setBusy(false);
    setName(''); setActionTitle(''); setActionBody('');
    await load();
  };

  const toggle = async (w: Workflow) => {
    await briefApi.updateWorkflow(w.id, { enabled: !w.enabled });
    await load();
  };

  const sweep = async () => {
    await briefApi.runWorkflowSweep();
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-extrabold text-[var(--brief-ink)]">Creator Cockpit</h2>
          <p className="text-[11px] text-[var(--ink-60)]">
            Automate your streams: when something happens, do something. {stats ? `${stats.totalRuns} run${stats.totalRuns === 1 ? '' : 's'} so far.` : ''}
          </p>
        </div>
        <button onClick={() => void sweep()} className="flex items-center gap-1 rounded-full border border-[var(--brief-line)] px-3 py-1.5 text-[12px] font-bold text-[var(--brief-ink)] cursor-pointer">
          <Play className="h-3 w-3" /> Run now
        </button>
      </div>

      {/* Builder */}
      <div className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-4 space-y-3">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-[var(--brief-ink)]">
          <Zap className="h-3.5 w-3.5" /> New automation
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (e.g. Welcome new members)"
          className="w-full rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-well)] px-3 py-2 text-[14px] text-[var(--brief-ink)] outline-none focus:border-[#0891B2]"
        />
        <div className="flex flex-wrap gap-2 text-[12px]">
          <div className="flex items-center gap-1.5">
            <span className="text-[var(--ink-60)]">When</span>
            <select value={trigger} onChange={(e) => setTrigger(e.target.value)} className="rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-well)] px-2 py-1.5 text-[var(--brief-ink)]">
              {TRIGGERS.map((t) => <option key={t} value={t}>{t === '*' ? 'Anything happens' : t}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[var(--ink-60)]">do</span>
            <select value={actionType} onChange={(e) => setActionType(e.target.value)} className="rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-well)] px-2 py-1.5 text-[var(--brief-ink)]">
              {ACTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        {actionType === 'tag' ? (
          <input value={actionTitle} onChange={(e) => setActionTitle(e.target.value)} placeholder="Tag (e.g. Outdoor enthusiast)" className="w-full rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-well)] px-3 py-2 text-[13px] text-[var(--brief-ink)] outline-none focus:border-[#0891B2]" />
        ) : actionType === 'blast' ? (
          <input value={actionBody} onChange={(e) => setActionBody(e.target.value)} placeholder="Message text" className="w-full rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-well)] px-3 py-2 text-[13px] text-[var(--brief-ink)] outline-none focus:border-[#0891B2]" />
        ) : (
          <>
            <input value={actionTitle} onChange={(e) => setActionTitle(e.target.value)} placeholder="Notification title" className="w-full rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-well)] px-3 py-2 text-[13px] text-[var(--brief-ink)] outline-none focus:border-[#0891B2]" />
            <input value={actionBody} onChange={(e) => setActionBody(e.target.value)} placeholder="Notification body (optional)" className="w-full rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-well)] px-3 py-2 text-[13px] text-[var(--brief-ink)] outline-none focus:border-[#0891B2]" />
          </>
        )}
        <button onClick={() => void create()} disabled={busy || !name.trim()} className="flex items-center gap-1.5 rounded-full bg-[#40916C] px-4 py-2 text-[13px] font-bold text-[var(--accent-ink)] disabled:opacity-40 cursor-pointer">
          <Plus className="h-3.5 w-3.5" /> Create automation
        </button>
      </div>

      {/* Workflow list */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[var(--brief-ink)]">Your automations ({workflows.length})</p>
        {state === 'loading' && <p className="text-xs text-[var(--ink-60)]">Loading…</p>}
        {state === 'ready' && workflows.length === 0 && (
          <p className="text-xs text-[var(--ink-60)]">No automations yet. Create one above.</p>
        )}
        {workflows.map((w) => (
          <div key={w.id} className="flex items-center gap-3 rounded-xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-3">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-[var(--brief-ink)] truncate">{w.name}</p>
              <p className="text-[11px] text-[var(--ink-60)]">
                when <span className="text-[var(--brief-ink)]">{w.trigger === '*' ? 'anything' : w.trigger}</span> → {w.actions.map((a) => a.type).join(', ')}
              </p>
            </div>
            <button
              onClick={() => void toggle(w)}
              className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold cursor-pointer ${w.enabled ? 'bg-[#40916C] text-[var(--accent-ink)]' : 'bg-[color:var(--color-paper)] text-[var(--ink-70)] border border-[var(--brief-line)]'}`}
            >
              {w.enabled ? 'On' : 'Off'}
            </button>
          </div>
        ))}
      </div>

      {/* Recent runs */}
      {runs.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[var(--ink-60)]">Recent activity</p>
          {runs.slice(0, 8).map((r) => (
            <div key={r.id} className="rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-3 py-2 text-[11px] text-[var(--ink-60)]">
              <span className="text-[var(--brief-ink)]">{r.signalType}</span>
              {' → '}{r.results.map((x: any) => `${x.action}${x.ok ? ' ✓' : ' ✗'}`).join(', ')}
              <span className="float-right text-[var(--ink-60)]">{new Date(r.at).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default CreatorCockpit;
