import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Search,
  Share2,
  SlidersHorizontal,
  X,
  Package,
  Briefcase,
  BookOpen,
  Star,
  MapPin
} from 'lucide-react';
import * as api from '../../api/briefApi';
import type {
  BusinessCard,
  BusinessFeedPage,
  BusinessFeedAction,
  FeedControls
} from '../../api/businessFeedTypes';
import { SessionSignIn } from '../../components/SessionSignIn';
import type { DiscoverRoom } from '../city/taxonomy';
import '../requests/requests.css';
import './business-feed.css';

const labels: Record<string, string> = {
  all: 'Everything',
  tool: 'Tools',
  offer: 'Services & offers',
  campaign: 'Work campaigns',
  task: 'Tasks',
  request: 'Matched briefs',
  playbook: 'Playbooks'
};
const singular: Record<string, string> = {
  tool: 'Software · keyword match',
  offer: 'Service / offer',
  campaign: 'Work campaign',
  task: 'Task opportunity',
  request: 'Matched brief',
  playbook: 'The playbook'
};
const emptyControls: FeedControls = {
  topic: '',
  location: '',
  stage: '',
  budget: null,
  rememberActivity: false
};
const justControls = ({
  topic,
  location,
  stage,
  budget,
  rememberActivity
}: FeedControls): FeedControls => ({
  topic,
  location,
  stage,
  budget,
  rememberActivity
});
const sharedKey = () =>
  new URLSearchParams(window.location.hash.split('?')[1] || '').get('card') ||
  '';
const icon = (kind: string) =>
  kind === 'playbook' ? (
    <BookOpen size={23} />
  ) : ['task', 'campaign', 'request'].includes(kind) ? (
    <Briefcase size={23} />
  ) : (
    <Package size={23} />
  );
function Dialog({
  title,
  onClose,
  children
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="bf-dialog"
      aria-label={title}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header>
        <span>{title}</span>
        <button type="button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function FeedCard({
  card: c,
  busy,
  onAction,
  onOpen,
  onShare
}: {
  card: BusinessCard;
  busy: boolean;
  onAction: (a: BusinessFeedAction) => void;
  onOpen: (c: BusinessCard) => void;
  onShare: (c: BusinessCard) => void;
}) {
  return (
    <article className={`bf-card bf-${c.kind}`} data-card-key={c.key}>
      <header className="bf-card-top">
        <span className="bf-kind">{singular[c.kind]}</span>
        <button
          className="bf-save"
          type="button"
          disabled={busy}
          aria-label={`${c.saved ? 'Unsave' : 'Save'} ${c.title}`}
          aria-pressed={c.saved}
          onClick={() =>
            onAction({ key: c.key, action: 'save', value: !c.saved })
          }
        >
          {c.saved ? <Check size={18} /> : <Bookmark size={18} />}
        </button>
      </header>
      <div className="bf-card-body">
        <div className="bf-source">
          <span className="bf-mark">
            {c.image ? (
              <img
                src={api.mediaFileUrl(c.image)}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            ) : (
              icon(c.kind)
            )}
          </span>
          <span>
            {c.source || 'Published offer'}
            <small>
              {c.kind === 'playbook'
                ? 'Original guidance · not a customer result'
                : c.scope === 'private'
                  ? 'Visible to your account · not publicly shareable'
                  : 'Public listing · provider-stated details'}
            </small>
          </span>
        </div>
        <h2>{c.title}</h2>
        <p className="bf-summary">
          {c.summary ||
            'Open the offer to check the details with the provider.'}
        </p>
        {c.kind === 'playbook' && (
          <div className="bf-book-art" aria-hidden="true">
            <span>
              01
              <span className="bf-art-line" />
            </span>
            <span>
              02
              <span className="bf-art-line" />
            </span>
            <span>
              03
              <span className="bf-art-line" />
            </span>
            <b>
              IDEA
              <br />
              INTO ACTION ↗
            </b>
          </div>
        )}
        <div className="bf-facts">
          {c.location && (
            <span>
              <MapPin size={13} />
              {c.location}
            </span>
          )}
          {c.work && (
            <span>
              {c.work.mode} · {c.work.remaining} available units · due{' '}
              {c.work.deadline}
            </span>
          )}
          {c.steps && <span>{c.steps.length} practical steps</span>}
        </div>
        {c.price && (
          <div className="bf-price">
            <strong>{c.price}</strong>
            <small>{c.priceNote}</small>
          </div>
        )}
        {c.kind === 'request' && <p className="bf-muted">{c.priceNote}</p>}
        {c.blockers.length > 0 && (
          <details className="bf-eligibility">
            <summary>
              Before you can take this work ({c.blockers.length})
            </summary>
            <ul>
              {c.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </details>
        )}
        {c.reviews && (
          <a className="bf-review-link" href={c.reviews.href}>
            {c.reviews.count ? (
              <>
                <Star size={13} />
                {c.reviews.average?.toFixed(1)} · {c.reviews.count} customer
                review{c.reviews.count === 1 ? '' : 's'}
              </>
            ) : (
              'No customer reviews yet'
            )}
            <ArrowRight size={12} />
          </a>
        )}
        <div className="bf-card-actions">
          <button
            type="button"
            className="bf-primary"
            onClick={() => onOpen(c)}
          >
            {c.cta}
            <ArrowRight size={16} />
          </button>
          {c.vendorId && (
            <button
              type="button"
              disabled={busy}
              aria-pressed={c.following}
              onClick={() =>
                onAction({ key: c.key, action: 'follow', value: !c.following })
              }
            >
              {c.following ? 'Following' : 'Follow provider'}
            </button>
          )}
          {c.scope === 'public' && (
            <button
              type="button"
              className="bf-share"
              aria-label={`Share ${c.title}`}
              onClick={() => onShare(c)}
            >
              <Share2 size={17} />
            </button>
          )}
        </div>
      </div>
      <footer className="bf-card-bottom">
        <details>
          <summary>Why this card?</summary>
          <p>Content relevance, not a provider or worker trust score.</p>
          <ul>
            {c.reasons.map((r) => (
              <li key={r.label}>
                {r.label} <small>+{r.points}</small>
              </li>
            ))}
          </ul>
          <p>
            For you mixes formats; newest uses publication dates. No paid
            boosts.
          </p>
        </details>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onAction({ key: c.key, action: 'hide', value: !c.hidden })
          }
        >
          {c.hidden ? 'Show again' : 'Hide'}
        </button>
      </footer>
    </article>
  );
}
export function BusinessFeed({
  onBrowse,
  onPostListing
}: {
  onBrowse: (room: DiscoverRoom) => void;
  onPostListing: () => void;
}) {
  const [data, setData] = useState<BusinessFeedPage | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [kind, setKind] = useState('all'),
    [tab, setTab] = useState('feed'),
    [sort, setSort] = useState('foryou'),
    [q, setQ] = useState(''),
    [page, setPage] = useState(1),
    [reload, setReload] = useState(0),
    [epoch, setEpoch] = useState(0);
  const [tuned, setTuned] = useState<FeedControls | null>(null),
    [draft, setDraft] = useState<FeedControls>(emptyControls),
    [busy, setBusy] = useState(false),
    [focus, setFocus] = useState(sharedKey);
  const [modal, setModal] = useState<'auth' | 'controls' | BusinessCard | null>(
      null
    ),
    [shareUrl, setShareUrl] = useState('');
  const ready = useRef(false),
    top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const session = () => {
      setData(null);
      setModal(null);
      setShareUrl('');
      setNotice('');
      setError('');
      setTuned(null);
      setDraft(emptyControls);
      setQ('');
      setKind('all');
      setSort('foryou');
      setPage(1);
      setTab('feed');
      setBusy(false);
      ready.current = false;
      setEpoch((n) => n + 1);
    };
    const hash = () => setFocus(sharedKey());
    const fresh = () => setReload((n) => n + 1);
    window.addEventListener('brief:session-changed', session);
    window.addEventListener('hashchange', hash);
    window.addEventListener('focus', fresh);
    return () => {
      window.removeEventListener('brief:session-changed', session);
      window.removeEventListener('hashchange', hash);
      window.removeEventListener('focus', fresh);
    };
  }, []);
  useEffect(() => {
    let live = true;
    const token = api.getSessionToken();
    setLoading(true);
    setError('');
    const timer = setTimeout(
      () => {
        const query: Record<string, string> = {
          kind,
          tab,
          sort,
          q,
          page: String(page),
          ...(focus ? { card: focus } : {})
        };
        if (tuned)
          Object.assign(query, {
            topic: tuned.topic,
            location: tuned.location,
            stage: tuned.stage,
            budget: tuned.budget === null ? '' : String(tuned.budget)
          });
        void api.getBusinessFeed(query).then((r) => {
          if (!live || token !== api.getSessionToken()) return;
          setLoading(false);
          if (r.ok) {
            setData(r.data);
            if (!ready.current) {
              setDraft(justControls(r.data.preferences));
              ready.current = true;
            }
          } else {
            setData(null);
            setError(r.error);
          }
        });
      },
      q ? 250 : 0
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [kind, tab, sort, q, page, reload, epoch, tuned, focus]);
  const filters = (fn: () => void) => {
    fn();
    setPage(1);
    setNotice('');
  };
  const signIn = () => {
    setModal('auth');
    setError('');
  };
  const action = async (a: BusinessFeedAction) => {
    if (!data?.authenticated) {
      signIn();
      return;
    }
    const token = api.getSessionToken();
    setBusy(true);
    setError('');
    const r = await api.actOnBusinessFeed(a);
    if (token !== api.getSessionToken()) return;
    setBusy(false);
    if (r.ok) {
      setNotice(
        a.action === 'hide'
          ? a.value
            ? 'Hidden from your feed. Restore hidden cards in Tune feed.'
            : 'Card restored.'
          : a.action === 'follow'
            ? a.value
              ? 'Provider followed.'
              : 'Provider unfollowed.'
            : a.value
              ? 'Saved to your private list.'
              : 'Removed from Saved.'
      );
      setReload((n) => n + 1);
    } else {
      setError(r.error);
      if (r.status === 401) signIn();
    }
  };
  const track = (c: BusinessCard, a: 'open' | 'share') => {
    if (data?.authenticated && data.preferences.rememberActivity)
      void api.actOnBusinessFeed({ key: c.key, action: a });
  };
  const open = (c: BusinessCard) => {
    track(c, 'open');
    if (c.steps) setModal(c);
    else if (c.href) window.location.assign(c.href);
  };
  const share = async (c: BusinessCard) => {
    const token = api.getSessionToken(),
      url = `${window.location.origin}/#city/all?card=${encodeURIComponent(c.key)}`;
    try {
      await navigator.clipboard.writeText(url);
      if (token !== api.getSessionToken()) return;
      setNotice('Link copied.');
      track(c, 'share');
    } catch {
      if (token !== api.getSessionToken()) return;
      setShareUrl(url);
      setNotice('Copy this public card link.');
    }
  };
  const reset = async (what: 'hidden' | 'following' | 'activity' | 'all') => {
    if (!data?.authenticated) {
      signIn();
      return;
    }
    if (
      what === 'all' &&
      !window.confirm(
        'Remove your feed preferences, saves, follows and activity? This does not delete your account or business records.'
      )
    )
      return;
    const token = api.getSessionToken();
    setBusy(true);
    const r = await api.resetBusinessFeed(what);
    if (token !== api.getSessionToken()) return;
    setBusy(false);
    if (r.ok) {
      setNotice('Discovery settings updated.');
      if (what === 'all') {
        setDraft(emptyControls);
        setTuned(null);
        setModal(null);
        setTab('feed');
      }
      setReload((n) => n + 1);
    } else setError(r.error);
  };
  const controlsNow = tuned || data?.applied;
  return (
    <div className="business-feed" data-testid="business-feed" ref={top}>
      <header className="bf-heading">
        <div>
          <span className="bf-eyebrow">THE BUSINESS FEED</span>
          <h1>
            Find your next
            <br />
            <em>good move.</em>
          </h1>
          <p>Useful tools. Work worth doing. Ideas you can put to work.</p>
        </div>
        <div className="bf-start">
          <a href="/#requests/new">
            I need something done <ArrowRight size={17} />
          </a>
          <button type="button" onClick={onPostListing}>
            I have something to offer <ArrowRight size={17} />
          </button>
          <small>
            Discover <span>→</span> Execute <span>→</span> Review
          </small>
        </div>
      </header>
      <nav className="bf-tabs" aria-label="Discovery views">
        {[
          ['feed', 'For you'],
          ['saved', 'Saved'],
          ['following', 'Following']
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            onClick={() => filters(() => setTab(key))}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="bf-tune"
          onClick={() => {
            setDraft(justControls(tuned || data?.preferences || emptyControls));
            setModal('controls');
          }}
        >
          <SlidersHorizontal size={15} />
          Tune feed
        </button>
      </nav>
      <div className="bf-search">
        <label>
          <Search size={17} />
          <input
            aria-label="Search business feed"
            value={q}
            maxLength={120}
            placeholder="A tool, a task, a better way to work…"
            onChange={(e) => filters(() => setQ(e.target.value))}
          />
        </label>
        <select
          aria-label="Sort feed"
          value={sort}
          onChange={(e) => filters(() => setSort(e.target.value))}
        >
          <option value="foryou">For you</option>
          <option value="latest">Newest</option>
        </select>
      </div>
      <nav className="bf-filters" aria-label="Card format">
        {Object.entries(labels).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={kind === key}
            onClick={() => filters(() => setKind(key))}
          >
            {label}
          </button>
        ))}
      </nav>
      {(controlsNow?.topic ||
        controlsNow?.location ||
        controlsNow?.stage ||
        (controlsNow?.budget !== null &&
          controlsNow?.budget !== undefined)) && (
        <p className="bf-applied">
          Prioritizing:{' '}
          {[
            controlsNow.topic,
            controlsNow.location,
            controlsNow.stage,
            controlsNow.budget !== null
              ? `up to KES ${controlsNow.budget.toLocaleString()}`
              : ''
          ]
            .filter(Boolean)
            .join(' · ')}
          . These are ranking preferences, not hard filters.
        </p>
      )}
      {notice && (
        <p className="bf-notice" role="status">
          {notice}
        </p>
      )}
      {shareUrl && (
        <label className="bf-copy">
          Public share link
          <input value={shareUrl} readOnly onFocus={(e) => e.target.select()} />
          <button type="button" onClick={() => setShareUrl('')}>
            Close
          </button>
        </label>
      )}
      {error && (
        <p className="bf-error" role="alert">
          {error}{' '}
          <button type="button" onClick={() => setReload((n) => n + 1)}>
            Retry feed
          </button>
        </p>
      )}
      {loading && (
        <p className="bf-loading" role="status">
          Finding your next good move…
        </p>
      )}
      {data && !loading && (
        <>
          {data.focusUnavailable && (
            <p className="bf-notice">
              This shared card is no longer available or is private. Other
              discoveries are below.
            </p>
          )}
          {data.focus && (
            <section className="bf-focused" aria-label="Shared card">
              <div className="bf-section-heading">
                <h2>Shared with you</h2>
                <button
                  type="button"
                  onClick={() => {
                    setFocus('');
                    window.location.hash = 'city';
                  }}
                >
                  Back to the feed <X size={14} />
                </button>
              </div>
              <FeedCard
                card={data.focus}
                busy={busy}
                onAction={(a) => void action(a)}
                onOpen={open}
                onShare={(c) => void share(c)}
              />
            </section>
          )}
          <div className="bf-section-heading">
            <p>
              {tab === 'saved'
                ? 'Your private reading list'
                : tab === 'following'
                  ? 'From providers you follow'
                  : sort === 'latest'
                    ? 'The latest, from real sources'
                    : 'A little discovery. A lot of possibility.'}
            </p>
            <span>
              {data.total} card{data.total === 1 ? '' : 's'}
            </span>
          </div>
          {!data.items.length ? (
            <section className="bf-empty">
              <span>{icon(kind)}</span>
              <h2>
                {tab !== 'feed' && !data.authenticated
                  ? 'Make this feed yours'
                  : q
                    ? 'No matches just yet'
                    : tab === 'saved'
                      ? 'Good finds belong here'
                      : tab === 'following'
                        ? 'Your people, in one place'
                        : 'A little quiet in this format'}
              </h2>
              <p>
                {tab !== 'feed' && !data.authenticated
                  ? 'Sign in to keep your saves and provider follows private to your account.'
                  : tab === 'saved'
                    ? 'Save a tool, opportunity or guide to come back to it. Unavailable sources stay out of your feed.'
                    : tab === 'following'
                      ? 'Follow a provider on a public offer to see their listings here.'
                      : 'Try another format or explore a playbook. Work opportunities are shown only to accounts that can view them; no invented campaigns or results.'}
              </p>
              {!data.authenticated ? (
                <button type="button" className="bf-primary" onClick={signIn}>
                  Sign in to personalize <ArrowRight size={16} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    filters(() => {
                      setQ('');
                      setKind('all');
                      setTab('feed');
                    })
                  }
                >
                  Explore everything
                </button>
              )}
            </section>
          ) : (
            <div className="bf-grid">
              {data.items
                .filter((c) => c.key !== data.focus?.key)
                .map((c) => (
                  <FeedCard
                    key={c.key}
                    card={c}
                    busy={busy}
                    onAction={(a) => void action(a)}
                    onOpen={open}
                    onShare={(c) => void share(c)}
                  />
                ))}
            </div>
          )}
          {data.pages > 1 && (
            <nav className="bf-pagination" aria-label="Feed pages">
              <button
                type="button"
                disabled={data.page <= 1}
                onClick={() => {
                  setPage(data.page - 1);
                  top.current?.scrollIntoView();
                }}
              >
                <ChevronLeft size={17} />
                Previous
              </button>
              <span>
                Page {data.page} of {data.pages}
              </span>
              <button
                type="button"
                disabled={data.page >= data.pages}
                onClick={() => {
                  setPage(data.page + 1);
                  top.current?.scrollIntoView();
                }}
              >
                Next
                <ChevronRight size={17} />
              </button>
            </nav>
          )}
          {(!data.availability.commerce ||
            !data.availability.workforce ||
            !data.availability.matching) && (
            <p className="bf-muted">
              Some discovery sources are currently disabled by the operator.
            </p>
          )}
        </>
      )}
      <footer className="bf-footer">
        <details>
          <summary>How this feed works</summary>
          <p>
            Public offers and Wairo editorial guides are open to everyone. Work
            programs and matched briefs use the access rules of your existing
            workspaces—not a new public job board.
          </p>
          <p>
            For you adds bounded boosts for chosen interests (+5), location
            (+3), KES minimum spend (+2), editorial stage (+2), provider follows
            (+6), repeated saves (+2) and optional open/share history (+1).
            Recent publications get up to +3. It mixes formats before
            pagination. No GPS, paid placement, conversion guesses or opaque
            worker trust scores.
          </p>
          <p>
            Tool labels use keyword matching, not certification. Rates are
            offers, not guaranteed earnings; approvals and payments remain in
            the existing execution and ledger flows. Save/follow/hide require
            sign-in. History is off by default, private and erasable.
          </p>
        </details>
        <nav aria-label="More discovery">
          <button type="button" onClick={() => onBrowse('all')}>
            Supply routes
          </button>
          <button type="button" onClick={() => onBrowse('shops')}>
            Shops
          </button>
          <button type="button" onClick={() => onBrowse('circles')}>
            Groups
          </button>
          <button type="button" onClick={() => onBrowse('errands')}>
            Errands
          </button>
          <a href="/#wanderly">Wanderly ↗</a>
          <a href="/reviews">Customer reviews ↗</a>
        </nav>
      </footer>
      {modal === 'auth' && (
        <Dialog title="Your Wairo account" onClose={() => setModal(null)}>
          <SessionSignIn
            brandName="Wairo"
            title="Sign in to personalize your feed"
            onSignedIn={() => {
              setModal(null);
              setReload((n) => n + 1);
              setNotice(
                'Signed in. You can now save, follow and tune your feed.'
              );
            }}
          />
        </Dialog>
      )}
      {modal === 'controls' && (
        <Dialog
          title="A feed that works for you"
          onClose={() => setModal(null)}
        >
          <form
            className="bf-controls"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              if (!data?.authenticated) {
                setTuned(draft);
                setPage(1);
                setModal(null);
                setNotice(
                  'Applied for this visit. Sign in to remember your preferences.'
                );
                return;
              }
              const token = api.getSessionToken();
              setBusy(true);
              const r = await api.updateBusinessFeedPreferences(
                justControls(draft)
              );
              if (token !== api.getSessionToken()) return;
              setBusy(false);
              if (r.ok) {
                setTuned(null);
                setPage(1);
                setModal(null);
                setNotice('Your feed preferences are saved.');
                setReload((n) => n + 1);
              } else setError(r.error);
            }}
          >
            <p>Choose what matters. Everything else stays discoverable.</p>
            <label>
              Your focus
              <select
                value={draft.topic}
                onChange={(e) => setDraft({ ...draft, topic: e.target.value })}
              >
                <option value="">Open to anything</option>
                {data?.topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Location
              <input
                aria-label="Location"
                value={draft.location}
                maxLength={80}
                placeholder="e.g. Nairobi or Remote"
                onChange={(e) =>
                  setDraft({ ...draft, location: e.target.value })
                }
              />
              <small>Only matches places stated on a card. No GPS.</small>
            </label>
            <label>
              Business stage
              <select
                value={draft.stage}
                onChange={(e) => setDraft({ ...draft, stage: e.target.value })}
              >
                <option value="">Any stage</option>
                <option value="starting">Starting out</option>
                <option value="growing">Growing</option>
                <option value="established">Established</option>
              </select>
              <small>
                Used for editorial guides, not inferred about providers.
              </small>
            </label>
            <label>
              Maximum tool / offer budget (KES)
              <input
                aria-label="Maximum tool / offer budget (KES)"
                type="number"
                min={0}
                max={1e9}
                step="any"
                value={draft.budget ?? ''}
                placeholder="No preference"
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    budget:
                      e.target.value === '' ? null : Number(e.target.value)
                  })
                }
              />
              <small>
                Compares minimum listed spend in KES, not task rewards. No
                currency conversion.
              </small>
            </label>
            {data?.authenticated && (
              <label className="bf-check">
                <input
                  type="checkbox"
                  checked={draft.rememberActivity}
                  onChange={(e) =>
                    setDraft({ ...draft, rememberActivity: e.target.checked })
                  }
                />
                <span>
                  Remember cards I open or share to tune my feed
                  <small>
                    Off by default. Up to 100 entries; turning this off erases
                    history.
                  </small>
                </span>
              </label>
            )}
            {error && (
              <p className="bf-error" role="alert">
                {error}
              </p>
            )}
            <button disabled={busy} type="submit" className="bf-primary">
              {busy
                ? 'Saving…'
                : data?.authenticated
                  ? 'Save preferences'
                  : 'Apply for this visit'}
              <ArrowRight size={16} />
            </button>
            {data?.authenticated && (
              <div className="bf-resets">
                <button
                  disabled={busy}
                  type="button"
                  onClick={() => void reset('hidden')}
                >
                  Restore hidden cards ({data.preferences.hiddenCount})
                </button>
                <button
                  disabled={busy}
                  type="button"
                  onClick={() => void reset('activity')}
                >
                  Clear open/share history ({data.preferences.activityCount})
                </button>
                <button
                  disabled={busy}
                  type="button"
                  onClick={() => void reset('following')}
                >
                  Unfollow all providers ({data.preferences.followingCount})
                </button>
                <button
                  disabled={busy}
                  type="button"
                  onClick={() => void reset('all')}
                >
                  Reset all discovery data
                </button>
              </div>
            )}
          </form>
        </Dialog>
      )}
      {modal && typeof modal === 'object' && (
        <Dialog title="Wairo editorial playbook" onClose={() => setModal(null)}>
          <div className="bf-playbook">
            <span className="bf-eyebrow">PRACTICAL, NOT PRESCRIPTIVE</span>
            <h2>{modal.title}</h2>
            <p>{modal.summary}</p>
            <ol>
              {modal.steps?.map(([title, body]) => (
                <li key={title}>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ol>
            <p className="bf-muted">
              General guidance, not a customer case study or a promise of
              results.
            </p>
            {modal.action && (
              <button
                type="button"
                className="bf-primary"
                onClick={() => {
                  if (modal.action?.href)
                    window.location.assign(modal.action.href);
                  else {
                    setKind(modal.action?.filter || 'all');
                    setTab('feed');
                    setQ('');
                    setPage(1);
                    setFocus('');
                    window.location.hash = 'city';
                  }
                  setModal(null);
                }}
              >
                {modal.action.label}
                <ArrowRight size={16} />
              </button>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}
