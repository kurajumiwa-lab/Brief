import { useMemo } from "react";
import { Award, CheckCircle2, ShieldCheck, Users } from "lucide-react";
import Avatar from "@/components/Avatar.jsx";
import PostCard from "@/components/PostCard.jsx";
import { useApp } from "@/store/appStore.js";
import { reputationFor } from "@/lib/reputation.js";
import { feedEntries, userById } from "@/lib/selectors.js";
import { count, percent } from "@/lib/format.js";
import { RANKING } from "@/lib/ranking.js";

/**
 * PROFILE AND REPUTATION — contribution, counted, defined, and checkable.
 *
 * There is deliberately no follower count and no "engagement". The four numbers
 * here answer one question — has this person been useful to a community, and
 * has it been fair? — and each one is spelled out underneath in words.
 */
export default function ProfilePage() {
  const state = useApp();
  const viewer = userById(state, state.viewerId);
  const reputation = useMemo(() => reputationFor(state.viewerId, { posts: state.posts }), [state]);
  const mine = useMemo(
    () => feedEntries(state).filter((entry) => entry.post.authorId === state.viewerId),
    [state]
  );

  return (
    <>
      <section className="card card--pad" style={{ marginTop: 18 }}>
        <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
          <Avatar name={viewer?.name} id={viewer?.id || ""} size="lg" gold />
          <div className="grow">
            <h1 className="title-md">{viewer?.name}</h1>
            <div className="micro muted">
              @{viewer?.handle} · {viewer?.city} · joined {new Date(viewer?.joined).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
            </div>
            <div className="row" style={{ gap: 6, marginTop: 8 }}>
              <span className={`chip ${reputation.standing === "trusted" ? "chip--gold" : reputation.standing === "member" ? "chip--green" : "chip--quiet"}`}>
                <Award size={11} aria-hidden="true" />
                {reputation.label}
              </span>
              <span className="chip chip--quiet">
                <Users size={11} aria-hidden="true" />
                {count(state.memberships.length, "circle", "circles")}
              </span>
            </div>
          </div>
        </div>

        <p className="tiny muted" style={{ marginTop: 12, lineHeight: 1.55 }}>
          {reputation.note} There is no follower count on Caesar: a person is measured by what the communities they
          post in decided about their posts, not by how many people tapped follow.
        </p>
      </section>

      <div className="stat-grid" style={{ marginTop: 12 }}>
        <Stat value={reputation.posts} label="Posts written" />
        <Stat value={reputation.useful} label="Useful to a community" />
        <Stat value={percent(reputation.usefulRate)} label="Hit rate" />
        <Stat value={reputation.upheldReports} label="Upheld reports" tone={reputation.upheldReports ? "terra" : undefined} />
      </div>

      <section className="card card--pad" style={{ marginTop: 12 }}>
        <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
          <CheckCircle2 size={16} aria-hidden="true" style={{ marginTop: 2, color: "var(--green-600)", flex: "none" }} />
          <div>
            <div className="title-sm">What "useful" means here</div>
            <p className="tiny muted" style={{ marginTop: 4, lineHeight: 1.55 }}>
              A post of yours counts as a useful contribution when at least 5 people reacted and the community's
              confidence in it reached {percent(0.6)}. Five people is the floor on purpose — one friend agreeing is
              not a contribution.
            </p>
          </div>
        </div>
        <hr className="hairline" style={{ margin: "12px 0" }} />
        <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
          <ShieldCheck size={16} aria-hidden="true" style={{ marginTop: 2, color: "var(--gold-700)", flex: "none" }} />
          <div>
            <div className="title-sm">Disagreement is not a black mark</div>
            <p className="tiny muted" style={{ marginTop: 4, lineHeight: 1.55 }}>
              Downvotes lower a post's reach. They never count against you personally, and they never appear on
              this page. Only an upheld moderation decision does — and that is a separate process, with a case
              number and a right of appeal.
            </p>
          </div>
        </div>
      </section>

      <div className="section-head">
        <div>
          <div className="eyebrow">Your posts</div>
          <h2 className="title-sm">{mine.length ? `${count(mine.length, "post")}, ranked as everyone sees them` : "Nothing yet"}</h2>
        </div>
      </div>

      <div className="stack">
        {mine.map((entry) => (
          <PostCard key={entry.post.id} entry={entry} />
        ))}
        {mine.length === 0 && (
          <div className="empty">
            <p style={{ fontSize: 13.5 }}>Your first post is how a circle learns what you know.</p>
          </div>
        )}
      </div>

      <p className="micro muted" style={{ margin: "16px 2px" }}>
        Ranking weights are published, not tuned in private: confidence {RANKING.weights.confidence * 100}% ·
        participation {RANKING.weights.participation * 100}% · recency {RANKING.weights.recency * 100}% · circle fit{" "}
        {RANKING.weights.circle * 100}%.
      </p>
    </>
  );
}

function Stat({ value, label, tone }) {
  return (
    <div className="stat">
      <div className="stat__value" style={tone === "terra" ? { color: "var(--terra-700)" } : undefined}>
        {value}
      </div>
      <div className="stat__label">{label}</div>
    </div>
  );
}
