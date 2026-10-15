import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BadgeCheck, Building2, CreditCard, Palette, ShieldCheck, Smartphone,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { catalogAPI, apiError } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { num } from "@/lib/formatters";

const READINESS = {
  available_now: { label: "Available now", variant: "brand" },
  pilot: { label: "Pilot — supervised rollout", variant: "amber" },
  service: { label: "Sell immediately — delivered as a service", variant: "brand" },
  scoped: { label: "Scoped quotation", variant: "gray" },
};
const LINE_ICON = { digital_services: Palette, business_software: Building2, field_operations: Smartphone };

const price = (o) => {
  if (o.price_min_kes == null) return o.price_unit === "scoped" ? "Scoped quotation" : "Quoted separately";
  const range = o.price_min_kes === o.price_max_kes ? `KSh ${num(o.price_min_kes)}` : `KSh ${num(o.price_min_kes)}–${num(o.price_max_kes)}`;
  return o.price_unit === "monthly" ? `${range}/mo` : o.price_unit === "setup_once" ? `${range} once` : range;
};
const tierPrice = (t) => {
  if (t.key === "junior") return "KSh 0";
  if (t.price_min_kes == null) return "Custom";
  return `KSh ${num(t.price_min_kes)}–${num(t.price_max_kes)}/mo`;
};

export default function StorefrontPage() {
  const token = useAuthStore((s) => s.token);
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null); // offer key
  const [form, setForm] = useState({ kind: "purchase", tier_key: "business", organisation_name: "", contact_name: "", contact_phone: "", notes: "", acknowledged_first_charge: false });
  const [mine, setMine] = useState([]);
  const [busy, setBusy] = useState(false);

  const loadMine = useCallback(() => {
    if (!token) return;
    catalogAPI.myEnquiries().then((r) => setMine(r.data || [])).catch(() => {});
  }, [token]);

  useEffect(() => {
    catalogAPI.catalogue().then((r) => setData(r.data)).catch((e) => setError(apiError(e, "The catalogue could not be loaded")));
    loadMine();
  }, [loadMine]);

  if (error) return <Shell><p className="text-sm text-red-600">{error}</p></Shell>;
  if (!data) return <Shell><PageSpinner label="Loading the storefront…" /></Shell>;

  const offer = data.offers.find((o) => o.key === selected);
  const trial = data.trial;

  const submit = async (e) => {
    e.preventDefault();
    if (!token) { navigate("/auth", { state: { from: "/storefront" } }); return; }
    setBusy(true);
    try {
      await catalogAPI.createEnquiry({
        kind: form.kind,
        offer_key: form.kind === "trial" ? undefined : selected || undefined,
        tier_key: form.kind === "trial" ? "business" : form.tier_key || undefined,
        organisation_name: form.organisation_name || undefined,
        contact_name: form.contact_name || undefined,
        contact_phone: form.contact_phone || undefined,
        notes: form.notes || undefined,
        acknowledged_first_charge: form.kind === "trial" ? form.acknowledged_first_charge : false,
      });
      toast.success("Enquiry recorded — a human follows up with scope and an invoice. No payment was taken.");
      setForm({ ...form, notes: "", acknowledged_first_charge: false });
      loadMine();
    } catch (err) {
      toast.error(apiError(err, "Could not record the enquiry"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell signedIn={!!token}>
      {/* Hero — one offer per line, sell tomorrow */}
      <section className="space-y-3">
        <Badge variant="brand" size="xs">Storefront — test prices, validated with buyers before publishing</Badge>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-ink-1">Sell what businesses already buy</h1>
        <p className="text-sm text-ink-3 max-w-2xl">
          One digital service, one business-software offer and one field-operations offer — each with a
          price or starting price, fixed scope, turnaround and an enquiry route. {data.price_honesty}
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {["business_website", "membership_management", "agent_workflow_management"].map((key) => {
            const o = data.offers.find((x) => x.key === key);
            return (
              <button key={key} type="button" onClick={() => setSelected(key)}
                className="rounded-2xl border border-edge-1 bg-surface-0 p-4 text-left hover:border-brand-500/60">
                <p className="text-sm font-bold text-ink-1">{o.name}</p>
                <p className="text-lg font-extrabold text-ink-1 mt-1">{price(o)}</p>
                <p className="text-2xs text-ink-3">{o.turnaround}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Catalogue lines */}
      {data.lines.map((line) => {
        const Icon = LINE_ICON[line.key] || Building2;
        return (
          <section key={line.key} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-ink-1 flex items-center gap-2"><Icon size={18} /> {line.title}</h2>
              <Badge variant={line.key === "business_software" ? "brand" : "gray"} size="xs">{line.badge}</Badge>
              <span className="text-2xs text-ink-3">{line.terms}</span>
            </div>
            <p className="text-2xs text-ink-3 max-w-3xl">{line.note}</p>
            <div className="grid gap-2 md:grid-cols-2">
              {line.offers.map((o) => (
                <button key={o.key} type="button" onClick={() => setSelected(o.key)}
                  aria-pressed={selected === o.key}
                  className={`rounded-2xl border p-4 text-left bg-surface-0 ${selected === o.key ? "border-brand-500" : "border-edge-1"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-ink-1">{o.name}</p>
                    <Badge variant={READINESS[o.readiness]?.variant || "gray"} size="xs">{READINESS[o.readiness]?.label || o.readiness}</Badge>
                  </div>
                  <p className="text-base font-extrabold text-ink-1 mt-1">{price(o)} <span className="text-2xs font-medium text-ink-4">test price</span></p>
                  <p className="text-2xs text-ink-3 mt-1">{o.readiness_note}</p>
                </button>
              ))}
            </div>
          </section>
        );
      })}

      {/* Selected offer: fixed scope before payment */}
      {offer && (
        <section className="rounded-2xl border border-brand-500/50 bg-surface-0 p-4 space-y-2" aria-label="Offer scope">
          <h3 className="text-sm font-bold text-ink-1">{offer.name} — {price(offer)}</h3>
          <div className="grid gap-3 sm:grid-cols-3 text-2xs text-ink-3">
            <ScopeList title="Deliverables" items={offer.deliverables} />
            <ScopeList title="Exclusions" items={offer.exclusions} />
            <ScopeList title="You provide" items={offer.customer_must_provide} />
          </div>
          <p className="text-2xs text-ink-3">Turnaround: {offer.turnaround}{offer.revisions ? ` · ${offer.revisions}` : ""} Scope is fixed before payment — define deliverables, revisions, turnaround and exclusions first.</p>
        </section>
      )}

      {/* Account tiers */}
      <section className="space-y-2">
        <h2 className="text-lg font-bold text-ink-1">Accounts: free entry, paid utility, enterprise contracts</h2>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {data.account_tiers.map((t) => (
            <div key={t.key} className="rounded-2xl border border-edge-1 bg-surface-0 p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold text-ink-1">{t.name}</p>
                <Badge variant={t.key === "junior" ? "amber" : "gray"} size="xs">{t.label}</Badge>
              </div>
              <p className="text-xl font-extrabold text-ink-1">{tierPrice(t)}</p>
              <p className="text-2xs text-ink-3">{t.purpose}</p>
              <ul className="text-2xs text-ink-3 space-y-1 list-disc pl-4">{t.includes.map((i) => <li key={i}>{i}</li>)}</ul>
              <ul className="text-2xs text-ink-4 space-y-1 list-disc pl-4">{t.excludes.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          ))}
        </div>
        <p className="text-2xs text-ink-3 flex items-start gap-1.5 max-w-3xl">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" /> {data.verification_note} A Junior label
          must never be read as "unqualified" — and no tier sells a verification badge.
        </p>
      </section>

      {/* BYOD vs fully managed */}
      <section className="space-y-2">
        <h2 className="text-lg font-bold text-ink-1">Don't overlook the buyer who already has a phone</h2>
        <div className="grid gap-2 md:grid-cols-2">
          {data.byod_vs_managed.map((mode) => (
            <div key={mode.key} className="rounded-2xl border border-edge-1 bg-surface-0 p-4 space-y-2">
              <p className="text-sm font-bold text-ink-1">{mode.name}</p>
              <p className="text-2xs text-ink-3">{mode.headline}</p>
              <ScopeList title="Includes" items={mode.includes} />
              <ScopeList title="Limits — stated, not promised away" items={mode.limits} />
            </div>
          ))}
        </div>
      </section>

      {/* Trial + enquiry */}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-edge-1 bg-surface-0 p-4 space-y-2">
          <h3 className="text-sm font-bold text-ink-1 flex items-center gap-2"><CreditCard size={15} /> Business trial — 30 days</h3>
          <Badge variant="amber" size="xs">{trial.status === "not_yet_live" ? "Not yet live — trial requests only" : trial.status}</Badge>
          <p className="text-2xs text-ink-3">{trial.status_note}</p>
          <p className="text-sm text-ink-1">
            Example disclosure: first charge of <strong>KSh {num(trial.example.first_charge_amount_kes)}</strong> on{" "}
            <strong>{trial.example.first_charge_date}</strong> after a {trial.example.trial_days}-day trial,
            with a reminder {trial.example.reminder_days_before_charge} days before. {trial.example.amount_basis}
          </p>
          <ul className="text-2xs text-ink-3 space-y-1 list-disc pl-4">{trial.card_rules.map((r) => <li key={r}>{r}</li>)}</ul>
          <p className="text-2xs text-ink-4">{trial.alternative_to_test}</p>
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-edge-1 bg-surface-0 p-4 space-y-3">
          <h3 className="text-sm font-bold text-ink-1">{offer ? `Enquire: ${offer.name}` : "Purchase or enquiry"}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <Select label="Enquiry type" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
              options={[{ value: "purchase", label: "Purchase" }, { value: "quotation", label: "Quotation" }, { value: "discovery_call", label: "Discovery call" }, { value: "trial", label: "Business trial request" }]} />
            <Select label="Account tier (optional)" value={form.tier_key} onChange={(e) => setForm({ ...form, tier_key: e.target.value })}
              options={data.account_tiers.map((t) => ({ value: t.key, label: `${t.name} — ${tierPrice(t)}` }))} />
            <Input label="Organisation" value={form.organisation_name} onChange={(e) => setForm({ ...form, organisation_name: e.target.value })} />
            <Input label="Contact phone" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} placeholder="2547…" />
          </div>
          <Textarea label="What do you need?" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Scope, team size, location — anything that decides the quote" />
          {form.kind === "trial" && (
            <label className="flex items-start gap-2 text-2xs text-ink-2">
              <input type="checkbox" className="mt-0.5" checked={form.acknowledged_first_charge}
                onChange={(e) => setForm({ ...form, acknowledged_first_charge: e.target.checked })} />
              I have seen the example first charge (KSh {num(trial.example.first_charge_amount_kes)} on {trial.example.first_charge_date})
              and understand the trial is not yet live: this records a request, takes no card and makes no charge.
            </label>
          )}
          <Button type="submit" loading={busy}>{token ? "Send enquiry" : "Sign in to enquire"}</Button>
          <p className="text-2xs text-ink-4">
            Payments and invoicing: until subscription billing is verified, a human replies with scope
            and a legitimate business invoice on an existing verified payment channel (M-Pesa/bank).
            Card details are never collected here.
          </p>
          {mine.length > 0 && (
            <ul className="divide-y divide-edge-1 text-2xs text-ink-3">
              {mine.map((e) => (
                <li key={e.id} className="py-1.5">{e.kind} · {e.offer_key || e.tier_key || "general"} · <Badge variant="gray" size="xs">{e.status}</Badge></li>
              ))}
            </ul>
          )}
        </form>
      </section>

      <section className="rounded-2xl border border-edge-1 bg-surface-0 p-4">
        <h3 className="text-sm font-bold text-ink-1">How selling starts tomorrow</h3>
        <ol className="mt-2 space-y-1 text-2xs text-ink-3 list-decimal pl-4">
          {data.sell_tomorrow.map((s) => <li key={s}>{s}</li>)}
        </ol>
      </section>
    </Shell>
  );
}

function ScopeList({ title, items }) {
  return (
    <div>
      <p className="font-semibold text-ink-2">{title}</p>
      <ul className="mt-1 space-y-1 list-disc pl-4">{(items || []).map((i) => <li key={i}>{i}</li>)}</ul>
    </div>
  );
}

function Shell({ children, signedIn }) {
  return (
    <div className="min-h-screen bg-surface-1">
      <header className="border-b border-edge-1 bg-surface-0">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/storefront" className="text-base font-extrabold tracking-tight text-ink-1">Brief_ <span className="font-medium text-ink-3">Storefront</span></Link>
          <div className="flex gap-2">
            <Link to="/portfolio" className="hidden sm:inline-flex items-center text-xs font-semibold text-ink-3 hover:text-ink-1 px-2">Creative portfolio</Link>
            {signedIn ? (
              <Link to="/"><Button size="sm">Open the app</Button></Link>
            ) : (
              <Link to="/auth" state={{ from: "/storefront" }}><Button size="sm">Sign in / Register</Button></Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-6">
        {children}
        <p className="flex items-center gap-1.5 text-2xs text-ink-4 pb-4">
          <BadgeCheck size={13} /> Prices are test ranges, not commitments — confirmed in writing per contract before payment.
        </p>
      </main>
    </div>
  );
}
