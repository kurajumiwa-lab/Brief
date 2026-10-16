import { PiggyBank, Users, MapPin } from "lucide-react";
import Badge from "@/components/ui/Badge";
import CardShell, { CardBody, CardTitle, CardMeta, CardPrice } from "./CardShell";
import { currency, num } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * COMMERCIAL CARD — group buys and verified savings.
 *
 * Harnesses existing stock, collective, and groups without replacing them.
 * Shows individual vs group price, savings, and progress to target.
 */
export default function CommercialCard({ item }) {
  const hasGroup = item.groupPrice != null && item.individualPrice != null && item.groupPrice < item.individualPrice;
  const savings = item.savingsAmount || (hasGroup ? item.individualPrice - item.groupPrice : 0);
  const pct = item.savingsPct || (hasGroup && item.individualPrice ? Math.round((savings / item.individualPrice) * 100) : 0);
  const progress = item.targetQty ? Math.min(100, ((item.currentQty || item.currentInterested || 0) / item.targetQty) * 100) : 0;

  return (
    <CardShell
      to={item.to}
      label={`${item.title} — ${item.groupPrice ? `${currency(item.groupPrice)} group price` : "group buy"} — ${item.vendorName}`}
      className="border-emerald-200/50 dark:border-emerald-500/20"
    >
      <div className="relative bg-gradient-to-br from-emerald-50 to-blue-50 dark:from-emerald-500/10 dark:to-blue-500/10 border-b border-edge-1 p-3">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="emerald" size="xs">
            <PiggyBank size={10} /> {pct ? `${pct}% off` : item.postType === "group_buy" ? "Group buy" : "Offer"}
          </Badge>
          <span className="text-2xs text-ink-4 inline-flex items-center gap-1">
            <Users size={10} /> {num(item.currentInterested || 0)} interested
          </span>
        </div>

        <div className="mt-2.5 flex gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-2xs text-ink-4">Individual</p>
            <p className={cn("text-sm font-medium truncate", hasGroup ? "line-through text-ink-4" : "text-ink-1")}>
              {item.individualPrice ? currency(item.individualPrice) : "—"}
            </p>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-2xs text-ink-4">Group price</p>
            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300 truncate">
              {item.groupPrice ? currency(item.groupPrice) : "Ask"}
            </p>
          </div>
        </div>

        {savings > 0 && (
          <p className="mt-2 text-2xs font-bold text-emerald-700 dark:text-emerald-300">
            Save {currency(savings)} per unit · {pct}% less if confirmed
          </p>
        )}
      </div>

      <CardBody>
        <CardTitle className="line-clamp-2">{item.title}</CardTitle>
        <CardMeta className="mt-1 flex items-center gap-1">
          <MapPin size={10} /> {item.location || item.vendorName || "Local"}
        </CardMeta>

        <div className="mt-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-2xs text-ink-4">
            <span>{item.currentQty || item.currentInterested || 0} / {item.targetQty || item.minGroup || "?"} units</span>
            <span className="font-mono">{Math.round(progress)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </CardBody>
    </CardShell>
  );
}
