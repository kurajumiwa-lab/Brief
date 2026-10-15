import { MapPin } from "lucide-react";
import CardShell, { CardBody, CardMedia, CardTitle, CardMeta } from "./CardShell";
import { num } from "@/lib/formatters";

/**
 * MARKET CARD — a real trading zone: registered members and mapped places.
 *
 * Both numbers are counted from rows (MarketMember, PublicPlace), not estimated.
 * The card opens that market's own screen.
 */
export default function MarketCard({ item }) {
  return (
    <CardShell
      to={item.to}
      label={`${item.title}${item.city ? `, ${item.city}` : ""} — ${item.members} registered vendors. Open the market`}
    >
      <CardMedia tint="bg-orchid-50 dark:bg-surface-2" fallback={<MapPin size={26} className="text-orchid-700 dark:text-orchid-300" />}>
        {item.distanceKm != null && (
          <span className="absolute bottom-2 left-2 rounded-full bg-surface-0/90 px-2 py-0.5 text-micro font-semibold text-ink-2">
            {item.distanceKm} km away
          </span>
        )}
      </CardMedia>
      <CardBody>
        <CardTitle>{item.title}</CardTitle>
        <CardMeta>{[item.city, item.country].filter(Boolean).join(" · ") || "Location not stated"}</CardMeta>
        <CardMeta>{num(item.members)} registered vendor{item.members === 1 ? "" : "s"}</CardMeta>
        <CardMeta>{num(item.places)} mapped place{item.places === 1 ? "" : "s"}</CardMeta>
      </CardBody>
    </CardShell>
  );
}
