import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  MessageCircle,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  ThumbsUp,
  PenLine
} from 'lucide-react';
import * as api from '../../api/briefApi';
import { WairoMark } from '../../components/WairoMark';
import { SessionSignIn } from '../../components/SessionSignIn';
import type {
  ReviewCatalog,
  ReviewContext,
  ReviewGalleryItem,
  ReviewPage,
  ReviewReport,
  ReviewMedia
} from '../../api/reviewTypes';
import {
  MediaThumb,
  ProductImage,
  ProductTile,
  ReviewGallery,
  ReviewModal,
  Stars,
  reviewDate,
  reviewMoney
} from './shared';
import { ReviewCard } from './ReviewCard';
import { ReviewComposer } from './ReviewComposer';
import './reviews.css';

function Guidelines() {
  return (
    <section className="rv-guidelines" id="review-guidelines">
      <div>
        <ShieldCheck size={22} />
        <h2>A little honesty goes a long way.</h2>
      </div>
      <details>
        <summary>
          Our community review guidelines
          <ChevronDown size={17} />
        </summary>
        <p>
          Share your own experience with this product. Be respectful and
          specific. No spam, promotional links, harassment, personal information
          or reviews written for someone else. Sellers cannot review their own
          products. Critical reviews are welcome; reports are assessed by
          moderators, not removed automatically.
        </p>
      </details>
      <details>
        <summary>
          What makes a helpful review?
          <ChevronDown size={17} />
        </summary>
        <p>
          Say how you used the item, how long you have had it, what worked and
          what could be better. Explain your rating. Give the size or variant if
          relevant; these details are reviewer-stated. Verified purchase means a
          settled payment exists for this product on the reviewer’s account. It
          is not an endorsement of the opinion.
        </p>
      </details>
      <details>
        <summary>
          Tips for photos and videos
          <ChevronDown size={17} />
        </summary>
        <p>
          Use your own clear, well-lit photos or a short MP4/WebM video. Show
          the item and the detail you are describing. Don’t include faces,
          addresses, order labels or other personal information. Upload only
          media you have permission to publish.
        </p>
      </details>
      <details>
        <summary>
          Our policy on incentivized reviews
          <ChevronDown size={17} />
        </summary>
        <p>
          Disclose free items, discounts or other incentives using the checkbox
          in the review form. We label that disclosure alongside the review.
          Incentives must never require a positive rating. Wairo does not pay
          rewards for reviews, helpful votes or recommendations.
        </p>
      </details>
    </section>
  );
}
function Catalog() {
  const initial = new URLSearchParams(window.location.search);
  const [q, setQ] = useState(initial.get('q') || ''),
    [type, setType] = useState(initial.get('type') || ''),
    [page, setPage] = useState(1),
    [data, setData] = useState<ReviewCatalog | null>(null),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      setLoading(true);
      api.getReviewCatalog({ q, type, page: String(page) }).then((r) => {
        if (!live) return;
        setLoading(false);
        if (r.ok) {
          setData(r.data);
          setError('');
        } else setError(r.error);
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, type, page, attempt]);
  return (
    <>
      <section className="rv-directory-intro">
        <span className="rv-eyebrow">THE WAIRO REVIEW ROOM</span>
        <h1>
          Real experiences.
          <br />
          <em>Better decisions.</em>
        </h1>
        <p>
          Go beyond the product description. Hear what worked, what didn’t, and
          what’s worth knowing—from the people who tried it.
        </p>
      </section>
      <form
        className="rv-directory-search"
        onSubmit={(e) => e.preventDefault()}
      >
        <label>
          <Search size={19} />
          <input
            aria-label="Find a product to read reviews"
            placeholder="Find a product to read reviews…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <select
          aria-label="Product category"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All categories</option>
          <option value="product">Products</option>
          <option value="service">Services</option>
          <option value="experience">Experiences</option>
          <option value="event">Events</option>
        </select>
      </form>
      {error && (
        <p className="rv-error" role="alert">
          {error}{' '}
          <button onClick={() => setAttempt((n) => n + 1)}>Retry</button>
        </p>
      )}
      {loading && (
        <p role="status" className="rv-subtle">
          Finding products…
        </p>
      )}
      {data && (
        <>
          <div className="rv-section-title">
            <h2>Find your next good choice</h2>
            <small>
              {data.total} {data.total === 1 ? 'product' : 'products'}
            </small>
          </div>
          <div className="rv-product-grid">
            {data.products.map((p) => (
              <ProductTile key={p.id} product={p} />
            ))}
          </div>
          {data.total === 0 && (
            <div className="rv-empty">
              <MessageCircle size={32} />
              <h2>{q ? 'No matching products' : 'A little quiet, for now.'}</h2>
              <p>
                {q
                  ? 'Try another product name or category.'
                  : 'Published public products will appear here. Reviews begin when real customers share their experience.'}
              </p>
              <a href="/#spaces">
                Explore Wairo Spaces <ArrowRight size={14} />
              </a>
            </div>
          )}
          {data.pages > 1 && (
            <div className="rv-pagination">
              <button
                disabled={data.page === 1 || loading}
                onClick={() => setPage((n) => n - 1)}
              >
                Previous
              </button>
              <span>
                Page {data.page} of {data.pages}
              </span>
              <button
                disabled={data.page === data.pages || loading}
                onClick={() => setPage((n) => n + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
      <Guidelines />
    </>
  );
}
function ProductReviews({ id }: { id: string }) {
  const initial = useRef(
    Object.fromEntries(
      [...new URLSearchParams(window.location.search)].filter(([key]) =>
        [
          'q',
          'stars',
          'verified',
          'media',
          'recent',
          'sort',
          'size',
          'color',
          'theme',
          'page',
          'review'
        ].includes(key)
      )
    )
  );
  const [query, setQuery] = useState<Record<string, string>>(initial.current),
    [search, setSearch] = useState(initial.current.q || ''),
    [data, setData] = useState<ReviewPage | null>(null),
    [context, setContext] = useState<ReviewContext | null>(null),
    [error, setError] = useState(''),
    [contextError, setContextError] = useState(''),
    [loading, setLoading] = useState(true),
    [attempt, setAttempt] = useState(0),
    [epoch, setEpoch] = useState(0),
    [auth, setAuth] = useState<'write' | 'participate' | null>(null),
    [composer, setComposer] = useState(false),
    [gallery, setGallery] = useState<{
      initial: ReviewGalleryItem | null;
    } | null>(null),
    [notice, setNotice] = useState(''),
    [jump, setJump] = useState('');
  const controls = useRef<HTMLDivElement>(null),
    sharedScrolled = useRef(false);
  const refresh = useCallback(() => setAttempt((n) => n + 1), []);
  const patch = useCallback(
    (input: Record<string, string>) =>
      setQuery((old) => {
        const next: Record<string, string> = {
          ...old,
          ...input,
          page: input.page || '1'
        };
        delete next.review;
        Object.keys(next).forEach((k) => {
          if (!next[k]) delete next[k];
        });
        return next;
      }),
    []
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery((old) => {
        if ((old.q || '') === search) return old;
        const next: Record<string, string> = { ...old, q: search, page: '1' };
        delete next.review;
        return next;
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const qs = new URLSearchParams(query).toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${qs ? '?' + qs : ''}${query.review ? '#review-' + query.review : ''}`
    );
    let live = true;
    setLoading(true);
    setError('');
    api.getProductReviews(id, query).then((r) => {
      if (!live) return;
      setLoading(false);
      if (r.ok) {
        setData(r.data);
        setJump(String(r.data.page));
        document.title = `${r.data.product.name} · Customer reviews · Wairo`;
      } else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [id, query, attempt, epoch]);
  useEffect(() => {
    let live = true;
    setContext(null);
    setContextError('');
    if (api.getSessionToken())
      api.getReviewContext(id).then((r) => {
        if (!live) return;
        if (r.ok) setContext(r.data);
        else if (r.status !== 401) setContextError(r.error);
      });
    return () => {
      live = false;
    };
  }, [id, attempt, epoch]);
  useEffect(() => {
    const changed = () => {
      setData(null);
      setContext(null);
      setComposer(false);
      setAuth(null);
      setGallery(null);
      setNotice('');
      setEpoch((n) => n + 1);
    };
    window.addEventListener('brief:session-changed', changed);
    return () => window.removeEventListener('brief:session-changed', changed);
  }, []);
  useEffect(() => {
    if (data?.focus && !sharedScrolled.current) {
      sharedScrolled.current = true;
      const timer = setTimeout(
        () =>
          document
            .getElementById(`review-${data.focus!.id}`)
            ?.scrollIntoView({ block: 'center' }),
        50
      );
      return () => clearTimeout(timer);
    }
  }, [data]);
  const write = () => {
    if (!api.getSessionToken()) {
      setAuth('write');
      return;
    }
    setComposer(true);
  };
  const toggleRating = (rating: number) => {
    const selected = (query.stars || '').split(',').filter(Boolean);
    const value = String(rating);
    patch({
      stars: selected.includes(value)
        ? selected.filter((v) => v !== value).join(',')
        : [...selected, value].join(',')
    });
  };
  const clear = () => {
    setQuery({});
    setSearch('');
  };
  const selectedStars = (query.stars || '').split(',');
  const hasFilters = Boolean(
    query.q ||
    query.stars ||
    query.verified ||
    query.media ||
    query.recent ||
    query.size ||
    query.color ||
    query.theme
  );
  if (!data)
    return (
      <div className="rv-empty" role={error ? 'alert' : 'status'}>
        <MessageCircle size={32} />
        <h1>
          {error
            ? 'We couldn’t open these reviews'
            : 'Opening the review room…'}
        </h1>
        {error && (
          <>
            <p>{error}</p>
            <button className="rv-primary" onClick={refresh}>
              Try again
            </button>
            <a href="/reviews">Browse public products</a>
          </>
        )}
      </div>
    );
  const product = data.product,
    summary = data.summary;
  const galleryLabel = [
    data.photoCount
      ? `${data.photoCount} ${data.photoCount === 1 ? 'photo' : 'photos'}`
      : '',
    data.videoCount
      ? `${data.videoCount} ${data.videoCount === 1 ? 'video' : 'videos'}`
      : ''
  ]
    .filter(Boolean)
    .join(' & ');
  const card = (
    r: ReviewPage['reviews'][number],
    featured = false,
    full = false
  ) => (
    <ReviewCard
      key={`${epoch}-${featured ? 'featured' : 'review'}-${r.id}`}
      review={r}
      listingId={id}
      featured={featured}
      full={full}
      onRefresh={refresh}
      onAuth={() => setAuth('participate')}
      onMedia={(m) => setGallery({ initial: m })}
    />
  );
  return (
    <>
      <nav className="rv-breadcrumb" aria-label="Breadcrumb">
        <a href="/#home">Home</a>
        <ChevronRight size={12} />
        <a href={`/reviews?type=${encodeURIComponent(product.type)}`}>
          {product.category}
        </a>
        <ChevronRight size={12} />
        <a href={`/#offer/${encodeURIComponent(id)}`}>{product.name}</a>
        <ChevronRight size={12} />
        <span aria-current="page">Reviews</span>
      </nav>
      <section className="rv-product-header">
        <ProductImage src={product.image} name={product.name} />
        <div>
          <span className="rv-eyebrow">THE WORD FROM THE COMMUNITY</span>
          <h1>{product.name}</h1>
          <p>
            {reviewMoney(product)} <span>· {product.seller}</span>
          </p>
          <a href={`/#offer/${encodeURIComponent(id)}`}>
            View product <ArrowRight size={14} />
          </a>
        </div>
        <button className="rv-primary" onClick={write}>
          <PenLine size={16} />
          Write a review
        </button>
      </section>
      <div className="rv-trust-line">
        <ShieldCheck size={15} />
        <span>
          Real opinions. Purchase badges checked against Wairo orders.
        </span>
        <a href="#review-guidelines">How reviews work</a>
      </div>
      {notice && (
        <p role="status" className="rv-success">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rv-error">
          {error} Last loaded reviews are shown.{' '}
          <button onClick={refresh}>Retry</button>
        </p>
      )}
      <section className="rv-overview" aria-label="Ratings overview">
        <div className="rv-average">
          <span className="rv-eyebrow">THE BIG PICTURE</span>
          <div>
            <strong>
              {summary.average === null ? '—' : summary.average.toFixed(1)}
            </strong>
            <span>/ 5</span>
          </div>
          {summary.average !== null && (
            <Stars value={summary.average} size={22} />
          )}
          <p>
            {summary.count
              ? `Based on ${summary.count.toLocaleString()} ${summary.count === 1 ? 'review' : 'reviews'}`
              : 'No reviews yet. Yours could be the first.'}
          </p>
        </div>
        <div
          className="rv-breakdown"
          title="Percentages are rounded independently."
        >
          {summary.breakdown.map((b) => (
            <button
              key={b.rating}
              aria-label={`Filter by ${b.rating} stars (${b.count} reviews)`}
              aria-pressed={selectedStars.includes(String(b.rating))}
              onClick={() => {
                toggleRating(b.rating);
                controls.current?.scrollIntoView({ block: 'start' });
              }}
            >
              <span>
                {b.rating}
                <Star size={11} fill="currentColor" />
              </span>
              <span className="rv-bar">
                <i style={{ width: `${b.percent}%` }} />
              </span>
              <b>{b.count.toLocaleString()}</b>
              <small>{b.percent}%</small>
            </button>
          ))}
        </div>
        <div className="rv-recommend">
          <span className="rv-recommend-icon">
            <ThumbsUp size={23} />
          </span>
          <strong>
            {summary.recommendPercent === null
              ? 'Be the first'
              : `${summary.recommendPercent}%`}
          </strong>
          <h2>
            {summary.recommendPercent === null
              ? 'to share your experience'
              : 'would recommend'}
          </h2>
          <p>
            {summary.recommendCount
              ? `Of ${summary.recommendCount.toLocaleString()} reviewers who answered`
              : 'Help the next person find their good choice.'}
          </p>
        </div>
      </section>
      {summary.categories.some((c) => c.count > 0) && (
        <section
          className="rv-category-ratings"
          aria-label="Ratings by category"
        >
          {summary.categories
            .filter((c) => c.count > 0)
            .map((c) => (
              <div key={c.id}>
                <span>{c.label}</span>
                <strong>
                  {c.average?.toFixed(1)}
                  <small> / 5</small>
                </strong>
                <div>
                  <i style={{ width: `${(c.average || 0) * 20}%` }} />
                </div>
                <small>{c.count} ratings</small>
              </div>
            ))}
        </section>
      )}
      <section className="rv-highlights">
        <div className="rv-section-title">
          <h2>What comes up most</h2>
          <span className="rv-label">Counted themes · not AI-generated</span>
        </div>
        <p className="rv-subtle">
          {summary.count
            ? `Keyword mentions across ${summary.count} published reviews. Each review is counted once per theme.`
            : 'Themes and customer-written pros and cons appear as reviews come in. No generated opinions or invented counts.'}
        </p>
        {data.highlights.themes.length > 0 && (
          <div className="rv-theme-chips">
            {data.highlights.themes.map((t) => (
              <button
                key={t.id}
                aria-pressed={query.theme === t.id}
                onClick={() =>
                  patch({ theme: query.theme === t.id ? '' : t.id })
                }
              >
                {t.label}
                <span>{t.count}</span>
              </button>
            ))}
          </div>
        )}
        {(data.highlights.pros.length > 0 ||
          data.highlights.cons.length > 0) && (
          <div className="rv-pros-cons">
            <div>
              <h3>
                <Check size={14} />
                What people liked
              </h3>
              {data.highlights.pros.length ? (
                data.highlights.pros.map((p) => (
                  <p key={p.text}>
                    {p.text}
                    <span>
                      {p.count} {p.count === 1 ? 'mention' : 'mentions'}
                    </span>
                  </p>
                ))
              ) : (
                <p>No pros added yet.</p>
              )}
            </div>
            <div>
              <h3>Room for improvement</h3>
              {data.highlights.cons.length ? (
                data.highlights.cons.map((p) => (
                  <p key={p.text}>
                    {p.text}
                    <span>
                      {p.count} {p.count === 1 ? 'mention' : 'mentions'}
                    </span>
                  </p>
                ))
              ) : (
                <p>No cons added yet.</p>
              )}
            </div>
          </div>
        )}
      </section>
      <section className="rv-gallery-section">
        <div className="rv-section-title">
          <div>
            <h2>Through customers’ eyes</h2>
            <p className="rv-subtle">The product, in real life.</p>
          </div>
          {data.galleryTotal > 0 && (
            <button
              className="rv-text-btn"
              onClick={() => setGallery({ initial: null })}
            >
              See all {galleryLabel}
              <ArrowRight size={15} />
            </button>
          )}
        </div>
        {data.gallery.length > 0 ? (
          <div className="rv-gallery-strip">
            {data.gallery.map((m) => (
              <MediaThumb
                key={`${m.reviewId}-${m.id}`}
                media={m}
                onClick={() => setGallery({ initial: m })}
              />
            ))}
          </div>
        ) : (
          <div className="rv-gallery-empty">
            <MessageCircle size={23} />
            <p>
              No customer photos or videos yet.
              <br />
              <small>Your own photos can make a review more useful.</small>
            </p>
            <button className="rv-text-btn" onClick={write}>
              Share your experience <ArrowRight size={14} />
            </button>
          </div>
        )}
      </section>
      {data.featured.length > 0 && !hasFilters && !query.review && (
        <section className="rv-featured">
          <div className="rv-section-title">
            <div>
              <span className="rv-eyebrow">A GOOD PLACE TO START</span>
              <h2>Found helpful by the community</h2>
            </div>
          </div>
          <div className="rv-featured-grid">
            {data.featured.map((r) => card(r, true))}
          </div>
        </section>
      )}
      <section className="rv-all-reviews" aria-label="Customer reviews">
        <div className="rv-section-title">
          <h2>
            Customer reviews <span className="rv-count">{summary.count}</span>
          </h2>
          <button className="rv-text-btn" onClick={write}>
            Share your experience <PenLine size={15} />
          </button>
        </div>
        <div className="rv-controls" ref={controls}>
          <label className="rv-search">
            <Search size={17} />
            <input
              aria-label="Search in reviews"
              maxLength={120}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search in reviews…"
            />
          </label>
          <details className="rv-filter-details">
            <summary>
              <SlidersHorizontal size={16} />
              Filters{hasFilters && <span className="rv-filter-dot" />}
              <ChevronDown size={13} />
            </summary>
            <div className="rv-filter-popover">
              <fieldset>
                <legend>Star rating</legend>
                {[5, 4, 3, 2, 1].map((n) => (
                  <label key={n}>
                    <input
                      type="checkbox"
                      checked={selectedStars.includes(String(n))}
                      onChange={() => toggleRating(n)}
                    />
                    {n} {n === 1 ? 'star' : 'stars'}
                  </label>
                ))}
              </fieldset>
              <label>
                <input
                  type="checkbox"
                  role="switch"
                  checked={query.verified === '1'}
                  onChange={(e) =>
                    patch({ verified: e.target.checked ? '1' : '' })
                  }
                />
                Verified purchase only
              </label>
              <label>
                <input
                  type="checkbox"
                  role="switch"
                  checked={query.media === '1'}
                  onChange={(e) =>
                    patch({ media: e.target.checked ? '1' : '' })
                  }
                />
                With photos / videos
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={query.recent === '1'}
                  onChange={(e) =>
                    patch({ recent: e.target.checked ? '1' : '' })
                  }
                />
                Last 90 days
              </label>
              {data.variants.sizes.length > 0 && (
                <label>
                  Size (reviewer-stated)
                  <select
                    value={query.size || ''}
                    onChange={(e) => patch({ size: e.target.value })}
                  >
                    <option value="">All sizes</option>
                    {data.variants.sizes.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
              )}
              {data.variants.colors.length > 0 && (
                <label>
                  Color / variant (reviewer-stated)
                  <select
                    value={query.color || ''}
                    onChange={(e) => patch({ color: e.target.value })}
                  >
                    <option value="">All variants</option>
                    {data.variants.colors.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
              )}
              <button className="rv-text-btn" onClick={clear}>
                Clear all filters
              </button>
            </div>
          </details>
          <label className="rv-sort">
            <span>Sort by</span>
            <select
              aria-label="Sort reviews"
              value={query.sort || 'recent'}
              onChange={(e) => patch({ sort: e.target.value })}
            >
              <option value="recent">Most recent</option>
              <option value="helpful">Most helpful</option>
              <option value="highest">Highest rated</option>
              <option value="lowest">Lowest rated</option>
              <option value="images">With images</option>
            </select>
          </label>
        </div>
        <div className="rv-results-line">
          <span role="status">
            {loading
              ? 'Updating reviews…'
              : `Showing ${data.from}–${data.to} of ${data.total.toLocaleString()} reviews`}
          </span>
          {hasFilters && (
            <button onClick={clear}>
              Clear filters
              {query.stars
                ? ` · ${query.stars.split(',').join(', ')} stars`
                : ''}
            </button>
          )}
        </div>
        {query.review && (
          <section className="rv-shared-review">
            <h3>Shared review</h3>
            {data.focus ? (
              card(data.focus, false, true)
            ) : (
              <p>This review is no longer available.</p>
            )}
          </section>
        )}
        <div className="rv-review-list" aria-busy={loading}>
          {data.reviews
            .filter((r) => r.id !== data.focus?.id)
            .map((r) => card(r))}
        </div>
        {data.total === 0 && (
          <div className="rv-empty">
            <MessageCircle size={30} />
            <h3>
              {hasFilters
                ? 'No reviews match just yet'
                : 'Every review starts a conversation.'}
            </h3>
            <p>
              {hasFilters
                ? 'Try fewer filters or a different search.'
                : 'Have experience with this product? Help someone else choose with confidence.'}
            </p>
            <button className="rv-primary" onClick={hasFilters ? clear : write}>
              {hasFilters ? 'Clear filters' : 'Write the first review'}
            </button>
          </div>
        )}
        {data.pages > 1 && (
          <div className="rv-pagination">
            <button
              disabled={loading || data.page === 1}
              onClick={() => {
                patch({ page: String(data.page - 1) });
                controls.current?.scrollIntoView({ block: 'start' });
              }}
            >
              <ArrowLeft size={14} />
              Previous
            </button>
            <div className="rv-page-numbers">
              {Array.from({ length: data.pages }, (_, i) => i + 1)
                .filter(
                  (n) =>
                    n === 1 || n === data.pages || Math.abs(n - data.page) <= 1
                )
                .map((n, i, arr) => (
                  <React.Fragment key={n}>
                    {i > 0 && n - arr[i - 1] > 1 && <span>…</span>}
                    <button
                      aria-label={`Page ${n}`}
                      aria-current={n === data.page ? 'page' : undefined}
                      onClick={() => {
                        patch({ page: String(n) });
                        controls.current?.scrollIntoView({ block: 'start' });
                      }}
                      disabled={loading}
                    >
                      {n}
                    </button>
                  </React.Fragment>
                ))}
            </div>
            <button
              disabled={loading || data.page === data.pages}
              onClick={() => {
                patch({ page: String(data.page + 1) });
                controls.current?.scrollIntoView({ block: 'start' });
              }}
            >
              Next
              <ArrowRight size={14} />
            </button>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                patch({ page: jump });
                controls.current?.scrollIntoView({ block: 'start' });
              }}
            >
              <label>
                Jump to page
                <input
                  type="number"
                  min={1}
                  max={data.pages}
                  value={jump}
                  onChange={(e) => setJump(e.target.value)}
                />
              </label>
              <button disabled={loading}>Go</button>
            </form>
          </div>
        )}
      </section>
      <section className="rv-write-banner">
        <span>
          <PenLine size={24} />
        </span>
        <div>
          <h2>Have this product? Share your experience.</h2>
          <p>
            Good, not-so-good, and everything in between. Your honest review
            helps.
          </p>
        </div>
        <button className="rv-primary" onClick={write}>
          Write a review
          <ArrowRight size={15} />
        </button>
      </section>
      <Guidelines />
      {data.related.length > 0 && (
        <section className="rv-related">
          <div className="rv-section-title">
            <h2>{data.relatedLabel}</h2>
            <a href={`/reviews?type=${product.type}`}>
              Explore more <ArrowRight size={14} />
            </a>
          </div>
          <div className="rv-product-grid">
            {data.related.map((p) => (
              <ProductTile key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
      {context?.canModerate && (
        <a className="rv-moderation-link" href="/reviews/moderation">
          Open review moderation <ArrowRight size={14} />
        </a>
      )}
      {auth && (
        <ReviewModal
          title="Join the conversation"
          onClose={() => setAuth(null)}
        >
          <SessionSignIn
            title="Sign in to review on Wairo"
            brandName="Wairo"
            onSignedIn={() => {
              setAuth(null);
              setEpoch((n) => n + 1);
              if (auth === 'write') setComposer(true);
              else setNotice('Signed in. You can now vote or report a review.');
            }}
          />
          <p className="rv-subtle">
            Signing in does not grant a verified purchase badge. We check the
            order you link.
          </p>
        </ReviewModal>
      )}
      {composer && (
        <ReviewModal
          title="Share your experience"
          wide
          onClose={() => setComposer(false)}
        >
          {context ? (
            <ReviewComposer
              key={`${epoch}-${id}`}
              product={product}
              context={context}
              onDone={() => {
                setComposer(false);
                setNotice('Thank you. Your review is published.');
                clear();
                refresh();
              }}
            />
          ) : contextError ? (
            <p className="rv-error" role="alert">
              {contextError}
              <button onClick={refresh}>Retry</button>
            </p>
          ) : (
            <p role="status">Checking your purchase options…</p>
          )}
        </ReviewModal>
      )}
      {gallery && (
        <ReviewGallery
          listingId={id}
          initial={gallery.initial}
          onClose={() => setGallery(null)}
        />
      )}
    </>
  );
}
function ModerationAttachment({ media }: { media: ReviewMedia }) {
  const [url, setUrl] = useState(''),
    [error, setError] = useState(false);
  useEffect(() => {
    let live = true,
      objectUrl = '';
    api.readPrivateEvidence(media.id).then((r) => {
      if (!live) return;
      if (r.ok) {
        objectUrl = URL.createObjectURL(r.data);
        setUrl(objectUrl);
      } else setError(true);
    });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [media.id]);
  return (
    <div className="rv-moderation-media">
      {error ? (
        <p>Media is unavailable or access was revoked.</p>
      ) : !url ? (
        <p role="status">Loading protected media…</p>
      ) : media.kind === 'video' ? (
        <video src={url} controls />
      ) : (
        <img src={url} alt="Review media for moderation" />
      )}
    </div>
  );
}
function ModerationEvidence({ media }: { media: ReviewMedia[] }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Review media ({media.length})</summary>
      {open && media.map((m) => <ModerationAttachment key={m.id} media={m} />)}
    </details>
  );
}
function Moderation() {
  const [data, setData] = useState<ReviewReport[] | null>(null),
    [error, setError] = useState(''),
    [signedOut, setSignedOut] = useState(false),
    [attempt, setAttempt] = useState(0),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState('');
  useEffect(() => {
    let live = true;
    setData(null);
    setError('');
    api.getReviewReports().then((r) => {
      if (!live) return;
      setSignedOut(!r.ok && r.status === 401);
      if (r.ok) setData(r.data.reports);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [attempt]);
  useEffect(() => {
    const reset = () => {
      setData(null);
      setNotes({});
      setBusy('');
      setError('');
      setAttempt((n) => n + 1);
    };
    const refresh = () => setAttempt((n) => n + 1);
    window.addEventListener('brief:session-changed', reset);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('brief:session-changed', reset);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  const act = async (id: string, action: 'hide' | 'restore' | 'dismiss') => {
    setBusy(id);
    setError('');
    const r = await api.moderateProductReview(id, action, notes[id] || '');
    setBusy('');
    if (r.ok) setAttempt((n) => n + 1);
    else setError(r.error);
  };
  return (
    <section className="rv-moderation">
      <span className="rv-eyebrow">AUTHORIZED MODERATORS ONLY</span>
      <h1>Review moderation</h1>
      <p>
        Reports do not automatically remove content. Record a reason for every
        decision. Sellers have no moderation privileges.
      </p>
      {signedOut ? (
        <SessionSignIn
          title="Sign in as a moderator"
          brandName="Wairo"
          onSignedIn={() => setAttempt((n) => n + 1)}
        />
      ) : (
        <>
          {error && (
            <p role="alert" className="rv-error">
              {error}
            </p>
          )}
          {!data && !error && <p role="status">Checking moderator access…</p>}
          {data?.length === 0 && (
            <div className="rv-empty">No review reports.</div>
          )}
          {data?.map((r) => (
            <article className="rv-review-card" key={r.id}>
              <div className="rv-review-top">
                <strong>
                  {r.reason} · {r.status}
                </strong>
                <time>{reviewDate(r.createdAt)}</time>
              </div>
              <p className="rv-review-body">{r.note}</p>
              {r.review && (
                <>
                  <a
                    href={`/reviews/${r.review.listingId}?review=${r.review.id}`}
                  >
                    {r.review.title}
                  </a>
                  <p className="rv-review-body">{r.review.body}</p>
                  <small>Review status: {r.review.status}</small>
                  {r.review.media.length > 0 && (
                    <ModerationEvidence media={r.review.media} />
                  )}
                  <label>
                    Decision reason
                    <input
                      minLength={10}
                      maxLength={300}
                      value={notes[r.review.id] || ''}
                      onChange={(e) =>
                        setNotes((v) => ({
                          ...v,
                          [r.review!.id]: e.target.value
                        }))
                      }
                    />
                  </label>
                  <div className="rv-choice">
                    {r.status === 'open' && (
                      <button
                        className="rv-secondary"
                        disabled={!!busy}
                        onClick={() => void act(r.review!.id, 'dismiss')}
                      >
                        Dismiss report
                      </button>
                    )}
                    {r.review.status === 'published' && (
                      <button
                        className="rv-primary"
                        disabled={!!busy}
                        onClick={() => void act(r.review!.id, 'hide')}
                      >
                        Hide review
                      </button>
                    )}
                    {r.review.status === 'hidden' && (
                      <button
                        className="rv-primary"
                        disabled={!!busy}
                        onClick={() => void act(r.review!.id, 'restore')}
                      >
                        Restore review
                      </button>
                    )}
                  </div>
                </>
              )}
            </article>
          ))}
        </>
      )}
    </section>
  );
}
export default function ReviewsPage() {
  const segment =
    /^\/reviews\/([A-Za-z0-9_-]+)\/?$/.exec(window.location.pathname)?.[1] ||
    null;
  useEffect(() => {
    document.title = 'Product reviews · Wairo Blue Avenue';
  }, []);
  return (
    <div className="wairo-reviews">
      <header className="rv-nav">
        <a href="/#home" aria-label="Wairo home" className="rv-brand">
          <WairoMark size={31} />
          <span>
            Wairo<small>BLUE AVENUE</small>
          </span>
        </a>
        <div>
          <a href="/reviews">Review room</a>
          <a href="/#home">
            <ArrowLeft size={14} /> Back to Wairo
          </a>
        </div>
      </header>
      <main className="rv-main">
        {segment === 'moderation' ? (
          <Moderation />
        ) : segment ? (
          <ProductReviews id={segment} />
        ) : (
          <Catalog />
        )}
        <footer className="rv-footer">
          <span>
            <ShieldCheck size={16} />
            Good choices start with honest conversations.
          </span>
          <a href="/track">
            Track an order <ArrowRight size={14} />
          </a>
        </footer>
      </main>
    </div>
  );
}
