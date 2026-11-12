import { CheckCircle2 } from "lucide-react";
import CredentialBadge from "@/components/credentials/CredentialBadge";

const MODE_LABEL = { clinic: "At clinic", home: "Home visit", remote: "Remote" };

/**
 * Professional profile card. Shows only what the server returned from real rows. A missing
 * completed count stays hidden rather than shown as zero.
 */
export default function ProfessionalCard({ card }) {
  if (!card) return null;
  const { services = [], hours = [], registrations = [], completed_appointments: done } = card;
  const empty = services.length === 0 && hours.length === 0 && registrations.length === 0 && !done;
  if (empty) return null;

  return (
    <section aria-labelledby="professional-card-heading" className="rounded-2xl border border-edge-1 bg-surface-0 p-5 space-y-4">
      <h2 id="professional-card-heading" className="text-sm font-bold text-ink-1">Professional profile</h2>

      {done ? (
        <p className="flex items-center gap-1.5 text-sm text-ink-2">
          <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-tech-700" />
          {done} completed {done === 1 ? "appointment" : "appointments"}
        </p>
      ) : null}

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
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-2">Services</h3>
          <ul className="space-y-2">
            {services.map((s) => (
              <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-ink-1">{s.name}</span>
                <span className="text-xs text-ink-2">
                  {s.duration_minutes} min
                  {s.delivery?.length > 0 && ` · ${s.delivery.map((m) => MODE_LABEL[m] || m).join(", ")}`}
                  {s.price_kes != null && ` · KES ${s.price_kes}${s.price_unit ? ` per ${s.price_unit}` : ""}`}
                </span>
              </li>
            ))}
          </ul>
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
