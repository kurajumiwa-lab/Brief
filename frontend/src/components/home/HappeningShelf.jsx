import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight, Bike, CalendarDays, GraduationCap, ShoppingBasket, Users, Wrench,
} from "lucide-react";
import { format, isToday, isTomorrow } from "date-fns";
import { formatKes } from "@/lib/receipts";
import { parseApiDate } from "@/lib/formatters";
import { regionPath } from "@/config/regions";

/**
 * HAPPENING SOON — the one place Home shows discovery.
 *
 * A compact horizontal shelf, not a second copy of the region feed. It holds
 * only dated rounds and events, because a returning person's question is
 * "what can I join near me this week?", not "what is listed?".
 *
 * The visual header is generated when the creator uploaded no photograph. A
 * category is a design decision, not an empty grey rectangle.
 */

const PALETTES = [
  { from: "#0F3D2E", to: "#2B7A5A", ink: "#D7F1E2", Icon: ShoppingBasket },
  { from: "#6B3F12", to: "#B8792B", ink: "#FBEBD5", Icon: CalendarDays },
  { from: "#1E3A5F", to: "#3E6E9E", ink: "#DBEBFA", Icon: Bike },
  { from: "#4A2C5A", to: "#7E5497", ink: "#F0E5F7", Icon: Users },
  { from: "#4C2A1E", to: "#9A5A3A", ink: "#F8E6DC", Icon: Wrench },
  { from: "#23423A", to: "#4F7F5C", ink: "#E1F3E4", Icon: GraduationCap },
];

const KEYWORDS = [
  { match: ["grocery", "groceries", "bulk", "food", "market", "produce"], palette: 0 },
  { match: ["brunch", "party", "wedding", "celebration", "music", "social"], palette: 1 },
  { match: ["bike", "ride", "trip", "travel", "tour", "hike"], palette: 2 },
  { match: ["community", "chama", "group", "meet", "neighbour", "neighbor"], palette: 3 },
  { match: ["repair", "fundi", "service", "fix", "maintenance"], palette: 4 },
  { match: ["learn", "class", "training", "session", "workshop", "school"], palette: 5 },
];

function paletteFor(item) {
  const text = `${item.category || ""} ${item.title || ""}`.toLowerCase();
  for (const entry of KEYWORDS) {
    if (entry.match.some((word) => text.includes(word))) return PALETTES[entry.palette];
  }
  return item.kind === "event" ? PALETTES[1] : PALETTES[0];
}

function dateLabel(value) {
  const date = parseApiDate(value);
  if (!date) return "Open round";
  const day = isToday(date) ? "TODAY" : isTomorrow(date) ? "TOMORROW" : format(date, "EEE").toUpperCase();
  return `${day} • ${format(date, "h a")}`;
}

function joinedLabel(item) {
  const joined = Number(
    item.counts?.attending ?? item.counts?.booked ?? item.counts?.responses ?? 0,
  );
  const capacity = Number(item.meta?.capacity || 0);
  if (capacity > 0) {
    return { text: `${Math.min(joined, capacity)}/${capacity} joined`, joined, capacity };
  }
  if (joined > 0) return { text: `${joined} joined`, joined, capacity: 0 };
  return { text: item.kind === "event" ? "Open event" : "Open to join", joined: 0, capacity: 0 };
}

function ShelfCard({ item }) {
  const [imageFailed, setImageFailed] = useState(false);
  const palette = paletteFor(item);
  const Icon = palette.Icon;
  const place = String(item.location || item.area_name || "").split(",")[0];
  const price = item.price_kes;
  const group = joinedLabel(item);
  const pct = group.capacity ? Math.min(100, Math.round((group.joined / group.capacity) * 100)) : 0;

  return (
    <li className="w-[220px] shrink-0 snap-start">
      <Link
        to={item.to}
        className="group block overflow-hidden rounded-2xl border border-edge-1 bg-surface-1 shadow-xs transition-[border-color,transform] duration-2 hover:-translate-y-0.5 hover:border-edge-3 focus-visible:ring-2 focus-visible:ring-brand-500"
        data-testid="happening-card"
      >
        <div
          className="relative h-[132px] overflow-hidden"
          data-testid="happening-art"
          data-fallback={!item.image || imageFailed ? "true" : "false"}
        >
          {item.image && !imageFailed ? (
            <img
              src={item.image}
              alt=""
              loading="lazy"
              onError={() => setImageFailed(true)}
              className="h-full w-full object-cover transition-transform duration-3 group-hover:scale-[1.03]"
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center"
              style={{ backgroundImage: `linear-gradient(135deg, ${palette.from}, ${palette.to})` }}
              aria-hidden="true"
            >
              <Icon size={42} strokeWidth={1.4} style={{ color: palette.ink }} />
            </div>
          )}
          <span className="absolute left-2.5 top-2.5 rounded-full bg-white/95 px-2 py-1 text-[10px] font-extrabold tracking-[0.06em] text-ink-1 shadow-sm backdrop-blur">
            {dateLabel(item.starts_at)}
          </span>
          <span className="absolute right-2.5 top-2.5 rounded-full bg-black/45 px-2 py-1 text-[10px] font-bold text-white backdrop-blur">
            {item.kind === "event" ? "Event" : "Round"}
          </span>
        </div>

        <div className="flex min-h-[142px] flex-col p-3">
          <p className="line-clamp-2 text-sm font-extrabold leading-snug text-ink-1">{item.title}</p>
          <p className="mt-1 line-clamp-1 text-micro text-ink-4">
            {place || "Near you"}
            {price ? ` • ${formatKes(price)}` : ""}
          </p>

          <div className="mt-auto pt-3">
            <div className="flex items-center justify-between gap-2 text-[10px] font-bold text-ink-3">
              <span data-testid="happening-joined">{group.text}</span>
              {group.capacity > 0 && <span className="text-ink-4">{Math.max(group.capacity - group.joined, 0)} left</span>}
            </div>
            {group.capacity > 0 && (
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full bg-brand-600"
                  style={{ width: `${Math.min(Math.max(pct, 4), 100)}%` }}
                  aria-hidden="true"
                />
              </div>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

export default function HappeningShelf({ items = [], region = null }) {
  return (
    <section aria-labelledby="happening-heading" data-testid="happening-shelf">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">This week</p>
          <h2 id="happening-heading" className="mt-1 text-base font-extrabold tracking-tight text-ink-1">
            Happening soon
          </h2>
        </div>
        <Link
          to={region ? regionPath(region) : "/regions"}
          className="inline-flex shrink-0 items-center gap-1 text-micro font-bold text-brand-700 hover:underline dark:text-brand-400"
        >
          {region ? region.name : "Regions"}
          <ArrowUpRight size={12} aria-hidden="true" />
        </Link>
      </div>

      {items.length > 0 ? (
        <ul className="-mx-4 mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 no-scrollbar sm:-mx-1 sm:px-1">
          {items.slice(0, 8).map((item) => (
            <ShelfCard key={`${item.kind}:${item.id}`} item={item} />
          ))}
        </ul>
      ) : (
        <div className="mt-3 rounded-2xl border border-dashed border-edge-2 bg-surface-0 px-4 py-4">
          <p className="text-xs font-semibold text-ink-1">
            Nothing scheduled{region ? ` in ${region.hub}` : " near you"} yet
          </p>
          <p className="mt-1 max-w-md text-2xs leading-relaxed text-ink-3">
            A round starts with one person setting a time and a meeting place. It
            appears here for everyone nearby, with its real join count.
          </p>
          <Link
            to="/create"
            className="mt-2 inline-flex items-center gap-1 text-micro font-bold text-brand-700 hover:underline dark:text-brand-400"
          >
            Publish a round or event
            <ArrowUpRight size={12} aria-hidden="true" />
          </Link>
        </div>
      )}
    </section>
  );
}
