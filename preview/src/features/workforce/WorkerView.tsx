// THE WORKER'S HOME — "Good morning, Jane". Everything a worker needs from a
// phone, with no office to visit: set up a profile, accept the terms, join a
// workforce with a code, follow the onboarding checklist, read briefings, take
// work that explains why it is shown, submit proof, and see earnings that are
// derived from reviewed rows — never a counter.
import React, { useEffect, useMemo, useState } from 'react';
import * as api from '../../api/briefApi';
import { TaskRunner } from './TaskRunner';
import { Btn, Card, Empty, Field, Notice, Pill, Section, Stat, inputClass, inputStyle, kes, modeLabel, muted, strong } from './ui';

type Load = { kind: 'loading' } | { kind: 'error'; message: string; status: number | null } | { kind: 'ready'; home: api.WorkerHome };

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ProfileForm({ profile, onSaved }: { profile: api.WorkerProfile | null; onSaved: () => void }) {
  const [name, setName] = useState(profile?.displayName ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [modes, setModes] = useState<api.WorkMode[]>(profile?.modes ?? []);
  const [gps, setGps] = useState(profile?.device?.gps ?? false);
  const [areas, setAreas] = useState((profile?.areas ?? []).join(', '));
  const [days, setDays] = useState<number[]>(profile?.availableDays ?? [1, 2, 3, 4, 5]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const save = async () => {
    setBusy(true);
    const r = await api.saveWorkerProfile({
      displayName: name, phone, modes, device: { smartphone: true, gps },
      areas: areas.split(',').map((s) => s.trim()).filter(Boolean), availableDays: days
    });
    setBusy(false);
    if (r.ok) { setError(''); onSaved(); } else setError(r.error);
  };
  return (
    <Card testId="worker-profile-form">
      <h3 className="text-base font-black" style={strong}>{profile ? 'Your worker profile' : 'Set up your worker profile'}</h3>
      <p className="text-xs mt-1" style={muted}>One profile, used by every workforce you join. Supervisors see your name, phone and how you work.</p>
      <Field label="Your name"><input className={inputClass} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Mobile number"><input className={inputClass} style={inputStyle} inputMode="tel" placeholder="07…" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      <Field label="How you work">
        <div className="flex gap-3 text-sm" style={strong}>
          {(['home', 'field'] as api.WorkMode[]).map((m) => (
            <label key={m} className="flex items-center gap-1.5">
              <input type="checkbox" checked={modes.includes(m)} onChange={() => setModes(toggle(modes, m))} />
              {m === 'home' ? 'From home (calls, research)' : 'In the field (visits)'}
            </label>
          ))}
        </div>
      </Field>
      <label className="flex items-center gap-2 mt-3 text-sm" style={strong}>
        <input type="checkbox" checked={gps} onChange={(e) => setGps(e.target.checked)} /> My phone can share its location (GPS)
      </label>
      <Field label="Areas you know" hint="Comma-separated, e.g. South C, Madaraka. Used for open-network work.">
        <input className={inputClass} style={inputStyle} value={areas} onChange={(e) => setAreas(e.target.value)} />
      </Field>
      <Field label="Days you are usually available">
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d, i) => (
            <button key={d} type="button" aria-pressed={days.includes(i)} onClick={() => setDays(toggle(days, i))}
              className="rounded-full px-3 py-1 text-xs font-bold"
              style={days.includes(i) ? { background: 'var(--color-primary)', color: 'var(--accent-ink)' } : { background: 'var(--color-surface-elevated)', color: 'var(--color-text)' }}>{d}</button>
          ))}
        </div>
      </Field>
      <Notice text={error} />
      <div className="mt-4"><Btn testId="save-worker-profile" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</Btn></div>
    </Card>
  );
}

function TermsCard({ terms, onAccepted }: { terms: api.WorkTerms; onAccepted: () => void }) {
  const [error, setError] = useState('');
  return (
    <Card testId="work-terms">
      <h3 className="text-base font-black" style={strong}>Independent-work terms</h3>
      <ul className="mt-2 grid gap-1.5 text-sm list-disc pl-5" style={strong}>
        {terms.lines.map((l) => <li key={l}>{l}</li>)}
      </ul>
      <p className="text-xs mt-2" style={muted}>Version {terms.version}</p>
      <Notice text={error} />
      <div className="mt-3">
        <Btn testId="accept-terms" onClick={async () => { const r = await api.acceptWorkTerms(terms.version); if (r.ok) onAccepted(); else setError(r.error); }}>I accept these terms</Btn>
      </div>
    </Card>
  );
}

function Briefing({ template, briefed, onAcknowledged, onClose }: { template: api.WorkTemplate; briefed: boolean; onAcknowledged: () => void; onClose: () => void }) {
  const [error, setError] = useState('');
  return (
    <Card testId="work-briefing">
      <div className="flex justify-between gap-3">
        <div>
          <p className="text-xs" style={muted}>Briefing · {modeLabel(template.mode)}</p>
          <h3 className="text-lg font-black" style={strong}>{template.label}</h3>
        </div>
        <button type="button" className="text-sm font-bold" style={muted} onClick={onClose}>Close</button>
      </div>
      <p className="text-sm mt-1" style={strong}>{template.summary}</p>
      <ol className="mt-3 grid gap-3">
        {template.steps.map((s) => (
          <li key={s.key} className="rounded-xl p-3" style={{ background: 'var(--color-surface-elevated)' }}>
            <p className="text-sm font-black" style={strong}>{s.index + 1}. {s.label} <span className="font-normal" style={muted}>· {modeLabel(s.mode)} · {s.hours} h to submit</span></p>
            <p className="text-sm mt-1" style={strong}>{s.brief}</p>
            <p className="text-xs mt-1" style={muted}>
              Evidence: {s.fields.filter((f) => f.required).map((f) => f.label.toLowerCase()).join(', ')}
              {s.photosMin ? `; ${s.photosMin} photo${s.photosMin === 1 ? '' : 's'}` : ''}{s.gps ? '; your location' : ''}{s.consent ? '; recorded consent' : ''}.
            </p>
            {s.gate && <p className="text-xs mt-1" style={muted}>If the answer to “{s.fields.find((f) => f.key === s.gate!.field)?.label}” is not “{s.gate.equals}”, the {template.unitNoun} closes: {s.gate.closedAs.toLowerCase()}.</p>}
          </li>
        ))}
      </ol>
      <p className="text-xs mt-3" style={muted}>Reading this records that you were briefed. It is not a certificate, and it is never shown as one.</p>
      <Notice text={error} />
      <div className="mt-3">
        {briefed ? <Pill tone="good">You have read this briefing</Pill> : (
          <Btn testId="ack-briefing" onClick={async () => { const r = await api.acknowledgeWorkBriefing(template.key); if (r.ok) onAcknowledged(); else setError(r.error); }}>I have read how this is done</Btn>
        )}
      </div>
    </Card>
  );
}

function AvailableCard({ a, onClaimed, onBrief }: { a: api.WorkAvailable; onClaimed: (msg: string) => void; onBrief: (templateKey: string) => void }) {
  const [count, setCount] = useState(1);
  const [territoryId, setTerritoryId] = useState<string>(a.territories[0]?.id ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useMemo(() => `${a.program.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`, [a.program.id]);
  const needsBriefing = a.blockers.some((b) => b.includes('briefing'));
  const claim = async () => {
    setBusy(true);
    const r = await api.claimWork(a.program.id, { count, territoryId: territoryId || null, idempotencyKey: key });
    setBusy(false);
    if (r.ok) onClaimed(`Took ${r.data.length} ${a.program.unitNoun}${r.data.length === 1 ? '' : 's'}. They are in “Your tasks”.`);
    else setError(r.error);
  };
  return (
    <Card testId="available-work">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-black" style={strong}>{a.program.title}</h3>
          <p className="text-xs" style={muted}>{a.program.workforceName} · {a.program.templateLabel} · {modeLabel(a.program.mode)} · due {a.program.deadline}</p>
        </div>
        <div className="text-right">
          <div className="text-base font-black" style={strong}>{kes(a.firstStep.feeKes)}</div>
          <div className="text-xs" style={muted}>per approved {a.program.unitNoun}</div>
        </div>
      </div>
      <p className="text-sm mt-2" style={strong}>{a.firstStep.label} · {modeLabel(a.firstStep.mode)} · ~{a.firstStep.hours} h window · {a.remaining} left</p>
      {a.program.objective && <p className="text-xs mt-1" style={muted}>{a.program.objective}</p>}
      <ul className="mt-2 grid gap-0.5 text-xs">
        {a.reasons.map((r) => <li key={r} style={{ color: 'var(--color-success)' }}>✓ {r}</li>)}
        {a.blockers.map((b) => <li key={b} style={{ color: 'var(--color-danger)' }}>✗ {b}</li>)}
      </ul>
      {a.eligible ? (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <label className="text-xs" style={muted}>How many
            <select className="ml-1 rounded-lg px-2 py-1 text-sm" style={inputStyle} value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {Array.from({ length: Math.min(10, a.remaining) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          {a.territories.length > 1 && (
            <label className="text-xs" style={muted}>Where
              <select className="ml-1 rounded-lg px-2 py-1 text-sm" style={inputStyle} value={territoryId} onChange={(e) => setTerritoryId(e.target.value)}>
                {a.territories.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.remaining} left)</option>)}
              </select>
            </label>
          )}
          <Btn testId="claim-work" onClick={() => void claim()} disabled={busy}>{busy ? 'Taking…' : 'Accept'}</Btn>
        </div>
      ) : needsBriefing ? (
        <div className="mt-3"><Btn kind="quiet" onClick={() => onBrief(a.program.templateKey)}>Read the briefing</Btn></div>
      ) : null}
      <Notice text={error} />
    </Card>
  );
}

function TaskLine({ t, action }: { t: api.WorkTaskView; action?: React.ReactNode }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black" style={strong}>{t.step.label}{t.subjectLabel ? ` — ${t.subjectLabel}` : ''}</p>
          <p className="text-xs" style={muted}>{t.program.title} · {modeLabel(t.step.mode)}{t.territory?.name ? ` · ${t.territory.name}` : ''} · {kes(t.feeKes)}</p>
          {t.lastReview && t.lastReview.decision !== 'approve' && (
            <p className="text-xs mt-1" style={{ color: 'var(--color-danger)' }}>{t.lastReview.decision === 'return' ? 'Returned' : 'Rejected'}: {t.lastReview.reason}</p>
          )}
          {t.reasons && <p className="text-xs mt-1" style={{ color: 'var(--color-success)' }}>{t.reasons.map((r) => `✓ ${r}`).join('  ')}</p>}
        </div>
        <div className="flex flex-col items-end gap-1">
          <Pill tone={t.status === 'approved' ? 'good' : t.status === 'rejected' ? 'bad' : t.returns ? 'warn' : 'plain'}>
            {t.status === 'assigned' && t.returns ? 'needs correction' : t.status}
          </Pill>
          {action}
        </div>
      </div>
    </Card>
  );
}

export function WorkerView() {
  const [state, setState] = useState<Load>({ kind: 'loading' });
  const [templates, setTemplates] = useState<api.WorkTemplate[]>([]);
  const [running, setRunning] = useState<api.WorkTaskView | null>(null);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [editProfile, setEditProfile] = useState(false);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = async () => {
    const [home, tpl] = await Promise.all([api.getWorkerHome(), api.getWorkTemplates()]);
    if (tpl.ok) setTemplates(tpl.data.templates);
    if (home.ok) setState({ kind: 'ready', home: home.data });
    else setState({ kind: 'error', message: home.error, status: home.status });
  };
  useEffect(() => { void load(); }, []);

  if (state.kind === 'loading') return <p className="text-sm mt-6" style={muted}>Reading your work…</p>;
  if (state.kind === 'error') {
    return <Empty>{state.status === 401 ? 'Sign in to see your work.' : state.message}</Empty>;
  }
  const h = state.home;
  const profile = h.profile;
  const termsOk = profile?.termsAcceptedVersion === h.terms.version;
  const briefed = new Set((profile?.briefings ?? []).map((b) => b.templateKey));
  const done = (m: string) => { setMsg(m); setErr(''); setRunning(null); void load(); };
  const ready = h.available.filter((a) => a.eligible);
  const blocked = h.available.filter((a) => !a.eligible);
  const tpl = templates.find((t) => t.key === briefing);

  if (running) return <div className="mt-4"><TaskRunner task={running} onDone={done} onClose={() => setRunning(null)} /></div>;

  return (
    <div data-testid="worker-view">
      <div className="mt-4">
        <h2 className="text-xl font-black" style={strong}>{profile ? `Hello, ${profile.displayName.split(' ')[0]}` : 'Work from your phone'}</h2>
        <p className="text-sm" style={muted}>Take tasks, submit proof, get paid a stated flat fee for approved work. No office visit needed.</p>
      </div>
      <Notice text={msg} tone="good" />
      <Notice text={err} />

      {(!profile || editProfile) && <div className="mt-4"><ProfileForm profile={profile} onSaved={() => { setEditProfile(false); done('Profile saved.'); }} /></div>}
      {profile && !termsOk && <div className="mt-4"><TermsCard terms={h.terms} onAccepted={() => done('Terms accepted.')} /></div>}
      {tpl && <div className="mt-4"><Briefing template={tpl} briefed={briefed.has(tpl.key)} onAcknowledged={() => { setBriefing(null); done(`Briefed on ${tpl.label.toLowerCase()}.`); }} onClose={() => setBriefing(null)} /></div>}

      {profile && (
        <Card className="mt-4">
          <div className="grid grid-cols-4 gap-2">
            <Stat value={h.today.submitted} label="submitted today" />
            <Stat value={h.today.approved} label="approved today" />
            <Stat value={h.today.inReview} label="in review" />
            <Stat value={kes(h.today.earnedKes)} label="earned today" />
          </div>
        </Card>
      )}

      {h.held.length > 0 && (
        <Section title="Your tasks" hint={`You can hold up to ${h.limits.maxHeld} at once. Unsubmitted tasks return to the pool when their window ends.`}>
          {h.held.map((t) => <TaskLine key={t.id} t={t} action={<Btn testId="open-task" onClick={() => setRunning(t)}>{t.returns ? 'Correct' : 'Start'}</Btn>} />)}
        </Section>
      )}

      {h.openSteps.length > 0 && (
        <Section title="Next steps near you" hint="The earlier step was approved; this one is waiting for someone.">
          {h.openSteps.map((t) => (
            <TaskLine key={t.id} t={t} action={<Btn onClick={async () => { const r = await api.acceptWorkTask(t.id); if (r.ok) setRunning(r.data); else setErr(r.error); }}>Accept</Btn>} />
          ))}
        </Section>
      )}

      <Section title="Available for you">
        {ready.length ? ready.map((a) => <AvailableCard key={a.program.id} a={a} onClaimed={done} onBrief={setBriefing} />) : <Empty>No work you can take right now. Work appears here when a workforce you belong to publishes a program.</Empty>}
      </Section>

      {blocked.length > 0 && (
        <Section title="Needs a step first" hint="Each card says exactly what is missing.">
          {blocked.map((a) => <AvailableCard key={a.program.id} a={a} onClaimed={done} onBrief={setBriefing} />)}
        </Section>
      )}

      <Section title="Your workforces">
        {h.memberships.map((m) => (
          <Card key={m.id} testId="membership">
            <div className="flex justify-between">
              <p className="text-sm font-black" style={strong}>{m.name}</p>
              <Pill tone={m.status === 'active' ? 'good' : m.status === 'suspended' ? 'bad' : 'plain'}>{m.role} · {m.status}</Pill>
            </div>
            {m.onboarding && (
              <ul className="mt-2 grid gap-1">
                {m.onboarding.items.map((i) => (
                  <li key={i.key} className="text-xs flex gap-2">
                    <span style={{ color: i.done ? 'var(--color-success)' : 'var(--color-text-muted)' }}>{i.done ? '✓' : '○'}</span>
                    <span><b style={strong}>{i.label}</b> <span style={muted}>— {i.detail}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
        <Card>
          <p className="text-sm font-black" style={strong}>Join a workforce</p>
          <p className="text-xs" style={muted}>Your organisation or supervisor gives you an 8-letter code.</p>
          <div className="flex gap-2 mt-2">
            <input aria-label="Workforce code" className={inputClass} style={inputStyle} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD2345" />
            <Btn testId="join-workforce" onClick={async () => { const r = await api.joinWorkforce(code); if (r.ok) { setCode(''); done('Joined. Follow the checklist to be activated.'); } else setErr(r.error); }}>Join</Btn>
          </div>
        </Card>
      </Section>

      {templates.length > 0 && profile && (
        <Section title="Task briefings" hint="Read how a task type is done before taking it.">
          <div className="flex flex-wrap gap-2">
            {templates.map((t) => (
              <button key={t.key} type="button" onClick={() => setBriefing(t.key)} className="rounded-full px-3 py-1.5 text-xs font-bold"
                style={{ background: 'var(--color-surface-elevated)', color: 'var(--color-text)' }}>
                {briefed.has(t.key) ? '✓ ' : ''}{t.label}
              </button>
            ))}
          </div>
        </Section>
      )}

      {h.inReview.length > 0 && <Section title="Waiting for review">{h.inReview.map((t) => <TaskLine key={t.id} t={t} />)}</Section>}
      {h.recent.length > 0 && <Section title="Recently decided">{h.recent.map((t) => <TaskLine key={t.id} t={t} />)}</Section>}

      <Section title="Earnings" hint={h.earnings.note}>
        <Card>
          <div className="grid grid-cols-3 gap-2">
            <Stat value={kes(h.earnings.payableKes)} label="approved outcomes" />
            <Stat value={kes(h.earnings.awaitingOutcomeKes)} label="waiting for the outcome" />
            <Stat value={kes(h.earnings.confirmedKes)} label="confirmed by finance" />
          </div>
          {h.earnings.weeks.length > 0 && (
            <ul className="mt-3 grid gap-1 text-xs">
              {h.earnings.weeks.map((w) => (
                <li key={w.week} className="flex justify-between" style={strong}>
                  <span>{w.week} · {w.tasks} task{w.tasks === 1 ? '' : 's'}</span>
                  <span>{kes(w.kes)} {w.settlements.length ? `· ${w.settlements.map((s) => s.status).join(', ')}` : w.unsettledTasks ? '· not yet settled' : ''}</span>
                </li>
              ))}
            </ul>
          )}
          {h.earnings.rows.some((r) => r.state === 'outcome_failed') && (
            <p className="text-xs mt-2" style={muted}>
              {h.earnings.rows.filter((r) => r.state === 'outcome_failed').length} approved step(s) earned nothing because the {h.earnings.rows.find((r) => r.state === 'outcome_failed')?.closedReason ? 'unit closed' : 'outcome did not happen'} — shown so the number is checkable.
            </p>
          )}
        </Card>
      </Section>

      <Section title="Your record" hint={h.record.note}>
        {h.record.byTemplate.length ? h.record.byTemplate.map((r) => (
          <Card key={r.templateKey}><p className="text-sm font-black" style={strong}>{r.templateLabel}</p><p className="text-xs" style={muted}>{r.statement}</p></Card>
        )) : <Empty>No reviewed work yet. Your record starts with your first submission.</Empty>}
      </Section>

      {profile && !editProfile && <div className="mt-6"><Btn kind="quiet" onClick={() => setEditProfile(true)}>Edit worker profile</Btn></div>}
    </div>
  );
}
