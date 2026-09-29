import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, Check, Truck, PackageCheck, X } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useStockStore } from "@/stores/stockStore";
import { MOVEMENT_BADGE } from "@/config/constants";
import { apiError } from "@/lib/api";
import { currency, num, relativeTime } from "@/lib/formatters";
import { cn, titleCase } from "@/lib/utils";

/**
 * Actions follow the API's state machine:
 *   supplier (outgoing): pending → confirm · confirmed → ship
 *   buyer    (incoming): shipped → receive
 *   either side may cancel before receipt
 */
export function movementActions(m) {
  const supplier = m.direction === "outgoing";
  const actions = [];
  if (supplier && m.status === "pending") actions.push({ action: "confirm", label: "Confirm", icon: Check });
  if (supplier && m.status === "confirmed") actions.push({ action: "ship", label: "Mark shipped", icon: Truck });
  if (!supplier && m.status === "shipped") actions.push({ action: "receive", label: "Received", icon: PackageCheck, primary: true });
  if (["pending", "confirmed", "shipped"].includes(m.status)) actions.push({ action: "cancel", label: "Cancel", icon: X, danger: true });
  return actions;
}

export default function MovementRow({ movement: m }) {
  const advance = useStockStore((s) => s.advance);
  const confirm = useConfirm();
  const [busy, setBusy] = useState(null);
  const incoming = m.direction === "incoming";
  const other = incoming ? m.from_handle : m.to_handle;

  const run = async ({ action, danger }) => {
    if (danger && !(await confirm({ title: "Cancel this movement?", message: "The reserved stock is released and neither side is scored.", confirmLabel: "Cancel movement", danger: true }))) return;
    setBusy(action);
    try {
      const res = await advance(m.id, action);
      toast.success(res?.message || `Movement ${res?.status || action}`);
    } catch (err) {
      toast.error(apiError(err, `Couldn't ${action}`));
    } finally {
      setBusy(null);
    }
  };

  const actions = movementActions(m);

  return (
    <div className="rounded-xl border border-edge-1 bg-surface-1 p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3 animate-fade-in">
      <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0", incoming ? "bg-blue-950/60 text-blue-300" : "bg-amber-950/60 text-amber-300")} title={incoming ? "Incoming — you are sourcing" : "Outgoing — you are supplying"}>
        {incoming ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-ink-1 truncate">{m.stock_name}</span>
          {m.sku && <span className="text-2xs font-mono text-ink-4">{m.sku}</span>}
          <Badge variant={MOVEMENT_BADGE[m.status] || "gray"} size="xs" dot>
            {titleCase(m.status)}
          </Badge>
        </div>
        <div className="text-xs text-ink-4 mt-0.5 flex flex-wrap gap-x-2">
          <span>
            {incoming ? "from" : "to"}{" "}
            <Link to={`/@${other}`} className="font-mono text-ink-3 hover:text-brand-300">
              @{other}
            </Link>
          </span>
          <span className="font-mono">{num(m.quantity)} × {currency(m.unit_price)} = <span className="text-ink-2">{currency(m.total_value)}</span></span>
          <span>{relativeTime(m.created_at)}</span>
        </div>
        {m.notes && <p className="text-2xs text-ink-4 mt-1 italic truncate">“{m.notes}”</p>}
      </div>
      {actions.length > 0 && (
        <div className="flex items-center gap-1.5 sm:justify-end shrink-0">
          {actions.map((a) => (
            <Button key={a.action} size="xs" variant={a.danger ? "dangerGhost" : a.primary || a.action === "confirm" ? "primary" : "secondary"} icon={a.icon} loading={busy === a.action} disabled={!!busy} onClick={() => run(a)}>
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
