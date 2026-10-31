import { Link } from "react-router-dom";
import { Contact, Network, QrCode, Workflow } from "lucide-react";

/**
 * WHAT IS UNDERNEATH — four systems, each with the screen it already has.
 * ---------------------------------------------------------------------------
 * "Digital identity, discovery, business codes, trade records" is the right
 * description of an infrastructure product, and the fastest way to make it a lie
 * is to say it in a marketing strip and ship none of it. So each of the four
 * names a surface that exists today, and the one that does not is labelled as
 * the next step rather than dressed up.
 *
 *   · identity       → `/@handle` (shop front) and `/passport` (verification)
 *   · discovery      → `/network` (ranked suppliers, with the reasons)
 *   · business code  → the handle *is* the code: a short, stable address that
 *                      resolves to a shop. A printed QR is next; saying it is
 *                      live before it can be generated would be the first thing
 *                      a buyer discovers is not true.
 *   · records        → `/orders` and `/analytics`, from the movement ledger
 */

const SYSTEMS = [
  {
    icon: Contact,
    title: "Digital business identity",
    body: "A structured record: what you sell, where you are, who verified you and how to reach you.",
    to: "/passport",
    cta: "Business passport",
  },
  {
    icon: Network,
    title: "Discovery and relationships",
    body: "Suppliers ranked by fit, with the reasons behind each one — not a paid placement list.",
    to: "/network",
    cta: "Find suppliers",
  },
  {
    icon: QrCode,
    title: "Business codes and automation",
    body: "Your handle is a stable address for your shop. A printed QR code is the next step.",
    to: null,
    cta: "Next",
    pending: true,
  },
  {
    icon: Workflow,
    title: "Trade activity and records",
    body: "Every enquiry, order and completed movement, kept — the history a lender or a client will ask for.",
    to: "/orders",
    cta: "Orders & trades",
  },
];

export default function FoundationStrip({ className = "" }) {
  return (
    <section
      aria-labelledby="foundations-heading"
      data-testid="foundation-strip"
      className={`rounded-2xl border border-edge-1 bg-surface-1 p-4 ${className}`}
    >
      <h2 id="foundations-heading" className="text-sm font-bold tracking-tight text-ink-1">
        What the network is built on
      </h2>

      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {SYSTEMS.map(({ icon: Icon, title, body, to, cta, pending }) => {
          const inner = (
            <>
              <span className="flex items-center justify-between gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                  <Icon size={15} strokeWidth={1.9} aria-hidden="true" />
                </span>
                <span
                  className={
                    pending
                      ? "rounded-full border border-edge-2 px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.08em] text-ink-4"
                      : "text-micro font-semibold text-brand-700 dark:text-brand-400"
                  }
                >
                  {cta}
                </span>
              </span>
              <span className="mt-2 block text-xs font-bold leading-tight text-ink-1">{title}</span>
              <span className="mt-1 block text-micro leading-relaxed text-ink-3">{body}</span>
            </>
          );

          return (
            <li key={title}>
              {to ? (
                <Link
                  to={to}
                  className="block h-full rounded-xl border border-edge-1 bg-surface-0 p-3 transition-colors hover:border-brand-300 hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  {inner}
                </Link>
              ) : (
                <div className="h-full rounded-xl border border-dashed border-edge-2 bg-surface-0 p-3">
                  {inner}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
