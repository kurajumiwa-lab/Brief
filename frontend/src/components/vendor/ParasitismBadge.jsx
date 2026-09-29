import { Leaf } from "lucide-react";
import Badge from "@/components/ui/Badge";

/** parasitism_index = deals×10 + bidirectional×25 + balance×50 → higher is healthier */
export function parasitismTier(index = 0) {
  if (index >= 75) return { label: "Symbiotic", variant: "brand" };
  if (index >= 40) return { label: "Balanced", variant: "blue" };
  if (index >= 15) return { label: "Building", variant: "amber" };
  return { label: "New", variant: "gray" };
}

export default function ParasitismBadge({ index = 0, showValue = true, size = "sm" }) {
  const tier = parasitismTier(index);
  return (
    <Badge
      variant={tier.variant}
      size={size}
      title="Parasitism index — how much you give back to the network. Deals ×10, two-way trade ×25, sourcing/supplying balance ×50."
    >
      <Leaf size={10} />
      {tier.label}
      {showValue && <span className="font-mono opacity-70">{Math.round(index)}</span>}
    </Badge>
  );
}
