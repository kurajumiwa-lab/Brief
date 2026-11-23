import { useEffect, useMemo, useState } from "react";
import { GalleryVerticalEnd, ImagePlus, LayoutGrid, Trash2, X } from "lucide-react";
import Media from "@/components/ui/Media";
import Button from "@/components/ui/Button";
import { fileAPI } from "@/lib/api";
import { readGalleryPhoto } from "@/lib/images";
import {
  DEFAULT_GALLERY_TAG, GALLERY_TAGS, GALLERY_TAG_VALUES, MAX_GALLERY_ITEMS, galleryTag,
} from "@/config/showcase";
import { cn } from "@/lib/utils";

/**
 * THE GALLERY BOARD — the part of a page a stranger looks at first.
 *
 * A cleaner, a cook, a tailor or a printer is chosen with the eyes: what did the
 * job look like when it was finished? This is a *board*, not a slideshow. The
 * three things that make it one:
 *
 *   · **It fills.** Photos are laid out in columns, so a tall before-and-after
 *     sits next to two square shots without cropping either to a shape the
 *     photo never had. (Pinterest keeps its rhythm this way; so does this.)
 *   · **It narrows.** One chip row, one filter. The counts come from the photos
 *     on the page, so a chip is never a promise of nothing.
 *   · **It opens.** A tap enlarges the photo and shows the caption, because the
 *     detail that sells the job is usually in the corner of the frame.
 *
 * A visitor with no photos sees nothing at all — no empty frame, no "coming
 * soon". The owner sees the same board plus one quiet way to add photos, and
 * can remove a single photo without leaving the page.
 */
export default function GalleryBoard({
  items = [],
  own = false,
  onAdd,
  onRemove,
  title = "Portfolio",
  blurb,
}) {
  const photos = useMemo(
    () => (Array.isArray(items) ? items.filter((item) => item?.image_url) : []),
    [items],
  );
  const [tag, setTag] = useState("all");
  const [density, setDensity] = useState("grid");
  const [open, setOpen] = useState(null);

  // A photo can be removed while its lightbox is open; close it rather than
  // showing a frame that no longer exists.
  useEffect(() => {
    if (open !== null && open >= photos.length) setOpen(null);
  }, [open, photos.length]);

  if (!photos.length && !own) return null;

  const counts = GALLERY_TAGS.reduce((acc, entry) => {
    acc[entry.value] = photos.filter((photo) => (photo.tag || DEFAULT_GALLERY_TAG) === entry.value).length;
    return acc;
  }, {});
  const visible = tag === "all" ? photos : photos.filter((photo) => (photo.tag || DEFAULT_GALLERY_TAG) === tag);
  const chip = tag === "all" ? null : galleryTag(tag);

  return (
    <section
      id="gallery"
      data-testid="page-gallery"
      aria-labelledby="gallery-heading"
      className="rounded-2xl border border-edge-1 bg-surface-1 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="gallery-heading" className="text-base font-extrabold tracking-tight text-ink-1">
            {title}
          </h2>
          <p className="mt-0.5 text-2xs leading-relaxed text-ink-3">
            {blurb || (own
              ? "Your photos, in your own words. A buyer looks here before they read anything else."
              : "The work, the premises and the people — as they actually are.")}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {own && (
            <span className="text-micro tabular-nums text-ink-4">
              {photos.length} / {MAX_GALLERY_ITEMS}
            </span>
          )}
          {photos.length > 1 && (
            <button
              type="button"
              onClick={() => setDensity((value) => (value === "grid" ? "board" : "grid"))}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-edge-1 bg-surface-0 px-2 text-micro font-bold text-ink-3 hover:border-edge-2 hover:text-ink-1"
              aria-label={density === "grid" ? "Switch to the tall board" : "Switch to square tiles"}
            >
              {density === "grid" ? <GalleryVerticalEnd size={13} aria-hidden="true" /> : <LayoutGrid size={13} aria-hidden="true" />}
              {density === "grid" ? "Board" : "Tiles"}
            </button>
          )}
          {own && (
            <Button
              type="button"
              size="xs"
              variant="secondary"
              icon={ImagePlus}
              onClick={onAdd}
              disabled={photos.length >= MAX_GALLERY_ITEMS}
              data-testid="gallery-add"
            >
              {photos.length >= MAX_GALLERY_ITEMS ? "Board full" : "Add photos"}
            </Button>
          )}
        </div>
      </div>

      {photos.length > 1 && (
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 no-scrollbar" role="group" aria-label="Filter photos">
          <FilterChip active={tag === "all"} onClick={() => setTag("all")} count={photos.length}>
            All
          </FilterChip>
          {GALLERY_TAGS.filter((entry) => counts[entry.value] > 0).map((entry) => (
            <FilterChip
              key={entry.value}
              active={tag === entry.value}
              onClick={() => setTag(entry.value)}
              count={counts[entry.value]}
            >
              {entry.label}
            </FilterChip>
          ))}
        </div>
      )}

      {!photos.length ? (
        <button
          type="button"
          onClick={onAdd}
          className="mt-3 flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-edge-2 bg-surface-0 px-4 py-10 text-center hover:border-edge-3"
        >
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
            <ImagePlus size={20} aria-hidden="true" />
          </span>
          <span className="text-sm font-bold text-ink-1">Add your first photos</span>
          <span className="max-w-xs text-2xs leading-relaxed text-ink-3">
            Up to {MAX_GALLERY_ITEMS}, straight from your gallery. A before-and-after, the stall, the finished job.
          </span>
        </button>
      ) : (
        <ul
          data-testid="gallery-grid"
          className={cn(
            "mt-3 [column-gap:0.625rem]",
            density === "grid" ? "columns-2 sm:columns-3" : "columns-2 sm:columns-3 lg:columns-4",
          )}
        >
          {visible.map((photo, index) => (
            <li key={`${photo.image_url}-${index}`} className="mb-2.5 break-inside-avoid">
              <PhotoTile
                photo={photo}
                own={own}
                onOpen={() => setOpen(photos.indexOf(photo))}
                onRemove={() => onRemove?.(photos.indexOf(photo))}
                tall={density === "board" && index % 5 === 1}
              />
            </li>
          ))}
        </ul>
      )}

      {own && photos.length > 0 && (
        <p className="mt-1 text-micro text-ink-4">
          Tap a photo to enlarge it. The first photo is the one people see on the card.
        </p>
      )}

      {chip && visible.length === 0 && (
        <p className="mt-2 text-2xs text-ink-3">No photos under “{chip.label}” yet.</p>
      )}

      {open !== null && photos[open] && (
        <Lightbox
          photo={photos[open]}
          onClose={() => setOpen(null)}
          onPrev={open > 0 ? () => setOpen(open - 1) : null}
          onNext={open < photos.length - 1 ? () => setOpen(open + 1) : null}
        />
      )}
    </section>
  );
}

function FilterChip({ active, onClick, count, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-2xs font-bold transition-colors",
        active
          ? "border-ink-1 bg-ink-1 text-surface-0"
          : "border-edge-1 bg-surface-0 text-ink-3 hover:border-edge-2 hover:text-ink-1",
      )}
    >
      {children}
      <span className={cn("tabular-nums", active ? "text-surface-0/70" : "text-ink-4")}>{count}</span>
    </button>
  );
}

function PhotoTile({ photo, own, onOpen, onRemove, tall }) {
  const tag = galleryTag(photo.tag);
  // `fit` is the whole point of a board: the photo keeps its own shape, so a
  // tall before-and-after is tall and a wide premises shot is wide. The frame
  // is only a placeholder shape until the file arrives.
  const frame = tall ? "aspect-[3/4]" : "aspect-[4/3]";
  return (
    <figure className="group relative overflow-hidden rounded-2xl border border-edge-1 bg-surface-0">
      <button type="button" onClick={onOpen} className="block w-full cursor-zoom-in" aria-label={photo.caption || "Open photo"}>
        <Media
          src={photo.image_url}
          alt={photo.caption || "Portfolio photo"}
          fit
          className="w-full bg-surface-2 object-contain transition-transform duration-300 group-hover:scale-[1.01]"
          fallback={
            <span className={cn("grid w-full place-items-center bg-surface-2 text-ink-4", frame)}>
              <ImagePlus size={18} aria-hidden="true" />
            </span>
          }
        />
      </button>

      {(photo.caption || (photo.tag && photo.tag !== DEFAULT_GALLERY_TAG)) && (
        <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent px-2.5 pb-2 pt-6">
          {photo.caption && <p className="line-clamp-2 text-micro font-bold leading-snug text-white">{photo.caption}</p>}
          {photo.tag && photo.tag !== DEFAULT_GALLERY_TAG && (
            <p className="text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-white/70">{tag.label}</p>
          )}
        </figcaption>
      )}

      {own && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove photo${photo.caption ? `: ${photo.caption}` : ""}`}
          className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-lg bg-ink-1/75 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-ink-1 group-hover:opacity-100 focus:opacity-100"
        >
          <Trash2 size={13} aria-hidden="true" />
        </button>
      )}
    </figure>
  );
}

function Lightbox({ photo, onClose, onPrev, onNext }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && onPrev) onPrev();
      if (event.key === "ArrowRight" && onNext) onNext();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose, onPrev, onNext]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={photo.caption || "Photo"}
      data-testid="gallery-lightbox"
      className="fixed inset-0 z-50 flex flex-col bg-ink-1/95 p-3 sm:p-6"
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-2 text-white">
        <p className="min-w-0 truncate text-xs font-bold">{galleryTag(photo.tag).label}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close photo"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20"
        >
          <X size={17} aria-hidden="true" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 py-2" onClick={(event) => event.stopPropagation()}>
        {onPrev && (
          <button type="button" onClick={onPrev} aria-label="Previous photo" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20">
            ‹
          </button>
        )}
        <img src={photo.image_url} alt={photo.caption || "Portfolio photo"} className="max-h-full min-h-0 w-auto max-w-full rounded-xl object-contain" />
        {onNext && (
          <button type="button" onClick={onNext} aria-label="Next photo" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20">
            ›
          </button>
        )}
      </div>
      {photo.caption && (
        <p className="mx-auto max-w-xl text-center text-xs leading-relaxed text-white/85">{photo.caption}</p>
      )}
    </div>
  );
}

/**
 * The owner's editor: pick many photos at once, then name and file them.
 *
 * `PhotoUploader` does the picking — it is the one component in the app that
 * uploads, caps at twelve, and says out loud when a file fails. What this adds
 * is the tag and the caption, applied to the whole batch, because the reason a
 * person picks eleven photos at once is that they are all the same kind of
 * thing ("this is the stall").
 */
export function AddGalleryModal({ open, onClose, onAdd, remaining = MAX_GALLERY_ITEMS }) {
  const [picked, setPicked] = useState([]);
  const [caption, setCaption] = useState("");
  const [tag, setTag] = useState(DEFAULT_GALLERY_TAG);

  useEffect(() => {
    if (!open) return;
    setPicked([]);
    setCaption("");
    setTag(DEFAULT_GALLERY_TAG);
  }, [open]);

  if (!open) return null;

  const save = () => {
    const items = picked.map((url) => ({ image_url: url, caption: caption.trim(), tag }));
    if (items.length) onAdd?.(items);
    onClose?.();
  };

  return (
    // z-50, above the fixed tab bar (z-40). At z-40 the "Add photos" button was
    // rendered underneath the tab bar on a phone, which is why the last step of
    // this sheet looked like it had no save at all.
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-1/50 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-gallery-heading"
        data-testid="add-gallery"
        className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl border border-edge-1 bg-surface-1 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:rounded-2xl sm:p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="add-gallery-heading" className="text-sm font-extrabold text-ink-1">Add photos</h2>
            <p className="mt-0.5 text-2xs text-ink-3">
              Pick several at once, name them and file them under one chip. This saves straight to your
              page — there is nothing else to confirm afterwards.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-2">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-3">
          <PhotoPicker value={picked} onChange={setPicked} max={remaining} />
        </div>

        <label className="mt-3 block text-2xs font-bold text-ink-2">
          Caption (optional, applied to this batch)
          <input
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            maxLength={160}
            placeholder="e.g. Deep clean, 3-bedroom in Milimani"
            className="mt-1 h-10 w-full rounded-xl border border-edge-2 bg-surface-0 px-3 text-xs text-ink-1"
          />
        </label>

        <p className="mt-3 text-2xs font-bold text-ink-2">File under</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {GALLERY_TAGS.filter((entry) => GALLERY_TAG_VALUES.includes(entry.value)).map((entry) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.value}
                type="button"
                aria-pressed={tag === entry.value}
                onClick={() => setTag(entry.value)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-micro font-bold",
                  tag === entry.value
                    ? "border-ink-1 bg-ink-1 text-surface-0"
                    : "border-edge-1 bg-surface-0 text-ink-3 hover:border-edge-2 hover:text-ink-1",
                )}
              >
                <Icon size={12} aria-hidden="true" />
                {entry.label}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            size="sm"
            onClick={save}
            disabled={!picked.length}
            data-testid="gallery-save"
          >
            Add {picked.length || ""} {picked.length === 1 ? "photo" : "photos"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The upload grid itself: many files, a preview each, and a remove on tap. */
function PhotoPicker({ value, onChange, max }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pick = async (event) => {
    const files = Array.from(event.target.files || []);
    if (event.target) event.target.value = "";
    if (!files.length) return;
    const room = Math.max(0, max - value.length);
    const accepted = files.slice(0, room);
    setError("");
    if (accepted.length < files.length) setError(`Only ${room} more fit on the board.`);
    if (!accepted.length) return;

    setBusy(true);
    const uploaded = [];
    let reason = "";
    try {
      const { data } = await fileAPI.uploadMany(accepted);
      for (const stored of data?.files || []) if (stored?.url) uploaded.push(stored.url);
    } catch {
      // One file at a time through the single-upload path, so a batch failure
      // still lands every photo it can instead of none.
      for (const file of accepted) {
        try {
          const url = await readGalleryPhoto(file);
          if (url) uploaded.push(url);
        } catch (err) {
          if (!reason) reason = err?.message || "";
        }
      }
    }
    setBusy(false);
    if (uploaded.length) onChange([...value, ...uploaded]);
    if (!uploaded.length) setError(reason || "Those photos could not be uploaded. Check the connection and try again.");
  };

  return (
    <div data-testid="gallery-picker">
      <input type="file" accept="image/*" multiple className="hidden" id="gallery-file-input" onChange={pick} aria-label="Choose photos" />
      <div className="grid grid-cols-4 gap-2">
        {value.map((src, index) => (
          <div key={`${src}-${index}`} className="group relative aspect-square overflow-hidden rounded-xl border border-edge-1 bg-surface-2">
            <Media src={src} alt={`Selected ${index + 1}`} className="h-full w-full object-cover" />
            <button
              type="button"
              aria-label={`Remove selected photo ${index + 1}`}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
              className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-md bg-ink-1/80 text-white"
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>
        ))}
        {value.length < max && (
          <label
            htmlFor="gallery-file-input"
            className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-edge-2 bg-surface-0 text-ink-4 hover:border-edge-3 hover:text-ink-2"
          >
            {busy ? <span className="text-micro font-bold">Uploading…</span> : (
              <>
                <ImagePlus size={16} aria-hidden="true" />
                <span className="text-[0.625rem] font-bold uppercase tracking-wide">Add</span>
              </>
            )}
          </label>
        )}
      </div>
      {error && <p className="mt-1.5 text-micro text-danger">{error}</p>}
    </div>
  );
}
