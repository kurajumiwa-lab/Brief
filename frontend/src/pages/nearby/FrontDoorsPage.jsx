import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { PageSpinner } from "@/components/ui/Spinner";
import EmptyState from "@/components/ui/EmptyState";
import { nearbyAPI, apiError } from "@/lib/api";

const FILTERS = [
  { key: "", label: "All" },
  { key: "goods", label: "Goods" },
  { key: "service", label: "Services" },
  { key: "tool", label: "Tools" },
];
const OFFER_LABEL = { goods: "goods", service: "services", tool: "tools" };

/**
 * OPEN FRONT DOORS (flagged, see config/flags.js). People near you who are offering
 * something right now. Distance is shown as measured, never rounded up into a bigger
 * radius. No phone numbers here: a person's own profile carries their contact details.
 */
export default function FrontDoorsPage() {
  const [kind, setKind] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async (k) => {
    setError("");
    try {
      const { data: body } = await nearbyAPI.frontDoors({ kind: k || undefined, radius_km: 3 });
      setData(body);
    } catch (e) {
      setError(apiError(e, "Could not load nearby front doors. Try again."));
    }
  }, []);

  useEffect(() => { load(kind); }, [kind, load]);

  const chooseKind = (k) => {
    setData(null);
    setKind(k);
  };

  return (
    <div className="space-y-4 p-4">
      <header>
        <h1 className="text-xl font-extrabold tracking-tight text-ink-1">Open front doors</h1>
        <p className="text-sm text-ink-2">People near you who are offering something right now.</p>
      </header>

      <div role="group" aria-label="Filter by what is offered" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key || "all"}
            type="button"
            aria-pressed={kind === f.key}
            onClick={() => chooseKind(f.key)}
            className={`rounded-full px-3 py-1 text-sm font-semibold ${kind === f.key ? "bg-brand-600 text-white" : "bg-surface-2 text-ink-2"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? (
        <Card className="space-y-3 p-4" role="alert">
          <p className="text-sm text-ink-2">{error}</p>
          <Button onClick={() => load(kind)}>Try again</Button>
        </Card>
      ) : !data ? (
        <PageSpinner />
      ) : data.reason === "no_location" ? (
        <EmptyState
          title="Set your location first"
          description="We need a location to show who is near you."
        />
      ) : data.front_doors.length === 0 ? (
        <EmptyState
          title="No open front doors nearby"
          description={`Nobody within ${data.radius_km} km is offering ${kind ? OFFER_LABEL[kind] : "anything"} right now.`}
        />
      ) : (
        <ul className="space-y-2">
          {data.front_doors.map((d) => (
            <li key={d.id}>
              <Link to={`/@${d.handle}`} className="block">
                <Card className="space-y-1 p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate font-semibold text-ink-1">{d.name}</p>
                    <span className="shrink-0 text-xs text-ink-2">{d.distance_km} km</span>
                  </div>
                  <p className="text-xs text-ink-2">
                    {Object.entries(d.offers).map(([k, n]) => `${n} ${OFFER_LABEL[k]}`).join(" · ")}
                  </p>
                  {d.titles?.length > 0 && (
                    <p className="truncate text-sm text-ink-2">{d.titles.join(", ")}</p>
                  )}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
