import { Link } from "react-router-dom";
import { ArrowRight, MessagesSquare, ShieldCheck, Users } from "lucide-react";

/**
 * THE WAY INTO THE COMMUNITY, FROM HOME.
 *
 * Deliberately static: this tile makes no request. Home is where a failure is
 * most expensive, and an entry point that can fail is an entry point that
 * sometimes isn't there. The screen behind it does its own loading, with its
 * own reason and its own retry.
 *
 * The claim on the tile is the whole design in one sentence: talking here does
 * not require a shop, and a shop does not buy standing in the conversation.
 */
export default function CommunityStrip() {
  return (
    <Link
      to="/community"
      data-testid="community-entry"
      className="group flex items-center gap-3 rounded-2xl border border-edge-1 bg-surface-0 p-3 transition-colors hover:border-edge-3 hover:bg-surface-1"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
        <MessagesSquare size={18} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-bold text-ink-1">
          Community
          <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-micro font-semibold text-ink-3">
            Caesar
          </span>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-ink-3">
          <span className="inline-flex items-center gap-1">
            <Users size={11} aria-hidden="true" /> Anyone can take part
          </span>
          <span className="inline-flex items-center gap-1">
            <ShieldCheck size={11} aria-hidden="true" /> Disagree, don't report
          </span>
        </span>
      </span>
      <ArrowRight
        size={16}
        aria-hidden="true"
        className="shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5 group-hover:text-ink-2"
      />
    </Link>
  );
}
