import { Footprints, HeartHandshake, MapPin, Package, Timer, Truck, Users, Wrench, Zap } from "lucide-react";
import Badge from "@/components/ui/Badge";
import CardShell, { CardBody, CardPoster, CardTitle, CardPrice, CardMeta } from "./CardShell";
import { currency, num, relativeTime } from "@/lib/formatters";

/**
 * OPPORTUNITY CARD — work waiting in the network.
 *
 * Two real records share the shelf: a **request** another business posted
 * (`open` scope already excludes your own), and a **call-up** from the Hustle
 * League (the server never matches your own call). Each keeps its own wording
 * and its own destination, so a vendor can tell at a glance which one they are
 * looking at — and what it pays.
 */
const TYPE_ICONS = { stock: Package, worker: Users, delivery: Truck, rental: Wrench, errand: Footprints, service: HeartHandshake };
const TYPE_LABELS = { stock: "Stock", worker: "Worker", delivery: "Delivery", rental: "Rental", errand: "Errand", service: "Service" };
const NEEDED_BY = { today: "Needed today", tomorrow: "Needed tomorrow", this_week: "Needed this week", flexible: "Timing flexible" };

export default function OpportunityCard({ item }) {
  if (item.subtype === "job") {
    return (
      <CardShell to={item.to} label={`${item.title} — paid work${item.pay ? ` at ${currency(item.pay)}` : ""}. Open the call-up board`}>
        <CardPoster
          icon={Zap}
          label={item.squad ? "Squad mission" : "Paid call-up"}
          tone="amber"
          corner={
            <span className="absolute left-2 top-2">
              <Badge variant="amber" size="xs">{item.squad ? "Squad mission" : "Call-up"}</Badge>
            </span>
          }
        />
        <CardBody>
          <CardTitle>{item.title}</CardTitle>
          <CardPrice>{item.pay ? `${currency(item.pay)} for the job` : "Pay on agreement"}</CardPrice>
          {item.skill ? <CardMeta>{item.skill}{item.taskType ? ` · ${item.taskType.replace(/_/g, " ")}` : ""}</CardMeta> : null}
          <CardMeta>
            <span className="inline-flex items-center gap-1">
              <MapPin size={10} aria-hidden="true" />
              {item.location || "Location not stated"}
              {item.distanceKm != null ? ` · ${item.distanceKm} km` : ""}
            </span>
          </CardMeta>
          {item.expiresAt ? (
            <CardMeta>
              <span className="inline-flex items-center gap-1">
                <Timer size={10} aria-hidden="true" />
                Closes {relativeTime(item.expiresAt)}
              </span>
            </CardMeta>
          ) : null}
        </CardBody>
      </CardShell>
    );
  }

  const Icon = TYPE_ICONS[item.requestType] || HeartHandshake;

  return (
    <CardShell
      to={item.to}
      label={`${TYPE_LABELS[item.requestType] || "Business"} request: ${item.title}. Open the requests feed`}
    >
      <CardPoster
        icon={Icon}
        label={`${TYPE_LABELS[item.requestType] || "Business"} request`}
        tone="blue"
        corner={
          <span className="absolute left-2 top-2">
            <Badge variant="blue" size="xs">{TYPE_LABELS[item.requestType] || "Request"}</Badge>
          </span>
        }
      />
      <CardBody>
        <CardTitle>{item.title}</CardTitle>
        <CardPrice>{item.budget ? `${currency(item.budget)} budget` : "Budget not stated"}</CardPrice>
        <CardMeta>
          <span className="inline-flex items-center gap-1">
            <MapPin size={10} aria-hidden="true" />
            {item.location || "Location not stated"}
            {item.distanceKm != null ? ` · ${item.distanceKm} km` : ""}
          </span>
        </CardMeta>
        <CardMeta>
          {item.offers > 0 ? `${num(item.offers)} offer${item.offers === 1 ? "" : "s"} so far` : "No offers yet"}
          {item.neededBy ? ` · ${NEEDED_BY[item.neededBy] || item.neededBy}` : ""}
        </CardMeta>
      </CardBody>
    </CardShell>
  );
}
