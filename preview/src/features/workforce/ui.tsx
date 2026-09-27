// Small shared pieces for the Workforce surfaces. Quiet on purpose: text,
// hairlines and the app's colour variables — no badges, no vanity counters.
import React, { useEffect, useState } from 'react';
import * as api from '../../api/briefApi';

export const muted = { color: 'var(--color-text-muted)' } as const;
export const strong = { color: 'var(--color-text)' } as const;

export const kes = (n: number) => `KES ${Math.round(n).toLocaleString('en-KE')}`;

export function Card({ children, testId, className = '' }: { children: React.ReactNode; testId?: string; className?: string }) {
  return (
    <div
      data-testid={testId}
      className={`rounded-2xl p-4 ${className}`}
      style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
    >
      {children}
    </div>
  );
}

export function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="mt-6">
      <h2 className="text-xs font-black uppercase tracking-wider" style={muted}>{title}</h2>
      {hint && <p className="text-xs mt-1" style={muted}>{hint}</p>}
      <div className="mt-2 grid gap-3">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed p-5 text-center text-sm" style={{ borderColor: 'var(--color-border)', ...muted }}>
      {children}
    </div>
  );
}

export function Btn({
  children, onClick, kind = 'primary', disabled, testId, type = 'button'
}: {
  children: React.ReactNode; onClick?: () => void; kind?: 'primary' | 'quiet' | 'danger';
  disabled?: boolean; testId?: string; type?: 'button' | 'submit';
}) {
  const style =
    kind === 'primary'
      ? { background: 'var(--color-primary)', color: 'var(--accent-ink)' }
      : kind === 'danger'
        ? { background: 'transparent', color: 'var(--color-danger)', border: '1px solid var(--color-danger)' }
        : { background: 'var(--color-surface-elevated)', color: 'var(--color-text)' };
  return (
    <button
      type={type}
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className="rounded-full px-4 py-2 text-sm font-bold disabled:opacity-50"
      style={style}
    >
      {children}
    </button>
  );
}

export function Pill({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'good' | 'warn' | 'bad' }) {
  const colors = {
    plain: { background: 'var(--color-surface-elevated)', color: 'var(--color-text)' },
    good: { background: 'var(--color-surface-elevated)', color: 'var(--color-success)' },
    warn: { background: 'var(--color-surface-elevated)', color: 'var(--color-warning, #9a6a00)' },
    bad: { background: 'var(--color-surface-elevated)', color: 'var(--color-danger)' }
  }[tone];
  return <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-bold" style={colors}>{children}</span>;
}

export function Notice({ text, tone = 'bad' }: { text: string | null | undefined; tone?: 'bad' | 'good' }) {
  if (!text) return null;
  return (
    <p role={tone === 'bad' ? 'alert' : 'status'} className="text-sm mt-2" style={{ color: tone === 'bad' ? 'var(--color-danger)' : 'var(--color-success)' }}>
      {text}
    </p>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block mt-3">
      <span className="text-xs font-bold" style={strong}>{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="text-xs" style={muted}>{hint}</span>}
    </label>
  );
}

export const inputClass = 'w-full rounded-xl px-3 py-2 text-sm';
export const inputStyle = { border: '1px solid var(--color-border)', background: 'var(--color-surface-elevated)', color: 'var(--color-text)' } as const;

export function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div>
      <div className="text-lg font-black" style={strong}>{value}</div>
      <div className="text-xs" style={muted}>{label}</div>
    </div>
  );
}

export function Progress({ pct }: { pct: number }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-2 rounded-full mt-2" style={{ background: 'var(--color-surface-elevated)' }} aria-label={`${w}% approved`}>
      <div className="h-2 rounded-full" style={{ width: `${w}%`, background: 'var(--color-primary)' }} />
    </div>
  );
}

export const modeLabel = (m: string) => (m === 'home' ? 'Home' : m === 'field' ? 'Field' : 'Home + field');

/** A private work photo: fetched with the session header, never a tokenized URL. */
export function PrivatePhoto({ id }: { id: string }) {
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    let made = '';
    void api.readPrivateEvidence(id).then((r) => {
      if (!live) return;
      if (r.ok) { made = URL.createObjectURL(r.data); setUrl(made); } else setErr(r.error);
    });
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [id]);
  if (err) return <span className="text-xs" style={{ color: 'var(--color-danger)' }}>Photo unavailable</span>;
  if (!url) return <span className="text-xs" style={muted}>Loading photo…</span>;
  return <img src={url} alt="Work evidence" className="h-28 w-28 rounded-xl object-cover" />;
}

export function CheckRow({ check }: { check: api.WorkCheck }) {
  const mark = check.status === 'pass' ? '✓' : check.status === 'flag' ? '!' : '–';
  const color = check.status === 'pass' ? 'var(--color-success)' : check.status === 'flag' ? 'var(--color-danger)' : 'var(--color-text-muted)';
  return (
    <li className="flex gap-2 text-xs">
      <span className="font-black w-3" style={{ color }}>{mark}</span>
      <span><b style={strong}>{check.label}</b> <span style={muted}>— {check.detail}</span></span>
    </li>
  );
}
