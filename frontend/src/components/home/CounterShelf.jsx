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
          <p className="eyebrow text-ink-4">The counter</p>
          <h2 id="counter-heading" className="mt-0.5 text-title-section font-bold tracking-tight text-ink-1">
            Settle your own books first
          </h2>
        </div>
        {open === 0 ? (
          <span className="shrink-0 rounded-full bg-brand-50 px-2 py-1 text-micro font-bold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
            All in order
          </span>
        ) : open != null ? (
          <span className="shrink-0 rounded-full bg-accent-50 px-2 py-1 text-micro font-bold text-accent-700 dark:bg-accent-500/10 dark:text-accent-300">
            {open} open
          </span>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-brand-800 via-brand-900 to-ink-900 text-white shadow-xl shadow-brand-900/20">
        <div className="flex items-start justify-between gap-4 px-5 pb-4 pt-5">
          <div className="min-w-0">
            <p className="text-micro font-bold uppercase tracking-[0.16em] text-white/50">
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

        <div className="grid grid-cols-2 gap-px bg-white/10">
          {COUNTERS.map(({ to, step, label, hint, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="group flex min-h-[92px] flex-col justify-between gap-2 bg-brand-900/40 p-4 transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60"
            >
              <span className="flex items-center justify-between">
                <Icon size={16} className="text-white/70" aria-hidden="true" />
                <span className="font-mono text-micro text-white/40">{step}</span>
              </span>
              <span className="space-y-0.5">
                <span className="flex items-center gap-1 text-xs font-bold text-white">
                  {label}
                  <ArrowUpRight
                    size={12}
                    className="text-white/40 transition-transform group-hover:-translate-y-0.5 group-hover:text-white"
                    aria-hidden="true"
                  />
                </span>
                <span className="block text-micro leading-snug text-white/55">{hint}</span>
              </span>
            </Link>
          ))}
        </div>

        <p className="border-t border-white/10 px-5 py-3 text-micro leading-relaxed text-white/45">
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
