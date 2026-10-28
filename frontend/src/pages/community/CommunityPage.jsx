import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, MessageSquarePlus, RefreshCw, ShieldCheck, Users } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Skeleton from "@/components/ui/Skeleton";
import PostCard from "@/components/community/PostCard";
import Composer from "@/components/community/Composer";
import SafetyPanel from "@/components/community/SafetyPanel";
import { useCommunityStore } from "@/stores/communityStore";
import { cn } from "@/lib/utils";

/**
 * COMMUNITY — Caesar, inside Brief.
 *
 * This is the screen that makes the social layer real: same session, same
 * phone, one tap from Home. Everything it shows comes from `/api/social/*`,
 * which ranks against the database rather than a seeded client array.
 *
 * Two things the screen is careful about:
 *
 *   · **A reader is not asked to be a business.** If the session is a vendor,
 *     the header says so; if it is a plain account, the header says that. Both
 *     can post.
 *   · **The feed degrades honestly.** A failed load names the reason, offers
 *     Retry, and — if posts were already on screen — keeps them and says they
 *     are the last ones read. It never blanks.
 */

const FILTERS = [
  { value: "", label: "Everything" },
  { value: "following", label: "My circles" },
];

export default function CommunityPage() {
  const identity = useCommunityStore((state) => state.identity);
  const identityError = useCommunityStore((state) => state.identityError);
  const circles = useCommunityStore((state) => state.circles);
  const feed = useCommunityStore((state) => state.feed);
  const status = useCommunityStore((state) => state.status);
  const error = useCommunityStore((state) => state.error);
  const reason = useCommunityStore((state) => state.reason);
  const retryable = useCommunityStore((state) => state.retryable);
  const stale = useCommunityStore((state) => state.stale);
  const at = useCommunityStore((state) => state.at);
  const load = useCommunityStore((state) => state.load);

  const [filter, setFilter] = useState("");
  const [composing, setComposing] = useState(false);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const accountId = identity?.account?.id;

  const circleName = (id) => {
    const found = circles.find((circle) => circle.id === id);
    return found?.name || "";
  };

  const shown = filter === "following"
    ? feed.filter((entry) => circles.find((circle) => circle.id === entry.post.circle_id)?.following)
    : feed;

  const loading = status === "loading" && feed.length === 0;
  const failed = status === "error";

  return (
    <div className="space-y-4 pb-8">
      <header className="flex items-center gap-2">
        <Link
          to="/"
          className="rounded-lg p-2 text-ink-3 hover:bg-surface-2 hover:text-ink-1"
          aria-label="Back to Home"
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-extrabold tracking-tight text-ink-1">Community</h1>
          <p className="text-2xs text-ink-3">
            {identity?.linked_to_vendor
              ? `Posting as ${identity.account.display_name} — your shop stays separate from what you say here.`
              : identity
                ? `Posting as ${identity.account.display_name}. No business needed.`
                : "Conversation alongside commerce."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSafetyOpen((open) => !open)}
          className="rounded-lg p-2 text-ink-3 hover:bg-surface-2 hover:text-ink-1"
          aria-label="Your safety settings"
          aria-expanded={safetyOpen}
        >
          <ShieldCheck size={18} aria-hidden="true" />
        </button>
      </header>

      {safetyOpen && <SafetyPanel onClose={() => setSafetyOpen(false)} />}

      {identityError && !identity && (
        <p className="rounded-xl bg-surface-1 px-3 py-2 text-2xs text-ink-3">
          We couldn't confirm your community identity yet. {identityError}
        </p>
      )}

      {/* Circles: the smallest possible rail — name, size, follow. */}
      {circles.length > 0 && (
        <section aria-label="Circles" className="flex gap-2 overflow-x-auto pb-1">
          {circles.map((circle) => (
            <button
              key={circle.id}
              type="button"
              onClick={() =>
                circle.following
                  ? useCommunityStore.getState().unfollow(circle.id)
                  : useCommunityStore.getState().follow(circle.id)
              }
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-2xs font-semibold transition-colors",
                circle.following
                  ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                  : "border-edge-2 text-ink-3 hover:bg-surface-2 hover:text-ink-1"
              )}
              aria-pressed={circle.following}
            >
              <Users size={12} aria-hidden="true" />
              {circle.name}
              <span className="text-ink-4">{circle.post_count}</span>
            </button>
          ))}
        </section>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-2xs font-semibold transition-colors",
                filter === option.value ? "bg-surface-2 text-ink-1" : "text-ink-4 hover:text-ink-2"
              )}
              aria-pressed={filter === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
        <Button size="sm" variant="secondary" icon={MessageSquarePlus} onClick={() => setComposing((open) => !open)}>
          Say something
        </Button>
      </div>

      {composing && (
        <Composer
          circles={circles}
          onCancel={() => setComposing(false)}
          onDone={() => setComposing(false)}
        />
      )}

      {/* Status line: the one place that admits a stale or failed read. */}
      {(failed || stale) && (
        <p role="status" className="flex items-center gap-1.5 text-2xs text-ink-3" data-testid="community-status">
          <span className="h-2 w-2 rounded-full bg-accent-500" aria-hidden="true" />
          {stale ? "Couldn't refresh · showing the posts last read" : "Couldn't load the feed"}
        </p>
      )}

      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
      )}

      {failed && feed.length === 0 && (
        <ErrorState
          title={error || "The community didn't load"}
          description={reason}
          onRetry={retryable ? () => useCommunityStore.getState().retry() : undefined}
          retryLabel="Try again"
        />
      )}

      {!loading && !failed && shown.length === 0 && (
        <EmptyState
          icon={MessageSquarePlus}
          title={filter === "following" ? "Nothing from your circles yet" : "No posts yet"}
          description={
            filter === "following"
              ? "Follow a circle above, or post something of your own."
              : "Nobody has said anything yet. You could be the first — say what you're seeing in the market."
          }
          action={
            <Button size="sm" variant="secondary" onClick={() => setComposing(true)}>
              Write the first post
            </Button>
          }
        />
      )}

      {shown.length > 0 && (
        <section aria-label="Posts" className="space-y-3">
          {shown.map((entry) => (
            <PostCard
              key={entry.post.id}
              entry={entry}
              circleName={circleName(entry.post.circle_id)}
              myAccountId={accountId}
              busy={busy}
              onReact={async (postId, value) => {
                setBusy(true);
                try {
                  await useCommunityStore.getState().react(postId, value);
                } finally {
                  setBusy(false);
                }
              }}
              onReport={(postId, why) => useCommunityStore.getState().report(postId, why)}
              onBlock={(targetId) => useCommunityStore.getState().block(targetId)}
            />
          ))}
        </section>
      )}

      {failed && feed.length > 0 && retryable && (
        <Button
          size="sm"
          variant="secondary"
          icon={RefreshCw}
          className="w-full"
          onClick={() => useCommunityStore.getState().retry()}
        >
          Try again
        </Button>
      )}

      {at > 0 && (
        <p className="flex items-center justify-center gap-1 text-2xs text-ink-4">
          <Loader2 size={10} aria-hidden="true" className="opacity-0" />
          Ranked by the people here, not by who shouts loudest.
        </p>
      )}

      {identity?.account?.city && (
        <Badge variant="outline" size="xs">{identity.account.city}</Badge>
      )}
    </div>
  );
}
