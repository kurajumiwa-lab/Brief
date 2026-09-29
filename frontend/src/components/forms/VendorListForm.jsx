import { useState } from "react";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { useListStore } from "@/stores/listStore";
import { apiError } from "@/lib/api";
import { splitList } from "@/lib/utils";
import { Check } from "./GroupForm";

/** Create a vendor list. Pass `onSubmit` to override the default (e.g. group-created lists). */
export default function VendorListForm({ onDone, onCancel, onSubmit, maxVendorsCap }) {
  const create = useListStore((s) => s.create);
  const [form, setForm] = useState({ name: "", description: "", category: "", region: "", max_vendors: "", requires_approval: true, criteria_categories: "", criteria_min_score: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Give the list a name");
    const entry_criteria = {};
    const cats = splitList(form.criteria_categories);
    if (cats.length) entry_criteria.categories = cats;
    if (form.criteria_min_score !== "") entry_criteria.min_network_score = Number(form.criteria_min_score);
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      category: form.category.trim() || null,
      region: form.region.trim() || null,
      requires_approval: form.requires_approval,
      entry_criteria,
    };
    if (form.max_vendors !== "") payload.max_vendors = Number(form.max_vendors); // API default is 100
    setBusy(true);
    try {
      const list = onSubmit ? await onSubmit(payload) : await create(payload);
      toast.success(`${list?.name || form.name} is open for registrations`);
      onDone?.(list);
    } catch (err) {
      toast.error(apiError(err, "Couldn't create the list"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Input label="List name" required value={form.name} onChange={set("name")} placeholder="Nairobi Fresh Produce Vendors" />
      <Textarea label="Description" value={form.description} onChange={set("description")} rows={2} placeholder="Who should register and what they get" />
      <div className="grid sm:grid-cols-3 gap-3">
        <Input label="Category" value={form.category} onChange={set("category")} placeholder="vegetables" />
        <Input label="Region" value={form.region} onChange={set("region")} placeholder="Nairobi" />
        <Input label="Max vendors" type="number" min="1" max={maxVendorsCap || undefined} value={form.max_vendors} onChange={set("max_vendors")} placeholder={maxVendorsCap ? `≤ ${maxVendorsCap}` : "unlimited"} />
      </div>
      <div>
        <p className="text-xs font-medium text-ink-3 mb-1.5">Entry criteria (optional)</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Input value={form.criteria_categories} onChange={set("criteria_categories")} placeholder="required categories, comma separated" />
          <Input type="number" min="0" step="any" value={form.criteria_min_score} onChange={set("criteria_min_score")} placeholder="minimum network score" />
        </div>
      </div>
      <Check checked={form.requires_approval} onChange={set("requires_approval")} label="Approve registrations manually" hint="Otherwise vendors join instantly" />
      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={busy}>
          Create list
        </Button>
      </div>
    </form>
  );
}
