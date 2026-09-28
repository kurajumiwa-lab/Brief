// ---------------------------------------------------------------------------
// REEL MEMORY — the two things the reel remembers about YOU, on this device.
//
//   seen   — you opened the detail, so the card can recede. Attention is a fact
//            about this sitting, not a claim about the board.
//   hidden — you swiped something away and the server had no object to record
//            it against, so the only honest place to keep it is here.
//
// Why device-local at all: "I have looked at this" is not a business fact. A
// save or a "not for me" IS recorded on the server (see the reel's own notes),
// and the reel merges both. This module only covers the part the server cannot
// hold — and the surface says which of the two it is doing, because a hide that
// dies with a browser cache must never be dressed as a preference.
//
// Everything here is guarded: no window, no storage, no throw. A private-mode
// browser gets a reel that simply forgets, never a screen that fails.
// ---------------------------------------------------------------------------

import type { DiscoverFeedItem } from '../../api/briefApi';

const KEY = 'brief.reel.memory.v1';

export interface ReelMemory {
  seen: string[];
  hidden: string[];
}

const EMPTY: ReelMemory = { seen: [], hidden: [] };

/** The stable name of a row, so two kinds can never collide on one id. */
export function reelKey(item: Pick<DiscoverFeedItem, 'kind' | 'id'>): string {
  return `${item.kind}:${item.id}`;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadReelMemory(): ReelMemory {
  const store = storage();
  if (!store) return EMPTY;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<ReelMemory>;
    return {
      seen: Array.isArray(parsed?.seen) ? parsed.seen.filter((k) => typeof k === 'string') : [],
      hidden: Array.isArray(parsed?.hidden) ? parsed.hidden.filter((k) => typeof k === 'string') : []
    };
  } catch {
    return EMPTY;
  }
}

function save(memory: ReelMemory): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(memory));
  } catch {
    // Full or blocked storage: the reel forgets and carries on.
  }
}

export function rememberSeen(keys: string[], memory: ReelMemory): ReelMemory {
  const seen = new Set(memory.seen);
  for (const key of keys) seen.add(key);
  // Bounded: a device memory that grows forever is a leak, not a memory.
  const next = { seen: Array.from(seen).slice(-200), hidden: memory.hidden };
  save(next);
  return next;
}

export function rememberHidden(key: string, memory: ReelMemory): ReelMemory {
  const hidden = new Set(memory.hidden);
  hidden.add(key);
  const next = { seen: memory.seen, hidden: Array.from(hidden).slice(-200) };
  save(next);
  return next;
}

export function forgetHidden(key: string, memory: ReelMemory): ReelMemory {
  const next = { seen: memory.seen, hidden: memory.hidden.filter((k) => k !== key) };
  save(next);
  return next;
}

export function forgetAllHidden(memory: ReelMemory): ReelMemory {
  const next = { seen: memory.seen, hidden: [] };
  save(next);
  return next;
}
