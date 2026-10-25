import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Info, PenLine, WifiOff } from "lucide-react";
import PostCard from "@/components/PostCard.jsx";
import VerdictSheet from "@/components/VerdictSheet.jsx";
import { useApp } from "@/store/appStore.js";
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

  const entries = useMemo(() => feedEntries(state), [state]);

  const visible = useMemo(() => {
    if (filter === "mine") return entries.filter((entry) => state.memberships.includes(entry.post.circleId));
    if (filter === "contested") return entries.filter((entry) => entry.verdict.contested);
    return entries;
  }, [entries, filter, state.memberships]);

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
          {state.users.find((user) => user.id === state.viewerId)?.city || "Your network"} ·{" "}
          {count(stats.posts, "post")} · {count(stats.reactions, "reaction")}
        </div>
        <h1 className="hero__title" style={{ marginTop: 8 }}>
          Your community. Your voice. Your verdict.
        </h1>
        <p className="hero__body">
          Ordered by what people here found useful — not by who has the most followers, and not by who arrived
          first. {stats.contested > 0 && `${stats.contested} ${stats.contested === 1 ? "post is" : "posts are"} still being argued over, and stay in the feed.`}
        </p>
        <div className="hero__foot">
          <span className="chip" style={{ background: "rgba(255,248,231,0.12)", borderColor: "rgba(255,248,231,0.2)", color: "var(--ivory)" }}>
            {t("brand.tagline")}
          </span>
          <span className="chip" style={{ background: "transparent", borderColor: "rgba(255,248,231,0.24)", color: "rgba(255,248,231,0.8)" }}>
            No follower counts
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

      <div className="section-head">
        <div>
          <div className="eyebrow">{t("feed.title")}</div>
          <h2 className="title-md">{filter === "contested" ? "Still being argued" : filter === "mine" ? "From your circles" : "Across the network"}</h2>
        </div>
      </div>

      <div className="scroll-row" role="tablist" aria-label="Feed filter">
        {FILTERS.map((option) => {
          const active = filter === option.id;
          const total = option.id === "all" ? entries.length : option.id === "mine" ? entries.filter((e) => state.memberships.includes(e.post.circleId)).length : stats.contested;
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

        {visible.length === 0 && (
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
