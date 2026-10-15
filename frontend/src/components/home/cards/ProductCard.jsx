import { ArrowDownToLine, BadgeCheck, Package } from "lucide-react";
import Badge from "@/components/ui/Badge";
import StockThumb from "@/components/stock/StockThumb";
import CardShell, { CardBody, CardActions, CardTitle, CardPrice, CardMeta, CardVendor, CARD_MEDIA_RATIO } from "./CardShell";
import { currency, num } from "@/lib/formatters";

/**
 * PRODUCT CARD — another vendor's stock, exactly as they restated it.
 *
 * The tap goes to the listing (where sourcing, provenance and the deal room
 * live). The `Source` button is the one-tap shortcut into the same sourcing
 * dialog the Stock Room and Browse already use — passed in, never re-invented.
 */
export default function ProductCard({ item, onSource }) {
  const soldOut = !item.quantity || item.quantity <= 0;
  const low = !soldOut && item.moq && item.quantity <= item.moq * 2;
  const price = item.price ?? item.wholesalePrice ?? item.unitPrice;

  return (
    <CardShell
      to={item.to}
      label={`${item.title} — ${price ? `${currency(price)} per ${item.unit}` : "price on request"} from ${item.vendorName}`}
    >
      <StockThumb item={item.raw} ratio={CARD_MEDIA_RATIO}>
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {soldOut ? (
            <Badge variant="red" size="xs">Sold out</Badge>
          ) : low ? (
            <Badge variant="amber" size="xs">Low stock</Badge>
          ) : (
            <Badge variant="brand" size="xs">Available</Badge>
          )}
        </div>
        {item.quality && item.quality !== "unverified" && (
          <span className="absolute right-2 top-2">
            <Badge variant="blue" size="xs" title="Provenance declared or verified by this vendor">
              <BadgeCheck size={10} aria-hidden="true" />
              {item.quality === "lab_certified" ? "Lab" : item.quality === "patron_verified" ? "Verified" : "Declared"}
            </Badge>
          </span>
        )}
      </StockThumb>

      <CardBody>
        <CardTitle>{item.title}</CardTitle>
        <CardPrice>
          {price ? (
            <>
              {currency(price)} <span className="font-medium text-ink-4">/ {item.unit}</span>
            </>
          ) : (
            <span className="text-ink-3">Ask for a price</span>
          )}
        </CardPrice>
        <CardMeta>
          {soldOut ? "None available" : `${num(item.quantity)} ${item.unit}${item.quantity === 1 ? "" : "s"} available`}
          {item.moq ? ` · min ${num(item.moq)}` : ""}
        </CardMeta>
        <CardVendor name={item.vendorName} />
      </CardBody>

      {onSource && (
        <CardActions>
          <button
            type="button"
            disabled={soldOut}
            onClick={() => onSource(item.raw)}
            className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-lg bg-brand-700 px-2 text-2xs font-semibold text-white transition-colors hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-4"
          >
            <ArrowDownToLine size={12} aria-hidden="true" />
            {soldOut ? "Sold out" : "Source"}
          </button>
        </CardActions>
      )}
    </CardShell>
  );
}

/** Used by the skeleton so the loading state is the same shape as the card. */
export const ProductCardFallbackIcon = Package;
