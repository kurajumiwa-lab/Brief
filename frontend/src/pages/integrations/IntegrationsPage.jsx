import { useEffect, useState } from "react";
import Card, { CardHeader, CardTitle } from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { integrationsAPI, apiError } from "@/lib/api";
import { shortDate } from "@/lib/formatters";
import {
  METHOD_LABEL, STATE_LABEL, STATE_VARIANT, fallbackText, usableMethods, validateRecord,
} from "./integrationsRules";

/**
 * INTEGRATIONS — /integrations (flag: INTEGRATIONS_ENABLED).
 * Record a fact from an outside system with where it came from and how it was obtained.
 * A fact is declared (your own record) until an operator verifies it. A failed attempt stays failed.
 * Official e-GP entry points are links only. Nothing is re-hosted or re-submitted here.
 */
const EMPTY = { fact_kind: "", method: "", outcome: "ok", reference: "", note: "", fetched_at: "" };

export default function IntegrationsPage() {
  const [data, setData] = useState(null);
  const [links, setLinks] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [lastFailure, setLastFailure] = useState(null);

  const load = () => integrationsAPI.facts().then((r) => setData(r.data)).catch((e) => toast.error(apiError(e)));

  useEffect(() => {
    load();
    integrationsAPI.links().then((r) => setLinks(r.data.links)).catch(() => {});
  }, []);

  if (!data) return <PageSpinner />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    const problem = validateRecord(form);
    if (problem) return toast.error(problem);
    setSaving(true);
    try {
      const body = { ...form, fetched_at: form.fetched_at ? new Date(form.fetched_at).toISOString() : undefined };
      const r = await integrationsAPI.record(body);
      if (r.data.state === "failed") setLastFailure(r.data);
      else setLastFailure(null);
      toast.success(r.data.state === "failed" ? "Recorded as failed" : "Recorded");
      setForm(EMPTY);
      await load();
    } catch (err) {
      toast.error(apiError(err, "Could not record that."));
    } finally {
      setSaving(false);
    }
  }

  const methods = usableMethods(data.methods);

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold">Records and links</h1>
        <p className="text-sm text-ink-3 mt-1">
          Record facts from outside systems with their source. A record is your own declaration until an operator checks it.
          We do not certify anything.
        </p>
      </header>

      <Card>
        <CardHeader><CardTitle>Record a fact</CardTitle></CardHeader>
        <form onSubmit={submit} className="space-y-3">
          <Select label="Fact" value={form.fact_kind} onChange={set("fact_kind")}
            options={[{ value: "", label: "Choose…" }, ...data.kinds]} />
          <Select label="How you got it" value={form.method} onChange={set("method")}
            options={[{ value: "", label: "Choose…" }, ...methods.map((m) => ({ value: m, label: METHOD_LABEL[m] }))]} />
          <Select label="Outcome" value={form.outcome} onChange={set("outcome")}
            options={[{ value: "ok", label: "Worked" }, { value: "failed", label: "Did not work" }]} />
          <Input label="Reference (optional)" value={form.reference} onChange={set("reference")} maxLength={200} />
          <Input label="Date you fetched it (optional)" type="datetime-local" value={form.fetched_at} onChange={set("fetched_at")} />
          <Textarea label={form.outcome === "failed" ? "What went wrong" : "Note (optional)"} value={form.note}
            onChange={set("note")} maxLength={500} />
          <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving…" : "Record"}</Button>
        </form>
        {lastFailure && (
          <p className="text-sm mt-3 text-red-700">
            Attempt failed. {fallbackText(lastFailure.fallback)}
          </p>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle>Your records</CardTitle></CardHeader>
        {data.facts.length === 0 ? (
          <p className="text-sm text-ink-3">Nothing recorded yet.</p>
        ) : (
          <ul className="divide-y">
            {data.facts.map((f) => (
              <li key={f.id} className="py-3 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{f.label}</span>
                  <Badge variant={STATE_VARIANT[f.state]}>{STATE_LABEL[f.state]}</Badge>
                  {f.review_due && <Badge variant="amber">Review due</Badge>}
                </div>
                <p className="text-xs text-ink-3">
                  {METHOD_LABEL[f.method]} · from {f.source_system} · fetched {shortDate(f.fetched_at)}
                  {f.reference ? ` · ref ${f.reference}` : ""}
                </p>
                {f.note && <p className="text-sm">{f.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle>Official e-GP links</CardTitle></CardHeader>
        <p className="text-sm text-ink-3 mb-2">These open the official sites. Actions happen there, not here.</p>
        <ul className="space-y-2">
          {links.map((l) => (
            <li key={l.url}>
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">{l.label}</a>
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
