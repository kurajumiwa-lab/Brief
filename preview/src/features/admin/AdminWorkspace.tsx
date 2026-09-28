import React, { useEffect, useState } from 'react';
import * as api from '../../api/briefApi';
import { AdminDesk } from '../../components/AdminDesk';
import { SessionSignIn } from '../../components/SessionSignIn';
import { OverlayScreen } from '../../ui/OverlayScreen';
import '../requests/requests.css';

/** The production entry: deep links do not bypass identity/capability checks.
 * Identity changes unmount the desk immediately, discarding private state. */
export function AdminWorkspace({ memberId, onClose, onSession }: {
  memberId: string | null;
  onClose: () => void;
  onSession: (me: api.AuthedUser | null) => void;
}) {
  const [identity, setIdentity] = useState<{ me: api.AuthedUser | null; status: number; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const reload = () => { setIdentity(null); setAttempt((n) => n + 1); };
    window.addEventListener('brief:session-changed', reload);
    window.addEventListener('focus', reload);
    return () => { window.removeEventListener('brief:session-changed', reload); window.removeEventListener('focus', reload); };
  }, []);
  useEffect(() => {
    let live = true;
    setIdentity(null);
    void api.whoAmI().then((r) => {
      if (!live) return;
      const me = r.ok ? r.data : null;
      setIdentity(r.ok ? { me, status: 200 } : { me: null, status: r.status ?? 0, error: r.error });
      onSession(me);
    });
    return () => { live = false; };
  }, [attempt, onSession]);
  const caps = identity?.me?.capabilities ?? [];
  if (identity?.me && (caps.includes('admin') || caps.includes('ops.read'))) {
    return <AdminDesk key={identity.me.id} open me={identity.me} onClose={onClose}
      onAccessDenied={() => { setIdentity(null); setAttempt((n) => n + 1); }}
      initialTab={caps.includes('admin') ? 'members' : 'health'} memberId={memberId}
      onSelectMember={(id) => { window.location.hash = id ? `admin/members/${encodeURIComponent(id)}` : 'admin/members'; }} />;
  }
  return <OverlayScreen title="Admin" onBack={onClose}>
    {!identity ? <p role="status">Checking administrator access…</p> : identity.status === 401 ?
      <SessionSignIn title="Sign in to the admin desk" onSignedIn={() => setAttempt((n) => n + 1)} /> :
      <div className="request-panel"><h2>{identity.me ? 'Admin access required' : 'Could not check access'}</h2>
        <p role="alert">{identity.me ? 'This account cannot open the admin desk. Ask an existing administrator or the deployment owner to grant access.' : identity.error}</p>
        <button type="button" className="request-primary" onClick={() => setAttempt((n) => n + 1)}>Check access again</button>
      </div>}
  </OverlayScreen>;
}
