import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Link2, UploadCloud } from 'lucide-react';
import * as briefApi from '../api/briefApi';

// ---------------------------------------------------------------------------
// IMAGE FIELD — put a real file in, not a link.
//
// The editorial surfaces used to take a URL and nothing else, which meant
// every photo in Brief was somebody else's asset on somebody else's server:
// it could rot, hotlink-block, or change quietly under a published story.
// Uploading is now the default action; pasting a link is still possible but
// has to be asked for, because there are legitimate cases (an agency image
// with attribution) and no reason to make them the front door.
//
// What this component does NOT do:
//   * it does not pretend to know the file is valid before the server has
//     sniffed it. The server decides from the magic bytes; its refusal is
//     shown here word for word.
//   * it does not invent a local preview URL. There is nothing to show until
//     the upload has really landed, so the honest state is "uploading".
// ---------------------------------------------------------------------------

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

export interface ImageFieldProps {
  label: string;
  hint?: string;
  /** The current image: an uploaded file's URL or an external link. */
  value?: string | null;
  onChange?: (url: string | null) => void;
  /** Gallery mode: several files at once, each reported as it lands. */
  onAdd?: (url: string) => void;
  multiple?: boolean;
  /** Compact rows sit inside a form; the full variant is a drop zone. */
  compact?: boolean;
}

export function ImageField({
  label,
  hint,
  value = null,
  onChange,
  onAdd,
  multiple = false,
  compact = false
}: ImageFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [useLink, setUseLink] = useState(false);
  const [link, setLink] = useState('');
  const [limitMb, setLimitMb] = useState<number | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // What this deployment can actually promise. Asked for, not assumed: the
  // limit and the "local disk" caveat come from the server that enforces them.
  useEffect(() => {
    let cancelled = false;
    void briefApi.getMediaStatus().then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        // Most often a signed-out session: uploads need one. Say it once,
        // honestly, instead of failing at pick time with no context.
        if (/sign|401|unauthor/i.test(res.error ?? '')) {
          setError('Sign in to upload images — an external link still works.');
        }
        return;
      }
      setLimitMb(Math.round(res.data.uploads.maxBytes / 1048576));
      setPersisted(res.data.uploads.persisted);
    });
    return () => { cancelled = true; };
  }, []);

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files ?? []).filter(Boolean);
    if (!list.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of list) {
        setProgress(file.name || 'photo');
        const res = await briefApi.uploadMediaFile(file);
        if (!alive.current) return;
        if (!res.ok) {
          // The server's reason, verbatim. It is the only authority on what
          // the bytes really are.
          setError(res.error);
          continue;
        }
        // Persist the server's own URL (`/api/media/file/<id>`), not the
        // `/ingest`-prefixed display URL. A stored ingest path is how a photo
        // that uploaded fine then 404s on every card.
        const stored = res.data.upload.url;
        if (onAdd) onAdd(stored);
        else onChange?.(stored);
        if (!multiple) break;
      }
    } finally {
      if (alive.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length) void upload(files);
    // Clear it so choosing the SAME file again still fires a change event.
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (files && files.length) void upload(files);
  };

  const formats = `JPEG, PNG, WebP or GIF${limitMb ? ` · up to ${limitMb} MB` : ''}`;

  if (value) {
    return (
      <div>
        <p className="text-[12px] font-bold text-[var(--brief-ink)]">{label}</p>
        <div className="mt-1 flex items-center gap-2">
          <img
            src={briefApi.mediaFileUrl(value)}
            alt=""
            className="h-14 w-20 shrink-0 rounded-lg border border-[var(--brief-line)] object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] text-[var(--ink-60)]">{value}</p>
            <div className="mt-1 flex gap-1.5">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="rounded-md border border-[var(--brief-line)] px-2 py-1 text-[11px] font-bold text-[var(--brief-ink)] cursor-pointer disabled:opacity-40"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={() => onChange?.(null)}
                className="rounded-md border border-[var(--brief-line)] px-2 py-1 text-[11px] font-bold text-[var(--ink-60)] cursor-pointer"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={onPick}
          aria-label={`Replace ${label}`}
        />
        {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <p className="text-[12px] font-bold text-[var(--brief-ink)]">{label}</p>
      {hint && <p className="text-[11px] text-[var(--ink-70)]">{hint}</p>}

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className={`mt-1 rounded-xl border border-dashed border-[var(--brief-line)] bg-[color:var(--color-well)] ${compact ? 'p-2.5' : 'p-4'} text-center`}
      >
        {busy ? (
          <p className="text-[11px] text-[var(--ink-60)]">Uploading {progress}…</p>
        ) : (
          <>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#40916C] px-3 py-1.5 text-[11px] font-extrabold text-[var(--accent-ink)] cursor-pointer hover:bg-[#000000]"
            >
              {multiple ? <UploadCloud className="h-3.5 w-3.5" /> : <ImagePlus className="h-3.5 w-3.5" />}
              {multiple ? 'Choose photos' : 'Choose photo'}
            </button>
            {!compact && (
              <p className="mt-1.5 text-[11px] text-[var(--ink-60)]">
                or drop {multiple ? 'them' : 'it'} here · {formats}
              </p>
            )}
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple={multiple}
        className="hidden"
        onChange={onPick}
        aria-label={multiple ? `Add ${label}` : `Upload ${label}`}
      />

      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}

      {useLink ? (
        <div className="mt-1.5 flex gap-1.5">
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://…/photo.jpg"
            className="flex-1 rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-well)] px-2.5 py-1.5 text-[12px] text-[var(--brief-ink)] outline-none focus:border-[#0891B2]"
          />
          <button
            type="button"
            disabled={!link.trim()}
            onClick={() => {
              const url = link.trim();
              if (!url) return;
              if (onAdd) onAdd(url);
              else onChange?.(url);
              setLink('');
            }}
            className="rounded-lg bg-[#40916C] px-2.5 py-1.5 text-[11px] font-extrabold text-[var(--accent-ink)] cursor-pointer disabled:opacity-40"
          >
            Use
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setUseLink(true)}
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-[var(--ink-60)] underline cursor-pointer"
        >
          <Link2 className="h-3 w-3" /> Use a link instead
        </button>
      )}

      {persisted === false && (
        <p className="mt-1 text-[11px] text-[var(--ink-60)]">
          Photos are stored on this server's disk: they survive a restart, not a redeploy to a fresh container.
        </p>
      )}
    </div>
  );
}

export default ImageField;
