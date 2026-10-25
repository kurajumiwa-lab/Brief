import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Check, PenLine, ShieldCheck } from "lucide-react";
import PostCard from "@/components/PostCard.jsx";
import VerdictSheet from "@/components/VerdictSheet.jsx";
import { useApp } from "@/store/appStore.js";
import { circleById, circleEntries, circleSize } from "@/lib/selectors.js";
import { count } from "@/lib/format.js";

/**
 * ONE CIRCLE — its rules, its moderators, and its posts in the same open order
 * as the home feed. A circle is not a different product; it is the same one,
 * narrowed.
 */
export default function CirclePage() {
  const { circleId } = useParams();
  const state = useApp();
  const toggleJoin = useApp((store) => store.toggleJoin);
  const [verdict, setVerdict] = useState(null);

  const circle = circleById(state, circleId);
  const entries = useMemo(() => (circle ? circleEntries(state, circle.id) : []), [state, circle]);
  const joined = state.memberships.includes(circleId);

  if (!circle) {
    return (
      <div className="empty" style={{ marginTop: 24 }}>
        <p>That circle does not exist.</p>
        <Link to="/circles" className="btn btn--sm btn--ghost">
          Back to Circles
        </Link>
      </div>
    );
  }

  const reactions = entries.reduce((sum, entry) => sum + entry.verdict.participation, 0);

  return (
    <>
      <Link to="/circles" className="btn btn--quiet" style={{ marginLeft: -10, marginTop: 8 }}>
        <ArrowLeft size={14} aria-hidden="true" /> All circles
      </Link>

      <section className="card card--pad" style={{ marginTop: 6 }}>
        <div className="row" style={{ gap: 12 }}>
          <span className={`circle__mark ${circle.tone === "gold" ? "circle__mark--gold" : ""}`} aria-hidden="true">
            {circle.mark}
          </span>
          <div className="grow">
            <h1 className="title-md">{circle.name}</h1>
            <div className="micro muted">
              {circle.place} · {count(circleSize(state, circle), "member")} · {count(reactions, "reaction")}
            </div>
          </div>
          <button type="button" className={`btn btn--sm ${joined ? "btn--ghost" : "btn--gold"}`} onClick={() => toggleJoin(circle.id)} aria-pressed={joined}>
            {joined ? <Check size={14} aria-hidden="true" /> : null}
            {joined ? "Joined" : "Join"}
          </button>
        </div>

        <p className="tiny muted" style={{ marginTop: 12, lineHeight: 1.55 }}>
          {circle.about}
        </p>

        <div className="notice" style={{ marginTop: 12 }}>
          <ShieldCheck size={16} className="notice__icon" aria-hidden="true" />
          <span>
            <strong>Rules of this circle.</strong> {circle.rules} Moderators can remove a post that breaks these
            rules; they cannot remove one because it was disagreed with.
          </span>
        </div>
      </section>

      <div className="section-head">
        <div>
          <div className="eyebrow">In this circle</div>
          <h2 className="title-sm">
            {entries.length ? `${count(entries.length, "post")} · ranked by the community` : "Nothing posted yet"}
          </h2>
        </div>
        {joined && (
          <Link to="/compose" className="btn btn--sm btn--ghost">
            <PenLine size={13} aria-hidden="true" /> Post
          </Link>
        )}
      </div>

      <div className="stack">
        {entries.map((entry) => (
          <PostCard key={entry.post.id} entry={entry} onOpenVerdict={(item, intent) => setVerdict({ entry: item, intent })} />
        ))}
        {entries.length === 0 && (
          <div className="empty">
            <p style={{ fontSize: 13.5 }}>The first post here decides what this circle is for. Write it.</p>
          </div>
        )}
      </div>

      {verdict && <VerdictSheet entry={verdict.entry} intent={verdict.intent} onClose={() => setVerdict(null)} />}
    </>
  );
}
