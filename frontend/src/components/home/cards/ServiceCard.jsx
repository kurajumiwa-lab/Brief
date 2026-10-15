import { Building2, Palette, Smartphone, Timer } from "lucide-react";
import Badge from "@/components/ui/Badge";
import CardShell, { CardBody, CardMedia, CardTitle, CardPrice, CardMeta } from "./CardShell";
import { num } from "@/lib/formatters";

/**
 * SERVICE CARD — a service offer from the storefront catalogue.
 *
 * These are the platform's own productised offers (digital services, business
 * software, field operations), each with a stated test price and a readiness
 * that says how it can honestly be sold today. The card shows both, because a
 * price without readiness is a promise a vendor would have to guess at.
 */
const LINE_ICON = { digital_services: Palette, business_software: Building2, field_operations: Smartphone };

const READINESS = {
  available_now: { label: "Available now", variant: "brand" },
  pilot: { label: "Pilot", variant: "amber" },
  service: { label: "Delivered as a service", variant: "brand" },
  scoped: { label: "Scoped quote", variant: "gray" },
};

function priceLine(item) {
  if (item.priceMin == null) return "Scoped quotation";
  const range = item.priceMin === item.priceMax ? num(item.priceMin) : `${num(item.priceMin)}–${num(item.priceMax)}`;
  const suffix = item.priceUnit === "monthly" ? "/mo" : item.priceUnit === "setup_once" ? " once" : "";
  return `KSh ${range}${suffix}`;
}

export default function ServiceCard({ item }) {
  const Icon = LINE_ICON[item.line] || Palette;
  const readiness = READINESS[item.readiness] || null;

  return (
    <CardShell to={item.to} label={`${item.title} — ${priceLine(item)}. Open the offer`}>
      <CardMedia
        tint="bg-gradient-to-br from-brand-50 to-orchid-50 dark:from-surface-2 dark:to-surface-2"
        fallback={<Icon size={26} className="text-brand-700 dark:text-brand-300" />}
      />
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
