import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronRight, Plus, Users } from "lucide-react";
import { useApp } from "@/store/appStore.js";
import { useSession } from "@/store/session.js";
import { useLive } from "@/store/live.js";
import { circleSize } from "@/lib/selectors.js";
import { count } from "@/lib/format.js";
import { makeT } from "@/lib/i18n.js";

/**
 * CIRCLES — the unit of community.
 *
 * Every circle states its rules *before* the join button, because a rule you
 * only meet after being punished is not a rule, it is a trap. The prototype
 * has six; the real thing would open this list by neighbourhood first.
 */
/**
 * The server's circle row, in this card's vocabulary.
 *
 * A group on Brief is not a Caesar circle: it has a slug and a rule list rather
 * than a hand-written mark. Renaming here rather than in six components keeps
 * the difference in one place, and nothing is invented — a missing description
 * says it is missing.
 */
function shapeLiveCircle(circle) {
  return {
    id: circle.id,
    name: circle.name,
    place: circle.region || "Online",
    about: circle.description || "No description written yet.",
    rules:
      (circle.rules || []).length > 0
        ? circle.rules.join(" · ")
        : circle.is_public
          ? "Open to anyone. Post plainly and answer honestly."
          : "Approval only. A moderator adds people.",
    mark: circle.name.slice(0, 2).toUpperCase(),
    tone: circle.following ? "gold" : undefined,
    posts: circle.post_count,
    live: true,
  };
}

export default function CirclesPage() {
  const state = useApp();
  const t = makeT(state.preferences.locale);
  const mode = useSession((store) => store.mode);
  const liveCircles = useLive((store) => store.circles);
  const live = mode === "live";

  useEffect(() => {
    if (live && !useLive.getState().circles.length) useLive.getState().loadCircles();
  }, [live]);

  const circles = useMemo(
    () => (live ? liveCircles.map(shapeLiveCircle) : state.circles),
    [live, liveCircles, state.circles]
  );
  const memberships = useMemo(
    () => (live ? liveCircles.filter((circle) => circle.following).map((circle) => circle.id) : state.memberships),
    [live, liveCircles, state.memberships]
  );

  const joined = circles.filter((circle) => memberships.includes(circle.id));
  const discover = circles.filter((circle) => !memberships.includes(circle.id));

  return (
    <>
      <div className="section-head" style={{ marginTop: 18 }}>
        <div>
          <div className="eyebrow">Communities</div>
          <h1 className="title-lg">{t("circles.title")}</h1>
          <p className="muted" style={{ fontSize: 13, marginTop: 4, maxWidth: "52ch" }}>
            {t("circles.subtitle")}
          </p>
        </div>
      </div>

      <section>
        <div className="section-head">
          <div className="eyebrow">Your circles · {joined.length}</div>
          <span className="micro muted">{count(joined.length, "community", "communities")}</span>
        </div>
        <div className="circle-grid">
          {joined.map((circle) => (
            <CircleCard key={circle.id} circle={circle} joined size={live ? circle.posts : circleSize(state, circle)} unit={live ? "post" : "member"} />
          ))}
          {joined.length === 0 && (
            <div className="empty">
              <Users size={20} aria-hidden="true" />
              <p style={{ fontSize: 13.5 }}>You have not joined a circle yet. Everything below is open.</p>
            </div>
          )}
        </div>
      </section>

      <section style={{ marginTop: 8 }}>
        <div className="section-head">
          <div className="eyebrow">Discover</div>
          <span className="micro muted">Rules are shown before you join</span>
        </div>
        <div className="circle-grid">
          {discover.map((circle) => (
            <CircleCard key={circle.id} circle={circle} size={live ? circle.posts : circleSize(state, circle)} unit={live ? "post" : "member"} />
          ))}
        </div>
      </section>

      <div className="notice" style={{ marginTop: 18 }}>
        <Plus size={16} className="notice__icon" aria-hidden="true" />
        <span>
          Any member can start a circle. It opens with its rules written down, two moderators named, and a first
          post that says what the circle is for — not an empty room with a name.
        </span>
      </div>
    </>
  );
}

export function CircleCard({ circle, joined = false, size, unit = "member" }) {
  const toggleJoin = useApp((state) => state.toggleJoin);
  const locale = useApp((state) => state.preferences.locale);
  const mode = useSession((state) => state.mode);
  const t = makeT(locale);
  const join = () => (mode === "live" ? useLive.getState().toggleFollow(circle.id) : toggleJoin(circle.id));

  return (
    <article className="circle">
      <div className="row" style={{ gap: 11 }}>
        <span className={`circle__mark ${circle.tone === "gold" ? "circle__mark--gold" : ""}`} aria-hidden="true">
          {circle.mark}
        </span>
        <div className="grow">
          <h3 className="title-sm">{circle.name}</h3>
          <div className="micro muted">
            {circle.place} · {count(size, unit)}
          </div>
        </div>
      </div>

      <p className="tiny muted" style={{ lineHeight: 1.5 }}>
        {circle.about}
      </p>

      <p className="circle__rules">{circle.rules}</p>

      <div className="row" style={{ gap: 8, marginTop: 2 }}>
        <button
          type="button"
          className={`btn btn--sm ${joined ? "btn--ghost" : "btn--gold"}`}
          onClick={join}
          aria-pressed={joined}
        >
          {joined ? <Check size={14} aria-hidden="true" /> : null}
          {joined ? t("action.joined") : t("action.join")}
        </button>
        <Link to={`/circles/${circle.id}`} className="btn btn--sm btn--quiet" style={{ marginLeft: "auto" }}>
          Open
          <ChevronRight size={13} aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}
