import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { PageSpinner } from "@/components/ui/Spinner";
import { trustAPI, apiError } from "@/lib/api";
import { countryName, scoreText, TIER_LABEL, POINTS_NOTE, errorText } from "./trustCore";

/**
 * One shop: its checked status, its rating, and its reviews. Anyone can read.
 * To rate, you need to be signed in. A till code is optional and makes the
 * review count for more.
 */
export default function TrustBranchPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [error, setError] = useState(null);
  const [rating, setRating] = useState(0);
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [formError, setFormError] = useState(null);

  const load = useCallback(() => {
    Promise.all([trustAPI.branch(id), trustAPI.reviews(id)])
      .then(([b, r]) => { setData(b.data); setReviews(r.data.reviews); setError(null); })
      .catch((err) => setError(apiError(err, "Could not load this shop")));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function submit(e) {
    e.preventDefault();
    if (!rating) { setFormError("Tap a star rating first."); return; }
    setSending(true);
    setFormError(null);
    setNeedsSignIn(false);
    try {
      const body = { rating };
      if (code.trim()) body.transaction_token = code.trim();
      const { data: out } = await trustAPI.review(id, body);
      setResult(out);
      setRating(0);
      setCode("");
      load();
    } catch (err) {
      if (err?.response?.status === 401) setNeedsSignIn(true);
      else setFormError(errorText(err, "Your rating could not be saved. Try again."));
    } finally {
      setSending(false);
    }
  }

  if (error) return <p role="alert" className="p-4 text-sm text-red-600">{error}</p>;
  if (!data) return <PageSpinner />;

  const { branch, reputation } = data;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
      <Link to="/trust" className="text-xs font-medium text-brand-700 underline">All checked shops</Link>

      <header className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Badge variant="brand">Checked by Brief</Badge>
          <Badge variant="gray">{countryName(branch.country_code)}</Badge>
        </div>
        <h1 className="text-xl font-semibold text-ink-1">{branch.branch_name}</h1>
        <p className="text-sm text-ink-3">{branch.address_text}</p>
        <p className="text-sm font-medium text-ink-1">{scoreText(reputation)}</p>
        {reputation.verified_review_count > 0 && (
          <p className="text-xs text-ink-3">
            {reputation.verified_review_count} from a real visit (till code used)
          </p>
        )}
      </header>

      <Card padding="p-4" className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-1">Rate this shop</h2>
        {result ? (
          <p role="status" className="text-sm text-ink-2">
            Thanks. Your rating is published and {result.points_earned} points were added.
          </p>
        ) : null}
        {needsSignIn ? (
          <p className="text-sm text-ink-2">
            <Link to="/auth" className="font-medium text-brand-700 underline">Sign in</Link> to rate this shop.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <fieldset className="space-y-1">
              <legend className="text-xs text-ink-3">How was your visit?</legend>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-label={`${n} star${n === 1 ? "" : "s"}`}
                    aria-pressed={rating === n}
                    onClick={() => setRating(n)}
                    className={`h-11 w-11 rounded-full border text-base ${rating >= n ? "border-amber-400 bg-amber-50 text-amber-600" : "border-edge-2 text-ink-3"}`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </fieldset>
            <Input
              label="Till code (optional)"
              placeholder="TKN-XXXX-XXXX-XXXX"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              hint="Ask the shop for a code from its till. It makes your rating count for more."
            />
            {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
            <Button type="submit" variant="primary" loading={sending}>Publish my rating</Button>
            <p className="text-xs text-ink-3">{POINTS_NOTE}</p>
          </form>
        )}
      </Card>

      <section aria-label="Reviews" className="space-y-2">
        <h2 className="text-sm font-semibold text-ink-1">Reviews</h2>
        {reviews.length === 0 && <p className="text-sm text-ink-4">No reviews yet. Be the first to rate this shop.</p>}
        {reviews.map((r) => (
          <Card key={r.id} padding="p-3" className="space-y-1">
            <p className="text-sm text-ink-1">{"★".repeat(r.rating)}<span className="text-ink-4">{"★".repeat(5 - r.rating)}</span></p>
            <p className="text-xs text-ink-3">{TIER_LABEL[r.evidence_tier] || "Not checked with a till code"}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}
