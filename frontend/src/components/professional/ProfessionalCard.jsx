import { CheckCircle2, MapPin } from "lucide-react";
import CredentialBadge from "@/components/credentials/CredentialBadge";
import { SERVICE_PROFILES_ENABLED } from "@/config/flags";
import { currency } from "@/lib/formatters";

const MODE_BADGE = { clinic: "At Clinic", home: "Home Visit", remote: "Remote" };

const priceLine = (s) => {
  if (s.price_kes == null) return null; // no made-up price: only a stated one is shown
  return `${currency(s.price_kes)}${s.price_unit ? ` / ${s.price_unit}` : ""}`;
};

const completedLine = (n) => {
  if (!n) return "No completed bookings yet";
  return `${n} completed ${n === 1 ? "booking" : "bookings"}`;
};

/** Services grouped under their domain label, in the order they first appear. Unlabelled ones stay together. */
function groupByDomain(services) {
  const groups = new Map();
  for (const s of services) {
    const key = s.domain_label || null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  return [...groups.entries()];
}

function DeliveryBadges({ modes = [] }) {
  return modes.map((m) => (
    <span key={m} className="rounded-full bg-surface-3 px-2 py-0.5 text-2xs font-medium text-ink-2">
      {MODE_BADGE[m] || m}
    </span>
  ));
}

/**
 * Professional profile card. Built only from the server's real rows. Nothing is seeded: a missing
 * price, domain or location is left out, and zero completed bookings says so in words.
 */
export default function ProfessionalCard({ card }) {
  if (!card) return null;
  const { services = [], hours = [], registrations = [], completed_appointments: done = 0, handle, location } = card;

  if (!SERVICE_PROFILES_ENABLED) return <BasicCard card={card} />;

  return (
    <section aria-labelledby="professional-card-heading" className="rounded-2xl border border-edge-1 bg-surface-0 p-5 space-y-5">
      <header className="space-y-1">
        <h2 id="professional-card-heading" className="text-sm font-bold text-ink-1">Professional profile</h2>
        {handle && <p className="text-sm text-ink-2">@{handle}</p>}
        {location && (
          <p className="flex items-center gap-1 text-xs text-ink-2">
            <MapPin aria-hidden="true" className="h-3.5 w-3.5" /> {location}
          </p>
        )}
      </header>

      <p className="flex items-center gap-1.5 text-sm text-ink-2">
        {done > 0 && <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-tech-700" />}
        {completedLine(done)}
      </p>

      {registrations.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Registrations">
          {registrations.map((r, i) => (
            <li key={`${r.title}-${i}`} className="space-y-1">
              <CredentialBadge status={r.status} />
              <p className="text-xs text-ink-2">{r.title} · {r.issuing_body}</p>
            </li>
          ))}
        </ul>
      )}

      {services.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-2">Services</h3>
          {groupByDomain(services).map(([label, items]) => (
            <div key={label || "unlabelled"} className="space-y-2">
              {label && <p className="text-sm font-semibold text-ink-1">{label}</p>}
              <ul className="space-y-2">
                {items.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium text-ink-1">{s.name}</span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink-2">
                      <span>{s.duration_minutes} min</span>
                      {priceLine(s) && <span>· {priceLine(s)}</span>}
                      <DeliveryBadges modes={s.delivery} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {hours.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-2">Hours</h3>
          <ul className="text-sm text-ink-2">
            {hours.map((h) => (
              <li key={h.day}>{h.day}: {h.windows.join(", ")}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** The layout shown while the service-profiles flag is off. Same data, plainer presentation. */
function BasicCard({ card }) {
  const { services = [], hours = [], registrations = [], completed_appointments: done = 0 } = card;
  if (services.length === 0 && hours.length === 0 && registrations.length === 0 && !done) return null;
  return (
    <section aria-labelledby="professional-card-heading" className="rounded-2xl border border-edge-1 bg-surface-0 p-5 space-y-4">
      <h2 id="professional-card-heading" className="text-sm font-bold text-ink-1">Professional profile</h2>
      {done > 0 && (
        <p className="flex items-center gap-1.5 text-sm text-ink-2">
          <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-tech-700" />
          {completedLine(done)}
        </p>
      )}
      {registrations.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Registrations">
          {registrations.map((r, i) => (
            <li key={`${r.title}-${i}`} className="space-y-1">
              <CredentialBadge status={r.status} />
              <p className="text-xs text-ink-2">{r.title} · {r.issuing_body}</p>
            </li>
          ))}
        </ul>
      )}
      {services.length > 0 && (
        <ul className="space-y-2">
          {services.map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-medium text-ink-1">{s.name}</span>
              <span className="text-xs text-ink-2">
                {s.duration_minutes} min
                {s.delivery?.length > 0 && ` · ${s.delivery.map((m) => MODE_BADGE[m] || m).join(", ")}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {hours.length > 0 && (
        <ul className="text-sm text-ink-2">
          {hours.map((h) => (
            <li key={h.day}>{h.day}: {h.windows.join(", ")}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
