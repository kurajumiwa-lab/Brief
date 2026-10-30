import { ArrowLeft, Check, Clock, Minus, PackageCheck } from "lucide-react";
import Badge from "@/components/ui/Badge";
import { tintForDesk } from "@/config/categoryTints";
import { cn } from "@/lib/utils";
import { money } from "@/components/desk/ServiceCard";

const READINESS_LABEL = {
  available_now: "Live today",
  service: "Delivered as a service",
  pilot: "Pilot — supervised rollout",
  scoped: "Scoped quotation",
  not_yet_live: "Not yet live",
};

/**
 * ONE SERVICE, IN FULL — and only what belongs to *this* service.
 *
 * Three blocks, in the order a buyer asks the questions:
 *
 *   1. what your business gets        (deliverables)
 *   2. what we need from you          (so nobody is surprised mid-project)
 *   3. what it does not include       (exclusions — printed, not buried)
 *
 * Then exactly one next step, decided by the offer's readiness on the server.
 * A pilot says "request pilot participation"; a scoped deployment says "submit
 * requirements"; nothing here can offer to sell what does not exist yet.
 */
export default function ServiceDetail({ offer, desk, onBack, onRequest, className }) {
  const tint = tintForDesk(offer.desk);
  const cta = offer.cta || { kind: "quotation", label: "Request a quotation", note: "" };

  return (
    <section
      data-testid="service-detail"
      data-offer={offer.key}
      aria-labelledby="service-detail-title"
      className={cn("space-y-3", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-micro font-semibold text-ink-3 hover:text-ink-1"
        >
          <ArrowLeft size={12} aria-hidden="true" />
          {desk?.title || "All services"}
        </button>
        <span className={cn("rounded-full px-2 py-0.5 text-micro font-semibold", tint.wash, tint.ink)}>
          {READINESS_LABEL[offer.readiness] || offer.readiness}
        </span>
      </div>

      <div>
        <h2 id="service-detail-title" className="text-xl font-extrabold tracking-tight text-ink-1">
          {offer.name}
        </h2>
        <p className="mt-1 text-2xl font-extrabold tabular-nums text-ink-1">
          {money(offer.price_min_kes, offer.price_max_kes, offer.price_unit)}
          <span className="ml-2 align-middle text-micro font-medium text-ink-4">test price</span>
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-2xs text-ink-3">
          <Clock size={12} aria-hidden="true" />
          {offer.turnaround}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Block title="What your business gets" items={offer.deliverables} icon={Check} tone="good" />
        <Block title="What we need from you" items={offer.customer_must_provide} icon={PackageCheck} />
        <Block title="Not included" items={offer.exclusions} icon={Minus} tone="muted" />
        {offer.revisions && (
          <div className="rounded-xl border border-edge-1 bg-surface-1 p-3">
            <p className="text-micro font-bold uppercase tracking-[0.1em] text-ink-4">Changes</p>
            <p className="mt-1 text-2xs leading-relaxed text-ink-2">{offer.revisions}</p>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-edge-1 bg-surface-0 p-3">
        <p className="text-micro font-bold uppercase tracking-[0.1em] text-ink-4">
          Choose your next step
        </p>
        <p className="mt-1 text-2xs leading-relaxed text-ink-3">{cta.note}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onRequest(cta.kind)}
            data-testid="service-cta"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white shadow-xs hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
          >
            {cta.label}
          </button>
          <Badge variant="gray" size="sm">
            No card is collected here
          </Badge>
        </div>
      </div>
    </section>
  );
}

function Block({ title, items = [], icon: Icon = Check, tone = "default" }) {
  if (!items.length) return null;
  return (
    <div className="rounded-xl border border-edge-1 bg-surface-1 p-3">
      <p className="flex items-center gap-1.5 text-micro font-bold uppercase tracking-[0.1em] text-ink-4">
        <Icon size={12} aria-hidden="true" />
        {title}
      </p>
      <ul className="mt-1.5 space-y-1">
        {items.map((item) => (
          <li
            key={item}
            className={cn(
              "text-2xs leading-relaxed",
              tone === "muted" ? "text-ink-4" : "text-ink-2",
            )}
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
