import { RefreshCw } from "lucide-react";
import SectionHeader from "@/components/ui/SectionHeader";
import Button from "@/components/ui/Button";
import HorizontalCarousel, { CarouselItem } from "./HorizontalCarousel";
import ShelfSkeleton from "./ShelfSkeleton";
import ShelfEmptyState from "./ShelfEmptyState";
import { renderCard } from "./cards";
import ErrorBoundary from "@/components/system/ErrorBoundary";
import { useHomeFeedStore } from "@/stores/homeFeedStore";

/**
 * ONE CURATED SHELF.
 *
 * A shelf is a real module of Ogallo shown as a carousel: a short title, an
 * optional subtitle, a `See all` door into the module's own screen, and real
 * records beside each other. Its four states are all content decisions:
 *
 *   idle / loading → a skeleton the exact size of the cards
 *   error          → a one-line apology *inside this shelf* plus retry
 *   ready, empty   → nothing at all (the shelf hides; nothing is padded in)
 *   ready, items   → the carousel
 *
 * A failed *fetch* is only one way a shelf breaks. A card can also throw while
 * drawing — one record with a shape nobody anticipated — and React unmounts the
 * whole tree when that happens, so the "the rest of the feed is unaffected"
 * promise below would be false. The carousel is therefore wrapped in its own
 * error boundary: a record that cannot be drawn costs that shelf and nothing
 * else.
 *
 * Nothing here knows which module it is showing — that lives in
 * `config/homeShelves`, which keeps the feed one component wide.
 */
export default function CuratedShelf({ shelf, state, onSource, className }) {
  const retryShelf = useHomeFeedStore((s) => s.retryShelf);
  const { items = [], status = "idle", error, reason } = state || {};
  const headingId = `home-shelf-${shelf.key}`;

  // An empty shelf is not a shelf. Hiding it is the honest empty state: there
  // is no record to show, so we show no record.
  if (status === "ready" && items.length === 0) return null;

  return (
    <section
      className={className}
      aria-labelledby={headingId}
      data-testid={`home-shelf-${shelf.key}`}
      data-shelf-status={status}
    >
      <SectionHeader
        as="h2"
        id={headingId}
        title={shelf.title}
        description={shelf.subtitle}
        to={shelf.seeAll?.to}
        linkLabel={shelf.seeAll?.label}
      />

      {status === "idle" || status === "loading" ? (
        <ShelfSkeleton label={shelf.title} className="mt-0.5 -mx-4 px-4 sm:-mx-1 sm:px-1" />
      ) : status === "error" ? (
        <ShelfEmptyState
          tone="danger"
          icon={RefreshCw}
          title={error || `${shelf.title} didn't load`}
          description={
            reason
              ? `${reason} The rest of the market below is unaffected.`
              : "The rest of the market below is unaffected."
          }
          action={
            <Button size="xs" variant="secondary" icon={RefreshCw} onClick={() => retryShelf(shelf.key)}>
              Try again
            </Button>
          }
        />
      ) : (
        // the rail bleeds to the phone's edge; the title and See all above it
        // keep the page gutter, so the cards read as content rather than a box
        // inside a box
        <ErrorBoundary
          fallback={(_error, reset) => (
            <ShelfEmptyState
              tone="danger"
              icon={RefreshCw}
              title={`${shelf.title} couldn't be drawn`}
              description="One record in this shelf failed to render. The rest of the market below is unaffected."
              action={
                <Button
                  size="xs"
                  variant="secondary"
                  icon={RefreshCw}
                  onClick={() => {
                    reset();
                    retryShelf(shelf.key);
                  }}
                >
                  Try again
                </Button>
              }
            />
          )}
        >
          {/* The rail is its own component on purpose: `items.map(renderCard)`
              written inline would build the cards during THIS render, i.e.
              before the boundary below could catch a record that throws. */}
          <ShelfRail shelf={shelf} items={items} onSource={onSource} />
        </ErrorBoundary>
      )}
    </section>
  );
}

/** One carousel of cards. Rendered INSIDE the shelf's error boundary. */
function ShelfRail({ shelf, items, onSource }) {
  return (
    <HorizontalCarousel label={shelf.title} className="-mx-4 px-4 sm:-mx-1 sm:px-1">
      {items.map((item, index) => (
        <CarouselItem key={`${shelf.key}-${item.id}`} index={index}>
          {renderCard(shelf.card, { item, onSource })}
        </CarouselItem>
      ))}
    </HorizontalCarousel>
  );
}
