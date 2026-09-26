import React, { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import * as briefApi from '../api/briefApi';
import { StoryView } from './StoryView';
import { designOf, accentFor, themeFor } from './storyDesign';

// ---------------------------------------------------------------------------
// STORY READER — the public article page.
//
// Renders one published story through the SAME StoryView the editor previewed:
// its theme, layout, accent and hero overlay, exactly as designed. Below the
// story: the GALLERY of extra photos the editor added, and the LIKE bar —
// the public rating, recorded as a real act by a signed-in reader.
// A missing/unpublished slug resolves to an honest not-found state.
// ---------------------------------------------------------------------------

export function TeaReader({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [state, setState] = React.useState<{ status: 'loading' | 'ready' | 'missing'; article: any | null }>({ status: 'loading', article: null });
  const [likeState, setLikeState] = useState<{ count: number; liked: boolean; busy: boolean; note: string | null }>({ count: 0, liked: false, busy: false, note: null });

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await briefApi.getTeaArticle(slug);
      if (!live) return;
      if (res.ok) {
        setState({ status: 'ready', article: res.data });
        setLikeState({ count: Number((res.data as any)?.likeCount ?? 0), liked: Boolean((res.data as any)?.likedByMe), busy: false, note: null });
      } else {
        setState({ status: 'missing', article: null });
      }
    })();
    return () => { live = false; };
  }, [slug]);

  const toggleLike = async () => {
    const a = state.article;
    if (!a || likeState.busy) return;
    setLikeState((s) => ({ ...s, busy: true, note: null }));
    const res = likeState.liked
      ? await briefApi.unlikeTeaArticle(a.id)
      : await briefApi.likeTeaArticle(a.id);
    if (res.ok) {
      setLikeState({ count: res.data.likeCount, liked: res.data.liked, busy: false, note: null });
    } else if (res.status === 401) {
      setLikeState((s) => ({ ...s, busy: false, note: 'Sign in to like stories.' }));
    } else {
      setLikeState((s) => ({ ...s, busy: false, note: res.error }));
    }
  };

  const design = designOf(state.article);
  const theme = themeFor(design);
  const accent = accentFor(design);
  const gallery: string[] = Array.isArray(state.article?.images) ? state.article.images : [];

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-[var(--ink-90)] backdrop-blur-md" onClick={onClose}>
      <div className="mx-auto min-h-full max-w-2xl px-4 py-8" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="mb-4 text-[13px] font-bold text-[var(--ink-60)] cursor-pointer">← Back</button>

        {state.status === 'loading' && <p className="text-sm text-[var(--ink-60)]">Loading…</p>}

        {state.status === 'missing' && (
          <div className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-5">
            <p className="text-sm font-bold text-[var(--brief-ink)]">This story is not available.</p>
            <p className="mt-1 text-[13px] text-[var(--ink-60)]">It may be unpublished, expired, or the link is wrong.</p>
          </div>
        )}

        {state.status === 'ready' && state.article && (() => {
          const a = state.article;
          return (
            <article className="space-y-4">
              {/* the designed story — exactly what the editor previewed */}
              <div className="overflow-hidden rounded-2xl border border-[var(--brief-line)]">
                <StoryView article={a} design={design} mode="read" />
              </div>

              {/* the gallery: every photo the editor added, for the viewer */}
              {gallery.length > 0 && (
                <section className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-4">
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--brief-ink)]">
                    Gallery · {gallery.length} photo{gallery.length === 1 ? '' : 's'}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {gallery.map((url) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-[var(--brief-line)]">
                        <img src={briefApi.mediaFileUrl(url)} alt="" loading="lazy" className="h-32 w-full object-cover transition-transform duration-300 hover:scale-[1.03]" />
                      </a>
                    ))}
                  </div>
                </section>
              )}

              {/* the like bar — the public rating */}
              <section className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-bold text-[var(--brief-ink)]">
                      {likeState.count} like{likeState.count === 1 ? '' : 's'}
                    </p>
                    <p className="text-[11px] text-[var(--ink-70)]">The public rating — recorded by readers, derived from real rows.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleLike()}
                    disabled={likeState.busy}
                    className="flex h-10 items-center gap-2 rounded-xl border px-4 text-[13px] font-extrabold cursor-pointer disabled:opacity-40 transition-all"
                    style={{
                      background: likeState.liked ? '#40916C' : 'var(--color-paper)',
                      color: likeState.liked ? 'var(--brief-ink)' : 'var(--brief-ink)',
                      borderColor: 'var(--brief-ink)'
                    }}
                    aria-pressed={likeState.liked}
                  >
                    <Heart
                      className="h-4 w-4"
                      style={{ fill: likeState.liked ? (accent === 'var(--brief-ink)' ? 'var(--brief-ink)' : accent === 'var(--brief-ink)' ? 'var(--brief-ink)' : accent) : 'none', stroke: likeState.liked ? 'currentColor' : 'currentColor' }}
                    />
                    {likeState.liked ? 'Liked' : 'Like'}
                  </button>
                </div>
                {likeState.note && <p className="mt-2 text-[11px] text-[var(--ink-60)]">{likeState.note}</p>}
              </section>

              {a.source && (
                <p className="border-t pt-3 text-[12px]" style={{ color: theme.inkDim, borderColor: theme.line }}>
                  Source: {a.source}
                  {a.sourceUrl ? ` · ${a.sourceUrl}` : ''}
                </p>
              )}
              {(a.relatedContent?.length > 0 || a.relatedPlaces?.length > 0 || a.relatedEvents?.length > 0) && (
                <div className="rounded-xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[var(--brief-ink)]">Related</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {[...(a.relatedPlaces ?? []), ...(a.relatedEvents ?? []), ...(a.relatedContent ?? [])].map((r: string, i: number) => (
                      <span key={i} className="rounded-full border border-[var(--brief-line)] px-2 py-0.5 text-[11px] text-[var(--ink-60)]">{r}</span>
                    ))}
                  </div>
                </div>
              )}
            </article>
          );
        })()}
      </div>
    </div>
  );
}

export default TeaReader;
