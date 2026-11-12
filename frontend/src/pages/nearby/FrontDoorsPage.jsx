import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { PageSpinner } from "@/components/ui/Spinner";
import EmptyState from "@/components/ui/EmptyState";
import { nearbyAPI, apiError } from "@/lib/api";
import CredentialBadge from "@/components/credentials/CredentialBadge";

const FILTERS = [
  { key: "", label: "All" },
  { key: "goods", label: "Goods" },
  { key: "service", label: "Services" },
  { key: "tool", label: "Tools" },
];
const OFFER_LABEL = { goods: "goods", service: "services", tool: "tools" };

/**
 * Whether my own door is listed. Off by default: nobody's location is shown until they
 * choose it. Turning it off hides the door from everyone at once.
 */
function MyDoorSetting() {
  const [visible, setVisible] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    nearbyAPI.frontDoorSetting()
      .then(({ data }) => live && setVisible(!!data.front_door_visible))
      .catch(() => live && setError("Could not load your door setting."));
    return () => { live = false; };
  }, []);

  const toggle = async () => {
    if (visible === null || saving) return;
    const next = !visible;
    setSaving(true);
    setError("");
    try {
      const { data } = await nearbyAPI.setFrontDoorSetting(next);
      setVisible(!!data.front_door_visible);
    } catch (e) {
      setError(apiError(e, "Could not change your door setting."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink-1">Show my door to nearby people</p>
        <p className="text-xs text-ink-3">
          {visible ? "Listed while you offer something." : "Off. Your door is not listed."}
        </p>
        {error && <p role="alert" className="text-xs text-ink-2">{error}</p>}
      </div>
      <Button size="sm" variant={visible ? "secondary" : "primary"} disabled={visible === null || saving}
        aria-pressed={visible === true} onClick={toggle}>
        {visible ? "Hide my door" : "Show my door"}
      </Button>
    </Card>
  );
}

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

      <MyDoorSetting />

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
                  {d.credentials?.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {d.credentials.map((c, i) => (
                        <CredentialBadge key={`${c.title}-${i}`} status={c.status} />
                      ))}
                    </div>
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
