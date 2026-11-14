import { Link } from "react-router-dom";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { SETTINGS_GROUPS } from "@/config/navigation";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";

/**
 * SETTINGS & RECORDS — the long tail, in one place, reached deliberately.
 *
 * Everything that used to compete with the five tabs lives here: records,
 * tools, plans and the operator desks. It is grouped, searchable by eye, and
 * never on the home screen. The test for adding something here is simple: is it
 * a record or a tool you open from a standing start? If it is something you do
 * every day, it belongs in one of the five.
 */
export default function MorePage() {
  const vendor = useAuthStore((s) => s.vendor);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Link to="/you" className="inline-flex items-center gap-1.5 text-2xs font-bold text-ink-3 hover:text-ink-1">
        <ArrowLeft size={13} aria-hidden="true" />
        You
      </Link>

      <header className="mt-3">
        <p className="eyebrow">Everything else</p>
        <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-ink-1">Settings & records</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-3">
          The records, tools and plans that are not part of the five daily
          destinations. Nothing here is hidden — it is just not in the way.
        </p>
      </header>

      <div className="mt-6 space-y-6">
        {SETTINGS_GROUPS.map((group) => (
          <section key={group.title} aria-labelledby={`settings-${group.title.replaceAll(" ", "-").toLowerCase()}`}>
            <h2
              id={`settings-${group.title.replaceAll(" ", "-").toLowerCase()}`}
              className="eyebrow"
            >
              {group.title}
            </h2>
            <ul className="mt-1.5 divide-y divide-edge-1 border-y border-edge-1">
              {group.items.map(({ to, label, icon: Icon, quiet }) => (
                <li key={to}>
                  <Link
                    to={to}
                    className="group flex items-center gap-3 py-3 px-1 -mx-1 rounded-xl hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-3">
                      <Icon size={15} aria-hidden="true" />
                    </span>
                    <span className={cn("min-w-0 flex-1 text-xs font-semibold", quiet ? "text-ink-3" : "text-ink-1")}>
                      {label}
                    </span>
                    {quiet && <span className="text-micro font-medium text-ink-4">operator</span>}
                    <ChevronRight size={15} className="shrink-0 text-ink-4 group-hover:text-ink-1" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-8 rounded-2xl border border-edge-1 bg-surface-0 px-4 py-3 text-micro leading-relaxed text-ink-3">
        Signed in as <span className="font-semibold text-ink-2">{vendor?.business_name || vendor?.vendor_handle || "this account"}</span>.
        Your page address is <span className="font-mono text-ink-2">/p/{vendor?.vendor_handle || "…"}</span>.
      </p>
    </div>
  );
}
