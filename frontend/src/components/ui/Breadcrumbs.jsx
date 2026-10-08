import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

/** `items`: [{ label, to? }] — the last entry is the current page. */
export default function Breadcrumbs({ items = [], className }) {
  if (!items.length) return null;
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex items-center gap-1 text-2xs text-ink-4 flex-wrap">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1 min-w-0">
              {item.to && !last ? (
                <Link to={item.to} className="hover:text-ink-1 hover:underline underline-offset-2 truncate">
                  {item.label}
                </Link>
              ) : (
                <span className={last ? "text-ink-2 font-semibold truncate" : "truncate"} aria-current={last ? "page" : undefined}>
                  {item.label}
                </span>
              )}
              {!last && <ChevronRight size={12} className="shrink-0 opacity-60" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
