import React from 'react';
import * as briefApi from '../../api/briefApi';
import type { Vault as VaultType, Footstep, VaultRequest, ResolutionItem } from '../../api/types';

// ---------------------------------------------------------------------------
// THE VAULT — a persistent context layer
//
// A premium, restrained command surface over real-world activity. Not a chat,
// not a CRM, not an inbox: the Vault is the ROOM that people, channels,
// vendors, orders and payments all open into, and the timeline is its memory.
//
// Everything here is real: it calls the Vault API, renders the SERVER's scoped
// `role`, and never invents access, money or activity. If the backend says
// "not configured", this shows it rather than implying otherwise.
// ---------------------------------------------------------------------------

const TONE = {
  text: 'text-[var(--brief-ink)]',
  dim: 'text-[var(--ink-60)]',
  faint: 'text-[var(--ink-60)]',
  accent: 'text-[var(--brief-ink)]',
  gold: 'text-[var(--brief-ink)]',
  warn: 'text-[var(--brief-ink)]',
  danger: 'text-[var(--brief-ink)]'
};

const CATEGORY_TONE: Record<string, string> = {
  people: '#0D1117',
  messages: '#0D1117',
  commerce: '#5A6472',
  payments: '#0D1117',
  vendors: '#5A6472',
  system: '#5A6472',
  decisions: '#0D1117'
};

const CATEGORY_LABEL: Record<string, string> = {
  people: 'People', messages: 'Messages', commerce: 'Commerce',
  payments: 'Payments', vendors: 'Vendors', system: 'System', decisions: 'Decisions'
};

const FILTERS = ['All', 'People', 'Messages', 'Commerce', 'Payments', 'Vendors', 'System', 'Decisions'];

const money = (n: number) => `KSh ${n.toLocaleString()}`;

function timeOf(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function dayOf(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return 'TODAY';
  return d.toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'short' }).toUpperCase();
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-extrabold border cursor-pointer transition ${
        active ? 'bg-[#40916C] text-[var(--accent-ink)] border-[#0891B2]' : 'bg-[color:var(--color-paper)] text-[var(--ink-70)] border-[var(--brief-line)]'
      }`}
    >
      {children}
    </button>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-xl ${className}`}>{children}</div>;
}

// ---------------------------------------------------------------------------
// TIMELINE
// ---------------------------------------------------------------------------

function Timeline({ vaultId }: { vaultId: string }) {
  const [filter, setFilter] = React.useState('All');
  const [page, setPage] = React.useState<{ footsteps: Footstep[]; nextCursor: number | null }>({ footsteps: [], nextCursor: null });
  const [status, setStatus] = React.useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async (category: string | undefined, cursor?: number) => {
    setStatus('loading');
    const res = await briefApi.getFootsteps(vaultId, category, cursor);
    if (res.ok) {
      setPage((p) => ({ footsteps: cursor ? [...p.footsteps, ...res.data.footsteps] : res.data.footsteps, nextCursor: res.data.nextCursor }));
      setStatus('ready');
    } else {
      setError(res.error); setStatus('error');
    }
  }, [vaultId]);

  React.useEffect(() => {
    void load(filter === 'All' ? undefined : filter.toLowerCase());
  }, [filter, load]);

  // Group by day, oldest first.
  const days: { day: string; items: Footstep[] }[] = [];
  for (const f of page.footsteps) {
    const day = dayOf(f.createdAt);
    const last = days[days.length - 1];
    if (last && last.day === day) last.items.push(f);
    else days.push({ day, items: [f] });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        {FILTERS.map((f) => (
          <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>{f}</Chip>
        ))}
      </div>

      {status === 'loading' && page.footsteps.length === 0 && (
        <p className={`text-xs ${TONE.faint}`}>Loading timeline…</p>
      )}
      {status === 'error' && <p className={`text-xs ${TONE.danger}`}>{error}</p>}
      {status === 'ready' && page.footsteps.length === 0 && (
        <p className={`text-xs ${TONE.faint}`}>Nothing recorded yet.</p>
      )}

      {days.map((d) => (
        <div key={d.day} className="space-y-1">
          <p className="text-[11px] text-[var(--ink-60)] mt-3 mb-1">{d.day}</p>
          {d.items.map((f) => (
            <div key={f.id} className="flex items-start gap-2.5 py-1.5 border-b border-[var(--brief-line)] last:border-0">
              <span
                className="mt-1.5 shrink-0 w-2 h-2 rounded-full"
                style={{ background: CATEGORY_TONE[f.category] ?? '#5A6472' }}
              />
              <div className="min-w-0">
                <p className="text-[12px] leading-snug text-[var(--brief-ink)]">{f.narrative}</p>
                <p className="text-[11px] text-[var(--ink-60)] mt-0.5">
                  {timeOf(f.createdAt)}
                  {f.channel && f.channel !== 'web' ? ` · via ${f.channel}` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      ))}

      {page.nextCursor !== null && (
        <button
          onClick={() => void load(filter === 'All' ? undefined : filter.toLowerCase(), page.nextCursor!)}
          className="w-full py-2 rounded-lg bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-[11px] font-extrabold border border-[var(--brief-line)] cursor-pointer"
        >
          Load earlier
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HOST PANEL (add participant, handoff, close)
// ---------------------------------------------------------------------------

function HostPanel({ vault, onChanged }: { vault: VaultType; onChanged: () => void }) {
  const [name, setName] = React.useState('');
  const [role, setRole] = React.useState('guest');
  const [handoff, setHandoff] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState('');

  const addParticipant = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const res = await briefApi.addVaultParticipant(vault.id, { role, name: name.trim() });
    setBusy(false);
    if (res.ok) { setName(''); onChanged(); }
  };

  const makeHandoff = async () => {
    const participant = vault.participants?.find((p) => p.role === 'guest');
    if (!participant) { setNote('Add a guest first.'); return; }
    setBusy(true);
    const res = await briefApi.createHandoff(vault.id, { participantId: participant.id, toChannel: 'web' });
    setBusy(false);
    if (res.ok) {
      const origin = window.location.origin;
      setHandoff(`${origin}/#/vault/${vault.slug}?token=${encodeURIComponent(res.data.token)}`);
    } else setNote(res.error);
  };

  return (
    <Card className="p-3 space-y-2">
      <p className="text-[12px] font-extrabold text-[var(--brief-ink)]">Host</p>

      <div className="flex gap-1.5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name"
          className="flex-1 min-w-0 bg-[color:var(--color-well)] border border-[var(--brief-line)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--brief-ink)] placeholder:text-[var(--ink-60)] outline-none focus:border-[#0891B2]" />
        <select value={role} onChange={(e) => setRole(e.target.value)}
          className="bg-[color:var(--color-well)] border border-[var(--brief-line)] rounded-lg px-2 py-1.5 text-xs text-[var(--brief-ink)] outline-none">
          <option value="guest">Guest</option>
          <option value="vendor">Vendor</option>
          <option value="admin">Admin</option>
        </select>
        <button onClick={addParticipant} disabled={busy || !name.trim()}
          className="px-2.5 py-1.5 rounded-lg bg-[#40916C] text-[var(--accent-ink)] text-[11px] font-extrabold cursor-pointer disabled:opacity-40">
          Add
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button onClick={makeHandoff} disabled={busy}
          className="px-2.5 py-1.5 rounded-lg bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-[11px] font-extrabold border border-[var(--brief-line)] cursor-pointer disabled:opacity-40">
          Continue elsewhere
        </button>
        <button onClick={async () => { await briefApi.closeVault(vault.id); onChanged(); }}
          className="px-2.5 py-1.5 rounded-lg bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-[11px] font-extrabold border border-[var(--brief-line)] cursor-pointer">
          Close vault
        </button>
      </div>

      {handoff && (
        <div className="bg-[color:var(--color-well)] border border-[var(--brief-line)] rounded-lg p-2 space-y-1">
          <p className="text-[11px] text-[var(--ink-60)]">Handoff link (single-use):</p>
          <p className="text-[11px] text-[var(--brief-ink)] break-all select-all">{handoff}</p>
        </div>
      )}
      {note && <p className="text-[11px] text-[var(--brief-ink)]">{note}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// REQUESTS
// ---------------------------------------------------------------------------

function Requests({ vault, onChanged }: { vault: VaultType; onChanged: () => void }) {
  const requests = vault.requests ?? [];
  const [fresh, setFresh] = React.useState<VaultRequest[] | null>(null);
  const [freshError, setFreshError] = React.useState<string | null>(null);
  const [routeFor, setRouteFor] = React.useState<string | null>(null);
  const [vendorId, setVendorId] = React.useState('');
  const [routeBusy, setRouteBusy] = React.useState(false);
  const [routeError, setRouteError] = React.useState<string | null>(null);

  // Re-read the request list from the server on demand. The vault view
  // carries requests at load time; this is the refresh half that had no
  // caller — listVaultRequests exists precisely for it.
  const reload = async () => {
    setFreshError(null);
    const res = await briefApi.listVaultRequests(vault.id);
    if (res.ok) setFresh(res.data); else setFreshError(res.error);
  };

  // The host routes an open request to a vendor. The server decides whether
  // the caller may route and whether the vendor exists; a refusal is shown
  // verbatim rather than swallowed.
  const route = async (requestId: string) => {
    const v = vendorId.trim();
    if (!v) return;
    setRouteBusy(true); setRouteError(null);
    const res = await briefApi.routeVaultRequest(vault.id, requestId, v);
    setRouteBusy(false);
    if (!res.ok) { setRouteError(res.error); return; }
    setRouteFor(null); setVendorId('');
    onChanged();
  };

  if (!requests.length && !fresh) return null;
  const rows = fresh ?? requests;

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-extrabold text-[var(--brief-ink)]">Requests</p>
        <button onClick={() => { if (fresh) { setFresh(null); return; } void reload(); }}
          className="text-[11px] font-extrabold text-[var(--ink-60)] cursor-pointer">
          {fresh ? 'Show loaded' : 'Refresh'}
        </button>
      </div>
      {freshError && <p className="text-[11px] text-[var(--brief-ink)]">{freshError}</p>}
      {rows.map((r: VaultRequest) => (
        <div key={r.id} className="bg-[color:var(--color-well)] border border-[var(--brief-line)] rounded-lg p-2.5 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-[var(--brief-ink)] truncate">{r.description}</p>
            <p className="text-[11px] text-[var(--ink-60)] mt-0.5">
              {r.status}{r.status === 'routed' && r.vendorId ? ` → ${r.vendorId}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {(vault.role === 'host' || vault.role === 'admin') && r.status === 'open' && (
              routeFor === r.id ? (
                <>
                  <input
                    value={vendorId}
                    onChange={(e) => setVendorId(e.target.value)}
                    placeholder="vendor id"
                    aria-label="vendor id to route to"
                    className="w-28 px-2 py-1 rounded-lg border border-[var(--brief-line)] text-[11px] text-[var(--brief-ink)]"
                  />
                  <button onClick={() => void route(r.id)} disabled={routeBusy || !vendorId.trim()}
                    className="px-2.5 py-1.5 rounded-lg bg-[#40916C] text-[var(--accent-ink)] text-[11px] font-extrabold cursor-pointer disabled:opacity-50">
                    {routeBusy ? '…' : 'Route'}
                  </button>
                  <button onClick={() => { setRouteFor(null); setRouteError(null); }}
                    className="px-2 py-1.5 rounded-lg border border-[var(--brief-line)] text-[11px] font-bold text-[var(--ink-60)] cursor-pointer">
                    ×
                  </button>
                </>
              ) : (
                <button onClick={() => setRouteFor(r.id)}
                  className="px-2.5 py-1.5 rounded-lg border border-[var(--brief-line)] text-[11px] font-extrabold text-[var(--brief-ink)] cursor-pointer">
                  Route
                </button>
              )
            )}
            {vault.role === 'vendor' && (r.status === 'routed' || r.status === 'open') && (
              <button onClick={async () => { await briefApi.acceptVaultRequest(vault.id, r.id); onChanged(); }}
                className="px-2.5 py-1.5 rounded-lg bg-[#40916C] text-[var(--accent-ink)] text-[11px] font-extrabold cursor-pointer">
                Accept
              </button>
            )}
          </div>
        </div>
      ))}
      {routeError && <p className="text-[11px] text-[var(--brief-ink)]">{routeError}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// DETAIL
// ---------------------------------------------------------------------------

function VaultDetail({ vault, onBack, onChanged }: { vault: VaultType; onBack: () => void; onChanged: () => void }) {
  const [ask, setAsk] = React.useState('');
  const [request, setRequest] = React.useState('');

  const askQuestion = async () => {
    if (!ask.trim()) return;
    await briefApi.recordFootstep(vault.id, { kind: 'question_asked', narrative: ask.trim() });
    setAsk(''); onChanged();
  };

  const makeRequest = async () => {
    if (!request.trim()) return;
    await briefApi.createVaultRequest(vault.id, { description: request.trim(), kind: 'service' });
    setRequest(''); onChanged();
  };

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="text-[11px] font-extrabold text-[var(--brief-ink)] cursor-pointer">← Vaults</button>

      <div>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-extrabold text-[var(--brief-ink)] leading-tight">{vault.title}</h2>
          <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-[color:var(--color-paper)] text-[var(--brief-ink)]">{vault.status}</span>
        </div>
        <p className={`text-[11px] ${TONE.faint} mt-0.5`}>{vault.type} · {vault.visibility}</p>
        {vault.description && <p className={`text-xs ${TONE.dim} mt-1`}>{vault.description}</p>}
      </div>

      <div className="flex gap-2 flex-wrap">
        <Stat label="People" value={String(vault.metrics.participantCount)} />
        <Stat label="Requests" value={String(vault.metrics.requestCount)} />
        <Stat label="Pending" value={vault.metrics.pendingKes > 0 ? money(vault.metrics.pendingKes) : '—'} accent={vault.metrics.pendingKes > 0} />
      </div>

      <Timeline vaultId={vault.id} />

      {vault.role !== 'vendor' && (
        <Card className="p-3 space-y-2">
          <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Ask a question…"
            className="w-full bg-[color:var(--color-well)] border border-[var(--brief-line)] rounded-lg px-3 py-2 text-xs text-[var(--brief-ink)] placeholder:text-[var(--ink-60)] outline-none focus:border-[#0891B2]" />
          <button onClick={askQuestion} disabled={!ask.trim()}
            className="w-full py-2 rounded-lg bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-[11px] font-extrabold border border-[var(--brief-line)] cursor-pointer disabled:opacity-40">
            Ask
          </button>
        </Card>
      )}

      {vault.role !== 'vendor' && (
        <Card className="p-3 space-y-2">
          <input value={request} onChange={(e) => setRequest(e.target.value)} placeholder="Request something (e.g. extra chairs)…"
            className="w-full bg-[color:var(--color-well)] border border-[var(--brief-line)] rounded-lg px-3 py-2 text-xs text-[var(--brief-ink)] placeholder:text-[var(--ink-60)] outline-none focus:border-[#0891B2]" />
          <button onClick={makeRequest} disabled={!request.trim()}
            className="w-full py-2 rounded-lg bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-[11px] font-extrabold border border-[var(--brief-line)] cursor-pointer disabled:opacity-40">
            Request
          </button>
        </Card>
      )}

      <Requests vault={vault} onChanged={onChanged} />

      {(vault.role === 'host' || vault.role === 'admin') && <HostPanel vault={vault} onChanged={onChanged} />}
    </div>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-lg px-3 py-2">
      <p className="text-[11px] text-[var(--ink-60)]">{label}</p>
      <p className={`text-sm font-extrabold ${accent ? 'text-[var(--brief-ink)]' : 'text-[var(--brief-ink)]'}`}>{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HOME (command surface)
// ---------------------------------------------------------------------------

function VaultHome({ onOpen, refreshKey }: { onOpen: (v: VaultType) => void; refreshKey: number }) {
  const [vaults, setVaults] = React.useState<VaultType[]>([]);
  const [status, setStatus] = React.useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [creating, setCreating] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [type, setType] = React.useState('gathering');
  const [visibility, setVisibility] = React.useState('private');
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState<{ vaultId: string; title: string; matches: { snippet: string }[] }[]>([]);
  const [resolution, setResolution] = React.useState<ResolutionItem[]>([]);

  const load = React.useCallback(async () => {
    setStatus('loading');
    const [v, r] = await Promise.all([briefApi.listVaults(), briefApi.getResolution()]);
    if (v.ok) { setVaults(v.data); setStatus('ready'); } else setStatus('error');
    if (r.ok) setResolution(r.data);
  }, []);

  React.useEffect(() => { void load(); }, [load, refreshKey]);

  const create = async () => {
    if (!title.trim()) return;
    const res = await briefApi.createVault({ title: title.trim(), type: type as any, visibility: visibility as any });
    if (res.ok) { setTitle(''); setCreating(false); void load(); }
  };

  const search = async (query: string) => {
    setQ(query);
    if (!query.trim()) { setResults([]); return; }
    const res = await briefApi.searchVaults(query);
    if (res.ok) setResults(res.data);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-extrabold text-[var(--brief-ink)]">The Vault</h2>
        <button onClick={() => setCreating((c) => !c)}
          className="px-3 py-1.5 rounded-full bg-[#40916C] text-[var(--accent-ink)] text-[11px] font-extrabold cursor-pointer">
          + New vault
        </button>
      </div>

      {creating && (
        <Card className="p-3 space-y-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What is this activity?"
            className="w-full bg-[color:var(--color-well)] border border-[var(--brief-line)] rounded-lg px-3 py-2 text-xs text-[var(--brief-ink)] placeholder:text-[var(--ink-60)] outline-none focus:border-[#0891B2]" />
          <div className="flex gap-1.5">
            <select value={type} onChange={(e) => setType(e.target.value)}
              className="flex-1 bg-[color:var(--color-well)] border border-[var(--brief-line)] rounded-lg px-2 py-1.5 text-xs text-[var(--brief-ink)] outline-none">
              <option value="gathering">Gathering</option>
              <option value="event">Event</option>
              <option value="marketplace">Market</option>
              <option value="campaign">Campaign</option>
              <option value="service">Service</option>
              <option value="deal">Deal</option>
            </select>
            <select value={visibility} onChange={(e) => setVisibility(e.target.value)}
              className="flex-1 bg-[color:var(--color-well)] border border-[var(--brief-line)] rounded-lg px-2 py-1.5 text-xs text-[var(--brief-ink)] outline-none">
              <option value="private">Private</option>
              <option value="public">Public</option>
              <option value="invite_only">Invite only</option>
              <option value="token_access">Token</option>
            </select>
          </div>
          <button onClick={create} disabled={!title.trim()}
            className="w-full py-2 rounded-lg bg-[#40916C] text-[var(--accent-ink)] text-[11px] font-extrabold cursor-pointer disabled:opacity-40">
            Create
          </button>
        </Card>
      )}

      <div className="relative">
        <input value={q} onChange={(e) => void search(e.target.value)} placeholder="Search people, requests, payments…"
          className="w-full bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-xl px-3 py-2.5 text-xs text-[var(--brief-ink)] placeholder:text-[var(--ink-60)] outline-none focus:border-[#0891B2]" />
      </div>
      {results.length > 0 && (
        <Card className="p-3 space-y-1.5">
          {results.map((r) => (
            <button key={r.vaultId} onClick={() => { const v = vaults.find((x) => x.id === r.vaultId); if (v) onOpen(v); }}
              className="w-full text-left bg-[color:var(--color-well)] border border-[var(--brief-line)] rounded-lg p-2.5 cursor-pointer">
              <p className="text-xs font-extrabold text-[var(--brief-ink)]">{r.title}</p>
              <p className="text-[11px] text-[var(--ink-60)] truncate">{r.matches.map((m) => m.snippet).join(' · ')}</p>
            </button>
          ))}
        </Card>
      )}

      {resolution.length > 0 && (
        <Card className="p-3 space-y-1.5">
          <p className="text-[12px] font-extrabold text-[var(--brief-ink)]">Needs attention</p>
          {resolution.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-[var(--brief-ink)] truncate">{r.vaultTitle} · {r.description ?? r.kind}</p>
            </div>
          ))}
        </Card>
      )}

      {status === 'loading' && <p className="text-xs text-[var(--ink-60)]">Loading…</p>}
      {status === 'error' && <p className="text-xs text-[var(--brief-ink)]">Could not load vaults.</p>}
      {status === 'ready' && vaults.length === 0 && (
        <p className="text-xs text-[var(--ink-60)]">No vaults yet. A vault wraps a real activity — a gathering, a market, a deal.</p>
      )}

      {vaults.filter((v) => v.status !== 'closed' && v.status !== 'archived').map((v) => (
        <button key={v.id} onClick={() => onOpen(v)} className="w-full text-left">
          <Card className="p-3 hover:border-[var(--brief-line)] transition">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-extrabold text-[var(--brief-ink)] truncate">{v.title}</p>
                <p className="text-[11px] text-[var(--ink-60)] mt-0.5">{v.type} · {v.role}</p>
              </div>
              <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full ${
                v.status === 'settled' ? 'bg-[color:var(--color-paper)] text-[var(--brief-ink)]' : 'bg-[color:var(--color-paper)] text-[var(--brief-ink)]'
              }`}>{v.status}</span>
            </div>
            <div className="flex gap-3 mt-2 text-[11px] text-[var(--ink-60)]">
              <span>{v.metrics.participantCount} people</span>
              {v.metrics.requestCount > 0 && <span>{v.metrics.requestCount} requests</span>}
              {v.metrics.pendingKes > 0 && <span className="text-[var(--brief-ink)]">{money(v.metrics.pendingKes)} pending</span>}
            </div>
          </Card>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ROOT
// ---------------------------------------------------------------------------

export function Vault() {
  const [selected, setSelected] = React.useState<VaultType | null>(null);
  const [version, setVersion] = React.useState(0);

  const refresh = React.useCallback(() => setVersion((n) => n + 1), []);

  return (
    <div className="max-w-3xl mx-auto px-4 py-4">
      {selected ? (
        <VaultDetail
          vault={selected}
          onBack={() => setSelected(null)}
          onChanged={() => { setVersion((n) => n + 1); }}
        />
      ) : (
        <VaultHome onOpen={setSelected} refreshKey={version} />
      )}
    </div>
  );
}

export default Vault;
