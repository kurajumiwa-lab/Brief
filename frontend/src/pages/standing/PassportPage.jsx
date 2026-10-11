import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BadgeCheck, ClipboardCheck, ExternalLink, FileUp, Pencil, Plus, RefreshCw,
  Share2, ShieldCheck, Trash2, X,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Breadcrumbs from "@/components/ui/Breadcrumbs";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { FactStatusBadge, VerifiedFacts } from "@/components/trust/VerifiedFacts";
import { passportAPI, apiError } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";

/* ═══════════════════════════════════════════════════════════════════════════
   BUSINESS PASSPORT — /passport
   ---------------------------------------------------------------------------
   The one screen that answers "what does this business have on paper, and
   who checked it?" — for the owner of the paperwork. Three parts:

     1. THE FACTS   add a document, ask a verifier to look, renew before it
                    lapses. Every row shows its true state; nothing says
                    "verified" until a named person has checked it.
     2. READINESS   the pack a buyer type asks for, item by item, with the
                    next action on each line. Counts only — no score, because
                    a single number would be a judgement the platform cannot
                    defend. Publishing is opt-in, per checklist.
     3. THE DESK    only configured verifier accounts get a 200 from the
                    queue; everyone else never sees the panel.

   Tone rule for every string here: a claim is evidence, never a verdict.
   ═══════════════════════════════════════════════════════════════════════════ */

const STATE_CHIP = {
  met: { label: "Verified", variant: "brand" },
  needs_confirmation: { label: "Needs confirmation", variant: "amber" },
  missing: { label: "Not on file", variant: "gray" },
  unverifiable: { label: "Cannot be checked", variant: "outline" },
};

function ReadinessPanel({ checklist, published, onTogglePublish, busy }) {
  if (!checklist) return null;
  const chip = (state) => STATE_CHIP[state] || STATE_CHIP.missing;
  return (
    <section className="rounded-2xl border border-edge-1 bg-surface-0 p-3.5 space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-ink-1">{checklist.label}</h3>
          <p className="text-2xs text-ink-4">{checklist.audience}</p>
        </div>
        <label className="inline-flex items-center gap-1.5 text-2xs font-semibold text-ink-2 cursor-pointer">
          <input type="checkbox" checked={published} disabled={busy}
                 onChange={(e) => onTogglePublish(checklist.checklist, e.target.checked)}
                 className="accent-brand-600" />
          Publish this checklist
        </label>
      </header>

      {checklist.note && <p className="text-2xs text-ink-3">{checklist.note}</p>}

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="brand" size="sm">{checklist.summary.met} verified</Badge>
        {checklist.summary.needs_confirmation > 0 && (
          <Badge variant="amber" size="sm">{checklist.summary.needs_confirmation} need confirmation</Badge>
        )}
        {checklist.summary.missing > 0 && (
          <Badge variant="gray" size="sm">{checklist.summary.missing} not on file</Badge>
        )}
        <span className="text-2xs text-ink-3">{checklist.sentence}</span>
      </div>

      <ul className="divide-y divide-edge-1 rounded-xl border border-edge-1 bg-surface-1">
        {checklist.items.map((item) => {
          const meta = chip(item.state);
          return (
            <li key={item.label} className="px-3 py-2 flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-ink-1">
                  {item.label}
                  {item.must_have && <span className="text-2xs text-ink-4"> · required</span>}
                </p>
                <p className="text-2xs text-ink-4">{item.next_step}</p>
              </div>
              <Badge variant={meta.variant} size="xs">{meta.label}</Badge>
            </li>
          );
        })}
      </ul>
      <p className="text-2xs text-ink-4">
        Readiness counts documents you have on file; it is not a compliance
        statement, and a missing line never blocks you from offering.
      </p>
    </section>
  );
}

function ClaimForm({ catalog, initial, onClose, onSaved }) {
  const groups = useMemo(() => {
    const byGroup = {};
    (catalog?.claims || []).forEach((c) => { (byGroup[c.group] ||= []).push(c); });
    return byGroup;
  }, [catalog]);

  const [key, setKey] = useState(initial?.claim_key || "");
  const [reference, setReference] = useState(initial?.reference || "");
  const [issuedOn, setIssuedOn] = useState(initial?.issued_on || "");
  const [expiresOn, setExpiresOn] = useState(initial?.expires_on || "");
  const [note, setNote] = useState(initial?.note || "");
  const [shareReference, setShareReference] = useState(initial?.share_reference ?? true);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const spec = (catalog?.claims || []).find((c) => c.key === key);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await passportAPI.saveClaim({
        claim_key: key, reference, issued_on: issuedOn, expires_on: expiresOn,
        note, share_reference: shareReference,
      }, file);
      toast.success("Saved to your passport — ask for a check when you are ready");
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(apiError(err, "That could not be saved"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-edge-1 bg-surface-0 p-3.5 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-bold text-ink-1">
          {initial ? `Update ${initial.label}` : "Add a fact"}
        </h3>
        <button type="button" onClick={onClose} aria-label="Close" className="text-ink-4 hover:text-ink-1 cursor-pointer">
          <X size={16} />
        </button>
      </div>

      {!initial && (
        <label className="block">
          <span className="text-2xs font-semibold text-ink-2">Which document?</span>
          <Select value={key} onChange={(e) => setKey(e.target.value)} required
                  aria-label="Which document?">
            <option value="" disabled>Choose a document…</option>
            {Object.entries(groups).map(([group, claims]) => (
              <optgroup key={group} label={group}>
                {claims.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </optgroup>
            ))}
          </Select>
        </label>
      )}

      {spec && (
        <div className="rounded-xl bg-surface-1 border border-edge-1 px-3 py-2 space-y-1">
          <p className="text-2xs text-ink-3"><strong className="text-ink-2">Issued by:</strong> {spec.issuer}</p>
          <p className="text-2xs text-ink-3">{spec.evidence}</p>
          {spec.hint && <p className="text-2xs text-ink-4">{spec.hint}</p>}
          {spec.attribute && (
            <p className="text-2xs text-amber-700 dark:text-amber-300">
              This is a declaration, not a certificate — where you have a CR12, it is the tie-breaker.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="text-2xs font-semibold text-ink-2">Reference number (optional)</span>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="What the document says" />
        </label>
        <label className="block">
          <span className="text-2xs font-semibold text-ink-2">Issued on</span>
          <Input type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-2xs font-semibold text-ink-2">
            Expires on{spec?.validity_months ? ` (defaults to ${spec.validity_months} months)` : " (if it carries one)"}
          </span>
          <Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-2xs font-semibold text-ink-2">Evidence (PDF or image)</span>
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp"
                 onChange={(e) => setFile(e.target.files?.[0] || null)}
                 className="block w-full text-2xs text-ink-3 file:mr-2 file:rounded-lg file:border-0 file:bg-surface-2 file:px-2 file:py-1.5 file:text-2xs file:font-semibold file:text-ink-2" />
        </label>
      </div>

      <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                placeholder="Anything a verifier should know (optional)" />

      <label className="inline-flex items-center gap-1.5 text-2xs font-semibold text-ink-2 cursor-pointer">
        <input type="checkbox" checked={shareReference} onChange={(e) => setShareReference(e.target.checked)}
               className="accent-brand-600" />
        Show the reference on my public passport
      </label>

      {error && <p className="text-2xs text-red-700 dark:text-red-300">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={busy} disabled={busy || !key}>
          Save to passport
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

function VerifierDesk() {
  const [queue, setQueue] = useState(null);
  const [notes, setNotes] = useState({});
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    passportAPI.queue()
      .then((r) => setQueue(r.data.queue || []))
      .catch(() => setQueue(null));   // 403 for ordinary accounts: no panel, no error
  }, []);
  useEffect(() => { load(); }, [load]);

  if (queue === null) return null;

  const record = async (id, fn) => {
    setBusyId(id);
    try {
      await fn();
      toast.success("Recorded — the owner has been told");
      setNotes((prev) => ({ ...prev, [id]: "" }));
      load();
    } catch (err) {
      toast.error(apiError(err, "That could not be recorded"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-2xl border border-edge-1 bg-surface-0 p-3.5 space-y-3">
      <header>
        <h3 className="text-sm font-bold text-ink-1 inline-flex items-center gap-1.5">
          <ClipboardCheck size={14} /> Verifier desk
        </h3>
        <p className="text-2xs text-ink-4">
          Documents waiting for a human. Check the document against the issuer
          where you can, and say what you checked — your note is stored verbatim
          and shown to the owner.
        </p>
      </header>
      {queue.length === 0 && <p className="text-2xs text-ink-4">Nothing waiting. Good.</p>}
      <ul className="space-y-2">
        {queue.map((item) => (
          <li key={item.id} className="rounded-xl border border-edge-1 bg-surface-1 px-3 py-2 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink-1 truncate">
                  {item.label} · {item.vendor?.business_name}
                </p>
                <p className="text-2xs text-ink-4">
                  @{item.vendor?.handle}{item.vendor?.location ? ` · ${item.vendor.location}` : ""}
                  {item.reference ? ` · ref ${item.reference}` : ""}
                </p>
              </div>
              <FactStatusBadge status={item.status} />
            </div>
            {item.evidence_url ? (
              <a href={item.evidence_url} target="_blank" rel="noreferrer"
                 className="text-2xs text-brand-700 dark:text-brand-300 underline inline-flex items-center gap-1">
                <ExternalLink size={10} /> Open the evidence
              </a>
            ) : (
              <p className="text-2xs text-ink-4">No file — the reference on the row is what there is to check.</p>
            )}
            <Input value={notes[item.id] || ""} maxLength={500}
                   aria-label={`What you checked for ${item.vendor?.handle || "this business"}`}
                   placeholder="What did you check? e.g. TCC verified on iTax, valid to 12 Aug 2027"
                   onChange={(e) => setNotes((prev) => ({ ...prev, [item.id]: e.target.value }))} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" loading={busyId === item.id} disabled={busyId === item.id}
                      onClick={() => record(item.id, () => passportAPI.verify(item.id, {
                        method: "registry_check", note: notes[item.id] || "",
                      }))}>
                Verify
              </Button>
              <Button size="sm" variant="ghost" disabled={busyId === item.id}
                      onClick={() => record(item.id, () => passportAPI.reject(item.id, notes[item.id] || ""))}>
                Send back
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-2xs text-ink-4">
        Verifying means: you saw the document (or checked the reference at the
        issuer) on this date. It is not a judgement about the business.
      </p>
    </section>
  );
}

export default function PassportPage() {
  const vendor = useAuthStore((s) => s.vendor);
  const [catalog, setCatalog] = useState(null);
  const [passport, setPassport] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);   // null | {} (new) | claim
  const [headline, setHeadline] = useState("");
  const [editingHeadline, setEditingHeadline] = useState(false);
  const [activeChecklist, setActiveChecklist] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError("");
    return passportAPI.me()
      .then((r) => {
        setPassport(r.data);
        setHeadline(r.data.headline || "");
        setActiveChecklist((current) =>
          current || r.data.published_checklists?.[0] || r.data.all_checklists?.[0] || "");
      })
      .catch((e) => setError(apiError(e, "Your passport could not be loaded")));
  }, []);

  useEffect(() => {
    passportAPI.catalog().then((r) => setCatalog(r.data)).catch(() => {});
    load();
  }, [load]);

  const checklist = useMemo(() => {
    if (!passport || !activeChecklist) return null;
    if (passport.readiness?.some((r) => r.checklist === activeChecklist)) {
      return passport.readiness.find((r) => r.checklist === activeChecklist);
    }
    return null;
  }, [passport, activeChecklist]);

  // Readiness for an unpublished checklist is not in the passport payload;
  // fetch it on demand (the owner may always see their own).
  useEffect(() => {
    if (!activeChecklist || !passport) return;
    if (passport.readiness?.some((r) => r.checklist === activeChecklist)) return;
    passportAPI.readiness(activeChecklist)
      .then((r) => setPassport((prev) => prev ? { ...prev, readiness: [...(prev.readiness || []), r.data] } : prev))
      .catch(() => {});
  }, [activeChecklist, passport]);

  const act = async (fn, ok) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); }
    catch (err) { toast.error(apiError(err, "That did not work")); }
    finally { setBusy(false); }
  };

  const togglePublish = (checklistKey, on) => {
    const current = passport?.published_checklists || [];
    const next = on ? [...new Set([...current, checklistKey])] : current.filter((k) => k !== checklistKey);
    return act(() => passportAPI.setProfile(headline, next),
               on ? "Checklist published" : "Checklist unpublished");
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!passport) return <PageSpinner label="Loading your passport" />;

  const counts = passport.counts || {};
  const publicLink = vendor ? `/@${vendor.vendor_handle}` : "/me";

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Business", to: "/me" }, { label: "Passport" }]} />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-1 tracking-tight inline-flex items-center gap-2">
            <ShieldCheck size={20} className="text-brand-600 dark:text-brand-300" /> Business passport
          </h1>
          <p className="text-2xs text-ink-3 mt-1">
            What your business has on record, and who checked it. {counts.verified || 0} verified fact
            {(counts.verified || 0) === 1 ? "" : "s"}
            {counts.needs_confirmation ? ` · ${counts.needs_confirmation} awaiting a check` : ""}
            {counts.expired ? ` · ${counts.expired} expired` : ""}.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => setEditing({})}>
            Add a fact
          </Button>
          <Link to={publicLink}>
            <Button size="sm" variant="ghost" icon={Share2}>View public passport</Button>
          </Link>
        </div>
      </header>

      {/* ── the headline, in the owner's words ─────────────────────────── */}
      <section className="rounded-2xl border border-edge-1 bg-surface-0 p-3.5">
        {editingHeadline ? (
          <div className="space-y-2">
            <Input value={headline} maxLength={200} onChange={(e) => setHeadline(e.target.value)}
                   placeholder="One line a buyer should read first" aria-label="Headline" />
            <div className="flex gap-2">
              <Button size="sm" loading={busy}
                      onClick={() => act(() => passportAPI.setProfile(headline, passport.published_checklists || []), "Saved")
                        .then(() => setEditingHeadline(false))}>
                Save
              </Button>
              <Button size="sm" variant="ghost"
                      onClick={() => { setHeadline(passport.headline || ""); setEditingHeadline(false); }}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-ink-1">
              {passport.headline || <span className="text-ink-4">Add a line in your own words — buyers read it first.</span>}
            </p>
            <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditingHeadline(true)}>Edit</Button>
          </div>
        )}
        <p className="text-2xs text-ink-4 mt-2">{passport.disclaimer}</p>
      </section>

      {passport.expiring_soon?.length > 0 && (
        <section className="rounded-2xl border border-amber-500/40 bg-amber-50/60 dark:bg-amber-500/10 p-3.5">
          <h2 className="text-xs font-bold text-ink-1 inline-flex items-center gap-1.5">
            <RefreshCw size={13} /> Renew before it lapses
          </h2>
          <ul className="mt-1.5 space-y-0.5">
            {passport.expiring_soon.map((fact) => (
              <li key={fact.id} className="text-2xs text-ink-2">
                {fact.label} — expires {fact.expires_on}
              </li>
            ))}
          </ul>
        </section>
      )}

      {editing && (
        <ClaimForm catalog={catalog} initial={editing.claim_key ? editing : null}
                   onClose={() => setEditing(null)} onSaved={load} />
      )}

      {/* ── the facts ──────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-ink-1">Facts on record</h2>
        {passport.facts?.length ? (
          <ul className="space-y-1.5">
            {passport.facts.map((fact) => (
              <li key={fact.id} className="rounded-xl border border-edge-1 bg-surface-1 px-3 py-2 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-ink-1 truncate">{fact.label}</p>
                    <p className="text-2xs text-ink-4 truncate">
                      {fact.issuer}
                      {fact.expires_on ? ` · expires ${fact.expires_on}` : ""}
                      {fact.verified_at ? ` · checked ${fact.verified_at.slice(0, 10)}` : ""}
                    </p>
                  </div>
                  <FactStatusBadge status={fact.status} />
                </div>
                {fact.rejection_reason && (
                  <p className="text-2xs text-red-700 dark:text-red-300">
                    Sent back: {fact.rejection_reason}
                  </p>
                )}
                {fact.verification_note && (
                  <p className="text-2xs text-ink-3 italic">Verifier: {fact.verification_note}</p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {fact.evidence_url ? (
                    <a href={fact.evidence_url} target="_blank" rel="noreferrer"
                       className="text-2xs text-brand-700 dark:text-brand-300 underline inline-flex items-center gap-1">
                      <FileUp size={10} /> {fact.evidence_name || "Evidence"}
                    </a>
                  ) : (
                    <span className="text-2xs text-ink-4">No file attached</span>
                  )}
                  {fact.status !== "verified" && !fact.verification_requested_at && (
                    <Button size="sm" variant="ghost" disabled={busy}
                            onClick={() => act(() => passportAPI.requestVerification(fact.id), "Sent to the verifier desk")}>
                      Ask for a check
                    </Button>
                  )}
                  {fact.verification_requested_at && fact.status !== "verified" && (
                    <Badge variant="outline" size="xs">Waiting for a verifier</Badge>
                  )}
                  <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(fact)}>
                    Replace
                  </Button>
                  <Button size="sm" variant="ghost" icon={Trash2} disabled={busy}
                          onClick={() => act(() => passportAPI.withdraw(fact.id), "Withdrawn — the history stays")}>
                    Withdraw
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={BadgeCheck}
            title="Nothing on record yet"
            description="Add the documents buyers ask for most — registration, KRA PIN, tax compliance, county permit — and ask for a check. Each one is evidence, not a badge."
          />
        )}
      </section>

      {/* ── readiness ──────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-ink-1">Readiness</h2>
          <div className="flex flex-wrap gap-1">
            {(passport.all_checklists || []).map((key) => {
              const meta = (catalog?.checklists || []).find((c) => c.key === key);
              const on = key === activeChecklist;
              return (
                <button key={key} type="button" onClick={() => setActiveChecklist(key)}
                        aria-pressed={on}
                        className={cn(
                          "rounded-full px-2.5 py-1 text-2xs font-semibold cursor-pointer transition-colors",
                          on ? "bg-brand-600 text-white" : "bg-surface-2 text-ink-3 hover:text-ink-1"
                        )}>
                  {meta?.label || key}
                </button>
              );
            })}
          </div>
        </div>
        {checklist ? (
          <ReadinessPanel checklist={checklist} busy={busy}
                          published={(passport.published_checklists || []).includes(activeChecklist)}
                          onTogglePublish={togglePublish} />
        ) : (
          <SkeletonRows count={4} />
        )}
      </section>

      {catalog && (
        <section className="rounded-2xl border border-edge-1 bg-surface-0 p-3.5">
          <h2 className="text-sm font-bold text-ink-1">What a claim means here</h2>
          <div className="mt-2 space-y-2">
            <VerifiedFacts facts={(passport.facts || []).slice(0, 1)} mine />
            <p className="text-2xs text-ink-4">{passport.disclaimer}</p>
          </div>
        </section>
      )}

      <VerifierDesk />
    </div>
  );
}
