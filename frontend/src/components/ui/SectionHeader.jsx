import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The shelf header used on every home/profile section: title, why, a way on.
 *
 * v3.2 tightened the type scale — a wall of 18px bold headings down a feed
 * makes every shelf shout equally, which is the same as none of them speaking.
 * The title is now 16px with a real rule between the header and the cards, so
 * the eye reads section → records → section instead of one continuous column of
 * bold text. Nothing about where a header links, or what it says, changed.
 */
export default function SectionHeader({
  title,
  description,
  to,
  action,
  linkLabel = "See all",
  className,
  id,
  as: Tag = "h2",
}) {
  const lead =
    action ||
    (to ? (
      <Link
        to={to}
        className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-micro font-bold text-brand-700 hover:underline underline-offset-2 dark:text-brand-400"
      >
        {linkLabel}
        <ChevronRight size={13} aria-hidden="true" />
      </Link>
    ) : null);

  return (
    <div className={cn("mb-3 border-b border-edge-1 pb-2.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Tag id={id} className="text-base font-bold tracking-tight text-ink-1">
          {title}
        </Tag>
        {lead}
      </div>
      {description && <p className="mt-0.5 text-pretty text-micro text-ink-4">{description}</p>}
    </div>
  );
}
