import React, { useEffect, useState } from "react";
import * as api from "../api/briefApi";
/** Uses the existing authentication API/token storage, not a second identity. */
export function SessionSignIn({
  onSignedIn,
  brandName = "Brief",
  title = "Sign in to save your Request",
}: {
  onSignedIn: () => void;
  title?: string;
  brandName?: string;
}) {
  const [joining, setJoining] = useState(false);
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [emailAvailable, setEmailAvailable] = useState(false);
  const [email, setEmail] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  useEffect(() => {
    let live = true;
    void api.getAuthProviders().then(r => { if (live) setEmailAvailable(Boolean(r.ok && r.data.emailLink?.configured)); });
    return () => { live = false; };
  }, []);
  return (
    <section className="request-panel request-auth">
      <span className="request-eyebrow">Your private workspace</span>
      <h2>{joining ? `Create your ${brandName} account` : title}</h2>
      <p>
        One {brandName} account for discovery and business. No enterprise registration
        required.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const res = joining
            ? await api.register(handle, password)
            : await api.login(handle, password);
          setBusy(false);
          if (res.ok) onSignedIn();
          else setError(res.error);
        }}
      >
        <label>
          Handle
          <input
            autoComplete="username"
            required
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            maxLength={32}
          />
        </label>
        <label>
          Password
          <input
            autoComplete={joining ? "new-password" : "current-password"}
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={joining ? 8 : undefined}
            maxLength={200}
          />
        </label>
        {error && (
          <p role="alert" className="request-error">
            {error}
          </p>
        )}
        <button disabled={busy} className="request-primary">
          {busy ? "Please wait…" : joining ? "Create account" : "Sign in"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setJoining(!joining);
            setError("");
          }}
        >
          {joining
            ? "Already have an account? Sign in"
            : "New here? Create an account"}
        </button>
      </form>
      {emailAvailable && <form onSubmit={async e => {
        e.preventDefault(); setBusy(true); setEmailMessage("");
        const result = await api.requestEmailSignIn(email);
        setBusy(false);
        setEmailMessage(result.ok ? result.data.message : result.error);
      }}>
        <label>Email sign-in link (sent only to your inbox)
          <input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} />
        </label>
        <button type="submit" disabled={busy} className="request-primary">Email me a sign-in link</button>
        {emailMessage && <p role="status">{emailMessage}</p>}
      </form>}
    </section>
  );
}
