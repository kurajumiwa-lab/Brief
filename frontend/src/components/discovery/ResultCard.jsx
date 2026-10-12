import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Truck, Wrench, MapPin, ShieldCheck, Star, Phone, Info, ChevronDown, ChevronUp, Clock } from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { categoryForSkill } from "@/components/tasks/TemporaryJobsSection";
import { num, relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const KIND_ICONS = { people: Users, services: Truck, equipment: Wrench };

const UNIT_LABELS = {
  per_day: "/ day",
  per_trip: "/ trip",
  per_kg: "/ kg",
  per_sqm: "/ sqm",
  per_unit: "",
};

/**
 * ResultCard — Amazon-style discovery card for `people` (temporary job calls &
 * specialist vendors), `services` (transport/logistics), and `equipment`
 * (warehouse & machinery rental).
 */
export default function ResultCard({ kind, item, onAction, onInspect, className }) {
  const navigate = useNavigate();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const isJob = kind === "people" && item.pay_kes != null;
  const isVendor = kind === "people" && !isJob;
  const isListing = kind === "services" || kind === "equipment";

  const jobCat = isJob ? categoryForSkill(item.skill) : null;
  const Icon = (jobCat && jobCat.icon) || KIND_ICONS[kind] || Star;

  const title = isJob ? item.title : isVendor ? item.business_name : item.title;
  const badge = isJob
    ? { label: item.status === "open" || !item.status ? "Open call" : item.status, variant: "brand" }
    : isVendor
    ? item.is_verified
      ? { label: "Verified", variant: "brand" }
      : null
    : item.is_available !== false
    ? { label: "Available", variant: "brand" }
    : { label: "Unavailable", variant: "gray" };

  const priceLine = isJob
    ? `Pays KSh ${num(item.pay_kes)}${item.task_type ? ` · ${item.task_type}` : " / shift"}`
    : isVendor
    ? (item.business_categories || []).slice(0, 3).join(" · ") || "Business"
    : `${item.price_per_unit != null ? `KSh ${num(item.price_per_unit)} ${UNIT_LABELS[item.price_unit] || ""}` : "Ask for a rate"}` +
      (item.deposit_required ? ` · deposit KSh ${num(item.deposit_required)}` : "");

  const metaLine = [
    item.location,
    typeof item.distance_km === "number" ? `${item.distance_km} km away` : null,
    isListing && item.min_booking ? `min ${item.min_booking}` : null,
    isListing && item.avg_rating ? `★ ${Number(item.avg_rating).toFixed(1)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const primary = isJob
    ? { label: "Accept job", action: () => onAction?.("accept", item) }
    : isVendor
    ? { label: "View shop", action: () => navigate(`/@${item.vendor_handle}`) }
    : kind === "equipment"
    ? { label: "Check dates", action: () => onAction?.("book", item) }
    : { label: "Book service", action: () => onAction?.("book", item) };

  const clientOrHost = item.client || item.vendor_business || (item.vendor_handle ? `@${item.vendor_handle}` : null);

  return (
    <article
      className={cn(
        "rounded-2xl border border-edge-1 bg-surface-0 shadow-xs p-4 flex flex-col justify-between gap-3 glass-hover",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "w-11 h-11 rounded-xl border border-edge-1 flex items-center justify-center shrink-0",
            jobCat ? jobCat.tone : "bg-surface-1 text-brand-700 dark:text-brand-300"
          )}
        >
          <Icon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink-1 leading-snug line-clamp-2">{title}</h3>
            {badge && (
              <Badge variant={badge.variant} size="xs" className="shrink-0">
                {badge.label}
              </Badge>
            )}
          </div>
          {clientOrHost && (
            <div className="mt-1 flex items-center gap-1.5 text-2xs text-ink-3">
              <Avatar name={clientOrHost} size="xs" />
              <span className="truncate font-medium text-ink-2">{clientOrHost}</span>
              {item.required_tier && (
                <span className="ml-auto text-micro text-ink-4 capitalize">{item.required_tier} tier</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Commercial summary block */}
      <div className="rounded-xl bg-surface-1 border border-edge-1 p-3 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold text-ink-1">{priceLine}</p>
          {item.capacity?.value != null && (
            <span className="text-micro font-mono font-semibold text-ink-2">
              {num(item.capacity.value)} {item.capacity.unit}
            </span>
          )}
        </div>
        {metaLine && (
          <p className="text-2xs text-ink-4 flex items-center gap-1">
            <MapPin size={10} className="shrink-0 text-brand-600" /> {metaLine}
          </p>
        )}
        {isJob && item.expires_at && (
          <p className="text-micro text-ink-4 flex items-center gap-1">
            <Clock size={10} /> Closes {relativeTime(item.expires_at)}
          </p>
        )}
      </div>

      {/* Progressive disclosure: Details on demand */}
      {detailsOpen && (
        <div className="rounded-xl border border-edge-1 bg-surface-1 p-3 space-y-1.5 text-2xs text-ink-3 animate-fade-in">
          {item.description && <p className="text-ink-2 leading-relaxed">{item.description}</p>}
          {item.features?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {item.features.map((f) => (
                <Badge key={f} variant="gray" size="xs">
                  {f}
                </Badge>
              ))}
            </div>
          )}
          {item.terms && <p className="text-micro text-ink-4">Terms: {item.terms}</p>}
          {isJob && (
            <p className="text-micro text-ink-4">
              Verified 2-party OTP completion proof required at shift finish.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
        <Button size="sm" variant={isJob ? "primary" : "secondary"} onClick={primary.action}>
          {primary.label}
        </Button>
        {isJob && onInspect ? (
          <Button size="sm" variant="secondary" icon={Info} onClick={() => onInspect(item)}>
            View Job
          </Button>
        ) : (
          (item.description || item.features?.length > 0 || item.terms || isJob) && (
            <Button
              size="sm"
              variant="ghost"
              icon={detailsOpen ? ChevronUp : ChevronDown}
              onClick={() => setDetailsOpen((v) => !v)}
            >
              Details
            </Button>
          )
        )}
        {isJob && item.vendor_handle && (
          <Button size="sm" variant="ghost" icon={Phone} onClick={() => navigate(`/@${item.vendor_handle}`)}>
            Poster
          </Button>
        )}
        {isVendor && item.is_verified && (
          <span className="text-2xs text-brand-700 dark:text-brand-300 inline-flex items-center gap-1 self-center ml-auto">
            <ShieldCheck size={11} /> ID verified
          </span>
        )}
      </div>
    </article>
  );
}
