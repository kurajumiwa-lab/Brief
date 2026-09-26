// ---------------------------------------------------------------------------
// ENTITY CHIP — the tappable "Venue · X" / "Hosted by X" / "Source · X" link
// on feed cards, connecting an object to its followable entity page.
//
// Only renders a LINK when a real entity exists behind the name (resolved
// through the server's by-name endpoint); otherwise it renders the same text
// as inert metadata. No link is ever invented, and no entity page is ever
// manufactured. Resolutions are cached per (kind, name) so a feed of cards
// costs at most one lookup per distinct name.
// ---------------------------------------------------------------------------

import React, { useEffect, useState } from 'react';
import * as briefApi from '../api/briefApi';
import type { EntityKind } from '../api/briefApi';

const CACHE = new Map<string, string | null>();

interface EntityChipProps {
  kind: EntityKind;
  /** Exact entity name (resolved via by-name lookup), or a direct entity id
   *  when the object itself IS the entity (e.g. a place card). */
  name?: string;
  directId?: string;
  onOpenEntity: (entityId: string) => void;
  className?: string;
}

function labelFor(kind: EntityKind, name: string): string {
  if (kind === 'organizer') return `Hosted by ${name}`;
  if (kind === 'publisher') return `Source · ${name}`;
  if (kind === 'business') return `Business · ${name}`;
  if (kind === 'community') return `Community · ${name}`;
  return `Venue · ${name}`;
}

export function EntityChip({ kind, name, directId, onOpenEntity, className }: EntityChipProps) {
  const [resolvedId, setResolvedId] = useState<string | null>(directId ?? null);
  const [done, setDone] = useState(Boolean(directId));

  useEffect(() => {
    if (directId) {
      setResolvedId(directId);
      setDone(true);
      return;
    }
    if (!name) {
      setDone(true);
      return;
    }
    const key = `${kind}:${name}`;
    if (CACHE.has(key)) {
      setResolvedId(CACHE.get(key) ?? null);
      setDone(true);
      return;
    }
    let live = true;
    briefApi.getEntityByName(kind, name).then((res) => {
      if (!live) return;
      const id = res.ok && res.data.entity ? res.data.entity.id : null;
      CACHE.set(key, id);
      setResolvedId(id);
      setDone(true);
    });
    return () => { live = false; };
  }, [kind, name, directId]);

  // While resolving, show nothing rather than a flickering label; once
  // resolved, an entity that doesn't exist renders as inert metadata.
  if (!done) return null;

  const text = name ? labelFor(kind, name) : '';
  if (!text) return null;

  if (resolvedId) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenEntity(resolvedId);
        }}
        className={`inline-flex items-center rounded-full bg-[var(--color-well)] px-2 py-0.5 text-[11px] font-bold text-[#40916C] transition-colors hover:bg-[#40916C] hover:text-[var(--accent-ink)] ${className ?? ''}`}
        title={`Open ${name}`}
      >
        {text}
      </button>
    );
  }

  return (
    <span className={`inline-flex items-center px-1 text-[11px] font-semibold text-[var(--ink-60)] ${className ?? ''}`}>
      {text}
    </span>
  );
}
