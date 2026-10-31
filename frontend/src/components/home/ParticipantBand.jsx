import { Link } from "react-router-dom";
import { ArrowRight, GraduationCap, HardHat, Home, Store } from "lucide-react";

/**
 * ONE NETWORK. DIFFERENT PARTICIPANTS.
 * ---------------------------------------------------------------------------
 * A marketplace sorts people into two boxes: buyer and seller. This network
 * does not, and the reason is not philosophy — it is the schema. `vendors`
 * already carries `account_kind IN ('person','household','artisan',
 * 'institution','business')`, so a school, a home, a fundi and a shop are the
 * same kind of record, and any of them can hold stock and raise a request on the
 * same day.
 *
 * The four rows below are that fact, in the words a person would use:
 *
 *   · a **school** joins to find electricians, stationery and transport — not
 *     to recruit pupils;
 *   · a **household** is a buyer today and can put a trade on the network
 *     tomorrow (rent the ladder, sell the extra sacks);
 *   · an **enterprise** publishes capabilities and receives enquiries;
 *   · a **skilled worker** gets an identity, a client network and a record.
 *
 * Every row is a link to a screen that exists. The band claims nothing about
 * numbers, because there are no numbers to claim.
 */

const PARTICIPANTS = [
  {
    icon: GraduationCap,
    kind: "Institution",
    title: "A school",
    body: "Finds electricians, stationery suppliers, IT technicians, food suppliers, transport operators and maintenance contractors.",
    to: "/network",
  },
  {
    icon: Home,
    kind: "Consumer + potential vendor",
    title: "A household",
    body: "Finds plumbers, technicians and products. Can also open a vendor front to offer a service, rent equipment or sell surplus.",
    to: "/explore",
  },
  {
    icon: Store,
    kind: "Business",
    title: "An enterprise",
    body: "Publishes its capabilities, receives enquiries, discovers suppliers and keeps a record of the relationships it builds.",
    to: "/me",
  },
  {
    icon: HardHat,
    kind: "Independent provider",
    title: "A skilled worker",
    body: "Creates a professional identity, lists skills, receives work enquiries and grows a client network.",
    to: "/create",
  },
];

export default function ParticipantBand({ className = "" }) {
  return (
    <section
      aria-labelledby="participants-heading"
      data-testid="participant-band"
      className={`rounded-2xl border border-edge-1 bg-surface-1 p-4 ${className}`}
    >
      <h2 id="participants-heading" className="text-sm font-bold tracking-tight text-ink-1">
        One network. Different participants.
      </h2>
      <p className="mt-1 text-micro leading-relaxed text-ink-3">
        Every participant can buy and supply. The account kind decides what the record looks like,
        not what it is allowed to do.
      </p>

      <ul className="mt-3 divide-y divide-edge-1">
        {PARTICIPANTS.map(({ icon: Icon, kind, title, body, to }) => (
          <li key={title}>
            <Link
              to={to}
              className="group flex items-start gap-3 py-3 focus:outline-none focus-visible:bg-surface-2"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-tech-50 text-tech-700 dark:bg-tech-500/10 dark:text-tech-300">
                <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold text-ink-1">{title}</span>
                  <span className="rounded-full border border-tech-200 bg-tech-50 px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.08em] text-tech-800 dark:border-tech-500/25 dark:bg-tech-500/10 dark:text-tech-300">
                    {kind}
                  </span>
                </span>
                <span className="mt-1 block text-micro leading-relaxed text-ink-3">{body}</span>
              </span>
              <ArrowRight
                size={14}
                className="mt-1 shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
