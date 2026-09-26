// ---------------------------------------------------------------------------
// COLLECTION PICKER — "Add to collection" from any object page.
//
// Lists the viewer's collections with current membership toggled. Adding is
// idempotent server-side; quick-create stays inline so a user never has to
// leave the object to start organizing. The quick "Save" action is the
// existing server save (the "Saved" bucket) — this picker is the organize
// layer on top of it.
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useState } from 'react';
import { Check, FolderPlus, Plus, X } from 'lucide-react';
import * as briefApi from '../api/briefApi';
import type { BriefCollectionSummary } from '../api/briefApi';

export function CollectionPicker({ objectId, onChanged }: {
  objectId: string;
  onChanged?: () => void;
}) {
  const [collections, setCollections] = useState<BriefCollectionSummary[]>([]);
  const [membership, setMembership] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    void briefApi.listCollections().then((r) => {
      if (!r.ok || !r.data) return;
      setCollections(r.data.collections);
      // Accurate initial membership: load each collection's live page (a few
      // requests at most) and mark the ones that already hold this object.
      const memberIds = new Set<string>();
      const checks = r.data.collections.slice(0, 20).map((c) =>
        briefApi.getMyCollection(c.id).then((page) => {
          if (page.ok && page.data?.collection.items.some((i) => i.object.id === objectId)) {
            memberIds.add(c.id);
          }
        }).catch(() => { /* keep going */ })
      );
      void Promise.all(checks).then(() => setMembership(memberIds));
    });
  }, [objectId]);

  useEffect(() => { reload(); }, [reload]);

  const toggle = (c: BriefCollectionSummary) => {
    const isMember = membership.has(c.id);
    setBusy(true);
    const call = isMember
      ? briefApi.removeFromCollection(c.id, objectId)
      : briefApi.addToCollection(c.id, objectId);
    void call.then((r) => {
      setBusy(false);
      if (r.ok) {
        setMembership((prev) => {
          const next = new Set(prev);
          if (isMember) next.delete(c.id);
          else next.add(c.id);
          return next;
        });
        onChanged?.();
      }
    });
  };

  const create = () => {
    const clean = name.trim();
    if (!clean || busy) return;
    setBusy(true);
    void briefApi.createCollection({ name: clean }).then((r) => {
      setBusy(false);
      if (r.ok && r.data) {
        setName('');
        setCreating(false);
        // Add the object straight into the fresh collection.
        void briefApi.addToCollection(r.data.collection.id, objectId).then((add) => {
          if (add.ok) {
            setMembership((prev) => new Set(prev).add(r.data.collection.id));
            onChanged?.();
          }
          reload();
        });
      }
    });
  };

  return (
    <div className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--brief-ink)]">
          Add to collection
        </p>
        {!creating && (
          <button type="button" onClick={() => setCreating(true)}
            className="flex items-center gap-1 text-[11px] font-bold text-[#40916C] cursor-pointer hover:underline">
            <Plus className="h-3 w-3" /> New
          </button>
        )}
      </div>

      {creating && (
        <div className="mb-2 flex items-center gap-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') create(); if (e.key === 'Escape') setCreating(false); }}
            placeholder="Collection name"
            aria-label="New collection name"
            className="min-w-0 flex-1 rounded-xl border border-[var(--brief-line)] px-2.5 py-1.5 text-[13px] font-semibold text-[var(--brief-ink)] outline-none focus:border-[#0891B2]"
          />
          <button type="button" onClick={create} disabled={busy || !name.trim()}
            className="rounded-full bg-[#40916C] px-3 py-1.5 text-[11px] font-extrabold text-[var(--accent-ink)] cursor-pointer disabled:opacity-40">
            Create
          </button>
          <button type="button" onClick={() => setCreating(false)} aria-label="Cancel"
            className="rounded-full border border-[var(--brief-line)] p-1.5 text-[var(--ink-60)] cursor-pointer">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {collections.length === 0 && !creating ? (
        <p className="py-2 text-center text-[12px] font-semibold text-[rgba(10, 14, 20,0.55)]">
          No collections yet — create one to start organizing.
        </p>
      ) : (
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {collections.map((c) => {
            const isMember = membership.has(c.id);
            return (
              <button key={c.id} type="button" onClick={() => toggle(c)} disabled={busy}
                className={`flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left cursor-pointer transition-colors disabled:opacity-50 ${
                  isMember ? 'border-[#0891B2] bg-[color:var(--color-well)]' : 'border-[var(--brief-line)] bg-[color:var(--color-paper)] hover:border-[#0891B2]/50'
                }`}>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                  isMember ? 'border-[#40916C] bg-[#40916C] text-[var(--accent-ink)]' : 'border-[var(--brief-line)] text-transparent'
                }`}>
                  <Check className="h-3 w-3" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-[var(--brief-ink)]">{c.name}</span>
                  <span className="block text-[11px] font-semibold text-[rgba(10, 14, 20,0.55)]">
                    {c.count} {c.count === 1 ? 'item' : 'items'} · {c.visibility}
                  </span>
                </span>
                <FolderPlus className="h-3.5 w-3.5 shrink-0 text-[rgba(10, 14, 20,0.4)]" />
              </button>
            );
          })}
        </div>
      )}

      <p className="mt-2 text-[11px] font-semibold text-[rgba(10, 14, 20,0.45)]">
        This only adds a reference — the object itself is never copied.
      </p>
    </div>
  );
}

export default CollectionPicker;
