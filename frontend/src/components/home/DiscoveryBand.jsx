import { Link } from "react-router-dom";
import { Package, Truck, Wrench, CalendarDays, ChevronRight } from "lucide-react";
import Media from "@/components/ui/Media";
import { photoUrl } from "@/lib/photos";

/**
 * THE DISCOVERY BAND — four ways in.
 *
 * The Home screen used to open on "who am I": a greeting, a rank chip and an
 * identity strip. That answers a returning business's question and answers
 * nothing for a person who came to see what is for sale. A marketplace opens
 * on *what are you after*, and the hero above already said where they are.
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

export default function DiscoveryBand() {
  return (
    <section aria-labelledby="discovery-heading" data-testid="discovery-band" className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="discovery-heading" className="ds-title">
          What are you after?
        </h2>
        <Link to="/discover" className="ds-action">
          Browse all
          <ChevronRight size={13} aria-hidden="true" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {CATEGORIES.map(({ to, label, hint, Icon, tone, subject }) => (
          <Link
            key={label}
            to={to}
            className="ds-focus group overflow-hidden rounded-2xl border border-edge-1 bg-surface-1 transition-colors hover:border-edge-2"
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
