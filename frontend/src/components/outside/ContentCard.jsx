import { Link } from "react-router-dom";
import {
  Bookmark, CalendarDays, Heart, HeartHandshake, MapPin, MessageSquare, Sparkles,
  Store, Ticket, Users,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { relativeTime, shortDateTime } from "@/lib/formatters";

/**
 * ONE CARD, CONTROLLED VARIATIONS.
 *
 * Every content type in Outside renders through this. The frame — radius,
 * padding, image ratio, metadata placement, interaction states — is identical
 * everywhere; what varies is a small, declared set of things:
 *
 *   the kind chip and its colour   what this is, in one word
 *   the meta line                  where · when · who, in that order
 *   the primary affordance         the ONE response this kind invites
 *   the counter row                what other people have already done
 *
 * Attending an event is not saving a post, and contacting a provider is not
 * joining a community — so each kind names its own primary action instead of
 * every card showing every button.
 *
 * Price appears only when the record has one. An unpriced card does not show
 * "Free" or "N/A"; it shows nothing, because the absence of a price is not a
 * claim about the content.
 */

const KIND_META = {
  post: { label: "Post", variant: "brand" },
  event: { label: "Event", variant: "amber" },
  listing: { label: "Listing", variant: "blue" },
  service: { label: "Service", variant: "purple" },
  rental: { label: "Rental", variant: "purple" },
  opportunity: { label: "Opportunity", variant: "red" },
  community: { label: "Community", variant: "brand" },
  collection: { label: "Collection", variant: "gray" },
  person: { label: "Person", variant: "gray" },
  place: { label: "Place", variant: "gray" },
  market: { label: "Market", variant: "amber" },
};

/** The one response each kind invites. Deliberately not a full action bar. */
const RESPONSES = {
  post: { reaction: "save", icon: Bookmark, label: "Save" },
  event: { reaction: "attending", icon: CalendarDays, label: "I'm going" },
  listing: { reaction: "interest", icon: HeartHandshake, label: "I'm interested" },
  service: { reaction: "interest", icon: HeartHandshake, label: "Enquire" },
  rental: { reaction: "interest", icon: HeartHandshake, label: "Enquire" },
  opportunity: { reaction: "interest", icon: HeartHandshake, label: "I can help" },
  community: { reaction: "interest", icon: Users, label: "Join" },
  collection: { reaction: "save", icon: Bookmark, label: "Save" },
  person: { reaction: "save", icon: Bookmark, label: "Follow" },
  place: { reaction: "save", icon: Bookmark, label: "Save" },
  market: { reaction: "save", icon: Bookmark, label: "Save" },
};

export default function ContentCard({ item, onReact, compact = false, className }) {
  const kind = KIND_META[item.kind] || KIND_META.post;
  const response = RESPONSES[item.kind] || RESPONSES.post;
  const active = Boolean(item.reactions?.[response.reaction]);
  const meta = KIND_META[item.kind];

  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-card border border-edge-1 bg-surface-1 shadow-xs",
        "transition-[border-color,box-shadow] duration-1 ease-out hover:border-edge-2 hover:shadow-sm",
        "focus-within:border-brand-500/60",
        className,
      )}
      data-testid={`content-card-${item.kind}`}
      data-kind={item.kind}
    >
      {item.image ? (
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-surface-2">
          <img
            src={item.image}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-3 group-hover:scale-[1.02]"
          />
          <span className="absolute left-2 top-2">
            <Badge variant={meta?.variant || "gray"} size="sm">{kind.label}</Badge>
          </span>
        </div>
      ) : (
        // A graceful fallback, not a broken image: the kind badge still says
        // what this is, and the card keeps the same height as its neighbours.
        <div className="flex aspect-[4/3] w-full items-center justify-center bg-surface-2 text-ink-4">
          <KindGlyph kind={item.kind} />
        </div>
      )}

      <div className="flex flex-1 flex-col gap-2 p-4">
        {!item.image && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={meta?.variant || "gray"} size="sm">{kind.label}</Badge>
            {item.status === "cancelled" && <Badge variant="red" size="sm">Cancelled</Badge>}
            {item.meta?.full && <Badge variant="red" size="sm">Full</Badge>}
          </div>
        )}

        <Link
          to={item.to || "#"}
          className="text-title-card font-semibold leading-snug text-ink-1 hover:text-brand-700 dark:hover:text-brand-300"
        >
          {item.title || truncate(item.summary, 60) || kind.label}
        </Link>

        {item.summary && item.title && !compact && (
          <p className="line-clamp-2 text-xs leading-relaxed text-ink-3">{item.summary}</p>
        )}

        {/* where · when · who — the three things a local card must answer */}
        <dl className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-4">
          {item.location && (
            <div className="flex items-center gap-1">
              <MapPin size={11} aria-hidden="true" />
              <dt className="sr-only">Where</dt>
              <dd>{truncate(item.location, 28)}</dd>
            </div>
          )}
          {item.distance_km != null && (
            <div className="flex items-center gap-1">
              <dt className="sr-only">Distance</dt>
              <dd className="tabular-nums">{formatDistance(item.distance_km)}</dd>
            </div>
          )}
          {item.starts_at && (
            <div className="flex items-center gap-1">
              <CalendarDays size={11} aria-hidden="true" />
              <dt className="sr-only">When</dt>
              <dd>{shortDateTime(item.starts_at)}</dd>
            </div>
          )}
          {!item.starts_at && item.created_at && (
            <div className="flex items-center gap-1">
              <dt className="sr-only">Posted</dt>
              <dd>{relativeTime(item.created_at)}</dd>
            </div>
          )}
        </dl>

        {/* Price only when there is one. Never "Free", never "N/A". */}
        {item.price_kes != null && (
          <p className="text-sm font-bold tabular-nums text-ink-1">
            KSh {new Intl.NumberFormat("en-KE").format(item.price_kes)}
            {item.meta?.price_unit && (
              <span className="ml-1 text-2xs font-medium text-ink-4">{item.meta.price_unit.replace("per_", "/ ")}</span>
            )}
          </p>
        )}

        {/* Attribution — content identity, so a recommendation shows its source
            and never implies a provider is verified when they are not. */}
        {item.owner?.name && (
          <p className="text-2xs text-ink-4">
            {item.owner.handle ? `@${item.owner.handle}` : item.owner.name}
          </p>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-edge-1 pt-2.5">
          <div className="flex items-center gap-2.5 text-2xs text-ink-4">
            <Count icon={Heart} value={item.counts?.like} />
            <Count icon={MessageSquare} value={item.counts?.reply} />
            <Count icon={Users} value={item.counts?.members ?? item.counts?.attending} />
            {item.reasons?.length > 0 && (
              <span className="inline-flex items-center gap-1 text-brand-700 dark:text-brand-300">
                <Sparkles size={11} aria-hidden="true" />
                {item.reasons[0]}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => onReact?.(item, response.reaction)}
            disabled={!onReact}
            aria-pressed={active}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-2xs font-semibold transition-colors",
              "disabled:cursor-default disabled:opacity-60",
              active
                ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                : "border-edge-2 text-ink-3 hover:border-brand-500/60 hover:text-brand-700 dark:hover:text-brand-300",
            )}
          >
            <response.icon size={13} aria-hidden="true" />
            {active ? doneLabel(item.kind) : response.label}
          </button>
        </div>
      </div>
    </article>
  );
}

/** The word a card shows once you have acted on it. */
function doneLabel(kind) {
  return { event: "Going", community: "Interested", listing: "Interested",
    opportunity: "Offered", service: "Enquired", rental: "Enquired" }[kind] || "Saved";
}

function KindGlyph({ kind }) {
  const map = {
    event: CalendarDays, community: Users, collection: Store,
    listing: Store, service: Ticket, rental: Store, opportunity: HeartHandshake,
    person: Users, place: MapPin, market: MapPin,
  };
  const Icon = map[kind] || MessageSquare;
  return <Icon size={26} strokeWidth={1.4} aria-hidden="true" />;
}

function Count({ icon: Icon, value }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <Icon size={11} aria-hidden="true" />
      {value > 999 ? `${(value / 1000).toFixed(1)}k` : value}
    </span>
  );
}

export function formatDistance(km) {
  if (km == null) return "";
  if (km < 1) return `${Math.round(km * 1000)} m away`;
  if (km < 10) return `${km.toFixed(1)} km away`;
  return `${Math.round(km)} km away`;
}

function truncate(value, max) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
