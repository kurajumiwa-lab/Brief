import { useState } from "react";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { EVENT_TYPES } from "@/config/constants";
import { useEventStore } from "@/stores/eventStore";
import { apiError } from "@/lib/api";
import { splitList } from "@/lib/utils";
import { Check } from "./GroupForm";

const toISO = (local) => (local ? new Date(local).toISOString() : null);

export default function EventForm({ onDone, onCancel, groups = [], lists = [] }) {
  const create = useEventStore((s) => s.create);
  const [form, setForm] = useState({
    title: "", description: "", event_type: "networking", start_date: "", end_date: "", location: "", is_virtual: false,
    max_vendors: "", entry_fee: "", required_categories: "", other_requirements: "", group_id: "", vendor_list_id: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return toast.error("Give the event a title");
    if (!form.start_date || !form.end_date) return toast.error("Start and end are required");
    if (new Date(form.end_date) < new Date(form.start_date)) return toast.error("It can't end before it starts");
    setBusy(true);
    try {
      const vendor_requirements = {};
      const cats = splitList(form.required_categories);
      const other = splitList(form.other_requirements);
      if (cats.length) vendor_requirements.categories = cats;
      if (other.length) vendor_requirements.other = other;
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        event_type: form.event_type,
        start_date: toISO(form.start_date),
        end_date: toISO(form.end_date),
        location: form.location.trim() || null,
        is_virtual: form.is_virtual,
        entry_fee: form.entry_fee === "" ? 0 : Number(form.entry_fee),
        vendor_requirements,
        group_id: form.group_id || null,
        vendor_list_id: form.vendor_list_id || null,
      };
      if (form.max_vendors !== "") payload.max_vendors = Number(form.max_vendors); // API default is 50
      const ev = await create(payload);
      toast.success(`${ev.title} is on the calendar`);
      onDone?.(ev);
    } catch (err) {
      toast.error(apiError(err, "Couldn't create the event"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Input label="Title" required value={form.title} onChange={set("title")} placeholder="Saturday farm-gate sourcing run — Kinangop" />
      <Textarea label="Details" value={form.description} onChange={set("description")} rows={2} />
      <div className="grid sm:grid-cols-2 gap-3">
        <Select label="Type" value={form.event_type} onChange={set("event_type")} options={EVENT_TYPES} />
        <Input label="Location" value={form.location} onChange={set("location")} placeholder="Kinangop, Nyandarua" disabled={form.is_virtual} />
        <Input label="Starts" type="datetime-local" required value={form.start_date} onChange={set("start_date")} />
        <Input label="Ends" type="datetime-local" required value={form.end_date} onChange={set("end_date")} min={form.start_date || undefined} />
        <Input label="Max vendors" type="number" min="1" value={form.max_vendors} onChange={set("max_vendors")} placeholder="50" />
        <Input label="Entry fee" type="number" min="0" step="any" prefix="KES" value={form.entry_fee} onChange={set("entry_fee")} placeholder="0" />
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Input label="Required categories" value={form.required_categories} onChange={set("required_categories")} placeholder="vegetables, fruit" hint="Only vendors trading these can register" />
        <Input label="Other requirements" value={form.other_requirements} onChange={set("other_requirements")} placeholder="own transport, KRA PIN" hint="Shown to vendors, not enforced" />
      </div>
      {(groups.length > 0 || lists.length > 0) && (
        <div className="grid sm:grid-cols-2 gap-3">
          {groups.length > 0 && <Select label="Limit to a group" value={form.group_id} onChange={set("group_id")} placeholder="Open to the network" options={groups.map((g) => ({ value: g.id, label: g.name }))} />}
          {lists.length > 0 && <Select label="Limit to a vendor list" value={form.vendor_list_id} onChange={set("vendor_list_id")} placeholder="Any vendor" options={lists.map((l) => ({ value: l.id, label: l.name }))} />}
        </div>
      )}
      <Check checked={form.is_virtual} onChange={set("is_virtual")} label="Virtual event" hint="No physical location" />
      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={busy}>
          Create event
        </Button>
      </div>
    </form>
  );
}
