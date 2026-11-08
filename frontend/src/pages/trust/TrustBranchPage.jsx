import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import { PageSpinner } from "@/components/ui/Spinner";
import { trustAPI, apiError } from "@/lib/api";
import { t, useLang } from "@/lib/i18n";
import { checkedByText, countryName, TIER_BADGE, POINTS_NOTE, errorText } from "./trustCore";

/**
 * One checked shop: its rating breakdown and its reviews.
 * Anyone can read. Anyone can review with the till code from a purchase.
 * No account is needed: the review is tied to this device, not to a person.
 */

const STARS = [1, 2, 3, 4, 5];

function Stars({ value, label, onChange }) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-medium text-ink-2">{label}</legend>
      <div className="flex gap-2">
        {STARS.map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${label}: ${n} star${n === 1 ? "" : "s"}`}
            aria-pressed={value === n}
            onClick={() => onChange(n)}
            className={`h-11 w-11 rounded-full border text-base transition-colors ${
              value >= n ? "border-amber-400 bg-amber-50 text-amber-600" : "border-edge-2 text-ink-3 hover:bg-surface-2"
            }`}
          >
            ★
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function ScoreBar({ label, value }) {
  const pct = value == null ? 0 : Math.round((Number(value) / 5) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-ink-2">
        <span>{label}</span>
        <span className="tabular-nums">{value == null ? "No ratings yet" : `${Number(value).toFixed(1)} / 5`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-3" role="presentation">
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function TrustBranchPage() {
  const lang = useLang();
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [error, setError] = useState(null);
  const [overall, setOverall] = useState(0);
  const [service, setService] = useState(0);
  const [product, setProduct] = useState(0);
  const [code, setCode] = useState("");
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [formError, setFormError] = useState(null);

  const load = useCallback(() => {
    Promise.all([trustAPI.branch(id), trustAPI.reviews(id)])
      .then(([b, r]) => { setData(b.data); setReviews(r.data.reviews); setError(null); })
      .catch((err) => setError(apiError(err, "Could not load this shop")));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function submit(e) {
    e.preventDefault();
    setFormError(null);
    if (!code.trim()) { setFormError("Enter the till code from your receipt or from the shop."); return; }
    if (!service || !product || !overall) { setFormError("Tap a star rating for service, product and your overall experience."); return; }
    setSending(true);
    try {
      const { data: out } = await trustAPI.customerReview(id, {
        transaction_code: code.trim(),
        service_rating: service,
        product_rating: product,
        overall_rating: overall,
        comment: comment.trim() || undefined,
      });
      setResult(out);
      setCode(""); setComment(""); setOverall(0); setService(0); setProduct(0);
      load();
    } catch (err) {
      setFormError(errorText(err, "Your review could not be saved. Try again."));
    } finally {
      setSending(false);
    }
  }

  if (error) return <p role="alert" className="p-4 text-sm text-red-600">{error}</p>;
  if (!data) return <PageSpinner />;

  const { branch, reputation } = data;
  const verifiedCount = reputation.verified_review_count || 0;
  const unverifiedCount = Math.max(0, (reputation.review_count || 0) - verifiedCount);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
      <Link to="/trust" className="text-xs font-medium text-brand-700 underline">{t("shop.allShops", lang)}</Link>

      <Card padding="p-5" className="space-y-4 bg-gradient-to-br from-surface-0 to-brand-50">
        <div className="flex flex-wrap gap-2">
          <Badge variant="brand">{t("shop.checked", lang)}</Badge>
          <Badge variant="gray">{countryName(branch.country_code)}</Badge>
        </div>
        <h1 className="text-2xl font-semibold text-ink-1">{branch.branch_name}</h1>
        <p className="text-sm text-ink-3">{branch.address_text}</p>
        <p className="text-sm text-ink-2" data-testid="checked-by-text">{checkedByText(branch.verification_level, lang)}</p>
        {branch.delivery && (
          <div className="space-y-1" data-testid="delivery-line">
            <p className="text-sm text-ink-2">
              {t("delivery.shopLine", lang)}: {t("delivery.shopPickup", lang)}
              {branch.delivery.rider &&
                ` · ${t("delivery.shopRider", lang).replace("{area}", branch.delivery.rider.area)}: ${branch.delivery.rider.name}, ${branch.delivery.rider.phone}`}
            </p>
            {branch.delivery.rider && (
              <p className="text-xs text-ink-3">{t("delivery.notChecked", lang)} {t("delivery.feeNote", lang)}</p>
            )}
          </div>
        )}

        <div className="flex items-end gap-3">
          <p className="text-4xl font-semibold tabular-nums text-ink-1">
            {reputation.score == null ? "–" : Number(reputation.score).toFixed(1)}
          </p>
          <p className="pb-1 text-sm text-ink-2">
            {reputation.score == null
              ? "Not enough reviews yet"
              : `out of 5 · ${reputation.review_count} review${reputation.review_count === 1 ? "" : "s"}`}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <ScoreBar label="Service" value={reputation.service_average} />
          <ScoreBar label="Product" value={reputation.product_average} />
          <ScoreBar label="Overall" value={reputation.raw_average} />
        </div>

        <p className="text-xs text-ink-3">
          {verifiedCount} verified visit{verifiedCount === 1 ? "" : "s"} (till code used) · {unverifiedCount} not verified
        </p>
      </Card>

      <Card padding="p-4" className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-1">{t("shop.rateTitle", lang)}</h2>
        <p className="text-xs text-ink-3">
          {t("shop.rateIntro", lang)}
        </p>

        {result && (
          <p role="status" className="rounded-lg bg-surface-2 p-3 text-sm text-ink-1">{result.message}</p>
        )}

        <form onSubmit={submit} className="space-y-4">
          <Input
            label={t("shop.tillLabel", lang)}
            placeholder="TKN-XXXX-XXXX-XXXX"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            hint={t("shop.tillHint", lang)}
          />
          <Stars label={t("shop.service", lang)} value={service} onChange={setService} />
          <Stars label={t("shop.product", lang)} value={product} onChange={setProduct} />
          <Stars label={t("shop.overall", lang)} value={overall} onChange={setOverall} />
          <Textarea
            label="Comment (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={500}
            rows={3}
          />
          {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
          <Button type="submit" variant="primary" loading={sending}>{t("shop.publish", lang)}</Button>
          <p className="text-xs text-ink-3">{POINTS_NOTE}</p>
        </form>
        <p className="text-xs text-ink-3">
          Reviews are checked when they look unusual. Checked reviews appear here once approved.{" "}
          <Link to="/trust/my-reviews" className="font-medium text-brand-700 underline">See my reviews</Link>
        </p>
      </Card>

      <section aria-label="Reviews" className="space-y-2">
        <h2 className="text-sm font-semibold text-ink-1">Reviews</h2>
        {reviews.length === 0 && <p className="text-sm text-ink-4">No published reviews yet. Be the first to rate this shop.</p>}
        {reviews.map((r) => (
          <Card key={r.id} padding="p-3" className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={TIER_BADGE[r.evidence_tier] || "gray"}>
                {r.evidence_tier === "confirmed_token" ? "Verified visit" : "Not verified"}
              </Badge>
              <span className="text-xs text-ink-3">{r.reviewer}</span>
            </div>
            <p className="text-sm text-ink-1">
              <span className="text-amber-600">{"★".repeat(r.overall)}</span>
              <span className="text-ink-4">{"★".repeat(5 - r.overall)}</span>
              <span className="ml-2 text-xs text-ink-3">
                {r.service != null && `Service ${r.service}/5`}
                {r.service != null && r.product != null && " · "}
                {r.product != null && `Product ${r.product}/5`}
              </span>
            </p>
            {r.comment && <p className="text-sm text-ink-2">{r.comment}</p>}
          </Card>
        ))}
      </section>
    </div>
  );
}
