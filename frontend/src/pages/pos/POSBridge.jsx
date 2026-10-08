import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plug, Plus, RefreshCw, Upload, Trash2, ScrollText, ArrowRight, Terminal, CheckCircle2, XCircle, Clock } from "lucide-react";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import Modal from "@/components/ui/Modal";
import Drawer from "@/components/ui/Drawer";
import FileUpload from "@/components/ui/FileUpload";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import POSConnectForm from "@/components/forms/POSConnectForm";
import { usePosStore } from "@/stores/posStore";
import { useAuthStore } from "@/stores/authStore";
import { POS_SYSTEMS } from "@/config/constants";
import { apiError } from "@/lib/api";
import { num, relativeTime, shortDateTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

export default function POSBridge() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const setVendor = useAuthStore((s) => s.setVendor);
  const { connections, loading, busy, fetchConnections, disconnect, sync, pushCsv } = usePosStore();
  const [connecting, setConnecting] = useState(false);
  const [nextStep, setNextStep] = useState(null);
  const [pushing, setPushing] = useState(null);
  const [logsFor, setLogsFor] = useState(null);

  useEffect(() => {
    fetchConnections().catch((e) => toast.error(apiError(e)));
  }, [fetchConnections]);

  const onSync = async (c) => {
    try {
      const res = await sync(c.id);
      toast.success(res?.message || `Synced ${num(res?.items_processed ?? 0)} items`);
    } catch (e) {
      toast.error(apiError(e, "Sync failed"));
    }
  };
  const onDisconnect = async (c) => {
    if (!(await confirm({ title: `Disconnect ${c.connection_name}?`, message: "Stock already on your shelf stays; it just stops updating from this source.", confirmLabel: "Disconnect", danger: true }))) return;
    try {
      await disconnect(c.id);
      toast("Disconnected");
      if (connections.length <= 1) setVendor({ has_pos_connected: false });
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink-1 tracking-tight">POS Bridge</h2>
          <p className="text-xs text-ink-4">Keep your shelf live from your till. Pull from Square/Shopify on a schedule, or push CSV / API updates from anything else.</p>
        </div>
        <Button size="sm" icon={Plus} onClick={() => setConnecting(true)}>
          Connect a POS
        </Button>
      </div>

      {nextStep && (
        <Card className="bg-brand-500/[0.09] flex items-start gap-3">
          <Terminal size={16} className="text-brand-600 dark:text-brand-400 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-brand-600 dark:text-brand-400">Connected — next step</p>
            <p className="text-xs text-brand-200/90 mt-1 font-mono break-all">{typeof nextStep === "string" ? nextStep : JSON.stringify(nextStep)}</p>
          </div>
          <button onClick={() => setNextStep(null)} className="text-brand-600 dark:text-brand-400 hover:text-brand-600 dark:hover:text-brand-400 text-xs">
            dismiss
          </button>
        </Card>
      )}

      {loading && connections.length === 0 ? (
        <PageSpinner />
      ) : connections.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="No POS connected"
          description="Connect one and your stock updates itself — quantities, new lines, sold-out items — without retyping anything."
          action={
            <Button size="sm" icon={Plus} onClick={() => setConnecting(true)}>
              Connect a POS
            </Button>
          }
        />
      ) : (
        <div className="grid lg:grid-cols-2 gap-3">
          {connections.map((c) => {
            const sys = POS_SYSTEMS.find((s) => s.value === c.pos_type);
            const pull = c.mode === "pull" || sys?.mode === "pull";
            return (
              <Card key={c.id} className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border", c.is_active ? "bg-brand-50 dark:bg-brand-500/15 border-brand-200 dark:border-brand-800 text-brand-600 dark:text-brand-400" : "bg-surface-3 border-edge-1 text-ink-4")}>
                      <Plug size={16} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-ink-1 truncate">{c.connection_name}</h3>
                      <p className="text-2xs text-ink-4">
                        {sys?.label || c.pos_type} · <span className="font-mono">{c.id.slice(0, 8)}</span>
                        {c.store_id ? ` · store ${c.store_id}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={pull ? "blue" : "amber"} size="xs">
                      {pull ? "pull" : "push"}
                    </Badge>
                    <Badge variant={c.is_active ? "brand" : "gray"} size="xs" dot>
                      {c.is_active ? "active" : "paused"}
                    </Badge>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <Cell label="items synced" value={num(c.items_synced || 0)} />
                  <Cell label="last sync" value={c.last_sync_at ? relativeTime(c.last_sync_at) : "never"} />
                  <Cell label={pull ? "schedule" : "credentials"} value={pull ? (c.auto_sync ? `every ${c.sync_interval_minutes}m` : "manual") : c.has_credentials ? "set" : "none"} />
                </div>

                {!pull && (
                  <p className="text-2xs text-ink-4 font-mono break-all rounded-lg bg-surface-2 border border-edge-1 px-2.5 py-2">
                    POST /api/pos/{c.id}/push · POST /api/pos/{c.id}/push-csv
                  </p>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                  {pull ? (
                    <Button size="xs" icon={RefreshCw} loading={busy === c.id} onClick={() => onSync(c)}>
                      Sync now
                    </Button>
                  ) : (
                    <Button size="xs" icon={Upload} loading={busy === c.id} onClick={() => setPushing(c)}>
                      Push CSV
                    </Button>
                  )}
                  <Button size="xs" variant="ghost" icon={ScrollText} onClick={() => setLogsFor(c)}>
                    Logs
                  </Button>
                  <Button size="xs" variant="ghost" iconRight={ArrowRight} onClick={() => navigate("/stock")}>
                    Shelf
                  </Button>
                  <Button size="xs" variant="dangerGhost" icon={Trash2} className="ml-auto" onClick={() => onDisconnect(c)} aria-label="Disconnect" />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card padding="p-4" className="text-xs text-ink-3 leading-relaxed space-y-2">
        <p className="text-sm font-medium text-ink-1">How the bridge works</p>
        <ul className="list-disc pl-4 space-y-1">
          <li>
            <span className="text-ink-1">Pull</span> (Square, Shopify): My Shop App calls the POS on your schedule and upserts your shelf by SKU.
          </li>
          <li>
            <span className="text-ink-1">Push</span> (CSV, manual, custom API): you — or the <span className="font-mono">pos-extension</span> daemon watching your till's export folder — send items to the connection's push endpoint with your app token.
          </li>
          <li>Items are matched by SKU, then by name. Nothing is ever deleted from your shelf by a sync; sold-out lines just drop to zero.</li>
        </ul>
      </Card>

      <Modal open={connecting} onClose={() => setConnecting(false)} title="Connect a POS">
        <POSConnectForm
          onDone={(res) => {
            setConnecting(false);
            setNextStep(res?.next_step || null);
            setVendor({ has_pos_connected: true });
          }}
          onCancel={() => setConnecting(false)}
        />
      </Modal>
      <PushCsvModal connection={pushing} onClose={() => setPushing(null)} onPush={pushCsv} />
      <LogsDrawer connection={logsFor} onClose={() => setLogsFor(null)} />
    </div>
  );
}

function Cell({ label, value }) {
  return (
    <div className="rounded-lg bg-surface-2 border border-edge-1 px-2.5 py-1.5 min-w-0">
      <div className="text-2xs text-ink-4">{label}</div>
      <div className="text-xs font-mono text-ink-1 truncate">{value}</div>
    </div>
  );
}

function PushCsvModal({ connection, onClose, onPush }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setFile(null), [connection?.id]);
  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await onPush(connection.id, file);
      toast.success(res?.message || `Pushed: ${num(res?.items_added ?? 0)} added, ${num(res?.items_updated ?? 0)} updated`);
      onClose();
    } catch (e) {
      toast.error(apiError(e, "Push failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={!!connection} onClose={onClose} title={connection ? `Push CSV → ${connection.connection_name}` : ""} description="Same columns as the Stock Room import: name, sku, category, quantity_in_stock, unit_price…" size="sm">
      <div className="space-y-4">
        <FileUpload file={file} onFile={setFile} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={Upload} loading={busy} disabled={!file} onClick={run}>
            Push
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function LogsDrawer({ connection, onClose }) {
  const logs = usePosStore((s) => (connection ? s.logs[connection.id] : null));
  const fetchLogs = usePosStore((s) => s.fetchLogs);
  useEffect(() => {
    if (connection) fetchLogs(connection.id).catch(() => {});
  }, [connection?.id, fetchLogs]); // eslint-disable-line react-hooks/exhaustive-deps
  const icon = (s) => (s === "success" || s === "completed" ? <CheckCircle2 size={13} className="text-brand-600 dark:text-brand-400" /> : s === "failed" || s === "error" ? <XCircle size={13} className="text-red-600 dark:text-red-400" /> : <Clock size={13} className="text-accent-600 dark:text-accent-400" />);
  return (
    <Drawer open={!!connection} onClose={onClose} title={connection ? `Sync log · ${connection.connection_name}` : ""} description="Most recent first">
      {!logs ? (
        <p className="text-xs text-ink-4">Loading…</p>
      ) : logs.length === 0 ? (
        <p className="text-xs text-ink-4">No syncs yet.</p>
      ) : (
        <ul className="space-y-2">
          {logs.map((l, i) => (
            <li key={l.id || i} className="rounded-lg border border-edge-1 bg-surface-2 p-3 text-xs">
              <div className="flex items-center gap-2">
                {icon(l.status)}
                <span className="font-medium text-ink-1">{l.sync_type}</span>
                <Badge variant="gray" size="xs">
                  {l.status}
                </Badge>
                <span className="ml-auto text-2xs text-ink-4">{shortDateTime(l.started_at)}</span>
              </div>
              <p className="mt-1.5 font-mono text-2xs text-ink-3">
                {num(l.items_processed || 0)} processed · {num(l.items_added || 0)} added · {num(l.items_updated || 0)} updated · {num(l.items_removed || 0)} removed
              </p>
              {l.errors?.length > 0 && (
                <ul className="mt-1.5 text-2xs text-red-600 dark:text-red-400 font-mono space-y-0.5">
                  {l.errors.slice(0, 5).map((e, j) => (
                    <li key={j}>{typeof e === "string" ? e : JSON.stringify(e)}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}
