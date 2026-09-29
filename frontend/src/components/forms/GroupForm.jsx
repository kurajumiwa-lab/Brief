import { useState } from "react";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { GROUP_TYPES } from "@/config/constants";
import { useGroupStore } from "@/stores/groupStore";
import { apiError } from "@/lib/api";
import { splitList } from "@/lib/utils";

export default function GroupForm({ onDone, onCancel }) {
  const create = useGroupStore((s) => s.create);
  const [form, setForm] = useState({ name: "", description: "", group_type: "open", category: "", tags: "", region: "", is_public: true, requires_approval: false });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Give the group a name");
    setBusy(true);
    try {
      const group = await create({
        name: form.name.trim(),
        description: form.description.trim() || null,
        group_type: form.group_type,
        category: form.category.trim() || null,
        tags: splitList(form.tags),
        region: form.region.trim() || null,
        is_public: form.is_public,
        requires_approval: form.requires_approval,
      });
      toast.success(`${group.name} is live — you're the admin`);
      onDone?.(group);
    } catch (err) {
      toast.error(apiError(err, "Couldn't create the group"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Input label="Group name" required value={form.name} onChange={set("name")} placeholder="Wakulima Sourcing Collective" />
      <Textarea label="What is it for?" value={form.description} onChange={set("description")} rows={2} placeholder="Pooling farm-gate orders every Saturday…" />
      <div className="grid sm:grid-cols-2 gap-3">
        <Select label="Type" value={form.group_type} onChange={set("group_type")} options={GROUP_TYPES} />
        <Input label="Category" value={form.category} onChange={set("category")} placeholder="fresh produce" />
        <Input label="Region" value={form.region} onChange={set("region")} placeholder="Nairobi" />
        <Input label="Tags" value={form.tags} onChange={set("tags")} placeholder="bulk, sourcing" hint="Comma separated" />
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        <Check checked={form.is_public} onChange={set("is_public")} label="Public" hint="Shows up in Browse" />
        <Check checked={form.requires_approval} onChange={set("requires_approval")} label="Approval to join" hint="Admins vet new members" />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={busy}>
          Create group
        </Button>
      </div>
    </form>
  );
}

export function Check({ checked, onChange, label, hint }) {
  return (
    <label className="flex items-center gap-2.5 rounded-lg border border-edge-1 bg-surface-1 px-3 py-2 cursor-pointer">
      <input type="checkbox" checked={!!checked} onChange={onChange} className="accent-brand-500 w-4 h-4" />
      <span className="text-sm text-ink-2">{label}</span>
      {hint && <span className="ml-auto text-2xs text-ink-4">{hint}</span>}
    </label>
  );
}
