import { Box, Hotel, MapPin, Package, Snowflake, Store, Truck, Warehouse, Wrench } from "lucide-react";
import Badge from "@/components/ui/Badge";
import CardShell, { CardBody, CardMedia, CardTitle, CardPrice, CardMeta, CardVendor } from "./CardShell";
import { TOOL_CATEGORIES, PRICE_UNITS } from "@/config/constants";
import { currency, num } from "@/lib/formatters";

/**
 * EQUIPMENT CARD — a tool, facility or logistics service someone is renting out.
 *
 * Categories and price units come from the shared config, the capacity wording
 * from the record's own `capacity` / `details` blocks — the same fields the
 * Tools page renders. Tapping opens that exact listing in the Tools browser.
 */
const ICONS = { Warehouse, Truck, Package, Store, Hotel, Wrench, Box, Snowflake };

const unitLabel = (unit) => PRICE_UNITS.find((p) => p.value === unit)?.label || (unit ? `/ ${unit.replace("per_", "")}` : "");

function capacityText(capacity, details) {
  if (capacity?.value != null) return `${num(capacity.value)} ${capacity.unit || "units"}`;
  if (capacity?.sqm != null) return `${num(capacity.sqm)} sqm`;
  if (details?.max_weight_kg != null) return `Up to ${num(details.max_weight_kg)} kg`;
  if (details?.shared_spaces_available != null) return `${num(details.shared_spaces_available)} shared spaces`;
  const entries = Object.entries(capacity || {}).filter(([, v]) => v != null && v !== "");
  return entries.length ? entries.slice(0, 2).map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`).join(" · ") : null;
}

export default function EquipmentCard({ item }) {
  const category = TOOL_CATEGORIES.find((c) => c.value === item.category);
  const Icon = ICONS[category?.icon] || Warehouse;
  const capacity = capacityText(item.capacity, item.details);

  return (
    <CardShell
      to={item.to}
      label={`${item.title} — ${item.price ? `${currency(item.price)} ${unitLabel(item.priceUnit)}` : "rate on request"} from ${item.vendorName}`}
    >
      <CardMedia
        src={item.image}
        tint="bg-brand-50 dark:bg-surface-2"
        fallback={
          <span className="flex flex-col items-center gap-1 text-brand-700 dark:text-brand-300">
            <Icon size={22} aria-hidden="true" />
            <span className="text-micro font-bold uppercase tracking-wider">{category?.label || item.category}</span>
          </span>
        }
      >
        <span className="absolute left-2 top-2">
          <Badge variant="brand" size="xs">Available</Badge>
        </span>
      </CardMedia>

      <CardBody>
        <CardTitle>{item.title}</CardTitle>
        <CardPrice>
          {item.price ? (
            <>
              {currency(item.price)} <span className="font-medium text-ink-4">{unitLabel(item.priceUnit)}</span>
            </>
          ) : (
            <span className="text-ink-3">Ask for a rate</span>
          )}
        </CardPrice>
        {capacity ? <CardMeta>{capacity}{item.minBooking ? ` · min ${item.minBooking}` : ""}</CardMeta> : null}
        {item.location ? (
          <CardMeta>
            <span className="inline-flex items-center gap-1">
              <MapPin size={10} aria-hidden="true" />
              {item.location}
            </span>
          </CardMeta>
        ) : null}
        <CardVendor name={item.vendorName} />
      </CardBody>
    </CardShell>
  );
}
