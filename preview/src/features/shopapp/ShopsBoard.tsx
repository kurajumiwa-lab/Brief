import React, { useEffect, useState } from 'react';
import { MapPin, Clock, ArrowUpRight } from 'lucide-react';
import * as briefApi from '../../api/briefApi';
import type { PublicSpaceDirectory } from '../../api/briefApi';
import type { PublicSpace } from '../../api/types';
import { shortDate } from './format';
import { soundEngine } from '../../utils/SoundEngine';

// ---------------------------------------------------------------------------
// SHOPS — the commercial directory. One card per public shopfront, with the
// fields a trader actually checks: where it operates, when, what it lists,
// and since when it has been listed. Every value is the space's own stated
// field or a count of its rows; nothing is filled in by the app.
// ---------------------------------------------------------------------------

export const ShopsBoard: React.FC<{ onOpenSpace?: (slug: string) => void }> = ({ onOpenSpace }) => {
  const [dir, setDir] = useState<PublicSpaceDirectory | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    briefApi.listPublicSpaces(mode ?? undefined).then((res) => {
      if (!live) return;
      if (res.ok) setDir(res.data);
      else setError(res.error ?? 'The directory could not be loaded.');
    });
    return () => { live = false; };
  }, [mode]);

  if (error) return <p className="text-sm py-8" role="alert">{error}</p>;
  if (!dir) return <p className="text-sm py-8" role="status">Loading shops…</p>;

  return (
    <div className="space-y-3">
      {/* The arms the directory actually contains — the taxonomy the server
          sends, so the filter never offers a mode no shop uses. */}
      {dir.modes.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <button
            type="button"
            onClick={() => { soundEngine.play('tap'); setMode(null); }}
            className="shrink-0 px-3 py-1.5 rounded-full text-[11px] font-black cursor-pointer"
            style={mode === null ? { background: '#0A0E14', color: '#EAB308' } : { background: 'var(--color-paper)', color: 'var(--color-text-muted)', boxShadow: '0 1px 6px rgba(10,14,20,0.07)' }}
          >
            All
          </button>
          {dir.modes.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => { soundEngine.play('tap'); setMode(m.id); }}
              className="shrink-0 px-3 py-1.5 rounded-full text-[11px] font-black cursor-pointer"
              style={mode === m.id ? { background: '#0A0E14', color: '#EAB308' } : { background: 'var(--color-paper)', color: 'var(--color-text-muted)', boxShadow: '0 1px 6px rgba(10,14,20,0.07)' }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      {dir.spaces.length === 0 ? (
        <div className="rounded-3xl p-6 text-center" style={{ background: 'var(--color-paper)', boxShadow: '0 2px 10px rgba(10,14,20,0.05)' }}>
          <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>No shops listed here yet.</p>
          <p className="text-[12px] mt-1" style={{ color: 'var(--color-text-muted)' }}>A shop appears when its owner makes their space public.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {dir.spaces.map((s: PublicSpace) => (
            <button
              key={s.id}
              type="button"
              onClick={() => { if (onOpenSpace && s.slug) { soundEngine.play('tap'); onOpenSpace(s.slug); } }}
              className="w-full text-left rounded-3xl p-4 flex gap-3 cursor-pointer disabled:cursor-default"
              style={{ background: 'var(--color-paper)', boxShadow: '0 2px 10px rgba(10,14,20,0.05)' }}
              disabled={!onOpenSpace || !s.slug}
            >
              {s.image ? (
                <img
                  src={s.image}
                  alt=""
                  className="w-14 h-14 rounded-2xl object-cover shrink-0"
                  style={{ boxShadow: '0 2px 8px rgba(10,14,20,0.12)' }}
                />
              ) : (
                <span className="w-14 h-14 rounded-2xl grid place-items-center shrink-0" style={{ background: '#EEF1F5' }}>
                  <span className="text-[15px] font-black" style={{ color: 'var(--color-text-muted)' }}>
                    {s.name.trim().charAt(0).toUpperCase() || 'S'}
                  </span>
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[14px] font-black tracking-tight truncate" style={{ color: 'var(--color-text)' }}>
                    {s.name}
                  </p>
                  {s.modeLabel && (
                    <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide"
                      style={{ background: '#0A0E14', color: '#EAB308' }}>
                      {s.modeLabel}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                  {s.where && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3 shrink-0" />{s.where}</span>}
                  {s.when && <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3 shrink-0" />{s.when}</span>}
                </div>
                <p className="text-[11px] font-semibold mt-1 tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                  {s.activeOfferCount} {s.activeOfferCount === 1 ? 'item' : 'items'} listed · since {shortDate(s.createdAt)}
                </p>
                {s.sampleOffers?.length > 0 && (
                  <p className="text-[11px] font-semibold truncate mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                    {s.sampleOffers.map((o) => o.title).join(' · ')}
                  </p>
                )}
              </div>
              <span className="shrink-0 self-center inline-grid place-items-center w-8 h-8 rounded-xl" style={{ background: '#0A0E14', color: '#EAB308' }}>
                <ArrowUpRight className="w-4 h-4" />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ShopsBoard;
