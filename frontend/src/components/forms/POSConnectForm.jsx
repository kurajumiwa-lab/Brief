import { useState } from "react";
import { Plug } from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { toast } from "@/components/ui/Toast";
import { POS_SYSTEMS } from "@/config/constants";
import { usePosStore } from "@/stores/posStore";
import { apiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Check } from "./GroupForm";

export default function POSConnectForm({ onDone, onCancel }) {
  const connect = usePosStore((s) => s.connect);
  const [form, setForm] = useState({ pos_type: "csv", connection_name: "", api_key: "", api_secret: "", store_id: "", auto_sync: true, sync_interval_minutes: 30 });
  const [busy, setBusy] = useState(false);
  const system = POS_SYSTEMS.find((s) => s.value === form.pos_type);
  const pull = system?.mode === "pull";
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.connection_name.trim()) return toast.error("Name this connection");
    if (pull && !form.api_key.trim()) return toast.error(`${system.label} needs an API key`);
    setBusy(true);
    try {
      const res = await connect({
        pos_type: form.pos_type,
        connection_name: form.connection_name.trim(),
        api_key: pull ? form.api_key.trim() : null,
        api_secret: pull ? form.api_secret.trim() || null : null,
        store_id: form.store_id.trim() || null,
        auto_sync: pull ? form.auto_sync : false,
        sync_interval_minutes: Math.min(1440, Math.max(5, Number(form.sync_interval_minutes) || 30)),
        sync_config: {},
      });
      toast.success(res?.message || "POS connected");
      onDone?.(res);
    } catch (err) {
      toast.error(apiError(err, "Couldn't connect the POS"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <p className="text-xs font-medium text-ink-3 mb-1.5">System</p>
        <div className="grid sm:grid-cols-2 gap-2">
          {POS_SYSTEMS.map((s) => (
            <button
              type="button"
              key={s.value}
              onClick={() => setForm((f) => ({ ...f, pos_type: s.value }))}
              className={cn("rounded-lg border p-3 text-left transition-colors", form.pos_type === s.value ? "border-brand-600 bg-brand-950/50" : "border-edge-1 bg-surface-1 hover:border-edge-2")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-ink-1">{s.label}</span>
                <Badge variant={s.mode === "pull" ? "blue" : "amber"} size="xs">
                  {s.mode}
                </Badge>
              </div>
              <p className="text-2xs text-ink-4 mt-0.5">{s.desc}</p>
            </button>
          ))}
        </div>
      </div>
      <Input label="Connection name" required value={form.connection_name} onChange={set("connection_name")} placeholder={`${system?.label} · main till`} />
      {pull ? (
        <div className="grid sm:grid-cols-2 gap-3">
          <Input label="API key" required value={form.api_key} onChange={set("api_key")} className="font-mono" autoComplete="off" />
          <Input label="API secret" type="password" value={form.api_secret} onChange={set("api_secret")} className="font-mono" autoComplete="off" />
          <Input label="Store / location ID" value={form.store_id} onChange={set("store_id")} className="font-mono" />
          <Input label="Sync every (minutes)" type="number" min="5" max="1440" value={form.sync_interval_minutes} onChange={set("sync_interval_minutes")} />
          <Check checked={form.auto_sync} onChange={set("auto_sync")} label="Auto-sync on schedule" />
        </div>
      ) : (
        <div className="rounded-lg border border-edge-1 bg-surface-1 p-3 text-xs text-ink-3 leading-relaxed">
          <span className="text-ink-1 font-medium">Push mode.</span> Nothing to enter — after connecting you'll get a connection ID. Upload CSV exports from this page, or point the{" "}
          <span className="font-mono text-ink-2">pos-extension</span> daemon (or your own script) at <span className="font-mono text-ink-2">POST /api/pos/&#123;id&#125;/push</span>.
        </div>
      )}
      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={busy} icon={Plug}>
          Connect
        </Button>
      </div>
    </form>
  );
}
