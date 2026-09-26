import React, { useEffect, useRef, useState } from "react";
import * as api from "../../api/briefApi";
import type { VendorLead } from "../../api/supplyTypes";
import type { SpaceMode } from "../../api/types";
import { ImageField } from "../../components/ImageField";
import { SessionSignIn } from "../../components/SessionSignIn";
import { supplyPath } from "./shared";
import { parseScrapeNote, type ScrapePick } from "./parseScrapeNote";

// ---------------------------------------------------------------------------
// VENDOR LEAD CAPTURE — the digitized manual entry of shops.
//
// A scout meets a shop on the street and takes a photo, a name, a contact
// and a category. That is a LEAD: it is not a shop, not a vendor, and buyers
// never see it as one. It becomes useful only when produce (or a real order)
// is linked to it by an explicit validation command — see
// docs/AGREEMENT-STATE-INTEGRITY-CONTRACT.md.
//
// Two ways in: type it by hand, or drop a scrape note (pasted from TikTok, an
// AI summary, anywhere) in the tray. The tray reads labeled lines and phone
// numbers into the form — nothing saves until the scout checks it and taps
// Save. A bare handle is never upgraded into a link; the raw note is kept
// verbatim so the picks stay auditable.
//
// An optional GPS pin drops the shop where the scout stands, so it appears
// on the map. No pin, no plot — the list works fully without coordinates.
//
// No cap: one account captures as many leads as it walks past. Exposure
// terms (the money for showing the shop) exist only when an operator types
// them, per lead. Nothing here invents a product, a price, or a promise.
// ---------------------------------------------------------------------------

const STATUS_WORD: Record<VendorLead["status"], string> = {
  captured: "Captured — produce not confirmed",
  validated: "Validated — produce confirmed",
  claimed: "Claimed by the vendor",
  dropped: "Dropped",
};

function LeadCard({
  lead,
  onChanged,
}: {
  lead: VendorLead;
  onChanged: (next: VendorLead) => void;
}) {
  const [showValidate, setShowValidate] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [causeType, setCauseType] = useState("capability");
  const [causeId, setCauseId] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState("once");
  const [termsNote, setTermsNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [codeCopied, setCodeCopied] = useState(false);

  const run = async (fn: () => Promise<{ ok: boolean; data?: VendorLead; error?: string }>) => {
    setBusy(true);
    setMsg("");
    const r = await fn();
    setBusy(false);
    if (r.ok && r.data) {
      onChanged(r.data);
      setShowValidate(false);
      setShowTerms(false);
    } else {
      setMsg(r.error ?? "That did not go through.");
    }
  };

  const mint = async () => {
    setMsg("");
    const r = await api.mintLeadCode(lead.id);
    if (!r.ok) {
      setMsg(r.error ?? "That did not go through.");
      return;
    }
    onChanged(r.data.lead);
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard?.writeText(code);
      setCodeCopied(true);
    } catch {
      setCodeCopied(false);
    }
  };

  return (
    <div className="request-panel" style={{ textAlign: "left" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        {lead.photo ? (
          <img
            src={api.mediaFileUrl(lead.photo)}
            alt=""
            style={{ width: 64, height: 64, borderRadius: 14, objectFit: "cover", flexShrink: 0 }}
          />
        ) : (
          <span
            style={{
              width: 64, height: 64, borderRadius: 14, flexShrink: 0,
              display: "grid", placeItems: "center",
              background: "var(--color-well)", color: "var(--color-text-muted)",
              fontWeight: 900, fontSize: 22,
            }}
          >
            {(lead.name || "?").trim().charAt(0).toUpperCase()}
          </span>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <strong style={{ fontSize: 15 }}>{lead.name}</strong>
          <p className="request-hint" style={{ margin: "2px 0 0" }}>
            {lead.category} · {lead.contact}
          </p>
          {typeof lead.lat === "number" && typeof lead.lon === "number" && (
            <p className="request-hint" style={{ margin: "2px 0 0" }}>
              Pinned at {lead.lat.toFixed(4)}, {lead.lon.toFixed(4)}
            </p>
          )}
          {typeof lead.lat === "number" && typeof lead.lon === "number" && lead.status !== "dropped" && (
            lead.code ? (
              <p style={{ margin: "6px 0 0", fontSize: 13 }}>
                <span className="font-mono font-black" style={{ fontSize: 16, letterSpacing: "0.08em" }}>
                  {lead.code}
                </span>
                {" · "}
                <button
                  type="button"
                  onClick={() => void copyCode(lead.code as string)}
                  style={{ fontSize: 12, fontWeight: 700, padding: 0 }}
                >
                  {codeCopied ? "Copied" : "Copy"}
                </button>
              </p>
            ) : (
              <button
                type="button"
                onClick={() => void mint()}
                style={{ fontSize: 12, fontWeight: 700, padding: 0, marginTop: 4 }}
              >
                Get a pickup code
              </button>
            )
          )}
          <p style={{ margin: "4px 0 0", fontSize: 12, fontWeight: 800 }}>
            {STATUS_WORD[lead.status]}
          </p>
          {lead.source === "scrape-note" && (
            <p className="request-hint" style={{ margin: "2px 0 0" }}>
              From a pasted note — fields were picked, not typed.
            </p>
          )}
        </div>
      </div>

      {lead.siteUrl && (
        <p style={{ fontSize: 12, margin: "8px 0 0", overflowWrap: "anywhere" }}>
          <a href={lead.siteUrl} target="_blank" rel="noreferrer">{lead.siteUrl}</a>
        </p>
      )}
      {lead.produce && (
        <p className="request-hint" style={{ margin: "8px 0 0" }}>
          Produce confirmed via {lead.produce.kind} {lead.produce.id}.
        </p>
      )}
      {lead.exposureTerms && (
        <p className="request-hint" style={{ margin: "4px 0 0" }}>
          Exposure: KES {lead.exposureTerms.amountKes.toLocaleString("en-KE")} · {lead.exposureTerms.period}
          {lead.exposureTerms.note ? ` — ${lead.exposureTerms.note}` : ""}
        </p>
      )}

      {lead.status === "captured" && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button type="button" onClick={() => { setShowValidate((s) => !s); setShowTerms(false); }}>
            Confirm produce
          </button>
          <button type="button" onClick={() => { setShowTerms((s) => !s); setShowValidate(false); }}>
            Set exposure terms
          </button>
          <button
            type="button" disabled={busy}
            onClick={() => {
              if (!window.confirm(`Drop “${lead.name}”? It leaves your list. Nothing else changes.`)) return;
              void run(() => api.dropVendorLead(lead.id));
            }}
          >
            Drop
          </button>
        </div>
      )}
      {lead.status === "validated" && !lead.exposureTerms && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setShowTerms((s) => !s)}>
            Set exposure terms
          </button>
        </div>
      )}

      {showValidate && lead.status === "captured" && (
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 700 }}>
            Proof of produce
            <span style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <select value={causeType} onChange={(e) => setCauseType(e.target.value)} style={{ padding: 10, borderRadius: 10 }}>
                <option value="capability">Capability</option>
                <option value="request">Request</option>
                <option value="workOrder">Work Order</option>
              </select>
              <input
                value={causeId} onChange={(e) => setCauseId(e.target.value)}
                placeholder="Paste the real record id"
                style={{ flex: 1, padding: 10, borderRadius: 10 }}
              />
            </span>
          </label>
          <p className="request-hint" style={{ margin: 0 }}>
            The record must exist. A guessed id is refused — validation is a claim about a real row.
          </p>
          <div>
            <button
              type="button" disabled={busy || !causeId.trim()}
              onClick={() => void run(() => api.validateVendorLead(lead.id, { causeType, causeId: causeId.trim() }))}
            >
              {busy ? "Confirming…" : "Confirm produce"}
            </button>
          </div>
        </div>
      )}

      {showTerms && (lead.status === "captured" || lead.status === "validated") && (
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 700 }}>
            Exposure amount (KES)
            <input
              value={amount} onChange={(e) => setAmount(e.target.value)}
              inputMode="numeric" placeholder="Whole shillings, typed by you"
              style={{ display: "block", width: "100%", marginTop: 4, padding: 10, borderRadius: 10 }}
            />
          </label>
          <label style={{ fontSize: 13, fontWeight: 700 }}>
            Period
            <select value={period} onChange={(e) => setPeriod(e.target.value)} style={{ display: "block", marginTop: 4, padding: 10, borderRadius: 10 }}>
              <option value="once">Once — a single amount for exposing the shop</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label style={{ fontSize: 13, fontWeight: 700 }}>
            Note (optional)
            <input
              value={termsNote} onChange={(e) => setTermsNote(e.target.value)}
              placeholder="What the amount covers, in your own words"
              style={{ display: "block", width: "100%", marginTop: 4, padding: 10, borderRadius: 10 }}
            />
          </label>
          <div>
            <button
              type="button" disabled={busy || !amount.trim()}
              onClick={() => {
                const n = Number(amount.trim());
                if (!Number.isInteger(n) || n <= 0) { setMsg("Type whole shillings above zero."); return; }
                void run(() => api.setVendorLeadExposureTerms(lead.id, { amountKes: n, period, note: termsNote.trim() }));
              }}
            >
              {busy ? "Saving…" : "Save terms"}
            </button>
          </div>
        </div>
      )}

      {msg && <p role="alert" style={{ fontSize: 13, margin: "8px 0 0" }}>{msg}</p>}
    </div>
  );
}

export function VendorLeadCapture() {
  const [leads, setLeads] = useState<VendorLead[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [auth, setAuth] = useState(false);
  const [error, setError] = useState("");
  const [modes, setModes] = useState<SpaceMode[]>([]);
  const [photo, setPhoto] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [category, setCategory] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [note, setNote] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [geoMsg, setGeoMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [formMsg, setFormMsg] = useState("");
  const [justSaved, setJustSaved] = useState<VendorLead | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  const [trayRaw, setTrayRaw] = useState("");
  const [trayReport, setTrayReport] = useState<ScrapePick | null>(null);
  const [fromTray, setFromTray] = useState(false);
  const keyRef = useRef("");
  if (!keyRef.current)
    keyRef.current = `lead-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const load = () => {
    setLoading(true);
    setError("");
    setAuth(false);
    void api.listVendorLeads().then((r) => {
      setLoading(false);
      if (r.ok) setLeads(r.data.leads);
      else {
        setError(r.error ?? "Your leads could not be read.");
        setAuth(r.status === 401);
      }
    });
  };
  useEffect(load, []);
  useEffect(() => {
    let live = true;
    void api.getSpaceModes().then((r) => {
      if (live && r.ok && Array.isArray(r.data)) setModes(r.data);
    });
    return () => { live = false; };
  }, []);

  const grabGps = () => {
    if (!("geolocation" in navigator)) {
      setGeoMsg("This device has no GPS to read.");
      return;
    }
    setGeoMsg("Reading GPS…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setGeoMsg("");
      },
      () => setGeoMsg("GPS refused — the lead saves fine without coordinates."),
      { timeout: 15000 },
    );
  };

  const pick = () => {
    const p = parseScrapeNote(trayRaw);
    setTrayReport(p);
    if (trayRaw.trim().length === 0) return;
    if (p.name) setName(p.name);
    if (p.contact) setContact(p.contact);
    if (p.category) setCategory(p.category);
    if (p.siteUrl) setSiteUrl(p.siteUrl);
    if (p.note) setNote(p.note);
    setFromTray(true);
  };

  const save = async () => {
    setFormMsg("");
    if (name.trim().length < 2) { setFormMsg("Give the shop a name — at least 2 characters."); return; }
    if (contact.trim().length < 3) { setFormMsg("Add a contact: a phone number, a handle, something reachable."); return; }
    if (category.trim().length < 2) { setFormMsg("Pick the shop category, or type it."); return; }
    setBusy(true);
    const r = await api.createVendorLead({
      name: name.trim(),
      contact: contact.trim(),
      category: category.trim(),
      photo,
      siteUrl: siteUrl.trim() === "" ? null : siteUrl.trim(),
      note: note.trim() === "" ? undefined : note.trim(),
      idempotencyKey: keyRef.current,
      source: fromTray ? "scrape-note" : "manual",
      ...(coords ? { lat: coords.lat, lon: coords.lon } : {}),
    });
    setBusy(false);
    if (!r.ok) { setFormMsg(r.error ?? "That did not go through."); return; }
    keyRef.current = `lead-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    setPhoto(null);
    setName("");
    setContact("");
    setCategory("");
    setSiteUrl("");
    setNote("");
    setCoords(null);
    setGeoMsg("");
    setTrayRaw("");
    setTrayReport(null);
    setFromTray(false);
    setJustSaved(r.data.lead);
    setLeads((prev) => (prev ? [r.data.lead, ...prev.filter((l) => l.id !== r.data.lead.id)] : [r.data.lead]));
  };

  if (loading) return <p role="status">Reading your leads…</p>;
  if (auth) return <SessionSignIn title="Sign in to onboard vendors" onSignedIn={load} />;
  if (error && leads === null)
    return (
      <section className="request-panel">
        <h2>Leads unavailable</h2>
        <p role="alert">{error}</p>
        <button type="button" onClick={load}>Retry leads</button>
      </section>
    );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="request-panel" style={{ textAlign: "left" }}>
        <button
          type="button"
          onClick={() => setTrayOpen((o) => !o)}
          aria-expanded={trayOpen}
          style={{ fontSize: 15, fontWeight: 800, padding: 0 }}
        >
          {trayOpen ? "Hide the scrape tray" : "Drop a scrape note"}
        </button>
        {trayOpen && (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            <p style={{ fontSize: 13, margin: 0 }}>
              Pasted from TikTok, an AI summary, anywhere. The tray reads labeled
              lines and phone numbers into the form below — nothing saves until
              you check it and tap Save this lead. A bare handle is never turned
              into a link.
            </p>
            <textarea
              value={trayRaw}
              onChange={(e) => setTrayRaw(e.target.value)}
              rows={6}
              placeholder="Paste the note here…"
              style={{ width: "100%", padding: 10, borderRadius: 10, fontSize: 13 }}
            />
            <div>
              <button type="button" onClick={pick}>Pick out the fields</button>
            </div>
            {trayReport && (
              <div style={{ display: "grid", gap: 4 }}>
                {trayReport.found.map((f) => (
                  <p key={f} className="request-hint" style={{ margin: 0 }}>Picked: {f}</p>
                ))}
                {trayReport.missing.map((f) => (
                  <p key={f} className="request-hint" style={{ margin: 0 }}>Missing: {f}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="request-panel" style={{ textAlign: "left" }}>
        <span className="request-eyebrow">Brief / Supply network / Vendor leads</span>
        <h2>Onboard a shop you met</h2>
        <p>
          A photo, a name, a contact, a category — that is a lead. It lives in
          your list only: buyers never see it as a shop, and it cannot take
          orders until produce is confirmed. An absent vendor with no produce
          and no orders proves nothing, so the list stays honest by staying
          small in what it claims.
        </p>
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <ImageField
            label="Shop photo"
            hint="The storefront or the brand — a photo you took, not a product shot."
            value={photo}
            onChange={setPhoto}
          />
          <label style={{ fontSize: 13, fontWeight: 700 }}>
            Shop name
            <input
              value={name} onChange={(e) => setName(e.target.value)}
              placeholder="The name on the signboard"
              style={{ display: "block", width: "100%", marginTop: 4, padding: 10, borderRadius: 10 }}
            />
          </label>
          <label style={{ fontSize: 13, fontWeight: 700 }}>
            Contact
            <input
              value={contact} onChange={(e) => setContact(e.target.value)}
              placeholder="Phone number or handle — something reachable"
              style={{ display: "block", width: "100%", marginTop: 4, padding: 10, borderRadius: 10 }}
            />
          </label>
          <label style={{ fontSize: 13, fontWeight: 700 }}>
            Shop category
            <input
              value={category} onChange={(e) => setCategory(e.target.value)}
              list="lead-category-list"
              placeholder="Start typing, or pick a suggestion"
              style={{ display: "block", width: "100%", marginTop: 4, padding: 10, borderRadius: 10 }}
            />
            <datalist id="lead-category-list">
              {modes.map((m) => <option key={m.id} value={m.label} />)}
            </datalist>
          </label>
          <label style={{ fontSize: 13, fontWeight: 700 }}>
            Their site, if they have one (optional)
            <input
              value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)}
              placeholder="A full link, or leave it empty"
              inputMode="url"
              style={{ display: "block", width: "100%", marginTop: 4, padding: 10, borderRadius: 10 }}
            />
          </label>
          <div>
            <button type="button" onClick={grabGps} style={{ fontSize: 13, fontWeight: 700 }}>
              {coords ? `Pinned at ${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)} — retake` : "Drop a pin here (GPS)"}
            </button>
            {geoMsg && <p className="request-hint" style={{ margin: "4px 0 0" }}>{geoMsg}</p>}
            <p className="request-hint" style={{ margin: "4px 0 0" }}>
              Optional. Pins the shop where you stand so it appears on the map.
            </p>
          </div>
          <label style={{ fontSize: 13, fontWeight: 700 }}>
            Note (optional)
            <textarea
              value={note} onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Anything the next person should know"
              style={{ display: "block", width: "100%", marginTop: 4, padding: 10, borderRadius: 10, fontSize: 13 }}
            />
          </label>
          <div>
            <button type="button" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save this lead"}
            </button>
          </div>
          {formMsg && <p role="alert" style={{ fontSize: 13, margin: 0 }}>{formMsg}</p>}
        </div>
      </section>

      {justSaved && (
        <section className="request-panel" style={{ textAlign: "left" }}>
          <h2>Lead saved — it is not a shop yet</h2>
          <p>
            “{justSaved.name}” sits in your list as captured. To make it
            useful, do one of these next:
          </p>
          <ul style={{ fontSize: 14, lineHeight: 1.7, paddingLeft: 20, margin: "8px 0 0" }}>
            <li>Ask what they actually sell and at what price — then confirm produce below against the real row.</li>
            <li>{justSaved.siteUrl ? "You dropped their site link — use it to verify what they stock." : "Or drop their site link, if they have one, so anyone can verify what they stock."}</li>
            <li>Set exposure terms only when you and the shop agree what showing it costs — the amount is typed, never assumed.</li>
          </ul>
          <p className="request-hint">
            Until produce is confirmed, this lead cannot take orders and no
            buyer sees it. That is the whole point of the list.
          </p>
        </section>
      )}

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>
          Your leads{(leads?.length ?? 0) > 0 ? ` · ${leads!.length}` : ""}
        </h2>
        {(leads ?? []).length === 0 ? (
          <div className="request-panel">
            <p style={{ margin: 0 }}>
              No leads yet — the first photo you take starts the list. There is
              no limit on how many shops one account onboards.
            </p>
          </div>
        ) : (
          (leads ?? []).map((l) => (
            <LeadCard
              key={l.id}
              lead={l}
              onChanged={(next) =>
                setLeads((prev) => (prev ? prev.map((x) => (x.id === next.id ? next : x)) : prev))
              }
            />
          ))
        )}
        <p className="request-hint">
          <button type="button" onClick={() => supplyPath("mine")} style={{ padding: 0 }}>
            ← Back to your enterprise
          </button>
        </p>
      </section>
    </div>
  );
}

export default VendorLeadCapture;
