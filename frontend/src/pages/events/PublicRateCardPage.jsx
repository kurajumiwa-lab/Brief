import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, ExternalLink, MapPin, ShieldCheck, Wallet } from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { PageSpinner } from "@/components/ui/Spinner";
import { EVENT_VENDOR_CATEGORIES } from "@/config/constants";
import { apiError } from "@/lib/api";
import { eventDeskAPI } from "@/lib/eventDeskApi";
import { formatKes } from "@/lib/receipts";

const labelFor = (value) => EVENT_VENDOR_CATEGORIES.find((c) => c.value === value)?.label || value;

/** A public rate card. Readable before sign-up; no phone number or email here. */
export default function PublicRateCardPage() {
  const { handle = "" } = useParams();
  const [card, setCard] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    setCard(null);
    setError(null);
    eventDeskAPI.publicRateCard(handle)
      .then(({ data }) => live && setCard(data))
      .catch((e) => live && setError(apiError(e, "This rate card is not available.")));
    return () => { live = false; };
  }, [handle]);

  if (error) {
    return (
      <PublicShell>
        <Card className="text-center py-10">
          <p className="font-semibold text-ink-1">This rate card is not available.</p>
          <p className="text-sm text-ink-4 mt-1">{error}</p>
          <Button as={Link} to="/events" className="mt-4" size="sm" variant="secondary">Browse events</Button>
        </Card>
      </PublicShell>
    );
  }
  if (!card) return <PageSpinner />;

  return (
    <PublicShell>
      <Card className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold text-ink-1 tracking-tight">{card.vendor?.business_name}</h1>
              {card.is_public && <Badge variant="brand" size="xs">Published card</Badge>}
            </div>
            <p className="text-sm text-ink-3 mt-1">@{card.vendor?.handle}{card.vendor?.location ? ` · ${card.vendor.location}` : ""}</p>
            {card.accepted_bookings > 0 && (
              <p className="text-2xs text-brand-700 dark:text-brand-300 mt-1">{card.accepted_bookings} booking{card.accepted_bookings === 1 ? "" : "s"} recorded on the event desk</p>
            )}
            {card.vendor?.location && (
              <p className="text-2xs text-ink-4 mt-1 inline-flex items-center gap-1"><MapPin size={11} /> {card.vendor.location}</p>
            )}
          </div>
          <Button as={Link} to={`/events/desk?category=${encodeURIComponent(card.event_categories?.[0] || "")}`}
                  size="sm" icon={ArrowRight}>Ask for a quote</Button>
        </div>
        <p className="text-base text-ink-2 leading-relaxed">{card.headline}</p>
        {card.summary && <p className="text-sm text-ink-3 leading-relaxed whitespace-pre-line">{card.summary}</p>}
        <div className="flex flex-wrap gap-1.5">
          {(card.event_categories || []).map((category) => (
            <Badge key={category} variant="outline" size="xs">{labelFor(category)}</Badge>
          ))}
        </div>
      </Card>

      <div className="grid md:grid-cols-[1.5fr_1fr] gap-3 items-start">
        <Card className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-1">Packages</h2>
            <p className="text-2xs text-ink-4">Prices set by the business. A quote can add or remove items.</p>
          </div>
          {(card.packages || []).length === 0 ? (
            <p className="text-sm text-ink-4">No packages published yet. Ask for a quote.</p>
          ) : (
            <div className="space-y-2">
              {card.packages.map((pack) => (
                <div key={pack.id} className="rounded-xl border border-edge-1 bg-surface-0 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink-1">{pack.name}</p>
                      {pack.description && <p className="text-xs text-ink-3 mt-0.5">{pack.description}</p>}
                    </div>
                    <p className="text-sm font-semibold text-ink-1 whitespace-nowrap inline-flex items-center gap-1">
                      <Wallet size={13} /> {formatKes(pack.price_kes)}
                    </p>
                  </div>
                  <p className="text-2xs text-ink-4 mt-1">{pack.price_unit.replaceAll("_", " ")}</p>
                  {(pack.inclusions || []).length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {pack.inclusions.map((item) => (
                        <li key={item} className="rounded-full bg-surface-2 px-2 py-0.5 text-2xs text-ink-3">{item}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-3">
          <Card className="space-y-2">
            <div className="flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-brand-600" />
              <h2 className="text-sm font-semibold text-ink-1">Reach, as claimed</h2>
            </div>
            {(card.reach_claims || []).length === 0 ? (
              <p className="text-xs text-ink-4">No reach claims on this card.</p>
            ) : (
              card.reach_claims.map((claim, index) => (
                <div key={`${claim.platform}-${index}`} className="rounded-lg bg-surface-2 p-2">
                  <p className="text-xs font-semibold text-ink-1">{claim.value} <span className="font-normal text-ink-3">{claim.metric}</span></p>
                  <p className="text-2xs text-ink-4 mt-0.5">{claim.platform} · {claim.source === "self_reported" ? "Self-reported" : claim.source}</p>
                </div>
              ))
            )}
            <p className="text-micro text-ink-4">Self-reported means the business typed it. It is not a platform verification.</p>
          </Card>

          <Card className="space-y-2">
            <h2 className="text-sm font-semibold text-ink-1">Work links</h2>
            {(card.proof_links || []).length === 0 ? (
              <p className="text-xs text-ink-4">No links on this card.</p>
            ) : (
              card.proof_links.map((link, index) => (
                <a key={`${link.url}-${index}`} href={link.url} target="_blank" rel="noreferrer"
                   className="flex items-center justify-between gap-2 rounded-lg border border-edge-1 px-2.5 py-2 text-xs text-ink-2 hover:text-brand-600">
                  <span className="truncate">{link.label || link.url}</span>
                  <ExternalLink size={12} className="shrink-0" />
                </a>
              ))
            )}
          </Card>
        </div>
      </div>

      <Card className="space-y-2">
        <h2 className="text-sm font-semibold text-ink-1">How booking works</h2>
        <ol className="text-xs text-ink-3 space-y-1 list-decimal list-inside">
          <li>Tell the organiser what the event needs in a structured request.</li>
          <li>The business answers with one quote and what it includes.</li>
          <li>The organiser accepts one quote. Contact details open and payment is agreed directly.</li>
        </ol>
        <p className="text-2xs text-ink-4">{card.money_note}</p>
        <Button as={Link} to="/events/desk" size="sm" variant="secondary" icon={ArrowRight} className="w-fit">
          Open the event desk
        </Button>
      </Card>
    </PublicShell>
  );
}

function PublicShell({ children }) {
  return (
    <div className="min-h-screen bg-surface-2">
      <header className="border-b border-edge-1 bg-surface-1">
        <div className="mx-auto max-w-4xl px-4 h-14 flex items-center justify-between">
          <Link to="/" className="text-sm font-bold tracking-tight text-ink-1">Brief<span className="text-brand-600">.</span></Link>
          <Link to="/events" className="text-xs text-ink-3 hover:text-ink-1">Events</Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-5 space-y-4">{children}</main>
    </div>
  );
}
