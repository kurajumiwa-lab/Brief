import { BadgeCheck, MapPin } from "lucide-react";
import { FulfilmentChip } from "@/components/trust/TrustSignals";
import CardShell, { CardBody, CardMedia, CardTitle, CardMeta } from "./CardShell";
import { VENDOR_ROLES } from "@/config/constants";

/**
 * PERSON CARD — a vendor to work with.
 *
 * The ranking is the existing discovery service: people you have not traded
 * with yet, scored on what the network can evidence.
 *
 * **The empty half (v3.2).** This card used to open with a 4:3 media box
 * holding one 56px avatar in the top-left corner — two thirds of the card was
 * blank surface, and it was the emptiest rectangle on the screen. A business is
 * an identity, so the media slot is now the identity itself: the vendor's
 * monogram at full card width on the market green, next to the name it stands
 * for. Same slot, same ratio, same shelf alignment — no blank area, and nothing
 * invented (the monogram comes from the business name the vendor typed).
 *
 * What the card states is still only what the API returned: their categories,
 * their location and distance, their fulfilment record when there is a sample,
 * and the discovery score with what it means. A vendor with nothing measured
 * says "New to the network" rather than showing a zero.
 */
export default function PersonCard({ item }) {
  const role = VENDOR_ROLES.find((r) => r.value === item.role);
  const location = [item.location, item.distanceKm != null ? `${item.distanceKm} km` : null].filter(Boolean).join(" · ");

  return (
    <CardShell
      to={item.to}
      label={`${item.name}${item.handle ? ` (@${item.handle})` : ""} — open shop front`}
    >
      <CardMedia className="market-forest border-b-0">
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-white/15 text-2xs font-bold uppercase text-white ring-1 ring-white/25">
            {(item.name || "?").replace(/^@/, "").slice(0, 2)}
          </span>
          {role && (
            <span className="text-micro font-bold uppercase tracking-[0.12em] text-white/85">{role.label}</span>
          )}
        </div>
        <span className="absolute right-2 top-2 flex items-center gap-1">
          {item.verified && (
            <BadgeCheck size={14} className="text-brand-200 drop-shadow" aria-label="Verified business" />
          )}
          {item.patron && (
            <span
              className="rounded-full bg-accent-400/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent-950"
              title="Runs a vendor list"
            >
              Patron
            </span>
          )}
        </span>
      </CardMedia>

      <CardBody>
        <CardTitle className="line-clamp-1">{item.name}</CardTitle>
        {item.handle && <CardMeta>@{item.handle}</CardMeta>}
        {item.categories?.length ? <CardMeta>{item.categories.join(" · ")}</CardMeta> : null}
        <CardMeta>
          <span className="inline-flex items-center gap-1">
            <MapPin size={10} aria-hidden="true" />
            {location || "Location not stated"}
          </span>
        </CardMeta>
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-1">
          {item.connected ? (
            <span className="text-micro text-ink-4">In your network</span>
          ) : item.fulfilment != null ? (
            <FulfilmentChip rate={item.fulfilment} />
          ) : (
            <span className="text-micro text-ink-4">New to the network</span>
          )}
          {item.score != null && (
            <span className="text-micro text-ink-4" title="Discovery score: how strongly the network graph recommends this business">
              Fit {Number(item.score).toFixed(0)}
            </span>
          )}
        </div>
      </CardBody>
    </CardShell>
  );
}
