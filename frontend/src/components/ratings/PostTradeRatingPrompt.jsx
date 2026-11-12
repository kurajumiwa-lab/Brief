import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { POST_TRADE_RATING_GATE_ENABLED } from "@/config/flags";
import { postTradeRatingAPI, apiError } from "@/lib/api";

/**
 * Notice shown with every rating prompt (Phase 7, PR 102). Wording on retention and on access or
 * correction requests is under legal review; this states only what the platform does today.
 */
function PrivacyNote() {
  return (
    <p className="text-2xs text-ink-3">
      Your rating is used to show how reliable a business is to other businesses on the platform.
      It does not move money.
    </p>
  );
}

/**
 * Rate one finished trade (Phase 7, PR 102). A client rates the supplier 1 to 5 stars. A supplier
 * records only a failed or fraudulent trade, about the client. Ratings measure exposure to the
 * market; they move no money. Renders nothing while the gate is off or when there is nothing to do.
 */
export default function PostTradeRatingPrompt({ kind, subjectId }) {
  const [st, setSt] = useState(null);
  const [stars, setStars] = useState(0);
  const [outcome, setOutcome] = useState("failed");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!POST_TRADE_RATING_GATE_ENABLED || !subjectId) return undefined;
    let alive = true;
    postTradeRatingAPI.status(kind, subjectId)
      .then(({ data }) => alive && setSt(data))
      .catch(() => {});
    return () => { alive = false; };
  }, [kind, subjectId]);

  if (!POST_TRADE_RATING_GATE_ENABLED || !st) return null;

  if (st.can_rate_as === null || st.can_rate_as === undefined) {
    if (st.final) return <p className="mt-2 text-xs text-ink-3">{st.rated_by_me ? "You have rated this trade." : "This trade is final."}</p>;
    return null;
  }

  const submit = async () => {
    setBusy(true);
    try {
      const body = st.can_rate_as === "client"
        ? { subject_kind: kind, subject_id: subjectId, outcome: "completed", stars }
        : { subject_kind: kind, subject_id: subjectId, outcome, note: note.trim() || null };
      await postTradeRatingAPI.record(body);
      toast.success("Thanks. This trade is now final.");
      setSt((s) => ({ ...s, final: true, rated_by_me: true, can_rate_as: null }));
    } catch (err) {
      toast.error(apiError(err, "Could not record this rating"));
    } finally {
      setBusy(false);
    }
  };

  if (st.can_rate_as === "client") {
    return (
      <div className="mt-3 space-y-2 rounded-xl bg-surface-2 p-3">
        <p className="text-xs font-semibold text-ink-1">Rate this completed trade</p>
        <div className="flex gap-1" role="radiogroup" aria-label="Stars">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={stars === n}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              onClick={() => setStars(n)}
              className="p-1"
            >
              <Star size={18} aria-hidden="true" className={n <= stars ? "fill-current text-accent-600" : "text-ink-4"} />
            </button>
          ))}
        </div>
        <PrivacyNote />
        <Button size="sm" variant="primary" disabled={!stars || busy} onClick={submit}>Submit rating</Button>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded-xl bg-surface-2 p-3">
      <p className="text-xs font-semibold text-ink-1">Record what went wrong</p>
      <label className="block text-2xs text-ink-3">
        Outcome
        <select
          className="mt-1 block w-full rounded-lg border border-edge-1 bg-surface-0 p-1.5 text-xs text-ink-1"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
        >
          <option value="failed">The trade failed</option>
          <option value="fraud">Fraud</option>
        </select>
      </label>
      <label className="block text-2xs text-ink-3">
        Note (optional)
        <textarea
          className="mt-1 block w-full rounded-lg border border-edge-1 bg-surface-0 p-1.5 text-xs text-ink-1"
          rows={2}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <PrivacyNote />
      <Button size="sm" variant="outline" disabled={busy} onClick={submit}>Record outcome</Button>
    </div>
  );
}
