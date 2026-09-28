import { useMatchFreshness } from "./useMatchFreshness";
import React, { useEffect, useState } from "react";
import * as api from "../../api/briefApi";
import type { RelevantRequest } from "../../api/matchTypes";
import { SessionSignIn } from "../../components/SessionSignIn";
import { date, quantity } from "../supply/shared";
import "./matching.css";
export function RelevantRequests() {
  const [rows, setRows] = useState<RelevantRequest[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [auth, setAuth] = useState(false),
    [busy, setBusy] = useState(""),
    [reload, setReload] = useState(0);
  useMatchFreshness(setReload);
  useEffect(() => {
    let live = true;
    setLoading(true);
    api.relevantRequests().then((r) => {
      if (!live) return;
      setLoading(false);
      if (r.ok) {
        setRows(r.data);
        setError("");
      } else {
        setRows([]);
        setError(r.error);
        setAuth(r.status === 401);
      }
    });
    return () => {
      live = false;
    };
  }, [reload]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.hash.split('?')[1] || '').get('match');
    if (id && !loading) document.getElementById(`match-${id}`)?.scrollIntoView({block:'center'});
  }, [rows, loading]);
  return (
    <section className="supply-section matching-workspace">
      <span className="request-eyebrow">
        Shared briefs · your actual capabilities
      </span>
      <h2>Requests you may be able to help with</h2>
      <p>
        Only current Requests explicitly shared with matched businesses appear
        here. Private Requests and commercial details remain with the requester.
      </p>
      {auth && (
        <SessionSignIn
          title="Sign in to manage your interest"
          onSignedIn={() => {
            setAuth(false);
            setReload((n) => n + 1);
          }}
        />
      )}
      {error && (
        <p role="alert">
          {error}{" "}
          <button onClick={() => setReload((n) => n + 1)}>
            Reload relevant Requests
          </button>
        </p>
      )}
      {loading ? (
        <p role="status">Loading relevant Requests…</p>
      ) : !rows.length && !error ? (
        <div className="match-empty">
          <h3>No shared Requests currently match your capabilities.</h3>
          <p>
            Keep your capabilities, coverage and turnaround up to date. No
            private demand or invented activity is shown.
          </p>
        </div>
      ) : (
        rows.map((r) => (
          <article
            key={r.matchId}
            id={`match-${r.matchId}`}
            className="match-option"
            data-testid="relevant-request"
          >
            <h3>{r.title}</h3>
            <p>
              {quantity(r.quantity)} {r.unit} · {r.location} ·{" "}
              {r.requiredBy
                ? `Needed by ${date(r.requiredBy)}`
                : "Deadline not stated"}
            </p>
            <p>{r.reason}</p>
            <ul>
              {r.capabilities.map((c) => (
                <li key={c.id}>
                  {c.name} ·{" "}
                  {c.supplyMode === "source"
                    ? "Can source through external relationships"
                    : "Supplies directly (declared)"}
                </li>
              ))}
            </ul>
            {r.interest?.status === "interested" && (
              <p className="match-interest">
                {r.interest.current
                  ? "Your interest is recorded. This is not an order or availability promise."
                  : "Requirements changed since your interest. Review this brief and confirm again."}
              </p>
            )}
            <div className="request-actions">
              {!(r.interest?.status === "interested" && r.interest.current) && (
                <button
                  disabled={!!busy || auth || loading}
                  className="request-primary"
                  onClick={async () => {
                    setBusy(r.matchId);
                    const res = await api.expressMatchInterest(
                      r.matchId,
                      r.requestRevision,
                      r.matchRevision,
                    );
                    setBusy("");
                    if (res.ok) setReload((n) => n + 1);
                    else {
                      setError(res.error);
                      setAuth(res.status === 401);
                    }
                  }}
                >
                  I can help with this Request
                </button>
              )}
              {r.interest?.status === "interested" && (
                <button
                  disabled={!!busy || auth || loading}
                  onClick={async () => {
                    setBusy(r.matchId);
                    const res = await api.withdrawMatchInterest(
                      r.matchId,
                      r.interest!.revision,
                    );
                    setBusy("");
                    if (res.ok) setReload((n) => n + 1);
                    else {
                      setError(res.error);
                      setAuth(res.status === 401);
                    }
                  }}
                >
                  Withdraw interest
                </button>
              )}
            </div>
            <p className="request-hint">
              No quote, price, notification or order is created. Sourcing
              interest never implies stock ownership.
            </p>
          </article>
        ))
      )}
    </section>
  );
}
