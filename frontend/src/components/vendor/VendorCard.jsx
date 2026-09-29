import { Link, useNavigate } from "react-router-dom";
import { MapPin, MessageSquare, ShieldCheck, Crown, Plug, Gauge } from "lucide-react";
import Card from "@/components/ui/Card";
import Avatar from "@/components/ui/Avatar";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import ParasitismBadge from "./ParasitismBadge";
import ConnectionButton from "./ConnectionButton";
import { ROLE_BADGE, VENDOR_ROLES } from "@/config/constants";
import { useChatStore } from "@/stores/chatStore";
import { toast } from "@/components/ui/Toast";
import { apiError } from "@/lib/api";
import { num } from "@/lib/formatters";

/** v2.1 · VendorPerformance summary — fulfilment rate feeds 40% of the live parasitism index. */
export function ReliabilityChip({ rate, score, completed }) {
  const r = Number(rate ?? 0);
  const variant = r >= 90 ? "brand" : r >= 70 ? "blue" : r >= 50 ? "amber" : "red";
  return (
    <div className="flex items-center gap-1.5" data-testid="reliability-chip">
      <Badge variant={variant} size="xs" title={`${completed || 0} movements completed`}>
        <Gauge size={10} /> {r.toFixed(0)}% fulfilled
      </Badge>
      {score != null && <span className="text-2xs text-ink-4 font-mono">reliability {Number(score).toFixed(0)}</span>}
    </div>
  );
}

export default function VendorCard({ vendor, compact = false, reasons, footer }) {
  const navigate = useNavigate();
  const openDirect = useChatStore((s) => s.openDirect);
  const id = vendor.id || vendor.vendor_id;
  const role = VENDOR_ROLES.find((r) => r.value === vendor.current_role);

  const message = async (e) => {
    e.preventDefault();
    try {
      const roomId = await openDirect(id);
      navigate(`/chat?room=${roomId}`);
    } catch (err) {
      toast.error(apiError(err, "Couldn't open a direct room"));
    }
  };

  return (
    <Card className="flex flex-col gap-3 group" padding="p-4">
      <div className="flex items-start gap-3">
        <Link to={`/@${vendor.vendor_handle}`} className="shrink-0">
          <Avatar name={vendor.business_name} size={compact ? "sm" : "md"} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <Link to={`/@${vendor.vendor_handle}`} className="text-sm font-semibold text-ink-1 truncate hover:text-brand-300">
              {vendor.business_name}
            </Link>
            {vendor.is_verified && <ShieldCheck size={13} className="text-brand-400 shrink-0" title="Verified" />}
            {vendor.is_patron && <Crown size={13} className="text-amber-400 shrink-0" title="Patron" />}
            {vendor.has_pos_connected && <Plug size={12} className="text-blue-400 shrink-0" title="POS connected" />}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-ink-4 min-w-0">
            <span className="font-mono truncate">@{vendor.vendor_handle}</span>
            {role && (
              <Badge variant={ROLE_BADGE[role.value]} size="xs">
                {role.emoji} {role.label}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {!compact && vendor.business_description && <p className="text-xs text-ink-3 line-clamp-2 leading-relaxed">{vendor.business_description}</p>}

      {(vendor.business_categories?.length > 0 || vendor.physical_location) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {vendor.business_categories?.slice(0, compact ? 2 : 4).map((c) => (
            <Badge key={c} variant="outline" size="xs">
              {c}
            </Badge>
          ))}
          {vendor.physical_location && (
            <span className="inline-flex items-center gap-1 text-2xs text-ink-4">
              <MapPin size={10} /> {vendor.physical_location}
            </span>
          )}
        </div>
      )}

      {reasons?.length > 0 && (
        <ul className="text-2xs text-brand-300/90 space-y-0.5">
          {reasons.slice(0, 2).map((r) => (
            <li key={r}>· {r}</li>
          ))}
        </ul>
      )}

      {!compact && (
        <div className="flex items-center justify-between gap-2 text-2xs text-ink-4 font-mono">
          <span title="Network score">score {Number(vendor.network_score || 0).toFixed(1)}</span>
          <span>{num(vendor.total_supplied || 0)} supplied · {num(vendor.total_sourced || 0)} sourced</span>
        </div>
      )}
      {!compact && (vendor.movements_completed > 0 || vendor.reliability_score > 0) && (
        <ReliabilityChip rate={vendor.fulfillment_rate} score={vendor.reliability_score} completed={vendor.movements_completed} />
      )}

      <div className="flex items-center justify-between gap-2 mt-auto pt-1">
        <ParasitismBadge index={vendor.parasitism_index ?? vendor.parasitism_score ?? 0} showValue={!compact} />
        <div className="flex items-center gap-1.5">
          <Button size="xs" variant="ghost" icon={MessageSquare} onClick={message} aria-label={`Message @${vendor.vendor_handle}`} />
          <ConnectionButton vendor={{ ...vendor, id }} size="xs" />
        </div>
      </div>
      {footer}
    </Card>
  );
}
