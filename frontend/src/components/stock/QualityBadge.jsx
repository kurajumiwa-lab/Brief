import { ShieldCheck, ShieldQuestion, FileCheck2, BadgeCheck } from "lucide-react";
import Badge from "@/components/ui/Badge";
import { QUALITY_STATUSES } from "@/config/constants";

const ICONS = { unverified: ShieldQuestion, self_declared: ShieldCheck, patron_verified: BadgeCheck, lab_certified: FileCheck2 };

/**
 * Quality / provenance badge for a stock item (v2.1 §3.1).
 * Tone comes from `QUALITY_STATUSES` (Badge `variant`, not `color`).
 */
export default function QualityBadge({ status = "unverified", size = "xs", showUnverified = false, className }) {
  const meta = QUALITY_STATUSES.find((q) => q.value === status) || QUALITY_STATUSES[0];
  if (meta.value === "unverified" && !showUnverified) return null;
  const Icon = ICONS[meta.value] || ShieldQuestion;
  return (
    <Badge variant={meta.variant} size={size} className={className} title={meta.hint} data-quality={meta.value}>
      <Icon size={size === "xs" ? 10 : 12} />
      {meta.label}
    </Badge>
  );
}
