import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity, AlertTriangle, ArrowUpRight, BadgeCheck, Check, HelpCircle,
  Clock3, FileCheck2, Landmark, LockKeyhole, MessageSquare,
  RefreshCw, ShieldCheck, ThumbsDown, ThumbsUp, Vote, WalletCards,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card, { CardHeader, CardTitle } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Input, { fieldBase } from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { apiError, governanceAPI, locksAPI } from "@/lib/api";

const purposeCopy = {
  lender_profile_sharing: {
    title: "Financial profile sharing",
    detail: "Separate, optional consent. This does not enable lender exports in this build.",
    sensitive: true,
  },
  aggregate_market_research: {
    title: "Anonymous market research",
    detail: "Use in aggregated research only; no individual vendor profile is published.",
  },
  voice_reuse: {
    title: "Voice recording reuse",
    detail: "Voice recordings stay private by default and are not used for scoring or monetized here.",
    sensitive: true,
  },
  promotional_story: {
    title: "Promotional story",
    detail: "Separate permission for a public story or quotation. You can revoke it at any time.",
  },
};

const labelize = (value = "") => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const money = (value) => `KSh ${Number(value || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const asDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" }).format(date);
};
const inputDateTime = (date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};
const inputDate = (date) => inputDateTime(date).slice(0, 10);
const localDateTimeToIso = (value) => new Date(`${value}:00+03:00`).toISOString();
const stateBadge = (status) => {
  const color = ({ open: "blue", passed: "brand", implemented: "brand", rejected: "red", expired: "gray", cancelled: "gray", draft: "amber" })[status] || "gray";
  return <Badge variant={color} size="xs">{labelize(status || "unknown")}</Badge>;
};
const eligibilityText = (eligibility) => (eligibility?.reasons || []).map((reason) => typeof reason === "string" ? reason : reason.explanation || labelize(reason.code || "Not eligible"));

function SectionHeading({ icon: Icon, title, detail, action }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 rounded-lg border border-edge-2 bg-surface-3 p-2 text-brand-300"><Icon size={16} /></span>
        <div><h2 className="text-sm font-semibold text-ink-1">{title}</h2><p className="mt-0.5 text-xs text-ink-4 max-w-2xl">{detail}</p></div>
      </div>
      {action}
    </div>
  );
}

function ProposalCard({ proposal, onVote }) {
  const [details, setDetails] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [voting, setVoting] = useState(false);
  const isOpen = proposal.status === "open" && new Date(proposal.closes_at) > new Date();
  const reasons = eligibilityText(proposal.eligibility);
  const showResults = async () => {
    if (result) return setDetails((open) => !open);
    setLoading(true);
    try {
      const response = await governanceAPI.results(proposal.id);
      setResult(response.data);
      setDetails(true);
    } catch (error) {
      toast.error(apiError(error, "Couldn't load proposal results"));
    } finally {
      setLoading(false);
    }
  };
  const cast = async (choice) => {
    setVoting(true);
    try {
      await onVote(proposal.id, choice);
    } finally {
      setVoting(false);
    }
  };

  return (
    <Card padding="p-4">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-ink-1">{proposal.title}</h3>
            {stateBadge(proposal.status)}
            <Badge variant="outline" size="xs">{labelize(proposal.scope)} · {labelize(proposal.authority)}</Badge>
          </div>
          <p className="mt-2 text-xs text-ink-3 leading-relaxed whitespace-pre-wrap">{proposal.summary}</p>
        </div>
        <div className="shrink-0 text-xs text-ink-4 md:text-right">
          <div className="flex items-center gap-1 md:justify-end"><Clock3 size={12} />{isOpen ? `Closes ${asDate(proposal.closes_at)}` : `Closed ${asDate(proposal.closes_at)}`}</div>
          {proposal.vendor_vote && <p className="mt-1 text-ink-3">Your vote: <span className="font-semibold">{labelize(proposal.vendor_vote)}</span></p>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {isOpen && (
          <>
            {[
              ["yes", "Yes", ThumbsUp], ["no", "No", ThumbsDown], ["abstain", "Abstain", HelpCircle],
            ].map(([value, label, Icon]) => (
              <Button key={value} size="xs" variant={proposal.vendor_vote === value ? "primary" : "outline"} icon={Icon}
                loading={voting} disabled={!proposal.eligibility?.eligible} onClick={() => cast(value)}>
                {proposal.vendor_vote === value ? `Voted ${label}` : label}
              </Button>
            ))}
            {!proposal.eligibility?.eligible && <span className="text-2xs text-amber-300">Ballot not available yet</span>}
          </>
        )}
        {!isOpen && <Button size="xs" variant="outline" loading={loading} onClick={showResults}>{details ? "Hide results" : "View results"}</Button>}
        {proposal.proposed_changes && Object.keys(proposal.proposed_changes).length > 0 && (
          <Button size="xs" variant="ghost" onClick={() => setDetails((open) => !open)}>{details ? "Hide proposal detail" : "What is proposed?"}</Button>
        )}
      </div>

      {!proposal.eligibility?.eligible && isOpen && reasons.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-2xs text-ink-4 space-y-0.5">{reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
      )}
      {details && proposal.proposed_changes && Object.keys(proposal.proposed_changes).length > 0 && (
        <div className="mt-3 rounded-lg border border-edge-1 bg-surface-0 p-3">
          <p className="mb-1 text-2xs uppercase tracking-wide text-ink-4">Proposed changes · not automatically applied</p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-ink-2">{JSON.stringify(proposal.proposed_changes, null, 2)}</pre>
        </div>
      )}
      {details && result && (
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-lg border border-edge-1 bg-surface-0 p-3 text-xs">
          <p>Eligible vendors <b className="block text-ink-1">{result.eligible_voters}</b></p>
          <p>Participated <b className="block text-ink-1">{result.participants}</b></p>
          <p>Yes / no / abstain <b className="block text-ink-1">{result.yes} / {result.no} / {result.abstain}</b></p>
          <p>Outcome <b className="block text-ink-1">{labelize(result.result || result.status)}</b></p>
          <p className="col-span-full text-ink-4">Quorum {result.quorum_met ? "met" : "not met"} · {result.implementation_status || "No implementation status recorded"}</p>
        </div>
      )}
      {proposal.implementation_note && <p className="mt-3 border-l-2 border-brand-500 pl-3 text-xs text-ink-3">Implementation update: {proposal.implementation_note}</p>}
      {proposal.legal_basis && <p className="mt-2 text-2xs text-ink-4">Authority basis: {proposal.legal_basis}</p>}
    </Card>
  );
}

function ProposalForm({ onCreated, disabled = false }) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: "", summary: "", proposed_changes: "{}", closes_at: inputDateTime(new Date(Date.now() + 7 * 86400000)) });
  const submit = async (event) => {
    event.preventDefault();
    let proposedChanges;
    try { proposedChanges = JSON.parse(form.proposed_changes || "{}"); }
    catch { return toast.error("Proposed changes must be valid JSON (use {} if none). "); }
    setBusy(true);
    try {
      await governanceAPI.createProposal({
        title: form.title.trim(), summary: form.summary.trim(), scope: "zone", authority: "advisory",
        proposed_changes: proposedChanges, closes_at: localDateTimeToIso(form.closes_at),
      });
      toast.success("Zone proposal opened for an advisory vendor vote.");
      setForm({ title: "", summary: "", proposed_changes: "{}", closes_at: inputDateTime(new Date(Date.now() + 7 * 86400000)) });
      onCreated();
    } catch (error) { toast.error(apiError(error, "Couldn't open this proposal")); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="grid md:grid-cols-2 gap-3">
      <Input label="Proposal title" required minLength={8} maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="A clear, specific decision" />
      <Input label="Voting closes (East Africa Time)" type="datetime-local" required value={form.closes_at} onChange={(e) => setForm({ ...form, closes_at: e.target.value })} />
      <Textarea label="Context and question for vendors" required minLength={20} maxLength={3000} rows={4} className="md:col-span-2" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder="Explain the question, who it affects, and what a yes or no vote would mean." />
      <Textarea label="Proposed changes (JSON, optional)" rows={3} className="md:col-span-2 font-mono text-xs" value={form.proposed_changes} onChange={(e) => setForm({ ...form, proposed_changes: e.target.value })} hint="This is a record of the proposal only; a passed vote does not automatically change platform settings." />
      <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xs text-ink-4">Zone · advisory · one eligible verified vendor, one vote. Binding/cooperative powers are not enabled.</p>
        <Button type="submit" size="sm" icon={Vote} loading={busy} disabled={disabled}>Open proposal</Button>
      </div>
    </form>
  );
}

function ConsentCard({ consent, onChange }) {
  const copy = purposeCopy[consent.purpose] || {};
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      const granted = !consent.granted;
      await onChange(consent.purpose, {
        granted,
        expires_at: granted ? new Date(Date.now() + 30 * 86400000).toISOString() : null,
      });
    } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-edge-1 bg-surface-0 p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2"><h3 className="text-xs font-semibold text-ink-1">{copy.title || labelize(consent.purpose)}</h3>{consent.sensitive && <LockKeyhole size={12} className="text-amber-300" />}</div>
        <p className="mt-1 text-2xs text-ink-4">{copy.detail}</p>
        {consent.granted && <p className="mt-1 text-2xs text-ink-4">Granted until {asDate(consent.expires_at)}</p>}
      </div>
      <Button size="xs" variant={consent.granted ? "outline" : "secondary"} loading={busy} onClick={toggle}>{consent.granted ? "Revoke" : "Grant for 30 days"}</Button>
    </div>
  );
}

const appealTransitions = {
  submitted: [["acknowledged", "Acknowledge"], ["under_review", "Start review"]],
  acknowledged: [["under_review", "Start review"], ["upheld", "Uphold"], ["partially_reversed", "Partially reverse"], ["reversed", "Reverse"]],
  under_review: [["upheld", "Uphold"], ["partially_reversed", "Partially reverse"], ["reversed", "Reverse"]],
};

function OpsConsole({ refresh, approvals, appeals, audit, onDecision, onAppealResolve }) {
  const [tab, setTab] = useState("approvals");
  const [note, setNote] = useState({});
  const [decisionBusy, setDecisionBusy] = useState(null);
  const openAppeals = appeals.filter((item) => !["upheld", "partially_reversed", "reversed"].includes(item.status));
  const decide = async (request, approve) => {
    const explanation = note[request.id]?.trim();
    if (!explanation || explanation.length < 10) return toast.error("Add an independent review note of at least 10 characters.");
    setDecisionBusy(request.id);
    try {
      await onDecision(request.id, { approve, reason_code: approve ? "SECOND_ADMIN_APPROVAL" : "SECOND_ADMIN_DECLINE", explanation });
      setNote((state) => ({ ...state, [request.id]: "" }));
    } finally { setDecisionBusy(null); }
  };
  const updateAppeal = async (appeal, status) => {
    const explanation = note[appeal.id]?.trim();
    if (!explanation || explanation.length < 10) return toast.error("Add a reasoned case note of at least 10 characters.");
    await onAppealResolve(appeal.id, { status, reason_code: `HUMAN_${status.toUpperCase()}`, resolution_note: explanation });
    setNote((state) => ({ ...state, [appeal.id]: "" }));
  };
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {[["approvals", `Second approvals (${approvals.length})`], ["appeals", `Appeals (${openAppeals.length})`], ["audit", "Audit history"]].map(([key, label]) => (
          <Button key={key} size="xs" variant={tab === key ? "secondary" : "ghost"} onClick={() => setTab(key)}>{label}</Button>
        ))}
        <Button size="xs" variant="ghost" icon={RefreshCw} onClick={refresh}>Refresh console</Button>
      </div>
      {tab === "approvals" && <div className="space-y-3">
        {approvals.length === 0 ? <p className="text-xs text-ink-4">No pending dual-approval requests.</p> : approvals.map((request) => (
          <div key={request.id} className="rounded-lg border border-edge-1 bg-surface-0 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-semibold text-ink-1">{labelize(request.action_type)} request</h3><Badge variant="amber" size="xs">2 distinct admins required</Badge></div>
            <p className="mt-1 text-xs text-ink-3">{request.explanation}</p>
            <p className="mt-1 text-2xs text-ink-4">Reason: {request.reason_code} · Submitted {asDate(request.created_at)}</p>
            <pre className="mt-2 max-h-36 overflow-auto rounded bg-surface-1 p-2 text-2xs text-ink-4">{JSON.stringify(request.payload, null, 2)}</pre>
            <Textarea label="Independent review note" required minLength={10} rows={2} className="mt-2" value={note[request.id] || ""} onChange={(e) => setNote((state) => ({ ...state, [request.id]: e.target.value }))} />
            <div className="mt-2 flex gap-2"><Button size="xs" icon={Check} loading={decisionBusy === request.id} onClick={() => decide(request, true)}>Approve</Button><Button size="xs" variant="dangerGhost" loading={decisionBusy === request.id} onClick={() => decide(request, false)}>Decline</Button></div>
          </div>
        ))}
      </div>}
      {tab === "appeals" && <div className="space-y-3">
        {openAppeals.length === 0 ? <p className="text-xs text-ink-4">No open appeals.</p> : openAppeals.map((appeal) => (
          <div key={appeal.id} className="rounded-lg border border-edge-1 bg-surface-0 p-3">
            <div className="flex flex-wrap items-center gap-2"><h3 className="text-xs font-semibold text-ink-1">{labelize(appeal.subject_type)}</h3>{stateBadge(appeal.status)}<span className="text-2xs text-ink-4">{asDate(appeal.created_at)}</span></div>
            <p className="mt-2 text-xs text-ink-3 whitespace-pre-wrap">{appeal.appeal_text}</p>
            <Textarea label="Human review note" rows={2} className="mt-2" value={note[appeal.id] || ""} onChange={(e) => setNote((state) => ({ ...state, [appeal.id]: e.target.value }))} />
            <div className="mt-2 flex flex-wrap gap-2">{(appealTransitions[appeal.status] || []).map(([status, label]) => <Button key={status} size="xs" variant={status === "reversed" || status === "partially_reversed" ? "outline" : "ghost"} onClick={() => updateAppeal(appeal, status)}>{label}</Button>)}</div>
          </div>
        ))}
      </div>}
      {tab === "audit" && <div className="max-h-[28rem] space-y-2 overflow-auto">
        {audit.length === 0 ? <p className="text-xs text-ink-4">No governance audit entries yet.</p> : audit.map((event) => (
          <details key={event.id} className="rounded-lg border border-edge-1 bg-surface-0 p-3">
            <summary className="cursor-pointer text-xs text-ink-2"><span className="font-semibold">{labelize(event.action)}</span> · {labelize(event.actor_type)} · {asDate(event.created_at)}</summary>
            <p className="mt-2 text-xs text-ink-3">{event.explanation}</p>
            <p className="mt-1 text-2xs text-ink-4">{event.entity_type} · {event.entity_id} · {event.reason_code}</p>
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-surface-1 p-2 text-2xs text-ink-4">{JSON.stringify({ previous: event.previous_state, next: event.new_state }, null, 2)}</pre>
          </details>
        ))}
      </div>}
    </div>
  );
}

function BenefitOps({ refresh }) {
  const today = inputDate(new Date());
  const [busy, setBusy] = useState("");
  const [revenue, setRevenue] = useState({ source_type: "subscription", source_reference: "", gross_amount_ksh: "", payment_fees_ksh: "0", recognized_at: inputDateTime(new Date()), evidence_note: "" });
  const [event, setEvent] = useState({ vendor_id: "", metric_type: "fulfilled_purchase", amount: "", source_type: "verified_operator_review", source_reference: "", evidence_note: "", event_at: inputDateTime(new Date()) });
  const [period, setPeriod] = useState({ starts_at: `${today.slice(0, 7)}-01`, ends_at: today, distribution_method: "group_buy_credit" });
  const [policy, setPolicy] = useState({ operations_rate: "", vendor_pool_rate: "", local_ops_rate: "", dispute_reserve_rate: "", training_fund_rate: "", effective_from: inputDateTime(new Date(Date.now() + 2 * 86400000)), governance_proposal_id: "", reason_code: "", explanation: "" });
  const [rule, setRule] = useState({ governance_proposal_id: "", effective_from: inputDateTime(new Date(Date.now() + 2 * 86400000)), reason_code: "", explanation: "" });
  const [ruleJson, setRuleJson] = useState("");
  const [ruleLoaded, setRuleLoaded] = useState(false);

  const send = async (kind, action, reset) => {
    setBusy(kind);
    try { const response = await action(); toast.success(response?.data?.message || "Recorded for human review."); reset?.(); refresh(); }
    catch (error) { toast.error(apiError(error, `Couldn't save ${kind}`)); }
    finally { setBusy(""); }
  };
  const submitRevenue = (e) => {
    e.preventDefault();
    send("revenue", () => governanceAPI.recordRevenue({ ...revenue, gross_amount_ksh: Number(revenue.gross_amount_ksh), payment_fees_ksh: Number(revenue.payment_fees_ksh), recognized_at: localDateTimeToIso(revenue.recognized_at) }), () => setRevenue({ ...revenue, source_reference: "", gross_amount_ksh: "", evidence_note: "" }));
  };
  const submitEvent = (e) => {
    e.preventDefault();
    send("evidence", () => governanceAPI.recordBenefitEvent({ ...event, amount: Number(event.amount), event_at: localDateTimeToIso(event.event_at) }), () => setEvent({ ...event, amount: "", source_reference: "", evidence_note: "" }));
  };
  const submitPeriod = (e) => {
    e.preventDefault();
    send("period", () => governanceAPI.calculateBenefitPeriod({
      starts_at: new Date(`${period.starts_at}T00:00:00+03:00`).toISOString(),
      ends_at: new Date(`${period.ends_at}T00:00:00+03:00`).toISOString(),
      distribution_method: period.distribution_method,
    }));
  };
  const submitPolicy = (e) => {
    e.preventDefault();
    const rates = [policy.operations_rate, policy.vendor_pool_rate, policy.local_ops_rate, policy.dispute_reserve_rate, policy.training_fund_rate].map((value) => Math.round(Number(value) * 10000));
    if (rates.some((value) => !Number.isFinite(value)) || rates.reduce((sum, value) => sum + value, 0) !== 10000) return toast.error("Policy rates must add up to exactly 1.0000.");
    send("policy request", () => governanceAPI.requestPolicy({ ...policy, ...Object.fromEntries(["operations_rate", "vendor_pool_rate", "local_ops_rate", "dispute_reserve_rate", "training_fund_rate"].map((key) => [key, Number(policy[key])])), effective_from: localDateTimeToIso(policy.effective_from) }));
  };
  const loadCurrentRules = async () => {
    try {
      const { data } = await governanceAPI.scoreRules();
      if (!data.active) return toast.error("No active score rules to copy.");
      setRuleJson(JSON.stringify(data.configuration, null, 2));
      setRuleLoaded(true);
    } catch (error) { toast.error(apiError(error, "Couldn't load published score rules")); }
  };
  const submitRule = (e) => {
    e.preventDefault();
    let configuration;
    try { configuration = JSON.parse(ruleJson); }
    catch { return toast.error("Score rule configuration must be valid JSON."); }
    send("score rule request", () => governanceAPI.requestScoreRules({ ...rule, configuration, effective_from: localDateTimeToIso(rule.effective_from) }));
  };

  const numeric = (key, label, step = "0.01") => <Input key={key} label={label} type="number" min="0" step={step} required value={policy[key]} onChange={(e) => setPolicy({ ...policy, [key]: e.target.value })} />;
  return (
    <div className="space-y-4">
      <div className="grid xl:grid-cols-2 gap-4">
        <form onSubmit={submitRevenue} className="space-y-3 rounded-lg border border-edge-1 bg-surface-0 p-3">
          <h3 className="text-xs font-semibold text-ink-1">Record realized network revenue</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs text-ink-3">Revenue source<select required className={`${fieldBase} mt-1 h-9 px-3`} value={revenue.source_type} onChange={(e) => setRevenue({ ...revenue, source_type: e.target.value })}>{["supplier_facilitation_fee", "logistics_fee", "subscription", "sponsored_placement", "financial_referral", "market_report"].map((type) => <option key={type} value={type}>{labelize(type)}</option>)}</select></label>
            <Input label="Reference (unique)" required minLength={4} value={revenue.source_reference} onChange={(e) => setRevenue({ ...revenue, source_reference: e.target.value })} />
            <Input label="Gross KSh" type="number" min="0" step="0.01" required value={revenue.gross_amount_ksh} onChange={(e) => setRevenue({ ...revenue, gross_amount_ksh: e.target.value })} />
            <Input label="Payment fees KSh" type="number" min="0" step="0.01" value={revenue.payment_fees_ksh} onChange={(e) => setRevenue({ ...revenue, payment_fees_ksh: e.target.value })} />
            <Input label="Recognized (EAT)" type="datetime-local" required value={revenue.recognized_at} onChange={(e) => setRevenue({ ...revenue, recognized_at: e.target.value })} />
            <Textarea label="Evidence note" required minLength={10} rows={2} value={revenue.evidence_note} onChange={(e) => setRevenue({ ...revenue, evidence_note: e.target.value })} />
          </div>
          <Button size="xs" type="submit" loading={busy === "revenue"}>Record revenue only</Button>
        </form>

        <form onSubmit={submitEvent} className="space-y-3 rounded-lg border border-edge-1 bg-surface-0 p-3">
          <h3 className="text-xs font-semibold text-ink-1">Add reviewed participation evidence</h3>
          <p className="text-2xs text-ink-4">Only record evidence with a traceable source. The vendor ID is internal and not shown in vendor-facing allocations.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <Input label="Vendor ID" required value={event.vendor_id} onChange={(e) => setEvent({ ...event, vendor_id: e.target.value })} />
            <label className="text-xs text-ink-3">Evidence type<select required className={`${fieldBase} mt-1 h-9 px-3`} value={event.metric_type} onChange={(e) => setEvent({ ...event, metric_type: e.target.value })}>{[["fulfilled_purchase", "Fulfilled purchase"], ["verified_peer_help", "Verified peer help"], ["reliability", "Reliability (0–1)" ]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <Input label="Amount / count" type="number" min="0.01" step={event.metric_type === "verified_peer_help" ? "1" : "0.01"} required value={event.amount} onChange={(e) => setEvent({ ...event, amount: e.target.value })} />
            <Input label="Source type" required minLength={3} value={event.source_type} onChange={(e) => setEvent({ ...event, source_type: e.target.value })} />
            <Input label="Evidence reference (unique)" required minLength={4} value={event.source_reference} onChange={(e) => setEvent({ ...event, source_reference: e.target.value })} />
            <Input label="Event time (EAT)" type="datetime-local" required value={event.event_at} onChange={(e) => setEvent({ ...event, event_at: e.target.value })} />
            <Textarea label="Evidence reviewed" required minLength={10} rows={2} className="sm:col-span-2" value={event.evidence_note} onChange={(e) => setEvent({ ...event, evidence_note: e.target.value })} />
          </div>
          <Button size="xs" type="submit" loading={busy === "evidence"}>Record verified evidence</Button>
        </form>
      </div>

      <form onSubmit={submitPeriod} className="grid md:grid-cols-4 gap-3 rounded-lg border border-edge-1 bg-surface-0 p-3">
        <div className="md:col-span-4"><h3 className="text-xs font-semibold text-ink-1">Calculate a closed-period estimate</h3><p className="mt-1 text-2xs text-ink-4">This creates a review-only calculation. It never issues credits, moves money, or creates a payout.</p></div>
        <Input label="Starts (EAT, inclusive)" type="date" required value={period.starts_at} onChange={(e) => setPeriod({ ...period, starts_at: e.target.value })} />
        <Input label="Ends (EAT, exclusive)" type="date" required value={period.ends_at} onChange={(e) => setPeriod({ ...period, ends_at: e.target.value })} />
        <label className="text-xs text-ink-3">Estimate category<select className={`${fieldBase} mt-1 h-9 px-3`} value={period.distribution_method} onChange={(e) => setPeriod({ ...period, distribution_method: e.target.value })}>{[["group_buy_credit", "Group-buy credit"], ["logistics_credit", "Logistics credit"], ["training_credit", "Training credit"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className="flex items-end"><Button type="submit" size="sm" loading={busy === "period"}>Calculate estimate</Button></div>
      </form>

      <details className="rounded-lg border border-edge-1 bg-surface-0 p-3">
        <summary className="cursor-pointer text-xs font-semibold text-ink-1">Dual-approved policy and score-rule requests</summary>
        <p className="mt-2 text-2xs text-ink-4">A passed binding vendor proposal and a valid legal basis are required. Changes take effect prospectively and need a second authorized administrator.</p>
        <div className="mt-3 grid xl:grid-cols-2 gap-4">
          <form onSubmit={submitPolicy} className="space-y-3 rounded-lg border border-edge-1 p-3">
            <h3 className="text-xs font-semibold text-ink-1">Request benefit allocation policy</h3>
            <Input label="Passed proposal ID" required value={policy.governance_proposal_id} onChange={(e) => setPolicy({ ...policy, governance_proposal_id: e.target.value })} />
            <div className="grid sm:grid-cols-2 gap-3">{[
              ["operations_rate", "Operations share"], ["vendor_pool_rate", "Vendor pool share"], ["local_ops_rate", "Local operations share"], ["dispute_reserve_rate", "Dispute reserve"], ["training_fund_rate", "Training fund"],
            ].map(([key, label]) => numeric(key, label, "0.0001"))}</div>
            <Input label="Effective from (EAT)" type="datetime-local" required value={policy.effective_from} onChange={(e) => setPolicy({ ...policy, effective_from: e.target.value })} />
            <Input label="Reason code" required minLength={3} value={policy.reason_code} onChange={(e) => setPolicy({ ...policy, reason_code: e.target.value })} />
            <Textarea label="Explanation" required minLength={20} rows={2} value={policy.explanation} onChange={(e) => setPolicy({ ...policy, explanation: e.target.value })} />
            <Button type="submit" size="xs" loading={busy === "policy request"}>Request second approval</Button>
          </form>
          <form onSubmit={submitRule} className="space-y-3 rounded-lg border border-edge-1 p-3">
            <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-semibold text-ink-1">Request score-rule version</h3><Button type="button" size="xs" variant="outline" onClick={loadCurrentRules}>Copy current rules</Button></div>
            {ruleLoaded && <p className="text-2xs text-ink-4">Edit only as authorized; a passed proposal must include this exact configuration.</p>}
            <Textarea label="Rule configuration (JSON)" required rows={6} className="font-mono text-2xs" value={ruleJson} onChange={(e) => setRuleJson(e.target.value)} />
            <Input label="Passed proposal ID" required value={rule.governance_proposal_id} onChange={(e) => setRule({ ...rule, governance_proposal_id: e.target.value })} />
            <Input label="Effective from (EAT)" type="datetime-local" required value={rule.effective_from} onChange={(e) => setRule({ ...rule, effective_from: e.target.value })} />
            <Input label="Reason code" required minLength={3} value={rule.reason_code} onChange={(e) => setRule({ ...rule, reason_code: e.target.value })} />
            <Textarea label="Explanation" required minLength={20} rows={2} value={rule.explanation} onChange={(e) => setRule({ ...rule, explanation: e.target.value })} />
            <Button type="submit" size="xs" loading={busy === "score rule request"}>Request second approval</Button>
          </form>
        </div>
      </details>
    </div>
  );
}

export default function OurNetwork() {
  const [proposals, setProposals] = useState([]);
  const [council, setCouncil] = useState([]);
  const [score, setScore] = useState(null);
  const [benefits, setBenefits] = useState(null);
  const [allocationPolicy, setAllocationPolicy] = useState(null);
  const [consents, setConsents] = useState([]);
  const [myAppeals, setMyAppeals] = useState([]);
  const [opsData, setOpsData] = useState({ approvals: [], appeals: [], audit: [] });
  const [vendorZone, setVendorZone] = useState(null);
  const [opsRole, setOpsRole] = useState(null);
  const opsRoleRef = useRef(null);
  const [appealForm, setAppealForm] = useState({ subject_type: "other", appeal_text: "" });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [appealBusy, setAppealBusy] = useState(false);

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true); else setRefreshing(true);
    const results = await Promise.allSettled([
      governanceAPI.proposals(), governanceAPI.council(), governanceAPI.myScore(),
      governanceAPI.myBenefits(), governanceAPI.allocationPolicy(), governanceAPI.consents(),
      governanceAPI.myAppeals(), locksAPI.home(),
    ]);
    const setters = [setProposals, setCouncil, setScore, setBenefits, setAllocationPolicy, setConsents, setMyAppeals];
    results.slice(0, 7).forEach((result, index) => { if (result.status === "fulfilled") setters[index](result.value.data); });
    const market = results[7];
    let role = opsRoleRef.current;
    if (market.status === "fulfilled") { setVendorZone(market.value.data.vendor_zone); role = market.value.data.market_ops_role; opsRoleRef.current = role; setOpsRole(role); }
    else if (initial) toast.error(apiError(market.reason, "Couldn't load your market role"));

    if (["admin", "clerk"].includes(role)) {
      const opsResults = await Promise.allSettled([
        governanceAPI.opsAppeals(), governanceAPI.audit(100), role === "admin" ? governanceAPI.approvals() : Promise.resolve({ data: [] }),
      ]);
      setOpsData({
        appeals: opsResults[0].status === "fulfilled" ? opsResults[0].value.data : [],
        audit: opsResults[1].status === "fulfilled" ? opsResults[1].value.data : [],
        approvals: opsResults[2].status === "fulfilled" ? opsResults[2].value.data : [],
      });
    }
    if (initial && results.every((result) => result.status === "rejected")) toast.error("Governance information is temporarily unavailable.");
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(true); }, [load]);

  const vote = async (proposalId, choice) => {
    try {
      await governanceAPI.vote(proposalId, choice);
      toast.success(`Your ${choice} vote is recorded. You may change it until voting closes.`);
      await load(false);
    } catch (error) { toast.error(apiError(error, "Couldn't record your vote")); }
  };
  const changeConsent = async (purpose, data) => {
    try { await governanceAPI.setConsent(purpose, data); toast.success(data.granted ? "Consent granted for 30 days." : "Consent revoked."); await load(false); }
    catch (error) { toast.error(apiError(error, "Couldn't update consent")); }
  };
  const submitAppeal = async (event) => {
    event.preventDefault(); setAppealBusy(true);
    try {
      await governanceAPI.submitAppeal({ ...appealForm, appeal_text: appealForm.appeal_text.trim() });
      toast.success("Appeal submitted for human review."); setAppealForm({ subject_type: "other", appeal_text: "" }); await load(false);
    } catch (error) { toast.error(apiError(error, "Couldn't submit your appeal")); }
    finally { setAppealBusy(false); }
  };
  const decideApproval = async (id, data) => {
    try { await governanceAPI.decideApproval(id, data); toast.success(data.approve ? "Second approval recorded." : "Request declined."); await load(false); }
    catch (error) { toast.error(apiError(error, "Couldn't record the decision")); }
  };
  const resolveAppeal = async (id, data) => {
    try { await governanceAPI.resolveAppeal(id, data); toast.success("Appeal review updated."); await load(false); }
    catch (error) { toast.error(apiError(error, "Couldn't update the appeal")); }
  };

  const openProposals = useMemo(() => proposals.filter((proposal) => ["open", "draft"].includes(proposal.status)), [proposals]);
  const closedProposals = useMemo(() => proposals.filter((proposal) => !["open", "draft"].includes(proposal.status)), [proposals]);
  if (loading) return <PageSpinner label="Loading governance and benefit information…" />;

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div><div className="flex items-center gap-2"><h1 className="text-xl font-semibold tracking-tight text-ink-1">Our Network</h1><Badge variant="brand" size="xs">Vendor voice</Badge></div>
          <p className="mt-1 text-xs text-ink-4">Proposals, transparent rules, private consent controls and review-only benefit estimates.</p>
          {vendorZone && <p className="mt-1 text-2xs text-ink-4">Your market zone: <span className="text-ink-3">{vendorZone.name}{vendorZone.city ? ` · ${vendorZone.city}` : ""}</span></p>}
        </div>
        <Button size="sm" variant="secondary" icon={RefreshCw} loading={refreshing} onClick={() => load(false)}>Refresh</Button>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <Card padding="p-3"><div className="flex items-center gap-2 text-brand-300"><Vote size={15} /><span className="text-xs font-semibold text-ink-1">One eligible vendor, one vote</span></div><p className="mt-1 text-2xs text-ink-4">Biashara Score does not determine ballot access or weight.</p></Card>
        <Card padding="p-3"><div className="flex items-center gap-2 text-blue-300"><ShieldCheck size={15} /><span className="text-xs font-semibold text-ink-1">Human decisions, recorded</span></div><p className="mt-1 text-2xs text-ink-4">Changes to ballots and sensitive admin actions leave an audit trail.</p></Card>
        <Card padding="p-3"><div className="flex items-center gap-2 text-amber-300"><WalletCards size={15} /><span className="text-xs font-semibold text-ink-1">No cash movement</span></div><p className="mt-1 text-2xs text-ink-4">Benefit estimates are not spendable credits or guaranteed income.</p></Card>
      </div>

      <section>
        <SectionHeading icon={Vote} title="Zone proposals & votes" detail="A proposal is a transparent record of a question, authority label, ballot and outcome. A passed vote does not automatically execute its proposed changes." />
        {!vendorZone && <div className="mb-3 rounded-lg border border-amber-700/30 bg-amber-950/20 p-3 text-xs text-amber-200">Choose an active market zone in <Link to="/locks" className="underline">Market Locks</Link> before opening or voting on zone proposals.</div>}
        <Card className="mb-3" padding="p-4"><CardHeader><CardTitle sub="Zone proposals are advisory in this release">Open a proposal</CardTitle><Badge variant="outline" size="xs">No binding power enabled</Badge></CardHeader><ProposalForm disabled={!vendorZone} onCreated={() => load(false)} /></Card>
        <div className="space-y-3">{openProposals.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} onVote={vote} />)}</div>
        {openProposals.length === 0 && <EmptyState icon={Vote} title="No open proposals" description="When a zone proposal is opened, it will appear here for eligible vendor review." compact />}
        {closedProposals.length > 0 && <details className="mt-3 rounded-xl border border-edge-1 bg-surface-1 p-3"><summary className="cursor-pointer text-xs font-semibold text-ink-2">Past proposals ({closedProposals.length})</summary><div className="mt-3 space-y-3">{closedProposals.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} onVote={vote} />)}</div></details>}
      </section>

      <section>
        <SectionHeading icon={Landmark} title="Vendor council" detail="Published representation and term dates. A council listing does not imply ownership, partnership or employment." />
        {council.length ? <div className="grid md:grid-cols-2 gap-3">{council.map((term) => <Card key={term.id} padding="p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-ink-1">{term.representative_name || term.representative_handle || "Vendor representative"}</p>{stateBadge(term.status)}</div><p className="mt-1 text-2xs text-ink-4">Term {asDate(term.starts_at)} – {asDate(term.ends_at)} · {term.consecutive_term_number ? `Term ${term.consecutive_term_number}` : ""}</p><details className="mt-2"><summary className="cursor-pointer text-2xs text-ink-3">Conflict disclosure</summary><p className="mt-1 text-xs text-ink-4">{term.conflict_disclosure}</p></details></Card>)}</div> : <EmptyState icon={Landmark} title="No active council terms" description="No council representative is currently published for this view." compact />}
      </section>

      <section className="grid xl:grid-cols-2 gap-4">
        <Card padding="p-4">
          <SectionHeading icon={Activity} title="Biashara Score: your record" detail="Rule-based and explainable. This score is not a governance vote, benefit entitlement or lending decision." />
          <div className="mb-3 rounded-lg bg-surface-0 border border-edge-1 p-3"><div className="flex items-end justify-between gap-3"><div><p className="text-2xs uppercase tracking-wide text-ink-4">Recorded points · last {score?.window_days ?? 180} days</p><p className="mt-1 text-2xl font-semibold text-ink-1">{score?.score ?? 0}</p></div><Badge variant={score?.rules?.active ? "brand" : "amber"} size="xs">{score?.rules?.active ? `Rules v${score.rules.version}` : "No active rules"}</Badge></div><p className="mt-2 text-2xs text-ink-4">{score?.dimension_note || "Score dimensions will be shown when verified event sources are connected."}</p></div>
          <h3 className="mb-2 text-xs font-semibold text-ink-2">Recent explained events</h3>
          {score?.events?.length ? <div className="max-h-56 space-y-2 overflow-auto">{score.events.map((item) => <div key={item.id} className="flex items-start justify-between gap-3 border-b border-edge-1 pb-2"><div><p className="text-xs text-ink-2">{labelize(item.event_type)}</p><p className="text-2xs text-ink-4">{item.explanation}{item.failure_cause ? ` · Cause: ${labelize(item.failure_cause)}` : ""}</p><p className="text-2xs text-ink-4">{asDate(item.created_at)}</p></div><Badge variant={item.points < 0 ? "red" : "gray"} size="xs">{item.points > 0 ? "+" : ""}{item.points}</Badge></div>)}</div> : <p className="text-xs text-ink-4">No verified score events are recorded for your account.</p>}
          {score?.rules?.active && <details className="mt-3"><summary className="cursor-pointer text-2xs text-ink-3">Read active rule configuration</summary><pre className="mt-2 max-h-52 overflow-auto rounded bg-surface-0 p-2 text-2xs text-ink-4">{JSON.stringify(score.rules.configuration, null, 2)}</pre></details>}
        </Card>

        <Card padding="p-4">
          <SectionHeading icon={WalletCards} title="Your Network Benefit view" detail="This is private to you. Other vendors' individual estimates and credits are never shown here." />
          <div className="grid grid-cols-2 gap-3"><div className="rounded-lg border border-edge-1 bg-surface-0 p-3"><p className="text-2xs text-ink-4">Spendable credit</p><p className="mt-1 text-lg font-semibold text-ink-1">{money(benefits?.available_credit_ksh)}</p><p className="text-2xs text-ink-4">Not enabled</p></div><div className="rounded-lg border border-edge-1 bg-surface-0 p-3"><p className="text-2xs text-ink-4">Review-only estimate</p><p className="mt-1 text-lg font-semibold text-ink-1">{money(benefits?.pending_estimate_ksh)}</p><p className="text-2xs text-ink-4">{labelize(benefits?.pool_status || "not configured")}</p></div></div>
          {benefits?.components && <div className="mt-3 grid grid-cols-2 gap-2 text-2xs">{Object.entries(benefits.components).map(([key, value]) => <p key={key} className="rounded bg-surface-0 p-2 text-ink-4">{labelize(key)} <b className="block text-ink-2">{Number(value).toFixed(3)}</b></p>)}</div>}
          <div className="mt-3 rounded-lg border border-amber-700/30 bg-amber-950/20 p-3 text-2xs leading-relaxed text-amber-100">{benefits?.disclaimer || "No credit is issued or spendable. There is no guaranteed benefit, ownership claim, or payment balance."}</div>
          <div className="mt-3 rounded-lg border border-edge-1 bg-surface-0 p-3"><div className="flex items-center gap-2"><FileCheck2 size={14} className="text-brand-300" /><p className="text-xs font-semibold text-ink-2">Pool policy</p></div>{allocationPolicy?.active ? <p className="mt-1 text-2xs text-ink-4">Policy v{allocationPolicy.version}, effective {asDate(allocationPolicy.effective_from)} · vendor pool share {Number(allocationPolicy.rates.vendor_pool).toLocaleString("en-KE", { style: "percent", maximumFractionDigits: 2 })}</p> : <p className="mt-1 text-2xs text-ink-4">{allocationPolicy?.message || "No allocation policy is currently active."}</p>}</div>
        </Card>
      </section>

      <section>
        <SectionHeading icon={LockKeyhole} title="Your data permissions" detail="Each purpose has separate, time-limited consent and can be revoked independently. No consent is required to participate in governance." />
        <div className="space-y-2">{consents.map((consent) => <ConsentCard key={consent.purpose} consent={consent} onChange={changeConsent} />)}</div>
      </section>

      <section className="grid xl:grid-cols-2 gap-4">
        <Card padding="p-4">
          <SectionHeading icon={MessageSquare} title="Appeal a platform decision" detail="Appeals go to a human review queue. Record what happened and why you think it should be reconsidered." />
          <form onSubmit={submitAppeal} className="space-y-3">
            <label className="block text-xs text-ink-3">What is your appeal about?<select className={`${fieldBase} mt-1 h-9 px-3`} value={appealForm.subject_type} onChange={(e) => setAppealForm({ ...appealForm, subject_type: e.target.value })}>{["account_suspension", "score_event", "no_show", "moderation", "benefit", "supplier_quality", "other"].map((subject) => <option key={subject} value={subject}>{labelize(subject)}</option>)}</select></label>
            <Textarea label="Your explanation" required minLength={20} maxLength={4000} rows={4} value={appealForm.appeal_text} onChange={(e) => setAppealForm({ ...appealForm, appeal_text: e.target.value })} placeholder="Include relevant dates, references and what outcome you are asking for." />
            <Button type="submit" size="sm" icon={ArrowUpRight} loading={appealBusy}>Submit appeal</Button>
          </form>
          <div className="mt-4 border-t border-edge-1 pt-3"><h3 className="mb-2 text-xs font-semibold text-ink-2">Your appeals</h3>{myAppeals.length ? <div className="space-y-2">{myAppeals.map((appeal) => <div key={appeal.id} className="flex items-center justify-between gap-2 rounded bg-surface-0 p-2"><span className="text-xs text-ink-3">{labelize(appeal.subject_type)} · {asDate(appeal.created_at)}</span>{stateBadge(appeal.status)}</div>)}</div> : <p className="text-xs text-ink-4">No appeals submitted.</p>}</div>
        </Card>
        <Card padding="p-4">
          <SectionHeading icon={AlertTriangle} title="Vendor protections" detail="Failures outside a vendor's control should not be treated as vendor misconduct." />
          <ul className="space-y-2 text-xs text-ink-3">{[
            "Supplier, transport, PSP, telco or platform failure is not a vendor default.",
            "A declined payment is not automatically a default or score penalty.",
            "Platform criticism and votes against management do not reduce a score or benefit weight.",
            "No AI, prediction, speech-to-text or sentiment analysis is used for scoring.",
            "Voice activity does not silently affect a credit or score decision.",
          ].map((text) => <li key={text} className="flex gap-2"><BadgeCheck size={14} className="mt-0.5 shrink-0 text-brand-300" /><span>{text}</span></li>)}</ul>
        </Card>
      </section>

      {["admin", "clerk"].includes(opsRole) && <section>
        <SectionHeading icon={ShieldCheck} title="Governance operations desk" detail="Authorized operators only. Sensitive changes require a second, distinct administrator; every action requires a reason and audit history." />
        <Card padding="p-4"><OpsConsole refresh={() => load(false)} approvals={opsData.approvals} appeals={opsData.appeals} audit={opsData.audit} onDecision={decideApproval} onAppealResolve={resolveAppeal} /></Card>
        {opsRole === "admin" && <Card className="mt-3" padding="p-4"><SectionHeading icon={FileCheck2} title="Benefit accounting · admin only" detail="Record realized revenue and traceable evidence, then calculate a closed-period estimate for review. No disbursement or credit issuance is available." /><BenefitOps refresh={() => load(false)} /></Card>}
      </section>}

      <p className="border-t border-edge-1 pt-3 text-center text-2xs text-ink-4">Brief_ is a torch, not a gatekeeper. Vendors remain independent businesses, set their own prices and keep their customer relationships.</p>
    </div>
  );
}
