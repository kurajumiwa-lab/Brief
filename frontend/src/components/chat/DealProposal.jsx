import { HeartHandshake } from "lucide-react";
import Badge from "@/components/ui/Badge";
import { currency, num } from "@/lib/formatters";

/** Structured deal terms carried in `message.deal_data`. */
export default function DealProposal({ deal }) {
  if (!deal) return null;
  const total = deal.total ?? (deal.quantity && deal.unit_price ? Number(deal.quantity) * Number(deal.unit_price) : null);
  return (
    <div className="mt-1.5 rounded-lg border border-amber-800/50 bg-amber-950/30 p-2.5 min-w-[14rem]">
      <div className="flex items-center gap-2 text-amber-200">
        <HeartHandshake size={13} />
        <span className="text-xs font-semibold">Deal proposal</span>
        {deal.status && (
          <Badge variant="amber" size="xs" className="ml-auto">
            {deal.status}
          </Badge>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-2xs">
        {deal.item && (
          <>
            <dt className="text-ink-4">Item</dt>
            <dd className="text-ink-1 truncate">{deal.item}</dd>
          </>
        )}
        {deal.quantity != null && (
          <>
            <dt className="text-ink-4">Quantity</dt>
            <dd className="font-mono text-ink-1">
              {num(deal.quantity)} {deal.unit || ""}
            </dd>
          </>
        )}
        {deal.unit_price != null && (
          <>
            <dt className="text-ink-4">Unit price</dt>
            <dd className="font-mono text-ink-1">{currency(deal.unit_price)}</dd>
          </>
        )}
        {total != null && (
          <>
            <dt className="text-ink-4">Total</dt>
            <dd className="font-mono text-amber-200 font-semibold">{currency(total)}</dd>
          </>
        )}
        {deal.delivery && (
          <>
            <dt className="text-ink-4">Delivery</dt>
            <dd className="text-ink-1">{deal.delivery}</dd>
          </>
        )}
        {deal.payment && (
          <>
            <dt className="text-ink-4">Payment</dt>
            <dd className="text-ink-1">{deal.payment}</dd>
          </>
        )}
      </dl>
      {deal.notes && <p className="mt-2 text-2xs text-ink-3 italic">{deal.notes}</p>}
    </div>
  );
}
