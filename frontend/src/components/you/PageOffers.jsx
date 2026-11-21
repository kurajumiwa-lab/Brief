import { useMemo, useState } from "react";
import { ArrowRight, Clock, Package } from "lucide-react";
import Media from "@/components/ui/Media";
import { OFFER_KINDS, offerKind, priceLine } from "@/config/showcase";
import { cn } from "@/lib/utils";

/**
 * WHAT THIS PAGE OFFERS — the real rows, on the page that sells them.
 *
 * The offers around the page used to be one sentence and two buttons pointing
 * at a region feed: a stranger who came to hire a cleaner was asked to go
 * somewhere else to find out whether the cleaner had a price. This shows the
 * listings themselves — a service with its price and where it happens, goods
 * with their unit, a tool with its day rate — because that is what the visitor
 * came for and it is already stored.
 *
 * Rules:
 *   · Only public rows. The server decides what is visible; this never
 *     re-derives it, and a paused or archived listing simply is not in the list.
 *   · One tap narrows by kind, and a kind with nothing under it is not shown.
 *   · No prices are invented. `ask_me` says "Ask", a missing price says so.
 */
export default function PageOffers({ items = [], own = false, createHref = "/you/page" }) {
  const offers = useMemo(() => (Array.isArray(items) ? items.filter((item) => item?.title) : []), [items]);
  const [kind, setKind] = useState("all");

  const counts = OFFER_KINDS.reduce((acc, entry) => {
    acc[entry.value] = offers.filter((item) => item.kind === entry.value).length;
    return acc;
  }, {});
  const visible = kind === "all" ? offers : offers.filter((item) => item.kind === kind);

  if (!offers.length) {
    if (!own) return null;
    return (
      <section id="offers" data-testid="page-offers-empty" className="rounded-3xl border border-dashed border-edge-2 bg-surface-0 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-extrabold text-ink-1">What you offer</h2>
            <p className="mt-0.5 text-2xs leading-relaxed text-ink-3">
              Nothing published yet. A page with a price and a photo is the one people send to their friends.
            </p>
          </div>
          <a
            href={createHref}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-bold text-white hover:bg-brand-700"
          >
            Add an offer
            <ArrowRight size={14} aria-hidden="true" />
          </a>
        </div>
      </section>
    );
  }

  return (
    <section id="offers" data-testid="page-offers" aria-labelledby="offers-heading" className="rounded-3xl border border-edge-1 bg-surface-1 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="offers-heading" className="text-base font-extrabold tracking-tight text-ink-1">
            What {own ? "you" : "they"} offer
          </h2>
          <p className="mt-0.5 text-2xs leading-relaxed text-ink-3">
            {offers.length} {offers.length === 1 ? "listing" : "listings"} published on this page.
          </p>
        </div>
        {own && (
          <a href={createHref} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-edge-1 bg-surface-0 px-2.5 text-micro font-bold text-ink-3 hover:border-edge-2 hover:text-ink-1">
            Add or edit
            <ArrowRight size={12} aria-hidden="true" />
          </a>
        )}
      </div>

      {new Set(offers.map((item) => item.kind)).size > 1 && (
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 no-scrollbar" role="group" aria-label="Filter offers by kind">
          <Chip active={kind === "all"} onClick={() => setKind("all")} count={offers.length}>All</Chip>
          {OFFER_KINDS.filter((entry) => counts[entry.value] > 0).map((entry) => (
            <Chip key={entry.value} active={kind === entry.value} onClick={() => setKind(entry.value)} count={counts[entry.value]}>
              {entry.label}
            </Chip>
          ))}
        </div>
      )}

      <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
        {visible.map((item) => (
          <OfferCard key={`${item.kind}-${item.id}`} item={item} />
        ))}
      </ul>
    </section>
  );
}

function Chip({ active, onClick, count, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-2xs font-bold",
        active ? "border-ink-1 bg-ink-1 text-surface-0" : "border-edge-1 bg-surface-0 text-ink-3 hover:border-edge-2 hover:text-ink-1",
      )}
    >
      {children}
      <span className={cn("tabular-nums", active ? "text-surface-0/70" : "text-ink-4")}>{count}</span>
    </button>
  );
}

function OfferCard({ item }) {
  const kind = offerKind(item.kind);
  const photo = Array.isArray(item.photos) ? item.photos[0] : null;
  const unavailable = item.available === false;
  return (
    <li className="flex gap-3 rounded-2xl border border-edge-1 bg-surface-0 p-3">
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-surface-2">
        <Media
          src={photo}
          alt=""
          className="h-full w-full object-cover"
          fallback={
            <span className="grid h-full w-full place-items-center text-ink-4">
              <Package size={18} aria-hidden="true" />
            </span>
          }
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 text-xs font-bold leading-snug text-ink-1 line-clamp-2">{item.title}</p>
          {kind && <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-ink-3">{kind.label}</span>}
        </div>
        <p className="mt-0.5 text-2xs font-bold text-ink-2">{priceLine(item)}</p>
        {/* 0082: a partner offer states what the buyer keeps, in the same line
            as the price. It is never a reason the card is where it is — a
            cheaper offer always sits above it. */}
        {item.cutback_kes > 0 && (
          <p
            data-testid="offer-cutback"
            className="mt-1 inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-micro font-bold text-brand-800 dark:bg-brand-500/10 dark:text-brand-200"
          >
            KSh {Number(item.cutback_kes).toLocaleString("en-KE")} back for you
            {item.buyer_price != null && (
              <span className="font-semibold text-brand-700 dark:text-brand-300">
                · pay KSh {Number(item.buyer_price).toLocaleString("en-KE")}
              </span>
            )}
          </p>
        )}
        {item.description && <p className="mt-0.5 line-clamp-2 text-micro leading-relaxed text-ink-3">{item.description}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-micro text-ink-4">
          {item.kind === "goods" && item.quantity > 0 && <span>{item.quantity} available</span>}
          {item.kind === "service" && item.duration_minutes > 0 && (
            <span className="inline-flex items-center gap-1"><Clock size={11} aria-hidden="true" />{item.duration_minutes} min</span>
          )}
          {item.service_radius_km > 0 && <span>Up to {item.service_radius_km} km</span>}
          {unavailable && <span className="font-bold text-warn">Unavailable right now</span>}
        </div>
      </div>
    </li>
  );
}

/** A short, honest line for the page hero: what this page has on it. */
export function offersSummary(items = [], gallery = []) {
  const offers = Array.isArray(items) ? items.length : 0;
  const photos = Array.isArray(gallery) ? gallery.length : 0;
  const parts = [];
  if (offers) parts.push(`${offers} listing${offers === 1 ? "" : "s"}`);
  if (photos) parts.push(`${photos} photo${photos === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
