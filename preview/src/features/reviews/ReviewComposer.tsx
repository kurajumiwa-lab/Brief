import React, { useEffect, useRef, useState } from 'react';
import { Star, Upload, X, CheckCircle2 } from 'lucide-react';
import * as api from '../../api/briefApi';
import type {
  ReviewContext,
  ReviewInput,
  ReviewMedia,
  ReviewProduct
} from '../../api/reviewTypes';
import { reviewDate } from './shared';
const categories = [
  ['quality', 'Quality'],
  ['value', 'Value for money'],
  ['ease', 'Ease of use'],
  ['durability', 'Durability'],
  ['shipping', 'Shipping & packaging']
];
export function ReviewComposer({
  product,
  context,
  onDone
}: {
  product: ReviewProduct;
  context: ReviewContext;
  onDone: () => void;
}) {
  const [rating, setRating] = useState(0),
    [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [orderId, setOrderId] = useState(''),
    [recommend, setRecommend] = useState<boolean | null>(null),
    [pros, setPros] = useState(''),
    [cons, setCons] = useState(''),
    [size, setSize] = useState(''),
    [color, setColor] = useState(''),
    [anonymous, setAnonymous] = useState(false),
    [incentivized, setIncentivized] = useState(false),
    [consent, setConsent] = useState(false),
    [scores, setScores] = useState<Record<string, number>>({}),
    [media, setMedia] = useState<(ReviewMedia & { preview: string })[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false);
  const key = useRef(crypto.randomUUID()),
    urls = useRef<string[]>([]),
    live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      urls.current.forEach(URL.revokeObjectURL);
    };
  }, []);
  const attach = async (files: FileList | null) => {
    if (!files || uploading) return;
    if (files.length + media.length > 6) {
      setError('You can attach up to 6 files.');
      return;
    }
    setError('');
    setUploading(true);
    for (const file of Array.from(files)) {
      if (file.size > context.uploadLimit) {
        setError(
          `Each file must be under ${Math.round(context.uploadLimit / 1048576)} MB.`
        );
        break;
      }
      const result = await api.uploadReviewMedia(file);
      if (!live.current) return;
      if (!result.ok) {
        setError(result.error);
        break;
      }
      const preview = URL.createObjectURL(file);
      urls.current.push(preview);
      setMedia((previous) =>
        previous.some((m) => m.id === result.data.media.id)
          ? previous
          : [...previous, { ...result.data.media, preview }]
      );
    }
    if (live.current) setUploading(false);
  };
  if (context.isSeller)
    return (
      <p>
        You can respond to customer reviews, but cannot review your own product.
      </p>
    );
  if (context.myReview)
    return (
      <div className="rv-empty">
        <CheckCircle2 size={28} />
        <h3>You’ve shared your experience.</h3>
        <p>
          {context.myReview.status === 'published'
            ? 'Thank you. Your review is part of this product’s community feedback.'
            : 'Your review is not currently public.'}
        </p>
        {context.myReview.status === 'published' && (
          <a
            href={`?review=${context.myReview.id}#review-${context.myReview.id}`}
          >
            Read your review
          </a>
        )}
      </div>
    );
  return (
    <form
      className="rv-compose"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || uploading) return;
        setError('');
        if (!rating) {
          setError('Choose your star rating.');
          return;
        }
        if (recommend === null) {
          setError('Choose whether you would recommend this product.');
          return;
        }
        setBusy(true);
        const input: ReviewInput = {
          rating,
          title,
          body,
          orderId: orderId || null,
          categories: scores,
          uploadIds: media.map((m) => m.id),
          recommend,
          pros: pros.split(';').filter(Boolean),
          cons: cons.split(';').filter(Boolean),
          size,
          color,
          incentivized,
          anonymous,
          consent,
          key: key.current
        };
        const r = await api.submitProductReview(product.id, input);
        if (!live.current) return;
        setBusy(false);
        if (r.ok) onDone();
        else setError(r.error);
      }}
    >
      <p className="rv-subtle">
        A few honest details can help someone make the right choice.
      </p>
      <fieldset>
        <legend>Your overall rating *</legend>
        <div
          className="rv-star-picker"
          role="radiogroup"
          aria-label="Overall rating"
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n}>
              <input
                type="radio"
                name="overall-rating"
                value={n}
                checked={rating === n}
                onChange={() => setRating(n)}
                aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}
              />
              <Star size={31} fill={n <= rating ? 'currentColor' : 'none'} />
            </label>
          ))}
          <span>
            {rating
              ? [
                  '',
                  'Not for me',
                  'Could be better',
                  'It’s okay',
                  'Really good',
                  'Loved it'
                ][rating]
              : 'Choose 1–5 stars'}
          </span>
        </div>
      </fieldset>
      <div className="rv-order-proof">
        <label>
          Link a purchase
          <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            <option value="">Review without a verified purchase badge</option>
            {context.orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.id} · {reviewDate(o.date)} · Qty {o.quantity}
              </option>
            ))}
          </select>
        </label>
        <small>
          {context.orders.length
            ? 'Choose your settled Wairo order. The server checks product and account ownership.'
            : 'No settled purchase for this product was found on your account. You can still share an unverified review.'}{' '}
          A badge confirms a paid purchase—not delivery or the accuracy of an
          opinion.
        </small>
      </div>
      <label>
        Review title *
        <input
          required
          minLength={3}
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What should someone know?"
        />
      </label>
      <label>
        Your review *
        <textarea
          aria-label="Your review"
          aria-describedby="rv-review-length"
          required
          minLength={50}
          maxLength={5000}
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="How did it work for you? Share the details you wish you’d known."
        />
        <small id="rv-review-length">
          {body.trim().length}/5,000 characters · minimum 50
        </small>
      </label>
      <details>
        <summary>Rate the finer details (optional)</summary>
        <div className="rv-category-inputs">
          {categories
            .filter(
              ([id]) =>
                product.type === 'product' ||
                !['shipping', 'durability'].includes(id)
            )
            .map(([id, label]) => (
              <label key={id}>
                {label}
                <select
                  value={scores[id] || ''}
                  onChange={(e) =>
                    setScores((v) => {
                      const next = { ...v };
                      if (e.target.value) next[id] = Number(e.target.value);
                      else delete next[id];
                      return next;
                    })
                  }
                >
                  <option value="">Not rated</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} / 5
                    </option>
                  ))}
                </select>
              </label>
            ))}
        </div>
      </details>
      <div className="rv-form-pair">
        <label>
          What worked well?
          <input
            maxLength={240}
            value={pros}
            onChange={(e) => setPros(e.target.value)}
            placeholder="e.g. Sturdy; good size"
          />
          <small>Up to 3 points, separated by semicolons.</small>
        </label>
        <label>
          What could be better?
          <input
            maxLength={240}
            value={cons}
            onChange={(e) => setCons(e.target.value)}
            placeholder="e.g. Limited colors"
          />
        </label>
      </div>
      {product.type === 'product' && (
        <details>
          <summary>Size or color you tried (optional)</summary>
          <p className="rv-subtle">
            These details are reviewer-stated, not order-verified.
          </p>
          <div className="rv-form-pair">
            <label>
              Size
              <input
                maxLength={40}
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder="e.g. Medium"
              />
            </label>
            <label>
              Color / variant
              <input
                maxLength={40}
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="e.g. Natural"
              />
            </label>
          </div>
        </details>
      )}
      <div className="rv-upload">
        <label>
          <Upload size={19} />
          <strong>
            {uploading ? 'Uploading…' : 'Add your photos or a short video'}
          </strong>
          <span>JPEG, PNG, WebP, GIF, MP4 or WebM · up to 6 files</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"
            multiple
            disabled={busy || uploading || media.length >= 6}
            onChange={(e) => {
              void attach(e.target.files);
              e.target.value = '';
            }}
            aria-label="Upload review photos or videos"
          />
        </label>
        <small>
          Up to {Math.round(context.uploadLimit / 1048576)} MB each. Files use
          this deployment’s local storage and may not survive a redeploy. Avoid
          faces, addresses and personal information.
        </small>
        {media.length > 0 && (
          <div className="rv-upload-preview">
            {media.map((m) => (
              <div key={m.id}>
                {m.kind === 'image' ? (
                  <img src={m.preview} alt="Your upload" />
                ) : (
                  <video src={m.preview} controls preload="metadata" />
                )}
                <button
                  type="button"
                  disabled={busy || uploading}
                  aria-label="Remove attachment"
                  onClick={() =>
                    setMedia((v) => v.filter((x) => x.id !== m.id))
                  }
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <fieldset>
        <legend>Would you recommend it? *</legend>
        <div className="rv-choice">
          <label>
            <input
              type="radio"
              name="recommend"
              checked={recommend === true}
              onChange={() => setRecommend(true)}
            />
            Yes, I would
          </label>
          <label>
            <input
              type="radio"
              name="recommend"
              checked={recommend === false}
              onChange={() => setRecommend(false)}
            />
            Not this time
          </label>
        </div>
      </fieldset>
      <label className="rv-check">
        <input
          type="checkbox"
          checked={anonymous}
          onChange={(e) => setAnonymous(e.target.checked)}
        />
        Show my name as Anonymous
      </label>
      <label className="rv-check">
        <input
          type="checkbox"
          checked={incentivized}
          onChange={(e) => setIncentivized(e.target.checked)}
        />
        I received a free item, discount or other incentive for this review
      </label>
      <label className="rv-check">
        <input
          type="checkbox"
          required
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        I agree to the review guidelines and to publish my review, display name
        (unless anonymous), and attached media. This is my own experience.
      </label>
      {error && (
        <p className="rv-error" role="alert">
          {error}
        </p>
      )}
      <button className="rv-primary" disabled={busy || uploading}>
        {busy ? 'Publishing…' : 'Submit review'}
      </button>
      <small>Reviews never generate a payment, reward or refund.</small>
    </form>
  );
}
