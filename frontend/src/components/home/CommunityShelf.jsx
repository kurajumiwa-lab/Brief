import { Link } from "react-router-dom";
import { ArrowUpRight, MessageSquare, Users } from "lucide-react";
import { relativeTime } from "@/lib/formatters";

/**
 * COMMUNITY ACTIVITY — the neighbourhood talking to itself.
 *
 * The review wanted community to be a *distinct section* on Home, not a
 * footnote under the market and not a second copy of the trade feed. The
 * difference is what is in it:
 *
 *   nearby trade   things you can buy, hire or join (listing, service,
 *                  rental, available)
 *   dated rounds   things that happen at a time (scheduled, event)
 *   COMMUNITY      things people say and ask (post, community, wanted,
 *                  opportunity) — a notice, a question, a request for a
 *                  hand, a neighbourhood group
 *
 * Every row is a real record from the same feed Home already loaded, so this
 * section costs no extra request. A row shows what was said, who said it and
 * when — never a number the record does not carry.
 *
 * When the neighbourhood has said nothing, the section does not ship. An
 * empty rail is furniture; a silence with a heading on it is worse.
 */

const KIND_LABEL = {
  post: "Notice",
  community: "Group",
  wanted: "Request",
  opportunity: "Opportunity",
  collection: "Collection",
};

export default function CommunityShelf({ items = [], to = "/regions?filter=rounds" }) {
  if (!items.length) return null;

  return (
    <section aria-labelledby="community-heading" data-testid="community-shelf" className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="community-heading" className="ds-title">
          Around the neighbourhood
        </h2>
        <Link to={to} className="ds-action">
          See it all
          <ArrowUpRight size={13} aria-hidden="true" />
        </Link>
      </div>

      <ul className="space-y-2">
        {items.map((item) => {
          const label = KIND_LABEL[item.kind] || "From the neighbourhood";
          const time = item.created_at ? relativeTime(item.created_at) : null;
          const replies = item.counts?.reply ?? item.counts?.responses ?? null;
          return (
            <li key={`${item.kind}:${item.id}`}>
              <Link
                to={item.to || "#"}
                data-testid="community-row"
                className="ds-card ds-card-interactive ds-focus ds-tap-row px-3 py-2.5"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-3">
                  {item.kind === "community" ? (
                    <Users size={15} aria-hidden="true" />
                  ) : (
                    <MessageSquare size={15} aria-hidden="true" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink-1">
                    {item.title || item.summary || label}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-ink-4">
                    <span className="font-semibold text-ink-3">{label}</span>
                    {item.location && <span className="truncate">{item.location}</span>}
                    {time && <span>{time}</span>}
                    {replies != null && (
                      <span className="tabular-nums">
                        {replies} {replies === 1 ? "reply" : "replies"}
                      </span>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
