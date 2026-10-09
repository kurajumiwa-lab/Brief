import { useNavigate } from "react-router-dom";
import { Users, Truck, Wrench, MapPin, ShieldCheck, Star, Phone } from "lucide-react";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { num } from "@/lib/formatters";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// ResultCard — ONE result contract across the discovery system.
//
// Every result answers five questions without a tap:
//   Can they help me?   the title and what it is
//   Are they available? the badge (in stock / open call / available)
//   What will it cost?  the price line (pay, rate or quote)
//   Can I trust them?   verification / rating / distance
//   What can I do now?  the primary action, specific to the kind:
//                       Hire · Check dates · Book · View shop
//
// Goods keep StockCard — it already answers all five with deeper trade
// actions (source, compare, deal room). This card covers the rest.
// ─────────────────────────────────────────────────────────────────────────────

const KIND_ICONS = { people: Users, services: Truck, equipment: Wrench };

const UNIT_LABELS = {
  per_day: "/ day", per_trip: "/ trip", per_kg: "/ kg", per_sqm: "/ sqm", per_unit: "",
};

export default function ResultCard({ kind, item, onAction, className }) {
  const navigate = useNavigate();
  const Icon = KIND_ICONS[kind] || Star;

  // ── people: an open job call or a specialist business ──────────────────────
  const isJob = kind === "people" && item.pay_kes != null;
  const isVendor = kind === "people" && !isJob;
  // ── services & equipment: a tool listing (rate, deposit, availability) ─────
  const isListing = kind === "services" || kind === "equipment";

  const title = isJob ? item.title : isVendor ? item.business_name : item.title;
  const badge = isJob
    ? { label: "Open call", variant: "brand" }
    : isVendor
      ? (item.is_verified ? { label: "Verified", variant: "brand" } : null)
      : (item.is_available ? { label: "Available", variant: "brand" } : { label: "Unavailable", variant: "gray" });

  const priceLine = isJob
    ? `Pays KSh ${num(item.pay_kes)}${item.task_type ? ` · ${item.task_type}` : ""}`
    : isVendor
      ? (item.business_categories || []).slice(0, 3).join(" · ") || "Business"
      : `${item.price_per_unit != null ? `KSh ${num(item.price_per_unit)}${UNIT_LABELS[item.price_unit] || ""}` : "Ask for a rate"}`
        + (item.deposit_required ? ` · deposit KSh ${num(item.deposit_required)}` : "");

  const metaLine = [
    item.location,
    typeof item.distance_km === "number" ? `${item.distance_km} km away` : null,
    isListing && item.min_booking ? `min ${item.min_booking}` : null,
    isListing && item.avg_rating ? `★ ${item.avg_rating.toFixed(1)}` : null,
  ].filter(Boolean).join(" · ");

  const primary =
    isJob ? { label: "Accept job", action: () => onAction?.("accept", item) }
    : isVendor ? { label: "View shop", action: () => navigate(`/@${item.vendor_handle}`) }
    : kind === "equipment" ? { label: "Check dates", action: () => onAction?.("book", item) }
    : { label: "Book service", action: () => onAction?.("book", item) };

  return (
    <article className={cn("glass rounded-2xl p-3 flex items-start gap-3", className)}>
      <span className="w-10 h-10 rounded-xl bg-surface-2 text-ink-2 flex items-center justify-center shrink-0">
        <Icon size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <h3 className="text-sm font-semibold text-ink-1 truncate max-w-full">{title}</h3>
          {badge && <Badge variant={badge.variant} size="xs">{badge.label}</Badge>}
        </div>
        <p className="text-xs text-ink-1 mt-0.5">{priceLine}</p>
        {metaLine && (
          <p className="text-2xs text-ink-4 mt-0.5 flex items-center gap-1">
            <MapPin size={10} className="shrink-0" /> {metaLine}
          </p>
        )}
        {!isVendor && item.description && (
          <p className="text-2xs text-ink-3 mt-1 line-clamp-2">{item.description}</p>
        )}
        <div className="mt-2 flex gap-1.5 flex-wrap">
          <Button size="sm" variant={isJob ? "primary" : "secondary"} onClick={primary.action}>
            {primary.label}
          </Button>
          {isJob && item.vendor_handle && (
            <Button size="sm" variant="ghost" icon={Phone} onClick={() => navigate(`/@${item.vendor_handle}`)}>
              Poster
            </Button>
          )}
          {isVendor && item.is_verified && (
            <span className="text-2xs text-brand-700 dark:text-brand-300 inline-flex items-center gap-1 self-center">
              <ShieldCheck size={11} /> ID verified
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
