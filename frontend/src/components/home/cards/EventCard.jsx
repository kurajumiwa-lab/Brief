import { CalendarDays, MapPin } from "lucide-react";
import Badge from "@/components/ui/Badge";
import CardShell, { CardBody, CardMedia, CardTitle, CardPrice, CardMeta, CardVendor } from "./CardShell";
import { currency, dayLabel, timeOnly } from "@/lib/formatters";

/**
 * EVENT CARD — a market day, trade fair or sourcing trip on the calendar.
 *
 * The date block leads because the date is the decision. Capacity and fee are
 * the vendor's own stated numbers, and a registered vendor sees their own
 * status rather than being asked to register twice.
 */
const TYPE_LABELS = {
  market_day: "Market day",
  sourcing_trip: "Sourcing trip",
  trade_fair: "Trade fair",
  training: "Training",
  other: "Event",
};

export default function EventCard({ item }) {
  const spotsLeft = item.spotsLeft ?? (item.capacity != null ? Math.max(0, item.capacity - item.registered) : null);

  return (
    <CardShell to={item.to} label={`${item.title} — ${dayLabel(item.startDate)}${item.location ? ` at ${item.location}` : ""}. Open events`}>
      <CardMedia tint="bg-accent-50 dark:bg-surface-2" fallback={<CalendarDays size={26} className="text-accent-700 dark:text-accent-300" />}>
        <span className="absolute left-2 top-2">
          <Badge variant="amber" size="xs">{TYPE_LABELS[item.eventType] || "Event"}</Badge>
        </span>
        {item.myStatus && (
          <span className="absolute right-2 top-2">
            <Badge variant="brand" size="xs">{item.myStatus === "registered" ? "Going" : item.myStatus}</Badge>
          </span>
        )}
      </CardMedia>

      <CardBody>
        <CardTitle>{item.title}</CardTitle>
        <CardPrice>{dayLabel(item.startDate)}{item.virtual ? "" : ` · ${timeOnly(item.startDate)}`}</CardPrice>
        {item.location ? (
          <CardMeta>
            <span className="inline-flex items-center gap-1">
              <MapPin size={10} aria-hidden="true" />
              {item.location}
            </span>
          </CardMeta>
        ) : null}
        <CardMeta>
          {item.fee ? `${currency(item.fee)} entry` : "Free entry"}
          {item.capacity != null ? ` · ${item.registered}/${item.capacity} registered` : spotsLeft != null ? ` · ${spotsLeft} spots left` : ""}
        </CardMeta>
        <CardVendor name={item.organizer} />
      </CardBody>
    </CardShell>
  );
}
