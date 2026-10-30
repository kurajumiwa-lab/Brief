import { Link } from "react-router-dom";
import {
  Boxes,
  CalendarDays,
  ClipboardList,
  Megaphone,
  MapPin,
  Store,
  Truck,
  Users,
  Wrench,
} from "lucide-react";
import { SHELVES } from "@/config/homeShelves";
import { cn } from "@/lib/utils";

/**
 * THE SHELF TILES — the reference designs' category row, over real shelves.
 *
 * Both references open their content with a strip of square icon tiles: a
 * picture of the aisles, not a description of them. Brief already declares nine
 * shelves in `config/homeShelves.js`, and each one already carries the
 * destination it belongs to (`seeAll.to`) — so this row is a *view* of that
 * config, never a second list to keep in sync.
 *
 * A tile is a door: it goes where "See all" on the shelf goes. Nothing is
 * counted here and nothing is previewed, because a tile that says "12 items"
 * and then opens an empty screen is exactly the kind of promise this codebase
 * keeps refusing to make.
 */

const ICONS = {
  stock: Boxes,
  services: Truck,
  people: Users,
  equipment: Wrench,
  opportunities: ClipboardList,
  events: CalendarDays,
  community: Store,
  markets: MapPin,
  notices: Megaphone,
};

/** Short labels: the shelf titles are sentences ("Fresh on the network"), and a
 *  tile needs a noun. */
const SHORT = {
  stock: "Stock",
  services: "Services",
  people: "People",
  equipment: "Equipment",
  opportunities: "Requests",
  events: "Events",
  community: "Groups",
  markets: "Markets",
  notices: "Notices",
};

export default function ShelfTiles({ className = "" }) {
  return (
    <nav aria-label="The shelves" data-testid="home-shelf-tiles" className={className}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-bold tracking-tight text-ink-1">Browse the shelves</h2>
        <Link
          to="/browse"
          className="text-micro font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
        >
          View all
        </Link>
      </div>

      <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 no-scrollbar sm:grid sm:grid-cols-9 sm:gap-1.5 sm:overflow-visible">
        {SHELVES.map((shelf) => {
          const Icon = ICONS[shelf.key] || Boxes;
          return (
            <li key={shelf.key} className="shrink-0 sm:min-w-0">
              <Link
                to={shelf.seeAll.to}
                className={cn(
                  "flex w-[4.5rem] flex-col items-center gap-1 rounded-xl border border-edge-1 bg-surface-1 px-1 py-2",
                  "text-center transition-colors hover:border-brand-400/60 hover:bg-brand-500/5",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60",
                  "sm:w-full"
                )}
              >
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500/10 text-brand-700 dark:text-brand-300">
                  <Icon size={15} aria-hidden="true" />
                </span>
                <span className="w-full truncate text-micro font-semibold leading-tight text-ink-2">
                  {SHORT[shelf.key] || shelf.key}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
