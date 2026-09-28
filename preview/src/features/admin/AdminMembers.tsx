import React, { useEffect, useRef, useState } from 'react';
import * as api from '../../api/briefApi';
import '../../ui/compact.css';

const date = (v: string | null | undefined) => v ? new Date(v).toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Not recorded';
const panel = 'rounded-xl p-4 space-y-3 border border-[var(--divider)] bg-[var(--color-paper)]';
const button = 'rounded-lg border border-[var(--divider)] px-3 py-2 text-xs font-semibold disabled:opacity-40';

export function AdminMembers({ canAdmin, tick, memberId, onSelectMember, meId, onAccessDenied }: {
  canAdmin: boolean; tick: number; memberId?: string | null;
  onSelectMember?: (id: string | null) => void; meId?: string; onAccessDenied?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [pageNumber, setPageNumber] = useState(0);
  const [page, setPage] = useState<api.MembersPage | null>(null);
  const [funnel, setFunnel] = useState<api.OnboardingFunnel | null>(null);
  const [localId, setLocalId] = useState<string | null>(null);
  const selectedId = memberId === undefined ? localId : memberId;
  const [profile, setProfile] = useState<api.AdminMemberProfile | null>(null);
  const [listError, setListError] = useState('');
  const [funnelError, setFunnelError] = useState('');
  const [profileError, setProfileError] = useState('');
  const [revision, setRevision] = useState(0);
  const [section, setSection] = useState<'account' | 'business' | 'worker'>('account');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const deny = useRef(onAccessDenied);
  deny.current = onAccessDenied;
  const refused = (r: { status?: number | null }) => { if (r.status === 401 || r.status === 403) deny.current?.(); };
  const actionLock = useRef(false);
  const profileElement = useRef<HTMLElement>(null);
  useEffect(() => {
    if (profile?.member.id !== selectedId) return;
    profileElement.current?.focus();
    profileElement.current?.scrollIntoView?.({ block: 'start' });
  }, [profile?.member.id, selectedId]);
  const select = (id: string | null) => { setProfile(null); setLocalId(id); setSection('account'); setNote(''); setReason(''); onSelectMember?.(id); };

  useEffect(() => {
    let live = true;
    setPage(null); setListError('');
    if (canAdmin) void api.listMembers(query, pageNumber).then((r) => { if (!live) return; if (r.ok) setPage(r.data); else { setListError(r.error); refused(r); } });
    return () => { live = false; };
  }, [query, pageNumber, tick, revision, canAdmin]);
  useEffect(() => {
    let live = true;
    setFunnel(null); setFunnelError('');
    if (canAdmin) void api.onboardingFunnel().then((r) => { if (!live) return; if (r.ok) setFunnel(r.data); else { setFunnelError(r.error); refused(r); } });
    return () => { live = false; };
  }, [tick, revision, canAdmin]);
  useEffect(() => {
    let live = true;
    setProfile(null); setProfileError(''); setReason('');
    if (selectedId && canAdmin) void api.getAdminMemberProfile(selectedId).then((r) => { if (!live) return; if (r.ok) setProfile(r.data); else { setProfileError(r.error); refused(r); } });
    return () => { live = false; };
  }, [selectedId, canAdmin, tick, revision]);
  useEffect(() => { setNote(''); setSection('account'); }, [selectedId]);
  const refresh = () => setRevision((n) => n + 1);
  const act = async (fn: () => Promise<{ ok: boolean; error?: string; status?: number | null }>, message: string) => {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setNote('');
    try {
      const r = await fn();
      if (r.ok) { refresh(); setNote(message); }
      else { setNote(r.error ?? 'The action was refused.'); refused(r); }
    } finally { actionLock.current = false; setBusy(false); }
  };
  // No privileged fetch or cached detail is mounted for a non-admin.
  if (!canAdmin) return <div className={panel}><h3>Members</h3><p>The directory needs the admin capability. Ask an admin for access.</p></div>;
  const p = profile?.member.id === selectedId ? profile : null;
  const m = p?.member;
  return <div className="space-y-4" data-testid="admin-members">
    <section className={panel} aria-label="Registration overview">
      <div className="flex justify-between gap-3"><h2 className="text-lg font-bold">Registered members</h2><button className={button} onClick={refresh}>Refresh</button></div>
      {funnelError ? <p role="alert">{funnelError}</p> : !funnel ? <p role="status">Reading registrations…</p> : <dl className="grid grid-cols-3 gap-3 text-xs">
        <div><dt>Members</dt><dd className="text-xl font-bold">{funnel.totals.members}</dd></div>
        <div><dt>Started (any event)</dt><dd className="text-xl font-bold">{funnel.totals.withAnyEvent}</dd></div>
        <div><dt>Finished onboarding</dt><dd className="text-xl font-bold">{funnel.totals.finishedOnboarding}</dd></div>
      </dl>}
      {funnel && Object.keys(funnel.funnel).length > 0 && <details className="text-xs"><summary>Onboarding events</summary><div className="flex flex-wrap gap-2 mt-2">{Object.entries(funnel.funnel).map(([name, n]) => <span key={name}>{name} · {n}</span>)}</div></details>}
      <p className="text-xs text-[var(--brief-muted)]">Registered accounts, newest first. Workforce enrollment is separate from app registration.</p>
    </section>
    <section className={panel} aria-label="Member directory">
      <label className="block text-sm font-semibold">Search members
        <input className="block w-full rounded-lg border p-2 mt-1" placeholder="search members…" value={query} onChange={(e) => { setQuery(e.target.value); setPageNumber(0); }} />
      </label>
      {listError ? <p role="alert">{listError} <button className={button} onClick={refresh}>Retry</button></p> : !page ? <p role="status">Reading members…</p> : <>
        <p className="text-xs text-[var(--brief-muted)]">{page.total} member{page.total === 1 ? '' : 's'}{query ? ' matching your search' : ''}</p>
        {!page.rows.length ? <p>No members match “{query}”.</p> : <ul className="divide-y divide-[var(--divider)]">
          {page.rows.map((row) => <li key={row.id}><button type="button" className="w-full text-left py-3" disabled={busy} aria-current={selectedId === row.id ? 'true' : undefined} onClick={() => select(row.id)} data-testid="admin-member-row">
            <span className="flex justify-between gap-2"><strong>{row.displayName}</strong><span className="text-xs">{date(row.createdAt)}</span></span>
            <span className="block text-xs">@{row.handle} · {row.status} · {(row.effectiveRoles ?? row.platformRoles).join(', ') || 'Member'}</span>
            <span className="text-xs text-[var(--brief-muted)]">{row.onboarding.rung ? `Climbed to: ${funnel?.rungs.find((r) => r.id === row.onboarding.rung)?.label ?? row.onboarding.rung}` : 'No rung yet'}{row.onboarding.latestEvent ? ` · last: ${row.onboarding.latestEvent}` : ''} · Open profile →</span>
          </button></li>)}
        </ul>}
        <nav className="flex justify-between items-center gap-2" aria-label="Member pages">
          <button className={button} disabled={pageNumber === 0} onClick={() => setPageNumber((n) => n - 1)}>Previous</button>
          <span className="text-xs">Page {pageNumber + 1} of {Math.max(1, Math.ceil(page.total / page.pageSize))}</span>
          <button className={button} disabled={(pageNumber + 1) * page.pageSize >= page.total} onClick={() => setPageNumber((n) => n + 1)}>Next</button>
        </nav>
      </>}
    </section>
    {selectedId && <section ref={profileElement} tabIndex={-1} className={`${panel} scroll-mt-40`} aria-label="Member profile" data-testid="admin-member-profile">
      <div className="flex justify-between gap-2"><h2 className="text-lg font-bold">{m ? `@${m.handle}` : 'Member profile'}</h2><button className={button} disabled={busy} onClick={() => select(null)}>Close profile</button></div>
      {profileError ? <p role="alert">{profileError} <button className={button} onClick={refresh}>Retry profile</button></p> : !p || !m ? <p role="status">Reading profile…</p> : <>
        <p className="text-sm">{m.displayName} · {m.status} · Registered {date(m.createdAt)}</p>
        <div className="compact-tabs" aria-label="Profile sections">{(['account', 'business', 'worker'] as const).map((key) => <button key={key} type="button" aria-pressed={section === key} onClick={() => setSection(key)}>{key === 'account' ? 'Account' : key === 'business' ? 'Business profiles' : 'Worker profile'}</button>)}</div>
        {section === 'account' && <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-2 gap-2"><dt>Status</dt><dd>{m.status}</dd><dt>Account ID</dt><dd className="break-all">{m.id}</dd><dt>Email</dt><dd className="break-all">{p.account.email ?? 'Not provided'}</dd><dt>Sign-in method</dt><dd>{p.account.authProvider}</dd><dt>Verification</dt><dd>{m.verification}</dd><dt>Last onboarding activity</dt><dd>{m.onboarding.latestEvent ?? 'None'} · {date(m.onboarding.latestAt)}</dd><dt>Effective roles</dt><dd>{(m.effectiveRoles ?? m.platformRoles).join(', ') || 'Member'}</dd></dl>
          <fieldset disabled={busy}><legend className="font-semibold">Platform roles</legend><p className="text-xs text-[var(--brief-muted)]">Stored roles below. Deployment-granted roles can only be removed in the hosting configuration. Changes are audited.</p>
            <div className="flex flex-wrap gap-2 mt-2">{['operator', 'reviewer', 'finance', 'admin'].map((role) => <button key={role} type="button" className={`${button} ${m.platformRoles.includes(role) ? 'bg-[var(--color-primary)] text-[var(--accent-ink)]' : ''}`} aria-pressed={m.platformRoles.includes(role)} disabled={busy || (m.id === meId && role === 'admin')} onClick={() => void act(() => api.setPlatformRoles(m.id, m.platformRoles.includes(role) ? m.platformRoles.filter((r) => r !== role) : [...m.platformRoles, role], `${m.platformRoles.includes(role) ? 'removed' : 'granted'} ${role} at the members desk`), 'Role change saved and audited.')}>{role}</button>)}</div>
          </fieldset>
          {m.id === meId ? <p className="text-xs">You cannot suspend yourself or remove your own admin access here.</p> : m.status === 'active' ? <div className="space-y-2"><label className="block text-xs">Suspension reason<input className="block w-full border rounded-lg p-2 mt-1" placeholder="why suspend? (audited)" value={reason} onChange={(e) => setReason(e.target.value)} /></label><button className={button} disabled={busy || reason.trim().length < 4} onClick={() => void act(() => api.setMemberStatus(m.id, 'suspended', reason), `Suspended — ${m.handle} is locked out now. All sessions revoked.`)}>Suspend — locks them out now</button></div> : <button className={button} disabled={busy} onClick={() => void act(() => api.setMemberStatus(m.id, 'active'), 'Account reinstated.')}>Reinstate</button>}
        </div>}
        {section === 'business' && <div className="space-y-3 text-sm">
          <h3 className="font-semibold">Spaces / shopfronts</h3>
          {!p.spaces.length && <p>No business spaces created.</p>}
          {p.spaces.map((s) => <article key={s.id} className="border rounded-lg p-3"><h4 className="font-semibold">{s.name}</h4><p className="text-xs">{s.type ?? 'Business'} · {s.visibility} · {s.status} · Created {date(s.createdAt)}</p>{s.publicSlug ? <a className="text-xs underline" href={`#space/${encodeURIComponent(s.publicSlug)}`}>Open public business profile →</a> : <p className="text-xs">No public page. Owner-only workspace access is unchanged.</p>}</article>)}
          <h3 className="font-semibold">Seller / supplier profiles</h3>
          {!p.businesses.length && <p>No seller profile registered.</p>}
          {p.businesses.map((b) => <article key={b.id} className="border rounded-lg p-3"><h4 className="font-semibold">{b.name}</h4><p className="text-xs">{b.businessType ?? 'Seller'} · {b.publication} · {b.status ?? 'Status not recorded'}</p></article>)}
        </div>}
        {section === 'worker' && <div className="space-y-3 text-sm">
          {!p.worker ? <p>No worker profile registered.</p> : <><h3 className="font-semibold">{p.worker.displayName}</h3><p>{p.worker.phone} · {p.worker.modes.join(' / ')}</p><p>Areas: {p.worker.areas.join(', ') || 'Not stated'}</p><p>Languages: {p.worker.languages.join(', ') || 'Not stated'}</p><p>Terms accepted: {date(p.worker.termsAcceptedAt)}</p><p className="text-xs">Briefings read: {p.worker.briefings.map((b) => b.templateKey.replace(/_/g, ' ')).join(', ') || 'None'}. Reading a briefing is not certification.</p></>}
          <h3 className="font-semibold">Workforce memberships</h3>
          {!p.memberships.length && <p>Not enrolled in a workforce.</p>}
          {p.memberships.map((w) => <article key={w.id} className="border rounded-lg p-3"><h4 className="font-semibold">{w.name}</h4><p>{w.role} · {w.status}</p><p className="text-xs">Territories: {w.territories.join(', ') || 'None assigned'}</p><ul className="text-xs mt-2 space-y-1">{w.onboarding.items.map((item) => <li key={item.key}>{item.done ? '✓' : '○'} {item.label} — {item.detail}</li>)}</ul></article>)}
          {!!p.ownedWorkforces.length && <p>Owns: {p.ownedWorkforces.map((w) => w.name).join(', ')}</p>}
          <h3 className="font-semibold">Capability-specific work record</h3>
          {!p.record.byTemplate.length ? <p>No reviewed work yet.</p> : p.record.byTemplate.map((r) => <p key={r.templateKey}>{r.templateLabel}: {r.statement}</p>)}
        </div>}
        <p className="text-xs text-[var(--brief-muted)]">Profile summaries are read-only; account changes and profile views are audited. Passwords, sessions, customer proof and private financial records are not exposed.</p>
      </>}
      {note && <p role="status" className="text-sm">{note}</p>}
    </section>}
  </div>;
}
