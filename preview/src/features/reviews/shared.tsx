import React, { useEffect, useRef, useState } from 'react';
import { Package, Star, Play, X, ArrowLeft, ArrowRight } from 'lucide-react';
import * as api from '../../api/briefApi';
import type {
  ReviewGalleryItem,
  ReviewMedia,
  ReviewProduct
} from '../../api/reviewTypes';
export const reviewDate = (at: string) =>
  new Intl.DateTimeFormat('en-KE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(new Date(at));
export const reviewMoney = (p: ReviewProduct) =>
  `${p.currency} ${p.price.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
export function Stars({ value, size = 15 }: { value: number; size?: number }) {
  return (
    <span
      className="rv-stars"
      role="img"
      aria-label={`${value} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className="rv-star-part"
          style={{ width: size, height: size }}
          aria-hidden="true"
        >
          <Star size={size} />
          <span
            style={{
              width: `${Math.max(0, Math.min(1, value - n + 1)) * 100}%`
            }}
          >
            <Star size={size} fill="currentColor" />
          </span>
        </span>
      ))}
    </span>
  );
}
export function ProductImage({
  src,
  name
}: {
  src: string | null;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="rv-product-image">
      {src && !failed && /^(https?:\/\/|\/api\/)/.test(src) ? (
        <img
          src={api.mediaFileUrl(src)}
          alt={name}
          onError={() => setFailed(true)}
        />
      ) : (
        <Package size={32} aria-label="No product photo" />
      )}
    </span>
  );
}
export function MediaThumb({
  media,
  onClick
}: {
  media: ReviewMedia;
  onClick: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      className="rv-media-thumb"
      onClick={onClick}
      aria-label={`Open customer ${media.kind === 'video' ? 'video' : 'photo'}`}
      type="button"
    >
      {media.kind === 'video' ? (
        <>
          <Play size={25} />
          <small>Video review</small>
        </>
      ) : failed ? (
        <small>Photo unavailable</small>
      ) : (
        <img
          loading="lazy"
          src={api.mediaFileUrl(media.url)}
          alt={media.alt}
          onError={() => setFailed(true)}
        />
      )}
    </button>
  );
}
export function ReviewModal({
  title,
  onClose,
  children,
  wide = false
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      prior?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`rv-modal ${wide ? 'wide' : ''}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        closeRef.current();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeRef.current();
      }}
    >
      <div className="rv-modal-top">
        <h2>{title}</h2>
        <button aria-label="Close dialog" type="button" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function ReviewGallery({
  listingId,
  initial,
  onClose
}: {
  listingId: string;
  initial: ReviewGalleryItem | null;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1),
    [data, setData] = useState<{
      items: ReviewGalleryItem[];
      pages: number;
      total: number;
    } | null>(null),
    [selected, setSelected] = useState<ReviewGalleryItem | null>(initial),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setLoading(true);
    api.getReviewGallery(listingId, page).then((r) => {
      if (!live) return;
      setLoading(false);
      if (r.ok) {
        setData(r.data);
        setError('');
      } else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [listingId, page]);
  useEffect(() => setFailed(false), [selected?.id]);
  return (
    <ReviewModal title="Through customers’ eyes" wide onClose={onClose}>
      {error && (
        <p role="alert" className="rv-error">
          {error}
        </p>
      )}
      {selected ? (
        <>
          <button className="rv-text-btn" onClick={() => setSelected(null)}>
            <ArrowLeft size={15} /> All customer media
          </button>
          <div className="rv-lightbox">
            <div className="rv-media-large">
              {failed ? (
                <p>
                  This file could not be displayed. It may be missing or
                  unsupported by your browser.
                </p>
              ) : selected.kind === 'video' ? (
                <video
                  key={selected.id}
                  controls
                  playsInline
                  preload="metadata"
                  src={api.mediaFileUrl(selected.url)}
                  onError={() => setFailed(true)}
                />
              ) : (
                <img
                  src={api.mediaFileUrl(selected.url)}
                  alt={selected.alt}
                  onError={() => setFailed(true)}
                />
              )}
            </div>
            <aside>
              <Stars value={selected.rating} />
              <h3>{selected.title}</h3>
              <p>By {selected.name}</p>
              <p>
                {selected.body}
                {selected.body.length >= 400 ? '…' : ''}
              </p>
              <a
                href={`/reviews/${encodeURIComponent(listingId)}?review=${encodeURIComponent(selected.reviewId)}#review-${selected.reviewId}`}
              >
                Read this review <ArrowRight size={14} />
              </a>
            </aside>
          </div>
        </>
      ) : (
        <>
          {loading ? (
            <p role="status">Loading customer media…</p>
          ) : (
            <>
              <div className="rv-gallery-all">
                {data?.items.map((m) => (
                  <MediaThumb
                    key={`${m.reviewId}-${m.id}`}
                    media={m}
                    onClick={() => setSelected(m)}
                  />
                ))}
              </div>
              {data?.total === 0 && <p>No customer media yet.</p>}
              <div className="rv-pagination">
                <button
                  disabled={page === 1}
                  onClick={() => setPage((n) => n - 1)}
                >
                  Previous
                </button>
                <span>
                  Page {page} of {data?.pages || 1} · {data?.total || 0} files
                </span>
                <button
                  disabled={page >= (data?.pages || 1)}
                  onClick={() => setPage((n) => n + 1)}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </>
      )}
    </ReviewModal>
  );
}
export function ProductTile({ product }: { product: ReviewProduct }) {
  return (
    <a
      className="rv-product-tile"
      href={`/reviews/${encodeURIComponent(product.id)}`}
    >
      <ProductImage src={product.image} name={product.name} />
      <small>{product.category}</small>
      <h3>{product.name}</h3>
      <strong>{reviewMoney(product)}</strong>
      <span>
        {product.summary.average !== null ? (
          <>
            <Stars value={product.summary.average} />
            <b>{product.summary.average.toFixed(1)}</b>
            <small>({product.summary.count})</small>
          </>
        ) : (
          <small>No reviews yet</small>
        )}
      </span>
    </a>
  );
}
