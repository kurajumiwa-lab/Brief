// ---------------------------------------------------------------------------
// COLLECTION PAGE — one personal collection, rendered twice:
//   mode 'owner'  inside the Collections surface (full controls)
//   mode 'public' from a shared /collections/:id link (read-only)
//
// Everything renders from the SERVER's live projection: items are resolved
// at read time, so an expired offer shows its real "Expired" status, an
// object that became private silently drops out of public rendering, and a
// cover is derived from real item images (or an honest type/location
// treatment when there are none — nothing is fabricated).
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, ArrowUp, ArrowDown, Bookmark, Check, ChevronDown, Globe,
  MapPin, Pencil, Share2, Trash2, X
} from 'lucide-react';
import * as briefApi from '../api/briefApi';
import type { CollectionPage as CollectionPageData } from '../api/briefApi';

const INK = '#0D1117';
const MUTED = 'rgba(10, 14, 20,0.62)';
const LINE = 'var(--brief-line)';
const ACCENT = '#40916C';

/** Honest status label: expired content is never presented as active. */
export function collectionStatusLabel(o: any): string | null {
  const t = o?.temporal;
  if (!t?.status) return null;
  if (t.status === 'happening') return 'Happening now';
  if (t.status === 'upcoming' && typeof t.startsAt === 'string') {
    const d = new Date(t.startsAt);
    if (Number.isFinite(d.getTime())) {
      return `On ${d.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' })}`;
    }
    return 'Upcoming';
  }
  if (t.status === 'active' && typeof t.deadlineAt === 'string') {
    const d = new Date(t.deadlineAt);
    if (Number.isFinite(d.getTime())) return `Closes ${d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}`;
    return 'Active';
  }
  if (t.status === 'active' || t.status === 'no_deadline' || t.status === 'current') return 'Active';
  if (t.status === 'expired' || t.status === 'past') {
    const type = String(o.type ?? '');
    if (type === 'event' || type === 'experience') return 'Ended';
    if (type === 'opportunity') return 'Closed';
    return 'Expired';
  }
  return null;
}

/** Image URL from the public projection (media.url). */
function imageOf(o: any): string | null {
  return typeof o?.media?.url === 'string' && o.media.url ? o.media.url : null;
}

function CoverMosaic({ cover, name }: { cover: briefApi.CollectionCover; name: string }) {
  const urls = cover.kind === 'mosaic' ? (cover.urls ?? []) : cover.kind === 'single' || cover.kind === 'custom' ? [cover.url ?? ''] : [];
  const real = urls.filter(Boolean);
  if (real.length >= 2) {
    return (
      <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-0.5">
        {real.slice(0, 4).map((u, i) => (
          <img key={i} src={u} alt="" aria-hidden="true" loading="lazy" className="h-full w-full object-cover" />
        ))}
      </div>
    );
  }
  if (real.length === 1) {
    return <img src={real[0]} alt="" aria-hidden="true" loading="lazy" className="h-full w-full object-cover" />;
  }
  // No real images: a type/location-based visual TREATMENT (never a fake
  // photo) — a calm gradient carrying the collection's first letter.
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#FFF4EC] via-[#FFE4D1] to-[#FFD9C2]">
      <span className="text-3xl font-extrabold text-white/85">{name.trim().slice(0, 1).toUpperCase() || 'C'}</span>
    </div>
  );
}

function notFoundBlock(onClose: () => void) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <Bookmark className="h-8 w-8 text-[rgba(10, 14, 20,0.35)]" />
      <p className="text-[15px] font-bold text-[var(--brief-ink)]">This collection isn't available</p>
      <p className="max-w-sm text-[13px] leading-relaxed text-[rgba(10, 14, 20,0.62)]">
        It may have been deleted, or it's private. Brief never reveals the
        existence of private collections.
      </p>
      <button type="button" onClick={onClose} className="mt-2 rounded-full bg-[#40916C] px-5 py-2 text-[12px] font-bold text-[var(--accent-ink)] cursor-pointer">
        Back
      </button>
    </div>
  );
}

export function CollectionPage({ collectionId, mode, onClose, onOpenObject, onChanged }: {
  collectionId: string;
  mode: 'owner' | 'public';
  onClose: () => void;
  onOpenObject: (object: any) => void;
  onChanged?: () => void;
}) {
  const [page, setPage] = useState<CollectionPageData | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sharedUrl, setSharedUrl] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!collectionId) return;
    setLoading(true);
    const call = mode === 'owner'
      ? briefApi.getMyCollection(collectionId)
      : briefApi.getPublicCollection(collectionId);
    call.then((r) => {
      setLoading(false);
      if (r.ok && r.data) { setPage(r.data.collection); setMissing(false); }
      else { setPage(null); setMissing(true); }
    });
  }, [collectionId, mode]);

  useEffect(() => { reload(); }, [reload]);

  const commitRename = () => {
    const name = draftName.trim();
    if (!name || !page) return;
    setBusy(true);
    void briefApi.updateCollection(page.id, { name }).then((r) => {
      setBusy(false);
      if (r.ok) { setRenaming(false); reload(); onChanged?.(); }
    });
  };

  const toggleVisibility = () => {
    if (!page) return;
    setBusy(true);
    const next = page.visibility === 'public' ? 'private' : 'public';
    void briefApi.updateCollection(page.id, { visibility: next }).then((r) => {
      setBusy(false);
      if (r.ok) { reload(); onChanged?.(); }
    });
  };

  const share = () => {
    if (!page) return;
    void briefApi.shareCollection(page.id).then((r) => {
      if (!r.ok || !r.data?.url) return;
      setSharedUrl(r.data.url);
      try { void navigator.clipboard?.writeText(r.data.url); } catch { /* best-effort */ }
    });
  };

  const doDelete = () => {
    if (!page) return;
    setBusy(true);
    void briefApi.deleteCollection(page.id).then((r) => {
      setBusy(false);
      if (r.ok) { onChanged?.(); onClose(); }
    });
  };

  const removeItem = (objectId: string) => {
    if (!page) return;
    void briefApi.removeFromCollection(page.id, objectId).then((r) => {
      if (r.ok) { reload(); onChanged?.(); }
    });
  };

  const moveItem = (objectId: string, dir: -1 | 1) => {
    if (!page) return;
    const ids = page.items.map((i) => i.object.id);
    const at = ids.indexOf(objectId);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to], ids[at]];
    void briefApi.reorderCollection(page.id, ids).then((r) => { if (r.ok) reload(); });
  };

  const openShareLink = () => {
    if (sharedUrl) window.open(sharedUrl, '_blank', 'noopener');
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-[rgba(10, 14, 20, 0.85)] backdrop-blur-md" role="dialog" aria-label="Collection">
        <div className="mx-auto min-h-full max-w-3xl bg-[color:var(--color-paper)] px-4 py-5 sm:px-6">
          <div className="h-24 animate-pulse rounded-2xl bg-[#EFF1F4]" />
        </div>
      </div>
    );
  }

  if (missing || !page) return notFoundBlock(onClose);

  const isPublic = page.visibility === 'public';
  const status = (o: any) => collectionStatusLabel(o);
  const expiredStyle = (o: any) => {
    const s = status(o);
    return s === 'Ended' || s === 'Expired' || s === 'Closed';
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[rgba(10, 14, 20, 0.85)] backdrop-blur-md" role="dialog" aria-label={`Collection ${page.name}`}>
      <div className="mx-auto min-h-full max-w-3xl bg-[color:var(--color-paper)] px-4 py-5 sm:px-6">
        {/* Top bar */}
        <div className="mb-4 flex items-center justify-between">
          <button type="button" onClick={onClose} aria-label="Back" className="flex items-center gap-1 rounded-full border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-3 py-1.5 text-[12px] font-bold text-[var(--brief-ink)] cursor-pointer hover:border-[#0891B2]">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <div className="flex items-center gap-2">
            {mode === 'owner' && (
              <button type="button" onClick={toggleVisibility} disabled={busy}
                className="rounded-full border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-3 py-1.5 text-[11px] font-extrabold text-[var(--ink-70)] cursor-pointer hover:border-[#0891B2] disabled:opacity-50">
                {isPublic ? <span className="flex items-center gap-1"><Globe className="h-3 w-3" /> Public</span> : <span className="flex items-center gap-1"><Check className="h-3 w-3" /> Private</span>}
              </button>
            )}
            {isPublic && (
              <button type="button" onClick={share}
                className="flex items-center gap-1 rounded-full bg-[#40916C] px-3 py-1.5 text-[11px] font-extrabold text-[var(--accent-ink)] cursor-pointer hover:bg-[#EFF1F4]">
                <Share2 className="h-3 w-3" /> Share
              </button>
            )}
            {mode === 'owner' && (
              <button type="button" onClick={() => setConfirmDelete(true)}
                className="rounded-full border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-3 py-1.5 text-[11px] font-extrabold text-[#DC2626] cursor-pointer hover:border-[#DC2626]">
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Cover + identity */}
        <div className="overflow-hidden rounded-3xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] shadow-sm">
          <div className="h-44 w-full sm:h-56">
            <CoverMosaic cover={page.cover} name={page.name} />
          </div>
          <div className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[color:var(--color-well)] px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#40916C]">
                Collection
              </span>
              <span className="rounded-full bg-[color:var(--color-well)] px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#40916C]">
                {isPublic ? 'Public' : 'Private'}
              </span>
              <span className="text-[11px] font-semibold text-[rgba(10, 14, 20,0.62)]">
                {page.count} {page.count === 1 ? 'item' : 'items'} · updated {new Date(page.updatedAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}
              </span>
            </div>

            {renaming ? (
              <div className="mt-2 flex items-center gap-2">
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
                  className="flex-1 rounded-xl border border-[#0891B2] px-3 py-1.5 text-[16px] font-extrabold text-[var(--brief-ink)] outline-none"
                  aria-label="Collection name"
                />
                <button type="button" onClick={commitRename} disabled={busy || !draftName.trim()}
                  className="rounded-full bg-[#40916C] px-3 py-1.5 text-[11px] font-extrabold text-[var(--accent-ink)] cursor-pointer disabled:opacity-40">
                  Save
                </button>
                <button type="button" onClick={() => setRenaming(false)} aria-label="Cancel rename"
                  className="rounded-full border border-[var(--brief-line)] px-2 py-1.5 text-[var(--ink-60)] cursor-pointer">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <h1 className="mt-1 text-[30px] font-extrabold leading-tight text-[var(--brief-ink)] sm:text-[30px]">
                {page.name}
              </h1>
            )}

            {mode === 'owner' && !renaming && (
              <button type="button" onClick={() => { setDraftName(page.name); setRenaming(true); }}
                className="mt-1 flex items-center gap-1 text-[11px] font-bold text-[#40916C] cursor-pointer hover:underline">
                <Pencil className="h-3 w-3" /> Rename
              </button>
            )}

            {page.description && (
              <p className="mt-2 text-[13px] leading-relaxed text-[rgba(10, 14, 20,0.62)]">{page.description}</p>
            )}

            {/* Location context from the items' own fields — never duplicated. */}
            {(page.locations.areas.length > 0 || page.locations.counties.length > 0) && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-[#40916C]" />
                {[...page.locations.areas, ...page.locations.counties].slice(0, 6).map((loc) => (
                  <span key={loc} className="rounded-full bg-[color:var(--color-well)] px-2.5 py-0.5 text-[11px] font-bold text-[#40916C]">
                    {loc}
                  </span>
                ))}
              </div>
            )}

            {sharedUrl && (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#0891B2]/40 bg-[rgba(238, 241, 245, 0.60)] px-3 py-2">
                <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[#40916C]">{sharedUrl}</p>
                <button type="button" onClick={openShareLink}
                  className="shrink-0 rounded-full bg-[#40916C] px-2.5 py-1 text-[11px] font-extrabold text-[var(--accent-ink)] cursor-pointer">
                  Open
                </button>
              </div>
            )}

            {confirmDelete && (
              <div className="mt-3 rounded-xl border border-[#DC2626]/40 bg-[color:var(--color-well)] px-3 py-2.5">
                <p className="text-[12px] font-bold text-[#DC2626]">Delete "{page.name}"?</p>
                <p className="mt-0.5 text-[11px] text-[#DC2626]/80">The objects themselves are never deleted — only this collection.</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={doDelete} disabled={busy}
                    className="rounded-full bg-[#DC2626] px-3 py-1 text-[11px] font-extrabold text-white cursor-pointer">
                    Delete
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(false)}
                    className="rounded-full border border-[var(--brief-line)] bg-[color:var(--color-paper)] px-3 py-1 text-[11px] font-extrabold text-[var(--brief-ink)] cursor-pointer">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Items */}
        <div className="mt-5 space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[12px] font-extrabold uppercase tracking-[0.18em] text-[var(--brief-ink)]">
              Items <span className="text-[rgba(10, 14, 20,0.45)]">· {page.count}</span>
            </h2>
            {mode === 'owner' && page.items.length > 1 && (
              <span className="text-[11px] font-semibold text-[rgba(10, 14, 20,0.45)]">Use the arrows to reorder</span>
            )}
          </div>

          {page.items.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[var(--brief-line)] px-6 py-12 text-center">
              <Bookmark className="h-6 w-6 text-[rgba(10, 14, 20,0.35)]" />
              <p className="text-[14px] font-semibold text-[var(--brief-ink)]">Nothing here yet</p>
              <p className="max-w-xs text-[13px] leading-relaxed text-[rgba(10, 14, 20,0.62)]">
                Save an object from its page and add it to this collection.
              </p>
            </div>
          )}

          {page.items.map((item) => {
            const o = item.object;
            const line = status(o);
            const isExpired = expiredStyle(o);
            return (
              <div key={item.id} className="group flex items-stretch gap-2 rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-2 shadow-sm transition-shadow hover:shadow-md">
                <button type="button" onClick={() => onOpenObject(o)}
                  className="flex min-w-0 flex-1 items-stretch gap-2.5 text-left cursor-pointer">
                  {imageOf(o) ? (
                    <img src={imageOf(o) ?? ''} alt="" aria-hidden="true" loading="lazy" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#EFF1F4] to-[var(--brief-line)] text-[11px] font-bold uppercase text-[#5A6472]">
                      {String(o.type ?? '').slice(0, 4)}
                    </div>
                  )}
                  <span className="min-w-0 py-0.5">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#0891B2]">{o.type}</span>
                      {line && (
                        <span className={`text-[11px] font-extrabold ${isExpired ? 'text-[#DC2626]' : 'text-[rgba(10, 14, 20,0.62)]'}`}>
                          {line}
                        </span>
                      )}
                      {o.locationName && (
                        <span className="flex items-center gap-0.5 text-[11px] font-semibold text-[rgba(10, 14, 20,0.45)]">
                          <MapPin className="h-2.5 w-2.5" /> {o.locationName}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[13px] font-semibold leading-snug text-[var(--brief-ink)] group-hover:text-[#40916C]">
                      {o.title}
                    </span>
                  </span>
                </button>

                {mode === 'owner' && (
                  <span className="flex shrink-0 flex-col items-center justify-center gap-1">
                    <button type="button" aria-label="Move up" onClick={() => moveItem(o.id, -1)}
                      className="rounded-full p-1 text-[rgba(10, 14, 20,0.4)] cursor-pointer hover:bg-[color:var(--color-well)] hover:text-[#40916C]">
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" aria-label="Remove" onClick={() => removeItem(o.id)}
                      className="rounded-full p-1 text-[rgba(10, 14, 20,0.4)] cursor-pointer hover:bg-[color:var(--color-well)] hover:text-[#DC2626]">
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" aria-label="Move down" onClick={() => moveItem(o.id, 1)}
                      className="rounded-full p-1 text-[rgba(10, 14, 20,0.4)] cursor-pointer hover:bg-[color:var(--color-well)] hover:text-[#40916C]">
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </div>
            );
          })}

          {mode === 'owner' && (
            <div className="pt-2 text-center">
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#40916C]">
                <ChevronDown className="h-3 w-3 rotate-180" />
                {isPublic ? 'Shareable: /collections/' + page.id : 'Make this collection public to share it'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CollectionPage;
