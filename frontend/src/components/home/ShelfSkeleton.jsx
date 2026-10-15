import { cn } from "@/lib/utils";
import Skeleton from "@/components/ui/Skeleton";
import { CARD_MEDIA_RATIO, CARD_SLOT } from "./cards/CardShell";

/**
 * LOADING, SHAPED LIKE THE CONTENT
 *
 * The skeleton uses the real card slot and media ratio, so the shelf does not
 * move a pixel when the records land — the single biggest cause of a janky
 * feed on a low-end Android phone.
 */
export default function ShelfSkeleton({ count = 4, label }) {
  return (
    <div className="flex gap-3 overflow-hidden px-1 -mx-1" role="status" aria-label={label ? `Loading ${label}` : "Loading"}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={cn(CARD_SLOT, "shrink-0 overflow-hidden rounded-2xl border border-edge-1 bg-surface-0")}
          aria-hidden="true"
        >
          <Skeleton className={cn(CARD_MEDIA_RATIO, "w-full")} rounded="rounded-none" />
          <div className="space-y-2 p-2.5">
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
