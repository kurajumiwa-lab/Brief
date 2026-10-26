import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ShieldAlert, ThumbsDown, ThumbsUp, X } from "lucide-react";
import Avatar from "./Avatar.jsx";
import { useApp } from "@/store/appStore.js";
import { RANKING } from "@/lib/ranking.js";
import { circleById, isJoined } from "@/lib/selectors.js";
import { count, percent } from "@/lib/format.js";

const REASONS = [
  { id: "harassment", label: "Harassment or a personal attack" },
  { id: "hate", label: "Hate against a group of people" },
  { id: "misinformation", label: "A claim that could cause harm" },
  { id: "spam", label: "Spam or a scam" },
  { id: "other", label: "Something else" },
];

/**
 * THE VERDICT PANEL — the ranking, opened up.
 *
 * This screen exists because "the algorithm decided" is not an answer a
 * community can argue with. Every number here is the number that sorted the
 * feed: the same `computeVerdict` call, printed. If the panel and the ordering
 * ever disagreed, one of them would be lying, and this is the only way to make
 * that impossible.
 *
 * It also holds the two things that must never be confused with a downvote:
 * reporting (which opens a case) and blocking (which is yours alone).
 */
export default function VerdictSheet({ entry, intent, onClose }) {
  const { post, verdict, parts, score, raisedByFloor } = entry;
  const users = useApp((state) => state.users);
  const circles = useApp((state) => state.circles);
  const memberships = useApp((state) => state.memberships);
  const report = useApp((state) => state.report);
  const mute = useApp((state) => state.mute);
  const block = useApp((state) => state.block);
  const viewerId = useApp((state) => state.viewerId);

  const [reporting, setReporting] = useState(intent === "report");
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState(false);
  const closeRef = useRef(null);

  const author = users.find((user) => user.id === post.authorId);
  const circle = circleById({ circles }, post.circleId);
  const joined = isJoined({ memberships }, post.circleId);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);

    // A dialog opens with focus inside it and leaves the page behind it still.
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [onClose]);

  const submit = () => {
    if (!reason) return;
    report(post.id, reason);
    setSent(true);
    setReporting(false);
  };

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="verdict-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet__head">
          <div className="grow">
            <div className="eyebrow">The Balanced Verdict</div>
            <h2 id="verdict-title" className="title-sm">
              Why this post sits where it does
            </h2>
          </div>
          <button ref={closeRef} type="button" className="iconbtn" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="sheet__body">
          <div className="row" style={{ alignItems: "flex-start", gap: 10 }}>
            <Avatar name={author?.name} id={author?.id || ""} size="sm" />
            <div className="grow">
              <div className="post__name">
                {author?.name} <span className="post__handle">@{author?.handle}</span>
              </div>
              <div className="micro muted">
                {circle?.name}
                {!joined && " · you are not in this circle"}
              </div>
            </div>
          </div>

          <p style={{ fontSize: 13.5, lineHeight: 1.55 }}>{post.body.length > 240 ? `${post.body.slice(0, 240)}…` : post.body}</p>

          {/* ── the split, at full width ─────────────────────────────────── */}
          <section className="stack stack--tight">
            <div className="verdict" style={{ height: 12 }}>
              <span
                className="verdict__up"
                style={{ width: `${verdict.participation ? (verdict.up / verdict.participation) * 100 : 0}%` }}
              />
              <span className="verdict__down grow" />
            </div>
            <div className="legend">
              <span>
                <span className="swatch swatch--up" />
                <ThumbsUp size={11} aria-hidden="true" /> {count(verdict.up, "support")}
              </span>
              <span>
                <ThumbsDown size={11} aria-hidden="true" /> {count(verdict.down, "disagreement")}
                <span className="swatch swatch--down" />
              </span>
            </div>
          </section>

          {/* ── the score, in parts ──────────────────────────────────────── */}
          <section className="stack stack--tight">
            <div className="row row--between">
              <span className="eyebrow">The four parts</span>
              <span className="micro muted">weighted, then added</span>
            </div>

            <Meter
              label="Confidence"
              value={parts.confidence}
              weight={RANKING.weights.confidence}
              tone="gold"
              note={`${percent(verdict.confidence)} — a lower bound, so ${verdict.participation} reactions cannot claim certainty they do not have`}
            />
            <Meter
              label="Participation"
              value={parts.participation}
              weight={RANKING.weights.participation}
              note={`${verdict.weightedParticipation} weighted reactions, capped at ${RANKING.participationCap} so volume cannot drown judgement`}
            />
            <Meter
              label="Recency"
              value={parts.recency}
              weight={RANKING.weights.recency}
              note={`half-life of ${RANKING.halfLifeHours} hours — useful does not mean forever`}
            />
            <Meter
              label="Circle fit"
              value={parts.circle}
              weight={RANKING.weights.circle}
              tone="gold"
              note={joined ? "You are in this circle" : "Outside your circles — still shown, ranked lower"}
            />
          </section>

          <div className="card card--flat" style={{ padding: 14 }}>
            <div className="row row--between">
              <div>
                <div className="eyebrow">Ranking score</div>
                <div className="title-md mono" style={{ marginTop: 2 }}>
                  {score.toFixed(3)}
                </div>
              </div>
              <div className="micro muted" style={{ maxWidth: "52%", textAlign: "right", lineHeight: 1.5 }}>
                0.50 × confidence + 0.20 × participation + 0.15 × recency + 0.15 × circle fit
              </div>
            </div>
            {raisedByFloor && (
              <p className="tiny" style={{ marginTop: 10, color: "var(--terra-700)" }}>
                Held at the contested floor ({RANKING.contestedFloor}). This post would score lower, but a
                community that is still arguing keeps its place in the feed.
              </p>
            )}
          </div>

          {/* ── the two honest warnings ──────────────────────────────────── */}
          {verdict.contested && (
            <div className="notice notice--terra">
              <AlertTriangle size={16} className="notice__icon" aria-hidden="true" />
              <span>
                <strong>Contested.</strong> {percent(verdict.dissentShare)} of {verdict.participation} people
                disagree. The post stays in the feed, ranked lower and labelled — disagreement is not a reason to
                remove what someone said.
              </span>
            </div>
          )}

          {verdict.coordination.suspected && (
            <div className="notice notice--gold">
              <ShieldAlert size={16} className="notice__icon" aria-hidden="true" />
              <span>
                <strong>Coordinated activity.</strong> {verdict.coordination.count} of{" "}
                {verdict.coordination.total} reactions arrived within {RANKING.burstWindowMs / 1000} seconds, from
                accounts with almost no history. Those reactions count at half weight. Nobody is banned and nothing
                is deleted.
              </span>
            </div>
          )}

          {verdict.needsMoreVoices && (
            <div className="notice">
              <Check size={16} className="notice__icon" aria-hidden="true" />
              <span>
                <strong>Too new to call.</strong> Fewer than {RANKING.contestedMinReactions} reactions, so the
                rank stays low on purpose. A small sample should not decide what the network sees.
              </span>
            </div>
          )}

          <div className="notice notice--green">
            <ThumbsDown size={16} className="notice__icon" aria-hidden="true" />
            <span>
              A downvote lowers reach. It never reports, hides or deletes anything, and it never counts against
              the author's standing.
            </span>
          </div>

          {/* ── moderation, kept separate ────────────────────────────────── */}
          <hr className="hairline" />

          {sent ? (
            <div className="notice notice--green" data-testid="report-sent">
              <Check size={16} className="notice__icon" aria-hidden="true" />
              <span>
                Report received. It is in the Safety centre with a case number. The post stays visible until a
                moderator decides — a report is a question, not a verdict.
              </span>
            </div>
          ) : reporting ? (
            <section className="stack stack--tight">
              <div className="eyebrow">Report this post</div>
              <p className="tiny muted">
                Reports go to the circle's moderators. Only a moderator decision changes what everyone else sees.
              </p>
              <div className="stack stack--tight">
                {REASONS.map((option) => (
                  <label key={option.id} className="row" style={{ gap: 9, cursor: "pointer", fontSize: 13 }}>
                    <input
                      type="radio"
                      name="reason"
                      value={option.id}
                      checked={reason === option.id}
                      onChange={() => setReason(option.id)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn btn--sm" disabled={!reason} onClick={submit}>
                  Send report
                </button>
                <button type="button" className="btn btn--quiet" onClick={() => setReporting(false)}>
                  Cancel
                </button>
              </div>
            </section>
          ) : (
            <section className="stack stack--tight">
              <div className="eyebrow">If this breaks a rule</div>
              <div className="row row--wrap" style={{ gap: 8 }}>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setReporting(true)}>
                  <ShieldAlert size={14} aria-hidden="true" /> Report
                </button>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => mute(post.authorId)}>
                  Mute {author?.name?.split(" ")[0]}
                </button>
                {post.authorId !== viewerId && (
                  <button type="button" className="btn btn--sm btn--danger" onClick={() => block(post.authorId)}>
                    Block
                  </button>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Meter({ label, value, weight, note, tone }) {
  return (
    <div className="meter">
      <div className="meter__top">
        <span>
          {label} <span className="micro muted">× {weight}</span>
        </span>
        <span className="mono">{value.toFixed(2)}</span>
      </div>
      <div className="meter__track">
        <div className={`meter__fill ${tone === "gold" ? "meter__fill--gold" : ""}`} style={{ width: `${value * 100}%` }} />
      </div>
      <div className="micro muted">{note}</div>
    </div>
  );
}
