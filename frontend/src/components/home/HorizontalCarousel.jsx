import Shelf, { ShelfItem } from "@/components/ui/Shelf";
import { cn } from "@/lib/utils";
import { CARD_SLOT } from "./cards/CardShell";

/**
 * THE HOME CAROUSEL — the feed's only horizontal scroller.
 *
 * It is a thin composition of the product's existing carousel (`ui/Shelf`),
 * not a second implementation: swiping, mouse-drag, snapping, arrow buttons and
 * the swipe-vs-tap guard all live there. What this adds is the feed's contract
 * — one card width, one animation, one accessible label — so twenty shelves
 * scroll identically.
 */
export default function HorizontalCarousel({ label, children, className }) {
  return (
    <Shelf ariaLabel={label} fade arrows="always" className={cn("-mx-1", className)}>
      {children}
    </Shelf>
  );
}

/** One card slot in a feed carousel. Always `CARD_SLOT` wide, never floating. */
export function CarouselItem({ index = 0, children, className }) {
  return (
    <ShelfItem index={index} float={false} className={cn(CARD_SLOT, className)}>
      {children}
    </ShelfItem>
  );
}
