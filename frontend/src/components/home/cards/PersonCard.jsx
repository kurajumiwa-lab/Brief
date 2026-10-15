import { BadgeCheck, Crown, MapPin, Star } from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import { FulfilmentChip } from "@/components/trust/TrustSignals";
import CardShell, { CardBody, CardMedia, CardTitle, CardMeta } from "./CardShell";
import { VENDOR_ROLES } from "@/config/constants";

/**
 * PERSON CARD — a vendor to work with.
 *
 * The ranking is the existing discovery service: people you have not traded
 * with yet, scored on what the network can evidence. The card shows the
 * vendor's own words (categories, location) and only the signals the API
 * actually returns — no invented ratings.
 */
export default function PersonCard({ item }) {
  const role = VENDOR_ROLES.find((r) => r.value === item.role);

  return (
    <CardShell to={item.to} label={`${item.name}${item.handle ? ` (@${item.handle})` : ""} — open shop front`}>
      <CardMedia tint="bg-gradient-to-br from-orchid-50 to-surface-2 dark:from-surface-2 dark:to-surface-2">
        <Avatar name={item.name} size="lg" />
      </CardMedia>

      <CardBody>
        <span className="flex items-center gap-1">
          <CardTitle className="truncate">{item.name}</CardTitle>
          {item.verified && <BadgeCheck size={12} className="shrink-0 text-brand-600 dark:text-brand-400" aria-label="Verified business" />}
          {item.patron && <Crown size={12} className="shrink-0 text-accent-600 dark:text-accent-400" aria-label="Runs a vendor list" />}
        </span>
        {role ? <CardMeta>{role.emoji} {role.label}</CardMeta> : null}
        {item.categories?.length ? <CardMeta>{item.categories.join(" · ")}</CardMeta> : null}
        {item.location || item.distanceKm != null ? (
          <CardMeta>
            <span className="inline-flex items-center gap-1">
              <MapPin size={10} aria-hidden="true" />
              {item.location || "location not stated"}
              {item.distanceKm != null ? ` · ${item.distanceKm} km` : ""}
            </span>
          </CardMeta>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
          {item.connected ? (
            <span className="text-micro text-ink-4">In your network</span>
          ) : item.fulfilment != null ? (
            <FulfilmentChip rate={item.fulfilment} />
          ) : (
            <span className="text-micro text-ink-4">New to the network</span>
          )}
          {item.score != null && (
            <span className="inline-flex items-center gap-0.5 text-micro text-ink-4" title="Discovery score from the network graph">
              <Star size={10} aria-hidden="true" />
              {Number(item.score).toFixed(0)}
            </span>
          )}
        </div>
      </CardBody>
    </CardShell>
  );
}
