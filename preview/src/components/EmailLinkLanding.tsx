import React, { useEffect, useRef, useState } from 'react';
import * as api from '../api/briefApi';
import { SessionSignIn } from './SessionSignIn';

/** Production-only mailbox proof landing; legacy HMAC links are rejected by the API. */
export function EmailLinkLanding({ token }: { token: string }) {
  const started = useRef(false);
  const [message, setMessage] = useState('Verifying your email link…');
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Remove the secret from address history/referrers before fetching anything.
    const url = new URL(window.location.href);
    url.searchParams.delete('bt');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    void api.continueFromLinkToken(token).then(result => {
      if (result.ok) window.location.assign('/#you');
      else setMessage('This link is invalid, expired or already used. Request a new link or sign in below.');
    });
  }, [token]);
  return <main className="mx-auto max-w-lg px-5 py-10" aria-live="polite"><p role="status">{message}</p>
    {message.startsWith('This link') && <SessionSignIn title="Sign in to Brief" onSignedIn={() => window.location.assign('/#you')} />}
  </main>;
}
