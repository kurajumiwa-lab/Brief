import { Building2, Palette, Smartphone, Timer } from "lucide-react";
import Badge from "@/components/ui/Badge";
import CardShell, { CardBody, CardPoster, CardTitle, CardPrice, CardMeta } from "./CardShell";
import { compactNum } from "@/lib/formatters";

/**
 * SERVICE CARD — a service offer from the storefront catalogue.
 *
 * These are the platform's own productised offers (digital services, business
 * software, field operations), each with a stated test price and a readiness
 * that says how it can honestly be sold today. The card shows both, because a
 * price without readiness is a promise a vendor would have to guess at.
 */
const LINE_ICON = { digital_services: Palette, business_software: Building2, field_operations: Smartphone };

/** The line's own name, so the poster says what kind of offer this is. */
const LINE_LABEL = {
  digital_services: "Digital service",
  business_software: "Business software",
  field_operations: "Field operations",
};

const READINESS = {
  available_now: { label: "Available now", variant: "brand" },
  pilot: { label: "Pilot", variant: "amber" },
  service: { label: "Delivered as a service", variant: "brand" },
  scoped: { label: "Scoped quote", variant: "gray" },
};

/**
 * The price line, in the smallest number of characters that is still exact:
 * a range reads "KSh 15–45k", a single figure "KSh 2,500/mo". The offer's own
 * page prints the full amounts — this is a card, and a wrapped price is noise.
 */
function priceLine(item) {
  if (item.priceMin == null) return "Scoped quotation";
  const range =
    item.priceMin === item.priceMax
      ? compactNum(item.priceMin)
      : `${compactNum(item.priceMin)}–${compactNum(item.priceMax)}`;
  const suffix = item.priceUnit === "monthly" ? "/mo" : item.priceUnit === "setup_once" ? " once" : "";
  return `KSh ${range}${suffix}`;
}

export default function ServiceCard({ item }) {
  const Icon = LINE_ICON[item.line] || Palette;
  const readiness = READINESS[item.readiness] || null;

  return (
    <CardShell to={item.to} label={`${item.title} — ${priceLine(item)}. Open the offer`}>
      <CardPoster icon={Icon} label={LINE_LABEL[item.line] || "Service"} tone="orchid" />
      <CardBody>
        <CardTitle>{item.title}</CardTitle>
        <CardPrice>{priceLine(item)}</CardPrice>
        {readiness ? (
          <span className="flex flex-wrap gap-1 pt-0.5">
            <Badge variant={readiness.variant} size="xs">{readiness.label}</Badge>
          </span>
        ) : null}
        {item.turnaround ? (
          <CardMeta>
            <span className="inline-flex items-center gap-1">
              <Timer size={10} aria-hidden="true" />
              {item.turnaround}
            </span>
          </CardMeta>
        ) : null}
      </CardBody>
    </CardShell>
  );
}
