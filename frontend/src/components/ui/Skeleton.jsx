import { cn } from "@/lib/utils";

/**
 * Loading looks like the content it is about to become. A shimmering block
 * shaped like a card beats a centred spinner on every perceived-speed metric,
 * and it stops the layout jumping when data lands.
 */
export default function Skeleton({ className, rounded = "rounded-lg", ...rest }) {
  return <div className={cn("skeleton", rounded, className)} aria-hidden="true" {...rest} />;
}

export function SkeletonText({ lines = 3, className }) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn("h-3", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/** The listing-card silhouette, reused by Browse, Home shelves and shop fronts. */
export function SkeletonCard({ media = true }) {
  return (
    <div className="bg-surface-0 border border-edge-1 rounded-2xl overflow-hidden" aria-hidden="true">
      {media && <Skeleton className="h-32 w-full" rounded="rounded-none" />}
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-7" rounded="rounded-full" />
          <Skeleton className="h-3 w-24" />
        </div>
        <SkeletonText lines={2} />
        <div className="flex items-center justify-between pt-1">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-5 w-20" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 8, media = true, className }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4", className)} role="status" aria-label="Loading results">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} media={media} />
      ))}
    </div>
  );
}

export function SkeletonRows({ count = 5, className }) {
  return (
    <div className={cn("space-y-2", className)} role="status" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-surface-0 border border-edge-1 rounded-xl p-4 flex items-center gap-3">
          <Skeleton className="h-10 w-10" rounded="rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-8 w-20" rounded="rounded-lg" />
        </div>
      ))}
    </div>
  );
}
