import { Link } from "react-router-dom";
import { MapPin, Package, Truck, Wrench, CalendarDays, ChevronRight } from "lucide-react";
import Media from "@/components/ui/Media";
import { photoUrl } from "@/lib/photos";

/**
 * THE DISCOVERY BAND — the brief's steps 2, 3 and 5.
 *
 * The Home screen used to open on "who am I": a greeting, a rank chip and an
 * identity strip. That answers a returning business's question and answers
 * nothing for a person who came to see what is for sale. A marketplace opens
 * on *where you are* and *what is here*, then shows you your own books.
 *
 * Four category doors, each with the brief's own colour, so Goods, Services,
 * Rentals and Events are told apart at a glance rather than by reading the
 * word. The colours come from --cat-* tokens; this file names no hex.
 */

const CATEGORIES = [
  { to: "/discover?kind=listing", label: "Goods", hint: "Produce, stock, wares", Icon: Package, tone: "goods", subject: "commerce-goods" },
  { to: "/discover?kind=service", label: "Services", hint: "Fundis and trades", Icon: Truck, tone: "services", subject: "work-technician" },
  { to: "/discover?kind=rental", label: "Rentals", hint: "Tools, rooms, vans", Icon: Wrench, tone: "rentals", subject: "rental-tools" },
  { to: "/discover?kind=event", label: "Events", hint: "Rounds and meetups", Icon: CalendarDays, tone: "events", subject: "culture-conference" },
];

const TONE = {
  goods: "bg-cat-goods-soft text-cat-goods-text",
  services: "bg-cat-services-soft text-cat-services-text",
  rentals: "bg-cat-rentals-soft text-cat-rentals-text",
  events: "bg-cat-events-soft text-cat-events-text",
};

export default function DiscoveryBand({ place }) {
  return (
    <section aria-labelledby="discovery-heading" className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="discovery-heading" className="text-section font-extrabold tracking-tight text-ink-1">
          What is near you
        </h2>
        <Link
          to="/discover"
          className="inline-flex items-center gap-0.5 text-xs font-bold text-brand-600 hover:text-brand-700 dark:text-brand-300"
        >
          Browse all
          <ChevronRight size={13} aria-hidden="true" />
        </Link>
      </div>

      {/* Where the person is. Hidden when the region is unknown rather than
          claiming a town they have not set. */}
      {place && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-3">
          <MapPin size={13} className="shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
          {place}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {CATEGORIES.map(({ to, label, hint, Icon, tone, subject }) => (
          <Link
            key={label}
            to={to}
            className="group overflow-hidden rounded-2xl border border-edge-1 bg-surface-1 transition-colors hover:border-edge-2"
          >
            {/* A real photograph of the category, so the door looks like the
                thing behind it. Purely decorative: the label below carries the
                meaning, and the tile still works with no image at all. */}
            <div className="relative aspect-[16/10] overflow-hidden bg-surface-3">
              <Media
                src={photoUrl(subject)}
                alt=""
                className="h-full w-full object-cover transition-transform duration-3 group-hover:scale-[1.04]"
                fallback={<span className={`block h-full w-full ${TONE[tone]}`} aria-hidden="true" />}
              />
              <span className={`absolute left-2 top-2 grid h-8 w-8 place-items-center rounded-lg bg-surface-1/95 shadow-sm ${TONE[tone]}`}>
                <Icon size={15} aria-hidden="true" />
              </span>
            </div>
            <div className="p-2.5">
              <span className="block text-sm font-bold text-ink-1">{label}</span>
              <span className="block text-2xs leading-snug text-ink-4">{hint}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
