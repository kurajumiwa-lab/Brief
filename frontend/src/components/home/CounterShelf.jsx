import { Link } from "react-router-dom";
import {
  ArrowUpRight, Banknote, FileText, LayoutDashboard, Receipt, ShieldCheck,
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { useSetupProgress } from "@/components/onboarding/useSetupProgress";

/**
 * THE COUNTER — the owner's records, without treating Home as an admin desk.
 *
 * Every destination, the setup reading and the "records, not an account"
 * promise stay. What went is the second layer of furniture: five step numbers,
 * five visible hints, a mark, a duplicate footer link and a paragraph explaining
 * the product. Home now shows one compact list of real doors and one honest
 * status line, after the marketplace and the things that need a reply.
 */

const COUNTERS = [
  {
    to: "/workspace",
    label: "Business workspace",
    hint: "Where you stand, and what is waiting on you",
    icon: LayoutDashboard,
  },
  {
    to: "/you/page",
    label: "Your page",
    hint: "Name, prices and the address you share",
    icon: FileText,
  },
  {
    to: "/desk",
    label: "What you offer",
    hint: "Services, goods, day rates and durations",
    icon: Banknote,
  },
  {
    to: "/payments",
    label: "Receipts & record",
    hint: "What has been paid and what is still owed",
    icon: Receipt,
  },
  {
    to: "/more",
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
  // Home already made this read. A loading read must never be shown as zero.
  const open = read?.loaded ? read.steps.filter((step) => !step.done).length : null;

  return (
    <section aria-labelledby="counter-heading" data-testid="counter-shelf" className="space-y-2">
      <div className="flex items-end justify-between gap-3 px-1">
        <h2 id="counter-heading" className="text-title-section font-bold tracking-tight text-ink-1">
          Your business today
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {open === 0 ? (
            <span className="rounded-full bg-brand-50 px-2 py-1 text-micro font-bold text-brand-900">
              All in order
            </span>
          ) : open != null ? (
            <span className="rounded-full bg-brand-50 px-2 py-1 text-micro font-bold text-brand-900">
              {open} open
            </span>
          ) : null}
          <p className="truncate font-mono text-micro text-ink-4">
            {handle ? `/p/${handle}` : "no page address yet"}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-brand-700 bg-brand-600 text-white shadow-sm">
        <ul className="divide-y divide-white/10">
          {COUNTERS.map(({ to, label, hint, icon: Icon }) => (
            <li key={to}>
              <Link
                to={to}
                title={hint}
                aria-label={`${label}: ${hint}`}
                className="group flex min-h-12 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10 text-white/85">
                  <Icon size={15} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-bold text-white">
                  {label}
                </span>
                <ArrowUpRight
                  size={13}
                  className="shrink-0 text-white/55 transition-transform group-hover:-translate-y-0.5 group-hover:text-white"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
        <p className="border-t border-white/10 px-4 py-2.5 text-micro leading-relaxed text-white/75">
          Records only. Wasta holds no money for you and lends you none.
        </p>
      </div>
    </section>
  );
}
