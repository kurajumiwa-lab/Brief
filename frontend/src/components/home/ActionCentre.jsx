import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronDown, ChevronUp } from "lucide-react";
import { routineAPI } from "@/lib/api";

const SHOWN_BY_DEFAULT = 2;

/**
 * ACTION CENTRE — what needs doing next, and nothing else.
 *
 * Two sources, one list: the shop's unfinished setup steps (vital ones first),
 * and the Today checks that have something waiting. The first two show; "View
 * all" expands the rest in place. When nothing is pending the whole section
 * renders nothing, so an empty to-do list never takes up room.
 */
export default function ActionCentre({ progress }) {
  const { steps, loaded } = progress;
  const [today, setToday] = useState([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let live = true;
    routineAPI
      .today()
      .then(({ data }) => {
        if (live) setToday(Array.isArray(data?.items) ? data.items.filter((i) => i.dot) : []);
      })
      .catch(() => {
        if (live) setToday([]);
      });
    return () => {
      live = false;
    };
  }, []);

  const pending = useMemo(() => {
    const setup = steps
      .filter((s) => !s.done)
      .map((s) => ({ key: `setup:${s.id}`, title: s.title, cta: s.cta, to: s.to }));
    const checks = today.map((i) => ({ key: `today:${i.key}`, title: i.label, cta: "Open", to: i.link, why: i.why }));
    return [...setup, ...checks];
  }, [steps, today]);

  if (!loaded || pending.length === 0) return null;

  const visible = expanded ? pending : pending.slice(0, SHOWN_BY_DEFAULT);
  const hidden = pending.length - visible.length;

  return (
    <section aria-labelledby="action-centre-heading" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="action-centre-heading" className="text-sm font-bold text-ink-1">Next actions</h2>
        {pending.length > SHOWN_BY_DEFAULT && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 text-micro font-bold text-brand-700 dark:text-brand-400 hover:underline underline-offset-2"
          >
            {expanded ? "Show fewer" : `View all (${pending.length})`}
            {expanded ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
          </button>
        )}
      </div>
      <ul className="space-y-2">
        {visible.map((a) => (
          <li key={a.key} className="flex items-center gap-3 rounded-2xl border border-edge-1 bg-surface-0 p-3">
            <span className="h-2 w-2 shrink-0 rounded-full bg-accent-500" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-ink-1">{a.title}</p>
              {a.why && <p className="truncate text-micro text-ink-3">{a.why}</p>}
            </div>
            <Link
              to={a.to}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-micro font-bold text-white hover:bg-brand-700"
            >
              {a.cta}
              <ArrowRight size={12} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
      {hidden > 0 && <p className="text-micro text-ink-4">{hidden} more</p>}
    </section>
  );
}
