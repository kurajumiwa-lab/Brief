import { Link } from "react-router-dom";
import { ArrowUpRight, Banknote, CalendarDays, FileText, Receipt, ShieldCheck } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { useSetupProgress } from "@/components/onboarding/useSetupProgress";

/**
 * THE COUNTER — settings and records, given the standing they actually have.
 *
 * A business meets this screen before it meets a market. Prices, a page, a
 * record of what has been paid and promised: that is the paperwork you get in
 * order before you open the door, and none of it is "admin". It used to live
 * behind a small text link at the bottom of another page, which is how a person
 * concludes the product has no records at all.
 *
 * The visual language is a bank counter on purpose: a dark slab, a row of lit
 * positions, a manifest underneath. It reads as somewhere business happens,
 * not as a settings menu, and it never pretends to be a bank — Brief holds no
 * funds and lends none, so nothing here moves money.
 *
 * Four counters, each an existing route. No new pages, no new requests: the
 * open-items number comes from the setup reading Home already made.
 */

const COUNTERS = [
  {
    to: "/you/page",
    step: "01",
    label: "Your page",
    hint: "Name, prices and the address you share",
    icon: FileText,
  },
  {
    to: "/desk",
    step: "02",
    label: "What you offer",
    hint: "Services, goods, day rates and durations",
    icon: Banknote,
  },
  {
    to: "/payments",
    step: "03",
    label: "Receipts & record",
    hint: "What has been paid and what is still owed",
    icon: Receipt,
  },
  {
    to: "/more",
    step: "04",
    label: "Every record",
    hint: "Orders, trades, calendar and the rest",
    icon: ShieldCheck,
  },
];

export default function CounterShelf({ progress }) {
  const vendor = useAuthStore((s) => s.vendor);
  const own = useSetupProgress();
  const read = progress || own;
  const handle = vendor?.vendor_handle;
  const open = read?.loaded ? read.steps.filter((s) => !s.done).length : null;

  return (
    <section aria-labelledby="counter-heading" data-testid="counter-shelf" className="space-y-2">
      <div className="flex items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <p className="eyebrow text-ink-4">For shop owners</p>
          <h2 id="counter-heading" className="mt-0.5 text-title-section font-bold tracking-tight text-ink-1">
            Your business today
          </h2>
        </div>
        {open === 0 ? (
          <span className="shrink-0 rounded-full bg-white/20 px-2 py-1 text-micro font-bold text-white">
            All in order
          </span>
        ) : open != null ? (
          <span className="shrink-0 rounded-full bg-white px-2 py-1 text-micro font-bold text-brand-900">
            {open} open
          </span>
        ) : null}
      </div>

      {/* Solid green, not a three-stop gradient. The gradient was the "dark
          green glassmorphism" a design review named as making the product look
          generated; a flat brand-600 slab with a white hairline reads as a
          physical counter instead. */}
      <div className="overflow-hidden rounded-2xl border border-brand-700 bg-brand-600 text-white shadow-sm">
        <div className="flex items-start justify-between gap-4 px-5 pb-4 pt-5">
          <div className="min-w-0">
            <p className="text-micro font-bold uppercase tracking-[0.16em] text-white/75">
              {vendor?.business_name || "This business"}
            </p>
            <p className="mt-1 truncate font-mono text-sm text-white/90">
              {handle ? `/p/${handle}` : "no page address yet"}
            </p>
          </div>
          {/* The counter's own mark. Deliberately not a bank's: it is a stamp,
              and the caption beside it says what it does and does not do. */}
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/25 bg-white/5">
            <ShieldCheck size={18} aria-hidden="true" />
          </span>
        </div>

        {/* Four rows, not four boxes. The old 2x2 of dark tiles inside a dark
            slab was three weights of green stacked on each other; a counter
            reads as a manifest, and a manifest is a list. Every row keeps its
            own tap target, and the hairline between them is the only division. */}
        <ul className="divide-y divide-white/10 border-t border-white/10">
          {COUNTERS.map(({ to, step, label, hint, icon: Icon }) => (
            <li key={to}>
              <Link
                to={to}
                className="group flex min-h-[68px] items-center gap-3 px-5 py-3 transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10 text-white/85">
                  <Icon size={15} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-xs font-bold text-white">
                    {label}
                    <ArrowUpRight
                      size={12}
                      className="text-white/50 transition-transform group-hover:-translate-y-0.5 group-hover:text-white"
                      aria-hidden="true"
                    />
                  </span>
                  <span className="mt-0.5 block truncate text-micro leading-snug text-white/75">
                    {hint}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-micro text-white/50">{step}</span>
              </Link>
            </li>
          ))}
        </ul>

        <p className="border-t border-white/10 px-5 py-3 text-micro leading-relaxed text-white/75">
          Records only. Brief holds no money for you and lends you none — a receipt here is a
          receipt, not an account.
        </p>
      </div>

      <Link
        to="/more"
        className="flex items-center gap-2 px-1 pt-1 text-micro font-semibold text-ink-3 hover:text-ink-1"
      >
        <CalendarDays size={12} aria-hidden="true" />
        Settings &amp; records: every tool and plan in one list
        <ArrowUpRight size={11} aria-hidden="true" />
      </Link>
    </section>
  );
}
