import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import { toast } from "@/components/ui/Toast";
import { knowledgeAPI, apiError } from "@/lib/api";

/** Host a session. Only verified businesses can publish; you write the promise first. */
export default function LearnNewPage() {
  const navigate = useNavigate();
  const [sectors, setSectors] = useState([]);
  const [form, setForm] = useState({
    kind: "seminar", title: "", sector: "", summary: "", price_kes: "", starts_at: "",
    location: "", capacity: "", promised_outcomes: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    knowledgeAPI.sectors().then(({ data }) => setSectors(data.sectors)).catch(() => setSectors([]));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (form.promised_outcomes.trim().length < 20) return toast.error("Say what attendees will get, in at least a sentence");
    setSaving(true);
    try {
      const body = {
        kind: form.kind, title: form.title.trim(), sector: form.sector,
        summary: form.summary || null,
        price_kes: form.price_kes === "" ? null : Number(form.price_kes),
        starts_at: form.starts_at ? `${form.starts_at}:00` : null,
        location: form.location || null,
        capacity: form.capacity === "" ? null : Number(form.capacity),
        promised_outcomes: form.promised_outcomes.trim(),
      };
      const { data } = await knowledgeAPI.create(body);
      toast.success("Saved as a draft. Publish it when you are ready.");
      navigate(`/learn/${data.id}`);
    } catch (err) {
      toast.error(apiError(err, "Could not save that session"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4 pb-16">
      <h1 className="text-xl font-semibold text-ink-1">Host a session</h1>
      <p className="text-sm text-ink-3">
        Only verified businesses can host. Say what attendees will get before you publish. After the session you record what was actually delivered.
      </p>
      <Card as="form" onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-2xs font-semibold text-ink-2">Type
            <select className="mt-1.5 h-10 w-full rounded-xl border border-edge-2 px-3 text-sm" value={form.kind} onChange={set("kind")}>
              <option value="seminar">Seminar</option>
              <option value="course">Course</option>
              <option value="mentor_session">Mentor session</option>
            </select>
          </label>
          <label className="block text-2xs font-semibold text-ink-2">Sector
            <select className="mt-1.5 h-10 w-full rounded-xl border border-edge-2 px-3 text-sm" value={form.sector} onChange={set("sector")} required>
              <option value="">Choose…</option>
              {sectors.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
        </div>
        <Input label="Title" value={form.title} maxLength={200} onChange={set("title")} required />
        <Textarea label="What attendees will get (promised)" value={form.promised_outcomes} maxLength={4000} onChange={set("promised_outcomes")} required />
        <Textarea label="Short summary (optional)" value={form.summary} maxLength={2000} onChange={set("summary")} />
        <div className="grid grid-cols-2 gap-2">
          <Input label="Date and time" type="datetime-local" value={form.starts_at} onChange={set("starts_at")} />
          <Input label="Price KSh (optional)" type="number" min={0} value={form.price_kes} onChange={set("price_kes")} />
          <Input label="Places (optional)" type="number" min={1} value={form.capacity} onChange={set("capacity")} />
          <Input label="Where (optional)" value={form.location} maxLength={300} onChange={set("location")} />
        </div>
        <Button type="submit" loading={saving} className="w-full">Save as draft</Button>
      </Card>
    </div>
  );
}
