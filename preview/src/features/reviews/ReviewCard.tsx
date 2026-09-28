import React, { useState } from 'react';
import {
  CheckCircle2,
  ThumbsUp,
  ThumbsDown,
  Flag,
  Share2,
  MessageCircle,
  ArrowRight
} from 'lucide-react';
import type { ProductReview, ReviewGalleryItem } from '../../api/reviewTypes';
import { Stars, MediaThumb, ReviewModal, reviewDate } from './shared';
import * as api from '../../api/briefApi';
export function ReviewCard({
  review: r,
  listingId,
  featured = false,
  full = false,
  onRefresh,
  onAuth,
  onMedia
}: {
  review: ProductReview;
  listingId: string;
  featured?: boolean;
  full?: boolean;
  onRefresh: () => void;
  onAuth: () => void;
  onMedia: (m: ReviewGalleryItem) => void;
}) {
  const [expanded, setExpanded] = useState(featured || full),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [report, setReport] = useState(false),
    [reason, setReason] = useState('spam'),
    [note, setNote] = useState(''),
    [reply, setReply] = useState(false),
    [response, setResponse] = useState(r.response?.body || ''),
    [remove, setRemove] = useState(false),
    [shareUrl, setShareUrl] = useState('');
  const vote = async (value: 'yes' | 'no') => {
    if (!api.getSessionToken()) {
      onAuth();
      return;
    }
    if (busy) return;
    setBusy(true);
    setError('');
    const result = await api.voteProductReview(
      r.id,
      r.myVote === value ? null : value
    );
    setBusy(false);
    if (result.ok) onRefresh();
    else setError(result.error);
  };
  const share = async () => {
    const url = `${window.location.origin}/reviews/${encodeURIComponent(listingId)}?review=${encodeURIComponent(r.id)}#review-${r.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: r.title, url });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setMessage('Review link copied.');
      } else setShareUrl(url);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setShareUrl(url);
    }
  };
  return (
    <article
      className={`rv-review-card ${featured ? 'featured' : ''}`}
      id={featured ? `featured-${r.id}` : `review-${r.id}`}
    >
      <div className="rv-review-top">
        <Stars value={r.rating} />
        <time dateTime={r.createdAt}>{reviewDate(r.createdAt)}</time>
      </div>
      <h3>{r.title}</h3>
      <div className="rv-review-person">
        <span className="rv-avatar" aria-hidden="true">
          {r.name === 'Anonymous'
            ? 'A'
            : r.name
                .split(/\s+/)
                .slice(0, 2)
                .map((n) => n[0])
                .join('')
                .toUpperCase()}
        </span>
        <strong>{r.name}</strong>
        {r.verifiedPurchase ? (
          <span
            className="rv-verified"
            title="Linked to a settled payment on this reviewer’s Wairo order"
          >
            <CheckCircle2 size={12} />
            Verified purchase
          </span>
        ) : (
          <small>Purchase not verified</small>
        )}
      </div>
      {r.incentivized && (
        <p className="rv-incentive">
          Incentivized review · disclosed by reviewer
        </p>
      )}
      {(r.size || r.color) && (
        <p className="rv-variant">
          {r.size && `Size: ${r.size}`}
          {r.size && r.color ? ' · ' : ''}
          {r.color && `Color / variant: ${r.color}`}
          <small>Reviewer-stated details</small>
        </p>
      )}
      <p className="rv-review-body">
        {expanded || r.body.length <= 420 ? r.body : r.body.slice(0, 420) + '…'}
      </p>
      {r.body.length > 420 && !featured && !full && (
        <button
          className="rv-read-more"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}
      {(r.pros.length > 0 || r.cons.length > 0) && (
        <div className="rv-review-points">
          {r.pros.length > 0 && (
            <p>
              <b>Liked</b> {r.pros.join(' · ')}
            </p>
          )}
          {r.cons.length > 0 && (
            <p>
              <b>Could improve</b> {r.cons.join(' · ')}
            </p>
          )}
        </div>
      )}
      {r.media.length > 0 && (
        <div className="rv-card-media">
          {r.media.map((m) => (
            <MediaThumb
              key={m.id}
              media={m}
              onClick={() =>
                onMedia({
                  ...m,
                  reviewId: r.id,
                  name: r.name,
                  title: r.title,
                  rating: r.rating,
                  body: r.body
                })
              }
            />
          ))}
        </div>
      )}
      {r.response && (
        <div className="rv-seller-response">
          <div>
            <MessageCircle size={16} />
            <strong>{r.response.seller}</strong>
            <span className="rv-verified">
              <CheckCircle2 size={12} />
              Verified seller
            </span>
          </div>
          <p>{r.response.body}</p>
          <time dateTime={r.response.at}>{reviewDate(r.response.at)}</time>
        </div>
      )}
      <div className="rv-review-actions">
        <span>Was this helpful?</span>
        <div className="rv-votes">
          <button
            aria-label={`Helpful: Yes (${r.helpful})`}
            aria-pressed={r.myVote === 'yes'}
            disabled={busy || r.isMine || r.canRespond}
            onClick={() => void vote('yes')}
          >
            <ThumbsUp size={14} />
            Yes <b>{r.helpful}</b>
          </button>
          <button
            aria-label={`Helpful: No (${r.notHelpful})`}
            aria-pressed={r.myVote === 'no'}
            disabled={busy || r.isMine || r.canRespond}
            onClick={() => void vote('no')}
          >
            <ThumbsDown size={14} />
            No <b>{r.notHelpful}</b>
          </button>
        </div>
        <button
          className="rv-icon-btn"
          aria-label="Report review"
          onClick={() => {
            if (!api.getSessionToken()) onAuth();
            else setReport(true);
          }}
        >
          <Flag size={14} />
        </button>
        <button
          className="rv-icon-btn"
          aria-label="Share review"
          onClick={() => void share()}
        >
          <Share2 size={14} />
        </button>
      </div>
      {featured && (
        <small className="rv-helpful-count">
          {r.helpful} {r.helpful === 1 ? 'person found' : 'people found'} this
          helpful
        </small>
      )}
      {r.canRespond && (
        <button className="rv-text-btn" onClick={() => setReply((v) => !v)}>
          {r.response ? 'Edit seller response' : 'Respond as the seller'}
          <ArrowRight size={13} />
        </button>
      )}
      {r.isMine && (
        <button className="rv-text-btn" onClick={() => setRemove(true)}>
          Remove my review
        </button>
      )}
      {reply && (
        <form
          className="rv-inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            const result = await api.respondProductReview(r.id, response);
            setBusy(false);
            if (result.ok) {
              setReply(false);
              onRefresh();
            } else setError(result.error);
          }}
        >
          <label>
            Official seller response
            <textarea
              required
              minLength={10}
              maxLength={2000}
              placeholder="Address the customer’s experience and offer a helpful next step. Keep private contact and order details out of your reply."
              value={response}
              onChange={(e) => setResponse(e.target.value)}
            />
          </label>
          <button className="rv-primary" disabled={busy}>
            Publish response
          </button>
        </form>
      )}
      {message && (
        <p className="rv-success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="rv-error" role="alert">
          {error}
        </p>
      )}
      {shareUrl && (
        <label className="rv-share-fallback">
          Copy this review link
          <input readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
        </label>
      )}
      {report && (
        <ReviewModal
          title="Report this review"
          onClose={() => {
            if (!busy) setReport(false);
          }}
        >
          <p className="rv-subtle">
            Reports are private and go to Wairo moderators. Disagreeing with an
            opinion is not a reason to remove it.
          </p>
          <form
            className="rv-inline-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              const result = await api.reportProductReview(r.id, reason, note);
              setBusy(false);
              if (result.ok) {
                setReport(false);
                setMessage(
                  'Report received. A moderator can review it; no removal is automatic.'
                );
              } else setError(result.error);
            }}
          >
            <label>
              Reason
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              >
                <option value="spam">Spam or promotion</option>
                <option value="abuse">Abuse or harassment</option>
                <option value="privacy">Personal information</option>
                <option value="irrelevant">Unrelated to the product</option>
                <option value="other">Other concern</option>
              </select>
            </label>
            <label>
              Details
              <textarea
                required
                minLength={10}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="rv-error">
                {error}
              </p>
            )}
            <button className="rv-primary" disabled={busy}>
              Send report
            </button>
          </form>
        </ReviewModal>
      )}
      {remove && (
        <ReviewModal
          title="Remove your review?"
          onClose={() => setRemove(false)}
        >
          <p>
            Your review and its media will disappear from the public review
            page. This does not cancel or refund your order.
          </p>
          <button
            className="rv-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const result = await api.withdrawProductReview(r.id);
              setBusy(false);
              if (result.ok) {
                setRemove(false);
                onRefresh();
              } else setError(result.error);
            }}
          >
            Remove review
          </button>
          {error && <p role="alert">{error}</p>}
        </ReviewModal>
      )}
    </article>
  );
}
