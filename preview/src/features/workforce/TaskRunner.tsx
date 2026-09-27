// TASK RUNNER — the phone as the field instrument. One held task: the brief,
// what is already known about the subject, then the evidence the step asks
// for (answers, photos, location, consent). The server validates everything
// again and runs the automatic checks; this form only helps get it right the
// first time. Nothing is submitted without the worker pressing Submit.
import React, { useEffect, useRef, useState } from 'react';
import * as api from '../../api/briefApi';
import { Btn, Card, CheckRow, Field, Notice, Pill, inputClass, inputStyle, kes, modeLabel, muted, strong } from './ui';

type Loc = { lat: number; lng: number; accuracyM: number | null };

export function TaskRunner({ task, onDone, onClose }: { task: api.WorkTaskView; onDone: (msg: string) => void; onClose: () => void }) {
  const step = task.step;
  const [values, setValues] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Array<{ id: string; preview: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [loc, setLoc] = useState<Loc | null>(null);
  const [locMsg, setLocMsg] = useState('');
  const [consentName, setConsentName] = useState('');
  const [consentWords, setConsentWords] = useState('');
  const [consentGiven, setConsentGiven] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError('');
    for (const file of Array.from(files).slice(0, 8 - photos.length)) {
      const r = await api.uploadMediaFile(file, { purpose: 'private_work', alt: `${task.program.title} — ${step.label}` });
      if (r.ok) setPhotos((prev) => (prev.some((p) => p.id === r.data.upload.id) ? prev : [...prev, { id: r.data.upload.id, preview: URL.createObjectURL(file) }]));
      else setError(r.error);
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const captureLocation = () => {
    if (!('geolocation' in navigator)) { setLocMsg('This phone does not share location with the browser.'); return; }
    setLocMsg('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null });
        setLocMsg('');
      },
      (err) => setLocMsg(err.code === 1 ? 'Location permission was refused. Allow location for this site and try again.' : 'Could not get a location fix. Step outside or wait a moment, then retry.'),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    const r = await api.submitWorkProof(task.id, {
      fields: values,
      photos: photos.map((p) => p.id),
      location: loc,
      consent: step.consent ? { given: consentGiven, name: consentName, words: consentWords } : null,
      note
    });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    const flags = r.data.proof.flags;
    onDone(flags ? `Submitted — ${flags} thing${flags === 1 ? '' : 's'} flagged for the reviewer to look at.` : 'Submitted. All automatic checks passed; a reviewer will decide.');
  };

  const release = async () => {
    setBusy(true);
    const r = await api.releaseWorkTask(task.id, 'Released from the task screen');
    setBusy(false);
    if (r.ok) onDone('Released — the task went back to the pool.');
    else setError(r.error);
  };

  const subjectEntries = Object.entries(task.subject ?? {});

  return (
    <Card testId="task-runner">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs" style={muted}>{task.program.title} · step {task.stepIndex + 1} of {task.stepCount} · {modeLabel(step.mode)}</p>
          <h3 className="text-lg font-black" style={strong}>{step.label}</h3>
        </div>
        <button type="button" onClick={onClose} className="text-sm font-bold" style={muted} aria-label="Close task">Close</button>
      </div>
      <p className="text-sm mt-2" style={strong}>{step.brief}</p>
      <p className="text-xs mt-2" style={muted}>
        You earn <b>{kes(task.feeKes)}</b> for this step once the {task.program.unitNoun} is approved.
        {task.dueAt ? ` Submit before ${new Date(task.dueAt).toLocaleString()}.` : ''}
        {task.territory?.name ? ` Territory: ${task.territory.name}.` : ''}
      </p>

      {task.lastReview?.decision === 'return' && (
        <div className="mt-3 rounded-xl p-3" style={{ background: 'var(--color-surface-elevated)' }}>
          <p className="text-xs font-bold" style={{ color: 'var(--color-danger)' }}>Returned for correction</p>
          <p className="text-sm" style={strong}>{task.lastReview.reason}</p>
        </div>
      )}

      {subjectEntries.length > 0 && (
        <div className="mt-3 rounded-xl p-3" style={{ background: 'var(--color-surface-elevated)' }}>
          <p className="text-xs font-bold" style={muted}>Already recorded about this {task.program.unitNoun}</p>
          <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {subjectEntries.map(([k, v]) => (
              <React.Fragment key={k}><dt style={muted}>{k}</dt><dd style={strong}>{String(v)}</dd></React.Fragment>
            ))}
          </dl>
          {typeof task.subject?.phone === 'string' && (
            <a className="inline-block mt-2 text-sm font-bold" style={{ color: 'var(--color-primary)' }} href={`tel:${task.subject.phone}`}>Call {task.subject.phone}</a>
          )}
        </div>
      )}

      {step.fields.map((f) => (
        <Field key={f.key} label={`${f.label}${f.required ? '' : ' (optional)'}`}>
          {f.kind === 'yesno' ? (
            <div className="flex gap-2">
              {['yes', 'no'].map((v) => (
                <button key={v} type="button" onClick={() => set(f.key, v)} aria-pressed={values[f.key] === v}
                  className="rounded-full px-4 py-1.5 text-sm font-bold"
                  style={values[f.key] === v ? { background: 'var(--color-primary)', color: 'var(--accent-ink)' } : { background: 'var(--color-surface-elevated)', color: 'var(--color-text)' }}>
                  {v === 'yes' ? 'Yes' : 'No'}
                </button>
              ))}
            </div>
          ) : (
            <input className={inputClass} style={inputStyle} value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}
              inputMode={f.kind === 'phone' ? 'tel' : f.kind === 'number' ? 'decimal' : 'text'}
              placeholder={f.kind === 'phone' ? '07…' : ''} />
          )}
        </Field>
      ))}

      {step.photosMin > 0 && (
        <Field label={`Photos — at least ${step.photosMin}`} hint="Taken now, by you. A photo can prove one thing only; reusing it on other work is refused.">
          <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple onChange={(e) => void addPhotos(e.target.files)} />
          <div className="flex flex-wrap gap-2 mt-2">
            {photos.map((p) => (
              <div key={p.id} className="relative">
                <img src={p.preview} alt="" className="h-20 w-20 rounded-xl object-cover" />
                <button type="button" aria-label="Remove photo" onClick={() => setPhotos((prev) => prev.filter((x) => x.id !== p.id))}
                  className="absolute -top-1 -right-1 rounded-full h-5 w-5 text-xs font-black" style={{ background: 'var(--color-surface)', color: 'var(--color-danger)' }}>×</button>
              </div>
            ))}
          </div>
          {uploading && <p className="text-xs" style={muted}>Uploading…</p>}
        </Field>
      )}

      {step.gps && (
        <Field label="Your location" hint="Captured while you are at the place. It is checked against the territory.">
          <div className="flex items-center gap-3">
            <Btn kind="quiet" onClick={captureLocation}>{loc ? 'Capture again' : 'Capture location'}</Btn>
            {loc && <span className="text-xs" style={strong}>{loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}{loc.accuracyM !== null ? ` · ±${loc.accuracyM} m` : ''}</span>}
          </div>
          {locMsg && <p className="text-xs mt-1" style={muted}>{locMsg}</p>}
        </Field>
      )}

      {step.consent && (
        <Field label="Consent" hint="Ask first. Record the person's name and what they agreed to, in their words.">
          <input className={inputClass} style={inputStyle} placeholder="Name of the person consenting" value={consentName} onChange={(e) => setConsentName(e.target.value)} />
          <input className={`${inputClass} mt-2`} style={inputStyle} placeholder="What they said (optional)" value={consentWords} onChange={(e) => setConsentWords(e.target.value)} />
          <label className="flex items-center gap-2 mt-2 text-sm" style={strong}>
            <input type="checkbox" checked={consentGiven} onChange={(e) => setConsentGiven(e.target.checked)} /> They agreed
          </label>
        </Field>
      )}

      <Field label="Note for the reviewer (optional)">
        <textarea className={inputClass} style={inputStyle} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>

      {task.lastProof?.checks?.length ? (
        <div className="mt-3">
          <p className="text-xs font-bold" style={muted}>Checks on your last attempt</p>
          <ul className="mt-1 grid gap-1">{task.lastProof.checks.map((c) => <CheckRow key={c.key + c.label} check={c} />)}</ul>
        </div>
      ) : null}

      <Notice text={error} />
      <div className="flex flex-wrap gap-2 mt-4">
        <Btn testId="submit-proof" onClick={() => void submit()} disabled={busy || uploading}>{busy ? 'Submitting…' : 'Submit for review'}</Btn>
        <Btn kind="quiet" onClick={() => void release()} disabled={busy}>Release task</Btn>
        {step.gate && <Pill>{`If "${step.gate.equals}" is not the answer, the ${task.program.unitNoun} closes honestly as not converted`}</Pill>}
      </div>
    </Card>
  );
}
