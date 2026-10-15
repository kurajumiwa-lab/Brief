import { CalendarDays, MapPin } from "lucide-react";
import Badge from "@/components/ui/Badge";
import CardShell, { CardBody, CardPoster, CardTitle, CardPrice, CardMeta, CardVendor } from "./CardShell";
import { currency, dayLabel, num, timeOnly } from "@/lib/formatters";

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
      <CardPoster
        icon={CalendarDays}
        label={TYPE_LABELS[item.eventType] || "Event"}
        tone="amber"
        corner={
          <>
            <span className="absolute left-2 top-2">
              <Badge variant="amber" size="xs">{TYPE_LABELS[item.eventType] || "Event"}</Badge>
            </span>
            {item.myStatus && (
              <span className="absolute right-2 top-2">
                <Badge variant="brand" size="xs">{item.myStatus === "registered" ? "Going" : item.myStatus}</Badge>
              </span>
            )}
          </>
        }
      />

      <CardBody>
        <CardTitle>{item.title}</CardTitle>
        <CardPrice>{dayLabel(item.startDate)}{item.virtual ? "" : ` · ${timeOnly(item.startDate)}`}</CardPrice>
        <CardMeta>
          <span className="inline-flex items-center gap-1">
            <MapPin size={10} aria-hidden="true" />
            {item.location || "Venue not stated"}
          </span>
        </CardMeta>
        <CardMeta>
          {item.freeEntry ? "Free entry" : item.fee != null ? `${currency(item.fee)} entry` : "Entry not stated"}
          {item.capacity != null
            ? ` · ${num(item.registered)}/${num(item.capacity)} registered`
            : spotsLeft != null
              ? ` · ${num(spotsLeft)} spots left`
              : item.registered != null
                ? ` · ${num(item.registered)} registered`
                : ""}
        </CardMeta>
        <CardVendor name={item.organizer} />
      </CardBody>
    </CardShell>
  );
}
