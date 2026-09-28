// THE ORGANISATION DESK — HR, territories, programs and quality control for a
// distributed team, with no central office. The server owns every rule and
// every number: this desk sends intents (activate, place in territory,
// publish, approve) and shows the server's answer — including refusals,
// verbatim. The rate card is shown only after the server computes it.
import { SessionSignIn } from '../../components/SessionSignIn';
import React, { useEffect, useRef, useState } from 'react';
import * as api from '../../api/briefApi';
import { Btn, Card, CheckRow, Empty, Field, Notice, Pill, PrivatePhoto, Progress, Section, Stat, inputClass, inputStyle, kes, modeLabel, muted, strong } from './ui';

type Tab = 'programs' | 'review' | 'people' | 'territories';

function CreateWorkforce({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  return (
    <Card testId="create-workforce">
      <p className="text-sm font-black" style={strong}>Start a workforce</p>
      <p className="text-xs" style={muted}>For your field team, agents or salesforce. People join with a code and onboard from their phones.</p>
      <div className="flex gap-2 mt-2">
        <input aria-label="Workforce name" className={inputClass} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Distribution — Field Team" />
        <Btn testId="create-workforce-btn" onClick={async () => { const r = await api.createWorkforce(name); if (r.ok) onCreated(r.data.id); else setError(r.error); }}>Create</Btn>
      </div>
      <Notice text={error} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// PROGRAMS
// ---------------------------------------------------------------------------
function NewProgram({ desk, onCreated }: { desk: api.WorkforceDesk; onCreated: (msg: string) => void }) {
  const [templateKey, setTemplateKey] = useState(desk.templates[0]?.key ?? '');
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [sourceRequestId, setSourceRequestId] = useState('');
  const [requests, setRequests] = useState<Array<{ id: string; title: string }>>([]);
  useEffect(() => { let active = true; void api.listMyRequests().then((r) => { if (active && r.ok) setRequests(r.data); }); return () => { active = false; }; }, []);
  const [target, setTarget] = useState('50');
  const [price, setPrice] = useState('300');
  const [deadline, setDeadline] = useState(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const [audience, setAudience] = useState<'workforce' | 'network'>('workforce');
  const [territoryIds, setTerritoryIds] = useState<string[]>([]);
  const [quotas, setQuotas] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const tpl = desk.templates.find((t) => t.key === templateKey);
  const create = async () => {
    setBusy(true);
    const territoryTargets: Record<string, number> = {};
    for (const id of territoryIds) if (quotas[id]) territoryTargets[id] = Number(quotas[id]);
    const r = await api.createWorkProgram(desk.workforce.id, {
      title, objective, sourceRequestId: sourceRequestId || null, templateKey, target: Number(target), unitPriceKes: Number(price), deadline, audience, territoryIds,
      territoryTargets: Object.keys(territoryTargets).length ? territoryTargets : null
    });
    setBusy(false);
    if (r.ok) onCreated(`Created as a draft. Check the rate card, then publish.`);
    else setError(r.error);
  };
  return (
    <Card testId="new-program">
      <p className="text-sm font-black" style={strong}>New work program</p>
      <p className="text-xs" style={muted}>Describe the outcome you are buying. Brief turns it into tasks workers can take.</p>
      <Field label="Task type">
        <select className={inputClass} style={inputStyle} value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
          {desk.templates.map((t) => <option key={t.key} value={t.key}>{t.label} — {modeLabel(t.mode)}</option>)}
        </select>
      </Field>
      {tpl && (
        <p className="text-xs mt-1" style={muted}>
          {tpl.summary} Steps: {tpl.steps.map((s) => `${s.label} (${modeLabel(s.mode)}, ${s.share}%)`).join(' → ')}.
        </p>
      )}
      {requests.length > 0 && <Field label="Related business request (optional)" hint="A private reference for you. This does not change the original request, its work order or its payment.">
        <select className={inputClass} style={inputStyle} value={sourceRequestId} onChange={(e) => setSourceRequestId(e.target.value)}><option value="">Standalone work</option>{requests.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select>
      </Field>}
      <Field label="Title"><input className={inputClass} style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Onboard 50 retailers in Nairobi West" /></Field>
      <Field label="Objective (what success means)"><textarea className={inputClass} style={inputStyle} rows={2} value={objective} onChange={(e) => setObjective(e.target.value)} /></Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label={`Target (${tpl?.unitNoun ?? 'units'})`}><input className={inputClass} style={inputStyle} inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
        <Field label="KES per approved unit"><input className={inputClass} style={inputStyle} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <Field label="Deadline"><input type="date" className={inputClass} style={inputStyle} value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
      </div>
      <Field label="Who can take it">
        <select className={inputClass} style={inputStyle} value={audience} onChange={(e) => setAudience(e.target.value as 'workforce' | 'network')}>
          <option value="workforce">Only my workforce (active members)</option>
          <option value="network">Open to the Brief worker network</option>
        </select>
      </Field>
      <Field label="Territories" hint={tpl?.steps.some((s) => s.mode === 'field') ? 'Field work needs at least one. A quota caps approved units per territory.' : 'Optional for home work.'}>
        {desk.territories.length === 0 ? <p className="text-xs" style={muted}>Create a territory first (Territories tab).</p> : (
          <div className="grid gap-1.5">
            {desk.territories.map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-sm" style={strong}>
                <label className="flex items-center gap-1.5 flex-1">
                  <input type="checkbox" checked={territoryIds.includes(t.id)} onChange={() => setTerritoryIds((prev) => (prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id]))} />
                  {t.name} <span className="text-xs" style={muted}>· {t.members} active</span>
                </label>
                {territoryIds.includes(t.id) && (
                  <input aria-label={`Quota for ${t.name}`} className="w-24 rounded-lg px-2 py-1 text-xs" style={inputStyle} placeholder="quota" inputMode="numeric" value={quotas[t.id] ?? ''} onChange={(e) => setQuotas((q) => ({ ...q, [t.id]: e.target.value }))} />
                )}
              </div>
            ))}
          </div>
        )}
      </Field>
      <Notice text={error} />
      <div className="mt-4"><Btn testId="create-program" onClick={() => void create()} disabled={busy}>{busy ? 'Creating…' : 'Create draft'}</Btn></div>
    </Card>
  );
}

function ProgramDetail({ id, onChanged }: { id: string; onChanged: (msg: string) => void }) {
  const [d, setD] = useState<api.WorkProgramDashboard | null>(null);
  const [error, setError] = useState('');
  const load = async () => { const r = await api.getWorkProgram(id); if (r.ok) setD(r.data); else setError(r.error); };
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <Notice text={error} />;
  const act = async (action: 'publish' | 'pause' | 'resume' | 'close') => {
    const r = await api.changeWorkProgramStatus(id, action, d.program.revision);
    if (r.ok) { onChanged(`Program ${r.data.status}.`); void load(); } else setError(r.error);
  };
  const rc = d.program.rateCard;
  return (
    <div className="mt-3 grid gap-3">
      <div className="rounded-xl p-3" style={{ background: 'var(--color-surface-elevated)' }}>
        <p className="text-xs font-bold" style={muted}>Rate card (frozen at creation)</p>
        <p className="text-sm" style={strong}>
          {kes(rc.unitPriceKes)} per approved {d.program.unitNoun} = {rc.steps.map((s) => `${s.label} ${kes(s.feeKes)}`).join(' + ')} + Brief fee {kes(rc.briefFeeKes)}
        </p>
        <p className="text-xs mt-1" style={muted}>Flat fees. No bonus, tier or speed incentive.</p>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <Stat value={kes(d.money.committedKes)} label="committed" />
        <Stat value={kes(d.money.verifiedKes)} label="verified" />
        <Stat value={kes(d.money.remainingKes)} label="remaining" />
        <Stat value={`${d.progressPct}%`} label="approved" />
      </div>
      <p className="text-xs" style={muted}>{d.money.note}</p>
      {d.sourceRequestId && <a className="text-xs underline" href={`#requests/${encodeURIComponent(d.sourceRequestId)}`}>View original business request</a>}
      <div>
        <p className="text-xs font-bold" style={muted}>Steps</p>
        <ul className="grid gap-1 mt-1 text-xs">
          {d.funnel.map((f) => (
            <li key={f.stepKey} style={strong}>{f.label} ({modeLabel(f.mode)}): {f.open} waiting · {f.assigned} held · {f.submitted} in review · {f.approved} approved · {f.rejected} rejected</li>
          ))}
        </ul>
      </div>
      {d.coverage.length > 0 && (
        <div>
          <p className="text-xs font-bold" style={muted}>Field coverage</p>
          <ul className="grid gap-1 mt-1 text-xs">
            {d.coverage.map((c) => <li key={c.territoryId} style={strong}>{c.name}: {c.approved} approved{c.quota ? ` of ${c.quota}` : ''} · {c.inProgress} in progress</li>)}
          </ul>
        </div>
      )}
      {d.results.length > 0 && (
        <div>
          <p className="text-xs font-bold" style={muted}>Latest approved</p>
          <ul className="grid gap-0.5 mt-1 text-xs">{d.results.slice(0, 10).map((r) => <li key={r.unitId} style={strong}>{r.subjectLabel ?? 'Unnamed'} {r.territory ? `· ${r.territory}` : ''} · {r.approvedAt.slice(0, 10)}</li>)}</ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {d.program.status === 'draft' && <Btn testId="publish-program" onClick={() => void act('publish')}>Publish</Btn>}
        {d.program.status === 'open' && <Btn kind="quiet" onClick={() => void act('pause')}>Pause</Btn>}
        {d.program.status === 'paused' && <Btn onClick={() => void act('resume')}>Resume</Btn>}
        {d.program.status !== 'closed' && <Btn kind="danger" onClick={() => void act('close')}>Close</Btn>}
      </div>
      <Notice text={error} />
    </div>
  );
}

function Programs({ desk, reload }: { desk: api.WorkforceDesk; reload: (msg: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <Section title="Programs" hint="Buy outcomes, not hours: each program pays a stated price per approved unit.">
      {desk.role === 'owner' && (creating
        ? <NewProgram desk={desk} onCreated={(m) => { setCreating(false); reload(m); }} />
        : <div><Btn testId="new-program-btn" onClick={() => setCreating(true)}>New program</Btn></div>)}
      {desk.programs.length === 0 && !creating && <Empty>No programs yet. {desk.role === 'owner' ? 'Create one to put work in front of your team.' : 'The owner creates programs.'}</Empty>}
      {desk.programs.map((p) => (
        <Card key={p.id} testId="program-card">
          <button type="button" className="w-full text-left" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-base font-black" style={strong}>{p.title}</p>
                <p className="text-xs" style={muted}>{p.templateLabel} · {modeLabel(p.mode)} · {p.audience === 'network' ? 'open network' : 'my workforce'} · due {p.deadline}</p>
              </div>
              <Pill tone={p.status === 'open' ? 'good' : p.status === 'closed' ? 'bad' : 'plain'}>{p.status}</Pill>
            </div>
            <Progress pct={p.progressPct} />
            <p className="text-xs mt-1" style={muted}>
              {p.counts.approved} of {p.target} approved · {p.counts.awaitingReview} in review · {p.counts.inProgress} in progress · {p.counts.rejected} rejected · {p.counts.notConverted} not converted · {kes(p.money.verifiedKes)} verified
            </p>
          </button>
          {open === p.id && <ProgramDetail id={p.id} onChanged={reload} />}
        </Card>
      ))}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// REVIEW (quality control)
// ---------------------------------------------------------------------------
function ReviewItem({ item, onDone }: { item: api.WorkReviewItem; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const decide = async (decision: 'approve' | 'return' | 'reject') => {
    setBusy(true);
    const r = await api.reviewWorkTask(item.taskId, decision, reason);
    setBusy(false);
    if (r.ok) onDone(decision === 'approve' ? `Approved — unit is ${r.data.unit.status.replace('_', ' ')}.` : decision === 'return' ? 'Returned to the worker for correction.' : 'Rejected.');
    else setError(r.error);
  };
  const p = item.proof;
  return (
    <Card testId="review-item">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-black" style={strong}>{item.stepLabel}{item.subjectBefore?.businessName ? ` — ${item.subjectBefore.businessName}` : p.fields.businessName ? ` — ${p.fields.businessName}` : ''}</p>
          <p className="text-xs" style={muted}>{item.programTitle} · step {item.stepIndex + 1}/{item.stepCount} · {modeLabel(item.mode)}{item.territory ? ` · ${item.territory}` : ''} · attempt {p.attempt}</p>
          <p className="text-xs mt-0.5" style={muted}>By {item.worker.name} — {item.worker.record}</p>
        </div>
        <Pill tone={p.flags ? 'bad' : 'good'}>{p.flags ? `${p.flags} flag${p.flags === 1 ? '' : 's'}` : 'clean'}</Pill>
      </div>
      <ul className="mt-2 grid gap-1">{p.checks.map((c) => <CheckRow key={c.key + c.label} check={c} />)}</ul>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {item.fields.filter((f) => p.fields[f.key] !== undefined).map((f) => (
          <React.Fragment key={f.key}><dt style={muted}>{f.label}</dt><dd style={strong}>{String(p.fields[f.key])}</dd></React.Fragment>
        ))}
      </dl>
      {p.photos.length > 0 && <div className="flex flex-wrap gap-2 mt-2">{p.photos.map((id) => <PrivatePhoto key={id} id={id} />)}</div>}
      {p.location && (
        <p className="text-xs mt-2" style={muted}>
          Location {p.location.lat.toFixed(5)}, {p.location.lng.toFixed(5)}{p.location.accuracyM !== null ? ` ±${p.location.accuracyM} m` : ''} ·{' '}
          <a href={`https://www.openstreetmap.org/?mlat=${p.location.lat}&mlon=${p.location.lng}#map=17/${p.location.lat}/${p.location.lng}`} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)' }}>open map</a>
        </p>
      )}
      {p.startedAt && <p className="text-xs mt-2" style={muted}>Device-reported start: {new Date(p.startedAt).toLocaleString()}{p.checkIn ? ` · ${p.checkIn.lat.toFixed(5)}, ${p.checkIn.lng.toFixed(5)}` : ' · remote'}. Submitted: {new Date(p.submittedAt).toLocaleString()}.</p>}
      {p.consent && <p className="text-xs mt-1" style={muted}>Consent given by {p.consent.name}{p.consent.words ? `: “${p.consent.words}”` : ''}</p>}
      {p.note && <p className="text-xs mt-1" style={strong}>Worker note: {p.note}</p>}
      {item.previous.length > 0 && <p className="text-xs mt-1" style={muted}>Earlier: {item.previous.map((r) => `${r.decision} — ${r.reason ?? ''}`).join('; ')}</p>}
      {item.ownSubmission ? <p className="text-xs mt-2" style={muted}>This is your own submission — someone else must review it.</p> : (
        <>
          <input aria-label="Reason" className={`${inputClass} mt-3`} style={inputStyle} placeholder="Reason (required to return or reject — the worker reads it)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex flex-wrap gap-2 mt-2">
            <Btn testId="approve-task" onClick={() => void decide('approve')} disabled={busy}>Approve</Btn>
            <Btn kind="quiet" onClick={() => void decide('return')} disabled={busy}>Return for correction</Btn>
            <Btn kind="danger" onClick={() => void decide('reject')} disabled={busy}>Reject</Btn>
          </div>
        </>
      )}
      <Notice text={error} />
    </Card>
  );
}

function Review({ desk, reload }: { desk: api.WorkforceDesk; reload: (msg: string) => void }) {
  const [queue, setQueue] = useState<api.WorkReviewItem[] | null>(null);
  const [error, setError] = useState('');
  const load = async () => { const r = await api.getWorkReviewQueue(desk.workforce.id); if (r.ok) setQueue(r.data); else setError(r.error); };
  useEffect(() => { void load(); }, [desk.workforce.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const cleanCount = (queue ?? []).filter((q) => q.proof.flags === 0 && !q.ownSubmission).length;
  const done = (m: string) => { void load(); reload(m); };
  return (
    <Section title="Quality control" hint="Automatic checks run on every submission; a person decides. Clean work is listed first.">
      <Notice text={error} />
      {queue && cleanCount > 0 && (
        <div><Btn testId="approve-clean" onClick={async () => { const r = await api.approveCleanWork(desk.workforce.id); if (r.ok) done(`Approved ${r.data.approved} clean submission${r.data.approved === 1 ? '' : 's'}.`); else setError(r.error); }}>Approve all clean ({cleanCount})</Btn></div>
      )}
      {queue && queue.length === 0 && <Empty>Nothing waiting for review.</Empty>}
      {queue?.map((item) => <ReviewItem key={item.taskId} item={item} onDone={done} />)}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// PEOPLE (HR) and TERRITORIES
// ---------------------------------------------------------------------------
function MemberCard({ m, desk, reload }: { m: api.WorkRosterMember; desk: api.WorkforceDesk; reload: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [terrs, setTerrs] = useState<string[]>(m.territoryIds);
  const [error, setError] = useState('');
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    const r = await api.workforceMemberAction(desk.workforce.id, m.memberId, { action, reason, ...extra });
    if (r.ok) { setReason(''); reload(`${m.name}: ${action.replace('_', ' ')} done.`); } else setError(r.error);
  };
  return (
    <Card testId="member-card">
      <button type="button" className="w-full text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-black" style={strong}>{m.name} {m.role === 'supervisor' && <span className="text-xs" style={muted}>· supervisor</span>}</p>
            <p className="text-xs" style={muted}>{m.phone ?? 'no phone yet'} · {m.modes.map(modeLabel).join(' + ') || 'no profile yet'} · {m.territories.join(', ') || 'no territory'}</p>
            <p className="text-xs" style={muted}>{m.record.byTemplate.map((r) => `${r.templateLabel}: ${r.statement}`).join(' | ') || 'No reviewed work yet'}</p>
          </div>
          <div className="text-right">
            <Pill tone={m.status === 'active' ? 'good' : m.status === 'suspended' ? 'bad' : m.onboarding.readyForActivation ? 'warn' : 'plain'}>
              {m.onboarding.readyForActivation ? 'ready to activate' : m.status}
            </Pill>
            <p className="text-xs mt-1" style={muted}>onboarding {m.onboarding.doneCount}/{m.onboarding.total}</p>
          </div>
        </div>
      </button>
      {open && (
        <div className="mt-3">
          <ul className="grid gap-1">
            {m.onboarding.items.map((i) => (
              <li key={i.key} className="text-xs flex gap-2"><span style={{ color: i.done ? 'var(--color-success)' : 'var(--color-text-muted)' }}>{i.done ? '✓' : '○'}</span><span><b style={strong}>{i.label}</b> <span style={muted}>— {i.detail}</span></span></li>
            ))}
          </ul>
          {desk.territories.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-bold" style={muted}>Territories</p>
              <div className="flex flex-wrap gap-2 mt-1">
                {desk.territories.map((t) => (
                  <label key={t.id} className="flex items-center gap-1 text-xs" style={strong}>
                    <input type="checkbox" checked={terrs.includes(t.id)} onChange={() => setTerrs((prev) => (prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id]))} />{t.name}
                  </label>
                ))}
              </div>
              <div className="mt-2"><Btn kind="quiet" onClick={() => void act('assign_territories', { territoryIds: terrs })}>Save territories</Btn></div>
            </div>
          )}
          <input aria-label="Reason" className={`${inputClass} mt-3`} style={inputStyle} placeholder="Reason (required to suspend or offboard)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex flex-wrap gap-2 mt-2">
            {m.status === 'applied' && <Btn testId="activate-member" onClick={() => void act('activate', { territoryIds: terrs })}>Activate</Btn>}
            {m.status === 'active' && <Btn kind="quiet" onClick={() => void act('suspend')}>Suspend</Btn>}
            {m.status === 'suspended' && <Btn onClick={() => void act('reinstate')}>Reinstate</Btn>}
            {desk.role === 'owner' && <Btn kind="quiet" onClick={() => void act('set_role', { role: m.role === 'supervisor' ? 'worker' : 'supervisor' })}>{m.role === 'supervisor' ? 'Make worker' : 'Make supervisor'}</Btn>}
            <Btn kind="danger" onClick={() => void act('offboard')}>Offboard</Btn>
          </div>
          {m.history.length > 0 && (
            <ul className="mt-3 grid gap-0.5">
              {m.history.slice().reverse().map((h, i) => <li key={i} className="text-xs" style={muted}>{h.at.slice(0, 10)} · {h.action.replace('_', ' ')}{h.note ? ` — ${h.note}` : ''}</li>)}
            </ul>
          )}
          <Notice text={error} />
        </div>
      )}
    </Card>
  );
}

function People({ desk, reload }: { desk: api.WorkforceDesk; reload: (msg: string) => void }) {
  return (
    <Section title="People" hint="Onboarding is a checklist each person completes on their phone. Activation is a human decision.">
      <Card>
        <p className="text-xs" style={muted}>Join code — share it with the people you want to onboard</p>
        <p className="text-2xl font-black tracking-widest" style={strong} data-testid="join-code">{desk.workforce.joinCode}</p>
        <p className="text-xs" style={muted}>{desk.counts.active} active · {desk.counts.applied} onboarding · {desk.counts.readyToActivate} ready to activate · {desk.counts.suspended} suspended</p>
      </Card>
      {desk.members.length === 0 ? <Empty>No one has joined yet. Share the code above.</Empty> : desk.members.map((m) => <MemberCard key={m.memberId} m={m} desk={desk} reload={reload} />)}
    </Section>
  );
}

function Territories({ desk, reload }: { desk: api.WorkforceDesk; reload: (msg: string) => void }) {
  const [name, setName] = useState('');
  const [areas, setAreas] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState('');
  const [error, setError] = useState('');
  const here = () => navigator.geolocation?.getCurrentPosition((p) => { setLat(p.coords.latitude.toFixed(5)); setLng(p.coords.longitude.toFixed(5)); if (!radius) setRadius('3'); }, () => setError('Could not read this device\'s location.'));
  const create = async () => {
    const geo = lat && lng && radius ? { lat: Number(lat), lng: Number(lng), radiusKm: Number(radius) } : {};
    const r = await api.createWorkTerritory(desk.workforce.id, { name, areas: areas.split(',').map((s) => s.trim()).filter(Boolean), ...geo });
    if (r.ok) { setName(''); setAreas(''); setLat(''); setLng(''); setRadius(''); reload(`Territory ${r.data.name} created.`); } else setError(r.error);
  };
  return (
    <Section title="Territories" hint="Where field work happens. With a map centre and radius, every field submission's location is checked against it.">
      {desk.territories.map((t) => (
        <Card key={t.id}>
          <p className="text-sm font-black" style={strong}>{t.name}</p>
          <p className="text-xs" style={muted}>
            {t.areas.join(', ') || 'no named areas'} · {t.center ? `${t.radiusKm} km around ${t.center.lat.toFixed(3)}, ${t.center.lng.toFixed(3)}` : 'no map area — locations recorded, not checked'}
          </p>
          <p className="text-xs" style={muted}>{t.members} active worker{t.members === 1 ? '' : 's'} · {t.approved} approved · {t.inProgress} in progress</p>
        </Card>
      ))}
      <Card testId="new-territory">
        <p className="text-sm font-black" style={strong}>New territory</p>
        <Field label="Name"><input className={inputClass} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nairobi West" /></Field>
        <Field label="Areas inside it" hint="Comma-separated"><input className={inputClass} style={inputStyle} value={areas} onChange={(e) => setAreas(e.target.value)} placeholder="South C, Madaraka, Langata" /></Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Centre latitude"><input className={inputClass} style={inputStyle} value={lat} onChange={(e) => setLat(e.target.value)} /></Field>
          <Field label="Centre longitude"><input className={inputClass} style={inputStyle} value={lng} onChange={(e) => setLng(e.target.value)} /></Field>
          <Field label="Radius (km)"><input className={inputClass} style={inputStyle} value={radius} onChange={(e) => setRadius(e.target.value)} /></Field>
        </div>
        <div className="flex gap-2 mt-3">
          <Btn kind="quiet" onClick={here}>Use my location as centre</Btn>
          <Btn testId="create-territory" onClick={() => void create()}>Create territory</Btn>
        </div>
        <Notice text={error} />
      </Card>
    </Section>
  );
}

// ---------------------------------------------------------------------------
export function OrgView() {
  const [signedOut, setSignedOut] = useState(false);
  const [list, setList] = useState<api.WorkMembership[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [desk, setDesk] = useState<api.WorkforceDesk | null>(null);
  const [tab, setTab] = useState<Tab>('programs');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const loadList = async (pick?: string) => {
    const r = await api.listMyWorkforces();
    if (!r.ok) { setSignedOut(r.status === 401); setError(r.status === 401 ? 'Sign in to manage a workforce.' : r.error); return; }
    setSignedOut(false); setError('');
    const managed = r.data.filter((w) => w.role === 'owner' || (w.role === 'supervisor' && w.status === 'active'));
    setList(managed);
    setSelected(pick ?? selected ?? managed[0]?.id ?? null);
  };
  const deskRead = useRef(0);
  const loadDesk = async (id: string) => { const n = ++deskRead.current; const r = await api.getWorkforceDesk(id); if (n !== deskRead.current) return; if (r.ok) setDesk(r.data); else setError(r.error); };
  useEffect(() => { void loadList(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (selected) void loadDesk(selected); }, [selected]);
  const reload = (m: string) => { setMsg(m); setError(''); if (selected) void loadDesk(selected); };

  if (signedOut) return <SessionSignIn title="Sign in to manage a workforce" onSignedIn={() => void loadList()} />;
  if (!list) return error ? <Empty>{error}</Empty> : <p className="text-sm mt-6" style={muted}>Reading your workforces…</p>;

  return (
    <div data-testid="org-view">
      {list.length > 1 && (
        <div className="flex flex-wrap gap-2 mt-4">
          {list.map((w) => (
            <button key={w.id} type="button" onClick={() => { deskRead.current++; setDesk(null); setError(''); setSelected(w.id); }} className="rounded-full px-3 py-1.5 text-xs font-bold"
              style={selected === w.id ? { background: 'var(--color-primary)', color: 'var(--accent-ink)' } : { background: 'var(--color-surface-elevated)', color: 'var(--color-text)' }}>{w.name}</button>
          ))}
        </div>
      )}
      {list.length === 0 && <div className="mt-4"><CreateWorkforce onCreated={(id) => void loadList(id)} /></div>}
      <Notice text={msg} tone="good" />
      <Notice text={error} />
      {desk && (
        <>
          <div className="mt-4">
            <h2 className="text-xl font-black" style={strong}>{desk.workforce.name}</h2>
            <p className="text-xs" style={muted}>You are the {desk.role}. {desk.counts.active} active · {desk.counts.awaitingReview} awaiting review · {desk.territories.length} territor{desk.territories.length === 1 ? 'y' : 'ies'}</p>
          </div>
          <div role="tablist" aria-label="Workforce sections" className="flex gap-1 mt-3 overflow-x-auto">
            {([['programs', 'Programs'], ['review', `Review${desk.counts.awaitingReview ? ` (${desk.counts.awaitingReview})` : ''}`], ['people', 'People'], ['territories', 'Territories']] as Array<[Tab, string]>).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} className="rounded-full px-3 py-1.5 text-sm font-bold whitespace-nowrap"
                style={tab === k ? { background: 'var(--color-text)', color: 'var(--color-surface)' } : { background: 'transparent', color: 'var(--color-text-muted)' }}>{label}</button>
            ))}
          </div>
          {tab === 'programs' && <Programs key={desk.workforce.id} desk={desk} reload={reload} />}
          {tab === 'review' && <Review key={desk.workforce.id} desk={desk} reload={reload} />}
          {tab === 'people' && <People key={desk.workforce.id} desk={desk} reload={reload} />}
          {tab === 'territories' && <Territories key={desk.workforce.id} desk={desk} reload={reload} />}
        </>
      )}
      {list.length > 0 && (
        <details className="mt-8">
          <summary className="text-xs font-bold cursor-pointer" style={muted}>Start another workforce</summary>
          <div className="mt-2"><CreateWorkforce onCreated={(id) => void loadList(id)} /></div>
        </details>
      )}
      {list.length > 0 && !desk && !error && <p className="text-sm mt-6" style={muted}>Opening the desk…</p>}
    </div>
  );
}
