import { useCallback, useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { toast } from "@/components/ui/Toast";
import { apiError, credentialsAPI } from "@/lib/api";
import CredentialBadge from "@/components/credentials/CredentialBadge";

const EMPTY = { issuing_body: "", registration_number: "", title: "" };

/**
 * My licences and credentials. Adding one records a self-declared claim. It does not verify
 * anything and does not change where I appear. Removing one is always mine to do.
 */
export default function CredentialsSection() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await credentialsAPI.mine();
      setItems(r.data.credentials || []);
    } catch (err) {
      setError(apiError(err, "Could not load your credentials."));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.issuing_body.trim() || !form.registration_number.trim() || !form.title.trim()) {
      setError("Fill in the body, the number and the title.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await credentialsAPI.add({
        issuing_body: form.issuing_body.trim(),
        registration_number: form.registration_number.trim(),
        title: form.title.trim(),
      });
      toast.success("Added. It shows as self-declared until it is checked.");
      setForm(EMPTY);
      await load();
    } catch (err) {
      setError(apiError(err, "Could not add that credential."));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    try {
      await credentialsAPI.remove(id);
      await load();
    } catch (err) {
      toast.error(apiError(err, "Could not remove that credential."));
    }
  };

  return (
    <section aria-labelledby="credentials-heading" className="space-y-3">
      <h2 id="credentials-heading" className="text-base font-bold text-ink-1">Licences and credentials</h2>
      <p className="text-sm text-ink-2">
        Add a registration you hold. It is shown as self-declared until our team checks it. Having or
        lacking a credential does not change whether you are visible to people nearby.
      </p>

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((c) => (
            <li key={c.id}>
              <Card className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0 space-y-1">
                  <p className="font-semibold text-ink-1">{c.title}</p>
                  <p className="text-xs text-ink-2">{c.issuing_body} · No. {c.registration_number}</p>
                  {c.status === "rejected" && (
                    <p className="text-xs text-ink-2">Not confirmed{c.rejection_reason ? `: ${c.rejection_reason}` : "."}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <CredentialBadge status={c.status} />
                  <Button variant="ghost" size="sm" onClick={() => remove(c.id)}>Remove</Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} aria-label="Add a licence or credential" noValidate
        className="space-y-3 rounded-card-lg border border-edge-1 bg-surface-1 p-5">
        <Input label="Issuing body" value={form.issuing_body}
          onChange={(e) => setForm({ ...form, issuing_body: e.target.value })} />
        <Input label="Registration number" value={form.registration_number}
          onChange={(e) => setForm({ ...form, registration_number: e.target.value })} />
        <Input label="Title" value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })} />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={saving}>{saving ? "Adding…" : "Add credential"}</Button>
      </form>
    </section>
  );
}
