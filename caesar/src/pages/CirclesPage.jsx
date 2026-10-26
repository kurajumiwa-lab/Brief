import { Link } from "react-router-dom";
import { Check, ChevronRight, Plus, Users } from "lucide-react";
import { useApp } from "@/store/appStore.js";
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
export default function CirclesPage() {
  const state = useApp();
  const t = makeT(state.preferences.locale);
  const joined = state.circles.filter((circle) => state.memberships.includes(circle.id));
  const discover = state.circles.filter((circle) => !state.memberships.includes(circle.id));

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
            <CircleCard key={circle.id} circle={circle} joined size={circleSize(state, circle)} />
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
            <CircleCard key={circle.id} circle={circle} size={circleSize(state, circle)} />
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

export function CircleCard({ circle, joined = false, size }) {
  const toggleJoin = useApp((state) => state.toggleJoin);
  const locale = useApp((state) => state.preferences.locale);
  const t = makeT(locale);

  return (
    <article className="circle">
      <div className="row" style={{ gap: 11 }}>
        <span className={`circle__mark ${circle.tone === "gold" ? "circle__mark--gold" : ""}`} aria-hidden="true">
          {circle.mark}
        </span>
        <div className="grow">
          <h3 className="title-sm">{circle.name}</h3>
          <div className="micro muted">
            {circle.place} · {count(size, "member")}
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
          onClick={() => toggleJoin(circle.id)}
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
