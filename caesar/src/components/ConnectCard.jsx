import { useState } from "react";
import { ArrowRight, Radio, Unplug, UserPlus } from "lucide-react";
import { useSession } from "@/store/session.js";
import { useLive, api } from "@/store/live.js";
import { ApiError } from "@/lib/api.js";

/**
 * JOINING — the one place the demo can become the network.
 *
 * The rule this panel exists to make visible: **taking part does not ask you to
 * be a business.** The short form creates a social account and nothing else — no
 * shop, no trade standing, no vendor record. The second field is for people who
 * already run a shop on Brief: their existing login works here too, and the
 * server gives it a social identity rather than a second one.
 *
 * Neither path hides what it does. Local mode says it is local; live mode says
 * whose handle is posting and offers one button back.
 */
export default function ConnectCard() {
  const mode = useSession((state) => state.mode);
  const account = useSession((state) => state.account);
  const notice = useSession((state) => state.notice);
  const start = useSession((state) => state.start);
  const signOut = useSession((state) => state.signOut);
  const dismissNotice = useSession((state) => state.dismissNotice);

  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [city, setCity] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [vendorLinked, setVendorLinked] = useState(null);

  const enterLive = async (next) => {
    start(next);
    await Promise.all([useLive.getState().loadCircles(), useLive.getState().load()]);
  };

  const join = async (event) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const result = await api.register({
        handle: handle.trim(),
        display_name: (displayName || handle).trim(),
        city: city.trim() || null,
      });
      await enterLive({ token: result.access_token, account: result.account });
      setOpen(false);
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "Could not join just now.");
    } finally {
      setBusy(false);
    }
  };

  const resume = async (event) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const me = await api.me(token.trim());
      setVendorLinked(me.linked_to_vendor);
      await enterLive({ token: token.trim(), account: me.account });
      setOpen(false);
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "Could not use that sign-in.");
    } finally {
      setBusy(false);
    }
  };

  const leave = () => {
    signOut();
    useLive.getState().clear();
  };

  if (mode === "live") {
    return (
      <section className="card card--pad" style={{ marginTop: 12 }} data-testid="session-card">
        <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
          <Radio size={16} aria-hidden="true" style={{ color: "var(--green-600)", marginTop: 2, flex: "none" }} />
          <div className="grow">
            <div className="title-sm">You are on the live network</div>
            <p className="tiny muted" style={{ marginTop: 4, lineHeight: 1.55 }}>
              Posting, reacting and reporting reach the server, and the order of your feed is the score it computed
              from real reactions — not from this device.
              {vendorLinked && " This identity is attached to your Brief shop."}
            </p>
            <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <span className="chip chip--green">@{account?.handle}</span>
              {account?.city && <span className="chip chip--quiet">{account.city}</span>}
              {account?.vendor_id ? (
                <span className="chip chip--gold">Shop identity linked</span>
              ) : (
                <span className="chip chip--quiet">No business account needed</span>
              )}
            </div>
          </div>
        </div>
        <hr className="hairline" style={{ margin: "12px 0" }} />
        <div className="row" style={{ gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
          <span className="micro muted">Leaving returns this device to the demo network.</span>
          <button type="button" className="btn btn--sm btn--ghost" onClick={leave} data-testid="leave-live">
            <Unplug size={13} aria-hidden="true" /> Leave live mode
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="card card--pad" style={{ marginTop: 12 }} data-testid="session-card">
      <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
        <UserPlus size={16} aria-hidden="true" style={{ color: "var(--gold-700)", marginTop: 2, flex: "none" }} />
        <div className="grow">
          <div className="title-sm">This is the demo network</div>
          <p className="tiny muted" style={{ marginTop: 4, lineHeight: 1.55 }}>
            Everything on this device — the posts, the reactions, the ranking — is seeded so the product can be
            tried without a server. Join the real conversation and the same screens talk to it. You do not need a
            shop, a business name, or a Brief vendor account to take part.
          </p>

          {notice && (
            <div className="notice notice--terra" style={{ marginTop: 10 }} role="status">
              <span className="grow">{notice}</span>
              <button type="button" className="btn btn--sm btn--ghost" onClick={dismissNotice}>
                Dismiss
              </button>
            </div>
          )}

          {!open ? (
            <button
              type="button"
              className="btn btn--sm btn--gold"
              style={{ marginTop: 10 }}
              onClick={() => setOpen(true)}
              data-testid="open-join"
            >
              Join the network <ArrowRight size={13} aria-hidden="true" />
            </button>
          ) : (
            <form onSubmit={join} style={{ marginTop: 12 }} noValidate>
              <div className="field">
                <label className="label" htmlFor="join-handle">
                  Handle
                </label>
                <input
                  id="join-handle"
                  className="input"
                  value={handle}
                  onChange={(event) => setHandle(event.target.value)}
                  placeholder="mama_asha"
                  minLength={3}
                  maxLength={30}
                  required
                  autoComplete="username"
                />
                <p className="micro muted" style={{ marginTop: 4 }}>
                  3–30 characters. This is the only name the network needs.
                </p>
              </div>
              <div className="field">
                <label className="label" htmlFor="join-name">
                  Name shown on posts
                </label>
                <input
                  id="join-name"
                  className="input"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Asha Otieno"
                  maxLength={120}
                  autoComplete="name"
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="join-city">
                  City <span className="muted">(optional)</span>
                </label>
                <input
                  id="join-city"
                  className="input"
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  placeholder="Kisumu"
                  maxLength={120}
                  autoComplete="address-level2"
                />
              </div>

              {problem && (
                <div className="notice notice--terra" style={{ margin: "8px 0" }} role="alert">
                  <span>{problem}</span>
                </div>
              )}

              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button type="submit" className="btn btn--sm btn--gold" disabled={busy || handle.trim().length < 3}>
                  {busy ? "Joining…" : "Create my account"}
                </button>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setOpen(false)}>
                  Not now
                </button>
              </div>
            </form>
          )}

          {!open && (
            <details style={{ marginTop: 12 }}>
              <summary className="micro muted" style={{ cursor: "pointer" }}>
                I already run a shop on Brief
              </summary>
              <form onSubmit={resume} style={{ marginTop: 10 }}>
                <div className="field">
                  <label className="label" htmlFor="join-token">
                    Your Brief sign-in token
                  </label>
                  <input
                    id="join-token"
                    className="input"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="eyJhbGciOi…"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p className="micro muted" style={{ marginTop: 4 }}>
                    The same login you already use. The server gives it a social identity once — your shop name
                    stays on your shop, not on your posts.
                  </p>
                </div>
                <button type="submit" className="btn btn--sm btn--ghost" disabled={busy || !token.trim()}>
                  {busy ? "Checking…" : "Use this login"}
                </button>
              </form>
            </details>
          )}
        </div>
      </div>
    </section>
  );
}
