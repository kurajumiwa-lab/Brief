import { useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";
import { apiError } from "@/lib/api";
import { ledgerAPI } from "@/lib/ledgerApi";

// Must match the backend CheckConstraint on saved_relationships.relationship_kind.
const KIND_OPTIONS = [
  { value: "service_provider", label: "Service provider" },
  { value: "artisan", label: "Artisan" },
  { value: "supplier", label: "Supplier" },
  { value: "household", label: "Household" },
  { value: "institution", label: "Institution" },
  { value: "collection_point", label: "Collection point" },
];

/**
 * Add a trusted contact by their @handle. Private to me; the backend checks the handle exists
 * and that I am not saving myself. The list above it reloads through onSaved.
 */
export default function AddTrustedContact({ onSaved }) {
  const [handle, setHandle] = useState("");
  const [kind, setKind] = useState("service_provider");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const clean = handle.trim().replace(/^@/, "");
    if (clean.length < 3) {
      setError("Enter the @handle of the person or business.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await ledgerAPI.saveRelationship({
        target_handle: clean,
        relationship_kind: kind,
        label: label.trim() || null,
      });
      toast.success("Saved as a trusted contact.");
      setHandle("");
      setLabel("");
      await onSaved?.();
    } catch (err) {
      setError(apiError(err, "Could not save that contact."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} aria-label="Add a trusted contact" className="space-y-3 rounded-card-lg border border-edge-1 bg-surface-1 p-5" noValidate>
      <h3 className="text-sm font-bold text-ink-1">Add a trusted contact</h3>
      <Input label="@handle" value={handle} onChange={(e) => setHandle(e.target.value)} error={error || undefined} />
      <Select label="Relationship" value={kind} onChange={(e) => setKind(e.target.value)}>
        {KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
      <Input label="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
      <Button type="submit" disabled={saving}>Save contact</Button>
    </form>
  );
}
