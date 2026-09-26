import React from 'react';
import * as briefApi from '../api/briefApi';
import type { MediaUpload } from '../api/types';

// ---------------------------------------------------------------------------
// MEDIA LIBRARY — the other half of the upload loop.
//
// ImageField uploads (uploadMediaFile); until now nothing ever listed or
// deleted what you uploaded. This panel sits beside the editor's photo fields
// and closes the loop over the rows the server already keeps:
//
//   - every entry is a REAL upload row from /api/media/mine (no thumbnails
//     invented, no sizes guessed),
//   - "Use" hands the real URL to the editor (hero or gallery),
//   - "Delete" calls the server's delete, which refuses files that are still
//     referenced by a story — that refusal is shown verbatim, because
//     "in use by …" is information, not an error to hide.
// ---------------------------------------------------------------------------

export interface MediaLibraryProps {
  /** Called with the chosen upload's URL. */
  onUse: (url: string) => void;
}

export function MediaLibrary({ onUse }: MediaLibraryProps) {
  const [rows, setRows] = React.useState<MediaUpload[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    const res = await briefApi.listMyMedia();
    if (res.ok) setRows(res.data);
    else {
      setRows([]);
      setError(res.error);
    }
  }, []);

  React.useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const handleDelete = async (id: string) => {
    setBusyId(id);
    setNote(null);
    const res = await briefApi.deleteMedia(id);
    setBusyId(null);
    if (!res.ok) {
      setNote(res.error);
      return;
    }
    setNote('Deleted.');
    await load();
  };

  return (
    <div className="rounded-xl border border-[var(--brief-line)] bg-[var(--color-well)] p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[var(--ink-60)]">
          Your media library
        </p>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-[11px] font-extrabold text-[var(--brief-ink)] cursor-pointer"
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>

      {open && (
        <>
          {error && (
            <p className="text-[11px] text-[var(--brief-ink)]">{error}</p>
          )}
          {rows === null && (
            <p className="text-[11px] text-[var(--ink-60)]">Loading…</p>
          )}
          {rows !== null && rows.length === 0 && !error && (
            <p className="text-[11px] text-[var(--ink-60)]">
              No uploads yet. Files you add above collect here, ready to reuse.
            </p>
          )}
          {rows !== null && rows.length > 0 && (
            <ul className="space-y-1.5 max-h-56 overflow-y-auto">
              {rows.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-2 rounded-lg bg-[color:var(--color-paper)] border border-[var(--brief-line)] px-2 py-1.5"
                >
                  <img
                    src={m.url}
                    alt=""
                    className="h-8 w-8 shrink-0 rounded-md object-cover bg-[var(--color-well)]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-bold text-[var(--brief-ink)]">
                      {m.originalName ?? 'unnamed upload'}
                    </p>
                    <p className="text-[11px] text-[var(--ink-60)]">
                      {(m.bytes / 1024).toFixed(0)} KB · {m.createdAt.slice(0, 10)}
                    </p>
                  </div>
                  <button
                    onClick={() => onUse(m.url)}
                    className="shrink-0 px-2 py-1 rounded-lg bg-[#40916C] text-[var(--accent-ink)] font-extrabold text-[11px] cursor-pointer"
                  >
                    Use
                  </button>
                  <button
                    onClick={() => handleDelete(m.id)}
                    disabled={busyId === m.id}
                    className="shrink-0 px-2 py-1 rounded-lg border border-[var(--brief-line)] font-bold text-[11px] text-[var(--ink-60)] cursor-pointer disabled:opacity-50"
                  >
                    {busyId === m.id ? '…' : 'Delete'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {note && <p className="text-[11px] text-[var(--ink-70)]">{note}</p>}
        </>
      )}
    </div>
  );
}
