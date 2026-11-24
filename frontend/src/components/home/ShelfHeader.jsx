import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";

/**
 * The heading every Home shelf wears.
 *
 * Four rails now sit on Home, and each one asks the same question in a
 * different tense: what is for sale, what is cheap, what is on, what is
 * nearby. They must not each invent their own type ramp, or the page reads as
 * four pages stacked. One eyebrow, one title, one way out.
 */
export default function ShelfHeader({ eyebrow, title, to, linkLabel, id }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 id={id} className="mt-1 text-base font-extrabold tracking-tight text-ink-1">
          {title}
        </h2>
      </div>
      {to && (
        <Link
          to={to}
          className="inline-flex shrink-0 items-center gap-1 text-micro font-bold text-brand-700 hover:underline dark:text-brand-400"
        >
          {linkLabel}
          <ArrowUpRight size={12} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
