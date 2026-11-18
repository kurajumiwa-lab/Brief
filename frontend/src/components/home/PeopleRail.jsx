import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Users } from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import { vendorAPI } from "@/lib/api";

/**
 * PEOPLE LIVE ON HOME.
 *
 * Discover answers "what is on offer"; this rail answers "who is around".
 * A person is a face and a name, not a merchandise card: a circular photo they
 * chose (avatar, then business logo), their trade, and the distance when the
 * network knows it. No score, no popularity rank, no colour-block placeholder.
 */
export default function PeopleRail() {
  const [people, setPeople] = useState([]);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        let { data } = await vendorAPI.discover({ limit: 12 });
        let rows = Array.isArray(data) ? data : [];
        if (!rows.length) {
          ({ data } = await vendorAPI.discover({ limit: 12, include_connected: true }));
          rows = Array.isArray(data) ? data : [];
        }
        if (live) setPeople(rows);
      } catch {
        if (live) setPeople([]);
      }
    };
    load();
    return () => { live = false; };
  }, []);

  if (!people.length) return null;

  return (
    <section aria-labelledby="home-people-heading" data-testid="home-people-rail" className="space-y-2">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h2 id="home-people-heading" className="flex items-center gap-1.5 text-title-section font-extrabold text-ink-1">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              <Users size={13} aria-hidden="true" />
            </span>
            People around you
          </h2>
          <p className="mt-0.5 text-micro text-ink-4">The faces behind the Pages — open one to see their work.</p>
        </div>
        <Link to="/network?tab=suggested" className="shrink-0 text-micro font-bold text-brand-700 hover:underline dark:text-brand-300">
          See all
        </Link>
      </div>

      <div className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {people.map((person) => {
          const handle = person.vendor_handle || person.handle;
          const name = person.business_name || person.name || (handle ? `@${handle}` : "Neighbour");
          const trade = (person.business_categories || [])[0] || person.current_role || "In the network";
          const place = person.physical_location || null;
          const distance = typeof person.distance_km === "number" ? `${person.distance_km.toFixed(1)} km` : null;
          const photo = person.avatar_url || person.logo_url || null;
          return (
            <Link
              key={person.vendor_id || handle || name}
              to={handle ? `/@${handle}` : "/network"}
              data-testid={`home-person-${handle || "person"}`}
              className="flex w-[76px] shrink-0 snap-start flex-col items-center gap-1.5 text-center"
            >
              <Avatar
                name={name}
                src={photo}
                mode="personal_photo"
                fallback="neutral"
                size="xl"
                ring
                className="transition-transform duration-2 hover:scale-[1.03]"
              />
              <span className="line-clamp-2 text-micro font-bold leading-tight text-ink-1">{name}</span>
              <span className="line-clamp-1 text-[10px] text-ink-4">{trade}</span>
              {(place || distance) && (
                <span className="line-clamp-1 text-[10px] text-ink-4">{distance || place}</span>
              )}
            </Link>
          );
        })}
        <Link
          to="/network?tab=suggested"
          className="flex w-[76px] shrink-0 snap-start flex-col items-center gap-1.5 text-center text-brand-700 dark:text-brand-300"
        >
          <span className="grid h-20 w-20 place-items-center rounded-full border border-dashed border-edge-2 bg-surface-1">
            <ArrowRight size={18} aria-hidden="true" />
          </span>
          <span className="text-micro font-bold">See all</span>
        </Link>
      </div>
    </section>
  );
}
