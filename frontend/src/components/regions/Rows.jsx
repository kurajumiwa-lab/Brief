import { Link } from "react-router-dom";
import {
  BadgeCheck, Building2, CalendarDays, ChevronRight, HeartHandshake,
  MapPin, Package, Store, UserRound, Wrench,
} from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import { RankChip } from "@/components/identity/Rank";
import { rankFor } from "@/config/identity";
import { regionFromPlace } from "@/config/regions";
import { relativeTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * ROWS, NOT CARDS.
 *
 * A region list is a list. Three people in Kisumu are three rows, not three
 * cards with a photograph, a cover, two buttons and a shelf. The compact row is
 * what lets a phone show eight real results in the space a card grid shows two,
 * and the whole redesign is partly just this decision applied consistently.
 */

export function PersonRow({ vendor }) {
  const rank = rankFor({ vendor });
  const place = vendor?.physical_location || "";
  const region = regionFromPlace(place);
  const line =
    vendor?.business_description ||
    (region ? `${region.hub} · ${region.knownFor.slice(0, 2).join(", ")}` : "In the network");

  return (
    <li>
      <Link
        to={`/p/${vendor.vendor_handle}`}
        className="group flex items-center gap-3 py-3.5 px-1 -mx-1 rounded-xl hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <Avatar
          name={vendor.business_name || vendor.vendor_handle}
          src={vendor.avatar_url || vendor.logo_url}
          size="md"
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-sm font-bold text-ink-1">{vendor.business_name}</span>
            {vendor.is_verified && (
              <BadgeCheck size={13} className="shrink-0 text-brand-600" aria-label="Verified" />
            )}
            <RankChip rank={rank} showLevel={false} className="ml-0.5" />
          </span>
          <span className="mt-0.5 line-clamp-1 block text-2xs text-ink-3">{line}</span>
          <span className="mt-0.5 flex items-center gap-1 text-micro text-ink-4">
            <MapPin size={10} aria-hidden="true" />
            {region ? `${region.hub}, ${region.name}` : place || "Region not set"}
            {vendor.movements_completed > 0 && (
              <>
                <span aria-hidden="true">·</span>
                {vendor.movements_completed} completed
              </>
            )}
          </span>
        </span>
        <ChevronRight size={15} className="shrink-0 text-ink-4 group-hover:text-ink-1" aria-hidden="true" />
      </Link>
    </li>
  );
}

const KIND = {
  available: { label: "Offer", icon: Package, tone: "text-brand-700 bg-brand-50 dark:bg-brand-500/15 dark:text-brand-300" },
  wanted: { label: "Need", icon: Wrench, tone: "text-accent-700 bg-accent-50 dark:bg-accent-500/15 dark:text-accent-300" },
  scheduled: { label: "Scheduled", icon: CalendarDays, tone: "text-orchid-700 bg-orchid-50 dark:bg-orchid-500/15 dark:text-orchid-300" },
  event: { label: "Event", icon: CalendarDays, tone: "text-accent-700 bg-accent-50 dark:bg-accent-500/15 dark:text-accent-300" },
  opportunity: { label: "Opportunity", icon: HeartHandshake, tone: "text-ink-2 bg-surface-2" },
  listing: { label: "Goods", icon: Package, tone: "text-blue-700 bg-blue-50 dark:bg-blue-500/15 dark:text-blue-300" },
  service: { label: "Service", icon: Wrench, tone: "text-orchid-700 bg-orchid-50 dark:bg-orchid-500/15 dark:text-orchid-300" },
  rental: { label: "Rental", icon: Store, tone: "text-orchid-700 bg-orchid-50 dark:bg-orchid-500/15 dark:text-orchid-300" },
  person: { label: "Person", icon: UserRound, tone: "text-ink-2 bg-surface-2" },
  community: { label: "Community", icon: Building2, tone: "text-brand-700 bg-brand-50 dark:bg-brand-500/15 dark:text-brand-300" },
  post: { label: "Post", icon: Store, tone: "text-ink-2 bg-surface-2" },
};

export function ItemRow({ item, showKind = true }) {
  const meta = KIND[item.kind] || KIND.post;
  const Icon = meta.icon;
  const price = item.price_kes ?? item.price;
  const body = (
    <>
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", meta.tone)}>
        <Icon size={16} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          {showKind && (
            <span className="text-micro font-bold uppercase tracking-[0.08em] text-ink-4">{meta.label}</span>
          )}
          {price ? (
            <span className="ml-auto shrink-0 text-2xs font-bold tabular-nums text-ink-2">
              KSh {Number(price).toLocaleString()}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-sm font-semibold leading-snug text-ink-1">
          {item.title}
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-micro text-ink-4">
          <MapPin size={10} aria-hidden="true" />
          {item.location || item.area_name || "Region not set"}
          {item.created_at && (
            <>
              <span aria-hidden="true">·</span>
              {relativeTime(item.created_at)}
            </>
          )}
        </span>
      </span>
      <ChevronRight size={15} className="shrink-0 text-ink-4 group-hover:text-ink-1" aria-hidden="true" />
    </>
  );

  if (!item.to) {
    return <li className="flex items-start gap-3 py-3.5">{body}</li>;
  }
  return (
    <li>
      <Link
        to={item.to}
        className="group flex items-start gap-3 py-3.5 px-1 -mx-1 rounded-xl hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {body}
      </Link>
    </li>
  );
}

/** The one-line "nothing here yet" used by every region tab. */
export function RegionEmpty({ region, action }) {
  return (
    <div className="rounded-2xl border border-dashed border-edge-2 bg-surface-0 px-4 py-8 text-center">
      <p className="text-sm font-semibold text-ink-1">Nothing published in {region?.hub || "this region"} yet</p>
      <p className="mx-auto mt-1 max-w-sm text-2xs leading-relaxed text-ink-3">
        A region starts with one honest page. If you work here, publish what you
        do and the next person has something to find.
      </p>
      {action}
    </div>
  );
}
