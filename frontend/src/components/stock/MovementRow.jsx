import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, Check, Clock, PackageCheck, Truck, X } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Avatar from "@/components/ui/Avatar";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useStockStore } from "@/stores/stockStore";
import { MOVEMENT_BADGE } from "@/config/constants";
import { apiError } from "@/lib/api";
import { currency, num, relativeTime } from "@/lib/formatters";
import { cn, titleCase } from "@/lib/utils";

/**
 * Actions follow the API's state machine — unchanged from v2:
 *   supplier (outgoing): pending → confirm · confirmed → ship
 *   buyer    (incoming): shipped → receive
 *   either side may cancel before receipt
 */
export function movementActions(m) {
  const supplier = m.direction === "outgoing";
  const actions = [];
  if (supplier && m.status === "pending") actions.push({ action: "confirm", label: "Confirm", icon: Check, primary: true });
  if (supplier && m.status === "confirmed") actions.push({ action: "ship", label: "Mark shipped", icon: Truck, primary: true });
  if (!supplier && m.status === "shipped") actions.push({ action: "receive", label: "Received", icon: PackageCheck, primary: true });
  if (["pending", "confirmed", "shipped"].includes(m.status)) actions.push({ action: "cancel", label: "Cancel", icon: X, danger: true });
  return actions;
}

// The four forward steps, rendered as a progress rail so the state machine is
// visible instead of implied by a single word.
const STEPS = ["pending", "confirmed", "shipped", "received"];
const STEP_LABEL = { pending: "Requested", confirmed: "Confirmed", shipped: "Shipped", received: "Received" };

function Pipeline({ status }) {
  if (status === "cancelled") {
    return (
      <div className="flex items-center gap-1.5 text-micro font-semibold text-red-600 dark:text-red-400">
        <X size={12} aria-hidden="true" /> Cancelled — stock released, neither side scored
      </div>
    );
  }
  const idx = STEPS.indexOf(status === "in_transit" ? "shipped" : status);
  return (
    <ol className="flex items-center gap-1" aria-label={`Status: ${STEP_LABEL[STEPS[idx]] || status}`}>
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-1">
          <span
            className={cn(
              "text-micro font-semibold whitespace-nowrap",
              i < idx ? "text-ink-4" : i === idx ? "text-brand-700 dark:text-brand-400" : "text-ink-4/60"
            )}
          >
            {STEP_LABEL[s]}
          </span>
          {i < STEPS.length - 1 && (
            <span className={cn("w-5 h-0.5 rounded-full", i < idx ? "bg-brand-500" : "bg-edge-2")} aria-hidden="true" />
          )}
        </li>
      ))}
    </ol>
  );
}

export default function MovementRow({ movement: m, actionable }) {
  const advance = useStockStore((s) => s.advance);
  const confirm = useConfirm();
  const [busy, setBusy] = useState(null);
  const incoming = m.direction === "incoming";
  const other = incoming ? m.from_handle : m.to_handle;
  const actions = movementActions(m);

  const run = async ({ action, danger }) => {
    if (
      danger &&
      !(await confirm({
        title: "Cancel this movement?",
        message: "The reserved stock is released and neither side is scored.",
        confirmLabel: "Cancel movement",
        danger: true,
      }))
    )
      return;
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

  return (
    <article
      className={cn(
        "rounded-2xl border bg-surface-0 shadow-xs p-4 animate-fade-in transition-shadow",
        actionable ? "border-brand-500/40 ring-1 ring-brand-500/20" : "border-edge-1"
      )}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <span
          className={cn(
            "w-10 h-10 rounded-xl grid place-items-center shrink-0",
            incoming ? "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400" : "bg-accent-50 text-accent-600 dark:bg-accent-500/15 dark:text-accent-400"
          )}
          title={incoming ? "Incoming — you are sourcing" : "Outgoing — you are supplying"}
        >
          {incoming ? <ArrowDownLeft size={18} aria-hidden="true" /> : <ArrowUpRight size={18} aria-hidden="true" />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Link to={`/listing/${m.stock_item_id}`} className="text-sm font-semibold text-ink-1 hover:underline underline-offset-2 truncate">
              {m.stock_name}
            </Link>
            {m.sku && <span className="text-micro font-mono text-ink-4">{m.sku}</span>}
            <Badge variant={MOVEMENT_BADGE[m.status] || "gray"} size="xs" dot>
              {titleCase(m.status)}
            </Badge>
            {actionable && (
              <Badge variant="brand" size="xs">
                Needs you
              </Badge>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-3">
            <span className="inline-flex items-center gap-1.5">
              <Avatar name={other} size="xs" />
              {incoming ? "from" : "to"}{" "}
              <Link to={`/@${other}`} className="font-mono font-semibold text-ink-2 hover:underline underline-offset-2">
                @{other}
              </Link>
            </span>
            <span className="tabular-nums">
              {num(m.quantity)} × {currency(m.unit_price)} ={" "}
              <strong className="text-ink-1">{currency(m.total_value)}</strong>
            </span>
            <span className="inline-flex items-center gap-1 text-ink-4">
              <Clock size={11} aria-hidden="true" /> {relativeTime(m.created_at)}
            </span>
          </div>

          <div className="mt-2.5">
            <Pipeline status={m.status} />
          </div>

          {m.hold_expires_at && m.status === "pending" && (
            <p className="mt-1.5 text-micro text-accent-600 dark:text-accent-400 font-semibold">
              Reservation expires {relativeTime(m.hold_expires_at)}
            </p>
          )}
          {m.notes && <p className="mt-1.5 text-micro text-ink-4 italic line-clamp-2">“{m.notes}”</p>}
        </div>

        {actions.length > 0 && (
          <div className="flex items-center gap-2 sm:justify-end shrink-0">
            {actions.map((a) => (
              <Button
                key={a.action}
                size="sm"
                variant={a.danger ? "ghost" : a.primary ? "primary" : "secondary"}
                className={a.danger ? "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10" : undefined}
                icon={a.icon}
                loading={busy === a.action}
                disabled={!!busy}
                onClick={() => run(a)}
              >
                {a.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
