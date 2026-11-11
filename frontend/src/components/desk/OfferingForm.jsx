import { useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Select from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";
import { offeringsAPI, apiError } from "@/lib/api";
import {
  KINDS, PRICE_MODES, TOOL_CATEGORIES, buildPayload, emptyForm, formFromOffering, validateOffering,
} from "./offeringRules";

/**
 * Create or edit one offering. The backend is the authority on every rule; this form checks
 * the same things first so the person sees the problem next to the field.
 */
export default function OfferingForm({ offering, onSaved, onCancel }) {
  const editing = Boolean(offering);
  const kind = editing ? offering.kind : "goods";
  const [form, setForm] = useState(editing ? formFromOffering(offering) : emptyForm());
  const [chosenKind, setChosenKind] = useState(kind);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const k = editing ? kind : chosenKind;
  const set = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const found = validateOffering(form, k);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const body = buildPayload(form, k);
      const { data } = editing
        ? await offeringsAPI.update(k, offering.id, body)
        : await offeringsAPI.create({ kind: k, ...body });
      toast.success(editing ? "Saved." : "Added to your desk.");
      onSaved(data);
    } catch (err) {
      toast.error(apiError(err, "Couldn't save. Try again."));
    } finally {
      setSaving(false);
    }
  };

  const modeHint = PRICE_MODES.find((m) => m.value === form.price_mode)?.hint;

  return (
    <form onSubmit={submit} className="space-y-4" aria-label={editing ? "Edit offering" : "Add an offering"} noValidate>
      {!editing && (
        <Select label="What is it?" value={chosenKind} onChange={(e) => setChosenKind(e.target.value)} options={KINDS} />
      )}
      <Input label="Name" value={form.title} onChange={set("title")} error={errors.title} required />
      <Textarea label="Description" value={form.description} onChange={set("description")} rows={3} error={errors.description} />

      {k === "tool" && (
        <Select label="Category" placeholder="Choose one" value={form.category} onChange={set("category")}
          options={TOOL_CATEGORIES} error={errors.category} required />
      )}
      {k === "goods" && (
        <Input label="Category (optional)" value={form.category} onChange={set("category")} />
      )}

      <Select label="Pricing" value={form.price_mode} onChange={set("price_mode")}
        options={PRICE_MODES.map(({ value, label }) => ({ value, label }))} hint={modeHint} />

      {form.price_mode !== "ask_me" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={form.price_mode === "fixed" ? "Price (KES)" : "Starting price (KES, optional)"}
            type="number" min="0" inputMode="decimal" value={form.price} onChange={set("price")} error={errors.price} />
          <Input label="Per (optional)" placeholder="e.g. bunch, visit, day" value={form.price_unit} onChange={set("price_unit")} />
        </div>
      )}

      {k === "goods" && (
        <Input label="Quantity you have" type="number" min="0" value={form.quantity} onChange={set("quantity")}
          error={errors.quantity} hint="Zero means not offered right now." />
      )}
      {k === "service" && (
        <Input label="Length (minutes)" type="number" min="1" max="480" value={form.duration_minutes}
          onChange={set("duration_minutes")} error={errors.duration_minutes} />
      )}
      {k !== "goods" && (
        <Input label="Service radius (km, optional)" type="number" min="1" max="500" value={form.service_radius_km}
          onChange={set("service_radius_km")} error={errors.service_radius_km} hint="How far you will go for this." />
      )}

      <Textarea label="Photo links (optional)" rows={3} value={form.photos} onChange={set("photos")} error={errors.photos}
        hint="One https:// link per line, up to 8." />

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>{editing ? "Save changes" : "Add to my desk"}</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}
