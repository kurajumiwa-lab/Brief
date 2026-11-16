import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, MapPin, Plus, ShieldCheck } from "lucide-react";
import Button from "@/components/ui/Button";
import { PersonRow, RegionEmpty } from "@/components/regions/Rows";
import RegionsGrid from "@/components/regions/RegionsGrid";
import { countryName } from "@/config/regions";
import { cn } from "@/lib/utils";

const TABS = [
  { value: "people", label: "People" },
  { value: "offers", label: "Offers" },
  { value: "needs", label: "Needs" },
];

const OFFER_KINDS = ["available", "listing", "service", "rental"];
const NEED_KINDS = ["wanted", "opportunity", "scheduled", "event"];

/**
 * ONE REGION, THREE QUESTIONS.
 *
 * Who works here, what is available here, and what is being asked for here.
 * Those were three screens (Local network, Mall/Browse, Market locks) and are
 * now three tabs on the same page, because they are the same question asked
 * with a different verb and the place never changes between them.
 */
export default function RegionView({
  region,
  tab = "people",
  onTab,
  people = [],
  items = [],
  loading = false,
}) {
  const shownItems =
    tab === "needs"
      ? items.filter((item) => NEED_KINDS.includes(item.kind))
      : items.filter((item) => OFFER_KINDS.includes(item.kind));

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Link
        to="/regions"
        className="inline-flex items-center gap-1.5 text-2xs font-bold text-ink-3 hover:text-ink-1"
      >
        <ArrowLeft size={13} aria-hidden="true" />
        All regions
      </Link>

      <header className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-micro font-bold text-ink-3">
            <MapPin size={11} aria-hidden="true" />
            {countryName(region.country)}
          </span>
          <span className="text-micro text-ink-4">Hub: {region.hub}</span>
        </div>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-ink-1 sm:text-3xl">{region.name}</h1>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-ink-3">{region.summary}</p>
        <p className="mt-1.5 text-2xs text-ink-4">{region.note}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {region.knownFor.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-edge-1 bg-surface-1 px-2.5 py-1 text-micro font-semibold text-ink-2"
            >
              {tag}
            </span>
          ))}
        </div>
      </header>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button as={Link} to={`/create?place=${encodeURIComponent(region.hub)}`} size="sm" icon={Plus}>
          Publish in {region.hub}
        </Button>
        <Button as={Link} to="/regions" size="sm" variant="secondary" iconRight={ArrowRight}>
          Another region
        </Button>
      </div>

      <div className="mt-6 flex gap-1 border-b border-edge-1" role="tablist" aria-label={`${region.name} content`}>
        {TABS.map((item) => {
          const active = tab === item.value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTab?.(item.value)}
              className={cn(
                "-mb-px border-b-2 px-3.5 py-2.5 text-xs font-bold transition-colors",
                active
                  ? "border-brand-700 text-ink-1"
                  : "border-transparent text-ink-4 hover:text-ink-2",
              )}
            >
              {item.label}
              {item.value === "people" && people.length > 0 && (
                <span className="ml-1.5 text-micro font-semibold tabular-nums text-ink-4">{people.length}</span>
              )}
              {item.value !== "people" && shownItems.length > 0 && tab === item.value && (
                <span className="ml-1.5 text-micro font-semibold tabular-nums text-ink-4">{shownItems.length}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-1" role="tabpanel">
        {loading ? (
          <div className="space-y-3 py-4" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-10 w-10 animate-pulse rounded-xl bg-surface-2" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-1/3 animate-pulse rounded bg-surface-2" />
                  <div className="h-2.5 w-2/3 animate-pulse rounded bg-surface-2" />
                </div>
              </div>
            ))}
          </div>
        ) : tab === "people" ? (
          people.length > 0 ? (
            <ul className="divide-y divide-edge-1">
              {people.map((vendor) => (
                <PersonRow key={vendor.id} vendor={vendor} />
              ))}
            </ul>
          ) : (
            <RegionEmpty
              region={region}
              action={
                <Button as={Link} to="/you/page" size="sm" variant="secondary" className="mt-4">
                  Publish your page
                </Button>
              }
            />
          )
        ) : shownItems.length > 0 ? (
          <RegionsGrid items={shownItems} className="mt-3" />
        ) : (
          <RegionEmpty
            region={region}
            action={
              <Button as={Link} to={`/create?place=${encodeURIComponent(region.hub)}`} size="sm" variant="secondary" className="mt-4">
                Publish something
              </Button>
            }
          />
        )}
      </div>

      <aside className="mt-7 flex items-start gap-2.5 rounded-2xl border border-edge-1 bg-surface-1 px-4 py-3">
        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-brand-600" aria-hidden="true" />
        <p className="text-2xs leading-relaxed text-ink-3">
          People are shown because their page is placed in this region. A page
          with a confirmed institution or licence carries that badge; one without
          it is still shown, and says so.
        </p>
      </aside>
    </div>
  );
}
