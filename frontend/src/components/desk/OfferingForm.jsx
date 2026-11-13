import { useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Select from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";
import { SERVICE_PROFILES_ENABLED } from "@/config/flags";
import OpeningHours from "@/components/schedule/OpeningHours";
import { offeringsAPI, apiError } from "@/lib/api";
import {
  KINDS, MAX_MODES, PRICE_MODES, SERVICE_DOMAINS, SERVICE_MODES, TOOL_CATEGORIES, buildPayload, emptyForm, emptyMode,
  formFromOffering, validateOffering,
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
  const setMode = (i, patch) => setForm((f) => ({ ...f, modes: f.modes.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));
  const addMode = () => setForm((f) => ({ ...f, modes: [...f.modes, emptyMode()] }));
  const removeMode = (i) => setForm((f) => ({ ...f, modes: f.modes.filter((_, j) => j !== i) }));
  const usedModes = new Set(form.modes.map((m) => m.mode));

  return (
    <form onSubmit={submit} className="space-y-4" aria-label={editing ? "Edit offering" : "Add an offering"} noValidate>
      {!editing && (
        <Select label="What is it?" value={chosenKind} onChange={(e) => setChosenKind(e.target.value)} options={KINDS} />
      )}
      <Input label={SERVICE_PROFILES_ENABLED && k === "service" ? "Service name" : "Name"} value={form.title}
        onChange={set("title")} error={errors.title} required />
      <Textarea label="Description" value={form.description} onChange={set("description")} rows={3} error={errors.description} />

      {k === "tool" && (
        <Select label="Category" placeholder="Choose one" value={form.category} onChange={set("category")}
          options={TOOL_CATEGORIES} error={errors.category} required />
      )}
      {k === "goods" && (
        <Input label="Category (optional)" value={form.category} onChange={set("category")} />
      )}

      {k === "service" && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-ink-1">Ways it is given</legend>
          <p className="text-xs text-ink-3">Add each way with its own price. A salon might list In shop and Home visit separately.</p>
          {errors.modes && <p className="text-xs text-red-700">{errors.modes}</p>}
          {form.modes.map((m, i) => (
            <div key={i} className="space-y-2 rounded-card border border-edge-1 p-3">
              <Select label="How" value={m.mode} onChange={(e) => setMode(i, { mode: e.target.value })}
                placeholder="Choose one" error={errors[`mode_${i}`]}
                options={SERVICE_MODES.filter((o) => o.value === m.mode || !usedModes.has(o.value))} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="Pricing" value={m.price_mode} onChange={(e) => setMode(i, { price_mode: e.target.value })}
                  options={PRICE_MODES.map(({ value, label }) => ({ value, label }))} />
                {m.price_mode !== "ask_me" && (
                  <Input label={m.price_mode === "fixed" ? "Price (KES)" : "Starting price (KES, optional)"}
                    type="number" min="0" inputMode="decimal" value={m.price}
                    onChange={(e) => setMode(i, { price: e.target.value })} error={errors[`price_${i}`]} />
                )}
              </div>
              {m.price_mode !== "ask_me" && (
                <Input label="Per (optional)" placeholder="e.g. visit, hour, kg, item" value={m.price_unit}
                  onChange={(e) => setMode(i, { price_unit: e.target.value })} />
              )}
              <Button type="button" variant="ghost" onClick={() => removeMode(i)}>Remove this way</Button>
            </div>
          ))}
          {form.modes.length < MAX_MODES && (
            <Button type="button" variant="secondary" onClick={addMode}>Add a way it is given</Button>
          )}
        </fieldset>
      )}

      {k !== "service" && (
        <Select label="Pricing" value={form.price_mode} onChange={set("price_mode")}
          options={PRICE_MODES.map(({ value, label }) => ({ value, label }))} hint={modeHint} />
      )}

      {k !== "service" && form.price_mode !== "ask_me" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={form.price_mode === "fixed" ? "Price (KES)" : "Starting price (KES, optional)"}
            type="number" min="0" inputMode="decimal" value={form.price} onChange={set("price")} error={errors.price} />
          <Input label="Per (optional)"
            placeholder={SERVICE_PROFILES_ENABLED && k === "service" ? "e.g. visit, hour, shift" : "e.g. bunch, visit, day"}
            value={form.price_unit} onChange={set("price_unit")} />
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
      {SERVICE_PROFILES_ENABLED && k === "service" && (
        <Select label="Service domain" placeholder="Not stated" value={form.domain} onChange={set("domain")}
          options={SERVICE_DOMAINS} hint="Optional. Helps people find you." />
      )}
      {SERVICE_PROFILES_ENABLED && k === "service" && (
        <OpeningHours note="These hours cover all of your services, not only this one." />
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
