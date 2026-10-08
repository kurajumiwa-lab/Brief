import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** The shelf header used on every home/profile section: title, why, a way on. */
export default function SectionHeader({ title, description, to, action, linkLabel = "See all", className, as: Tag = "h2" }) {
  return (
    <div className={cn("flex items-end justify-between gap-4 mb-3", className)}>
      <div className="min-w-0">
        <Tag className="text-lg font-bold text-ink-1 tracking-tight">{title}</Tag>
        {description && <p className="text-2xs text-ink-3 mt-0.5 text-pretty">{description}</p>}
      </div>
      {action ||
        (to && (
          <Link
            to={to}
            className="shrink-0 inline-flex items-center gap-0.5 text-2xs font-semibold text-brand-700 dark:text-brand-400 hover:underline underline-offset-2 rounded px-1 py-0.5"
          >
            {linkLabel}
            <ChevronRight size={14} aria-hidden="true" />
          </Link>
        ))}
    </div>
  );
}
