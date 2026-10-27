import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Info, PenLine, RefreshCw, WifiOff } from "lucide-react";
import PostCard from "@/components/PostCard.jsx";
import VerdictSheet from "@/components/VerdictSheet.jsx";
import { useApp } from "@/store/appStore.js";
import { useSession } from "@/store/session.js";
import { useLive } from "@/store/live.js";
import { feedEntries } from "@/lib/selectors.js";
import { count } from "@/lib/format.js";
import { makeT } from "@/lib/i18n.js";

const FILTERS = [
  { id: "all", label: "Everything" },
  { id: "mine", label: "Your circles" },
  { id: "contested", label: "Contested" },
];

/**
 * HOME FEED — one screen, ranked in the open.
 *
 * The order is not "newest" and it is not "most liked". It is the score the
 * Verdict panel prints, and every card carries one line saying which part of
 * that score put it there. A feed you cannot interrogate is a feed you have to
 * trust on faith, and this product does not ask for faith.
 */
export default function FeedPage() {
  const state = useApp();
  const [filter, setFilter] = useState("all");
  const [verdict, setVerdict] = useState(null);
  const t = makeT(state.preferences.locale);

  const mode = useSession((store) => store.mode);
  const account = useSession((store) => store.account);
  const liveEntries = useLive((store) => store.entries);
  const liveCircles = useLive((store) => store.circles);
  const liveStatus = useLive((store) => store.status);
  const liveError = useLive((store) => store.error);
  const live = mode === "live";

  // Live mode reads the ranked feed the server computed; demo mode ranks the
  // seeded network in the browser. Both arrive as the same entry shape.
  const entries = useMemo(() => (live ? liveEntries : feedEntries(state)), [live, liveEntries, state]);

  const memberships = useMemo(
    () => (live ? liveCircles.filter((circle) => circle.following).map((circle) => circle.id) : state.memberships),
    [live, liveCircles, state.memberships]
  );

  useEffect(() => {
    if (!live) return;
    if (!useLive.getState().entries.length) useLive.getState().load();
    if (!useLive.getState().circles.length) useLive.getState().loadCircles();
  }, [live]);

  const visible = useMemo(() => {
    if (filter === "mine") return entries.filter((entry) => memberships.includes(entry.post.circleId));
    if (filter === "contested") return entries.filter((entry) => entry.verdict.contested);
    return entries;
  }, [entries, filter, memberships]);

  const stats = useMemo(() => {
    const reactions = entries.reduce((sum, entry) => sum + entry.verdict.participation, 0);
    const contested = entries.filter((entry) => entry.verdict.contested).length;
    return { posts: entries.length, reactions, contested };
  }, [entries]);

  return (
    <>
      <section className="hero">
        <span className="hero__glow" aria-hidden="true" />
        <div className="eyebrow" style={{ color: "rgba(255,248,231,0.66)" }}>
          {(live ? account?.city : state.users.find((user) => user.id === state.viewerId)?.city) || "Your network"} ·{" "}
          {count(stats.posts, "post")} · {count(stats.reactions, "reaction")}
        </div>
        <h1 className="hero__title" style={{ marginTop: 8 }}>
          Your community. Your voice. Your verdict.
        </h1>
        <p className="hero__body">
          Ordered by what people here found useful — not by who has the most followers, and not by who arrived
          first. {stats.contested > 0 && `${stats.contested} ${stats.contested === 1 ? "post is" : "posts are"} still being argued over, and stay in the feed.`}
        </p>
        <p className="hero__note">No emperors here. Caesar is the crowd.</p>
        <div className="hero__foot">
          <span className="chip" style={{ background: "rgba(255,248,231,0.12)", borderColor: "rgba(255,248,231,0.2)", color: "var(--ivory)" }}>
            {t("brand.tagline")}
          </span>
          <span className="chip" style={{ background: "transparent", borderColor: "rgba(255,248,231,0.24)", color: "rgba(255,248,231,0.8)" }}>
            No follower counts
          </span>
          {/* Which network this feed came from is not a footnote: one is real
              rows ranked on the server, the other is this device's demo. */}
          <span
            className="chip"
            data-testid="feed-source"
            style={{ background: "transparent", borderColor: "rgba(255,248,231,0.24)", color: "rgba(255,248,231,0.8)" }}
          >
            {live ? `Live · @${account?.handle || "member"}` : "Demo network"}
          </span>
        </div>
      </section>

      {state.preferences.offline && (
        <div className="notice notice--gold" style={{ marginTop: 14 }} data-testid="offline-banner">
          <WifiOff size={16} className="notice__icon" aria-hidden="true" />
          <span>
            <strong>You are offline.</strong> Reading works, and anything you do is saved on this device and sent
            when the connection returns. {state.queue.length > 0 && `${state.queue.length} waiting.`}
          </span>
        </div>
      )}

      <Link
        to="/compose"
        className="card card--pad row"
        style={{ marginTop: 14, gap: 11, textDecoration: "none" }}
      >
        <span className="avatar" aria-hidden="true" style={{ background: "var(--green-100)", color: "var(--green-700)" }}>
          <PenLine size={17} />
        </span>
        <span className="grow muted" style={{ fontSize: 13.5 }}>
          {t("feed.composer")}
        </span>
        <span className="btn btn--sm btn--gold">Write</span>
      </Link>

      {live && liveError && (
        <div className="notice notice--terra" style={{ marginTop: 14 }} data-testid="live-error" role="status">
          <Info size={16} className="notice__icon" aria-hidden="true" />
          <span className="grow">
            {liveError === "offline"
              ? "The network is unreachable from this device. Nothing you do is being sent."
              : liveError}
          </span>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => useLive.getState().load()}>
            <RefreshCw size={13} aria-hidden="true" /> Try again
          </button>
        </div>
      )}

      <div className="section-head">
        <div>
          <div className="eyebrow">{t("feed.title")}</div>
          <h2 className="title-md">{filter === "contested" ? "Still being argued" : filter === "mine" ? "From your circles" : "Across the network"}</h2>
        </div>
      </div>

      <div className="scroll-row" role="tablist" aria-label="Feed filter">
        {FILTERS.map((option) => {
          const active = filter === option.id;
          const total = option.id === "all" ? entries.length : option.id === "mine" ? entries.filter((e) => memberships.includes(e.post.circleId)).length : stats.contested;
          return (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`chip ${active ? "chip--green" : ""}`}
              style={{ height: 30, padding: "0 12px", cursor: "pointer" }}
              onClick={() => setFilter(option.id)}
            >
              {option.label} <span style={{ opacity: 0.7 }}>{total}</span>
            </button>
          );
        })}
      </div>

      <div className="stack" style={{ marginTop: 12 }}>
        {visible.map((entry) => (
          <PostCard key={entry.post.id} entry={entry} onOpenVerdict={(item, intent) => setVerdict({ entry: item, intent })} />
        ))}

        {live && liveStatus === "loading" && visible.length === 0 && (
          <div className="empty" data-testid="feed-loading">
            <RefreshCw size={18} aria-hidden="true" className="spin" />
            <p style={{ fontSize: 13.5 }}>Reading the ranked feed from the network…</p>
          </div>
        )}

        {visible.length === 0 && liveStatus !== "loading" && (
          <div className="empty">
            <Info size={20} aria-hidden="true" />
            <p style={{ fontSize: 13.5 }}>
              {filter === "contested"
                ? "Nothing is being argued about right now. That is also a result."
                : "No posts here yet. Join a circle and the conversation starts."}
            </p>
            <Link to="/circles" className="btn btn--sm btn--ghost">
              Browse circles
            </Link>
          </div>
        )}
      </div>

      <p className="micro muted" style={{ margin: "18px 2px 6px", lineHeight: 1.6 }}>
        Every card shows one line of its own reasoning. Tap it to see the four numbers that placed the post, the
        weight each reaction carried, and anything the system thinks looks coordinated.
      </p>

      {verdict && (
        <VerdictSheet entry={verdict.entry} intent={verdict.intent} onClose={() => setVerdict(null)} />
      )}
    </>
  );
}
