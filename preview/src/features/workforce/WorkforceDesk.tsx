// WORKFORCE — one surface, two views of the same rows.
//
//   My work        the worker: profile, onboarding, available work, tasks,
//                  proof, earnings and record.
//   Organisation   the owner/supervisor: programs, quality control, people
//                  (onboarding and HR) and territories.
//
// A person can be both (a supervisor who also takes tasks), so the switch is
// a plain toggle, not a role gate. The server decides what each view returns.
import React, { useEffect, useState } from 'react';
import { WorkerView } from './WorkerView';
import { OrgView } from './OrgView';
import '../../ui/compact.css';
import '../requests/requests.css';

type View = 'worker' | 'org';

export function WorkforceDesk() {
  const [view, setView] = useState<View>(() => (window.location.hash === '#workforce/org' ? 'org' : 'worker'));
  useEffect(() => {
    const sync = () => setView(window.location.hash === '#workforce/org' ? 'org' : 'worker');
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const go = (v: View) => {
    setView(v);
    window.history.replaceState(null, '', v === 'org' ? '#workforce/org' : '#workforce');
  };
  return (
    <div className="mx-auto max-w-2xl px-4 pb-28 pt-4" data-testid="workforce-desk">
      <p className="text-xs font-black uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Work network</p>
      <div role="tablist" aria-label="Workforce view" className="mt-2 inline-flex rounded-full p-1" style={{ background: 'var(--color-surface-elevated)' }}>
        {([['worker', 'My work'], ['org', 'Organisation']] as Array<[View, string]>).map(([k, label]) => (
          <button key={k} role="tab" type="button" aria-selected={view === k} onClick={() => go(k)}
            className="rounded-full px-4 py-1.5 text-sm font-bold"
            style={view === k ? { background: 'var(--color-primary)', color: 'var(--accent-ink)' } : { color: 'var(--color-text)' }}>
            {label}
          </button>
        ))}
      </div>
      <a href="/cloudbites" className="mt-4 flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-bold" style={{ background: '#fff0e7', color: '#9c3e1c' }}>
        <span>CloudBites on Brief · local food concept preview</span><span aria-hidden="true">↗</span>
      </a>
      {view === 'worker' ? <WorkerView /> : <OrgView />}
    </div>
  );
}
