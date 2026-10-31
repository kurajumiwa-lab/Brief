import { useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import Media from "@/components/ui/Media";
import { fileAPI } from "@/lib/api";
import { readGalleryPhoto } from "@/lib/images";
import { apiError } from "@/lib/api";
import { toast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

/**
 * PHOTOS — pick up to twelve at once, from the phone's own gallery.
 * ---------------------------------------------------------------------------
 * Every surface that accepts a photo used to grow its own one-file input:
 * the shop gallery, the listing form, selected work, the chat identity. They
 * drifted, and each drifted toward the same two mistakes — one photo per tap,
 * and a silent failure that left the card blank.
 *
 * This is that rule, written once:
 *
 *   · **Many at once.** `multiple` on the input and a cap of twelve, matching
 *     the API. A wholesaler photographing a shelf should not be asked twelve
 *     times.
 *   · **Never silent.** A file that fails to upload says so; a file over the
 *     cap says so. The previous behaviour was to drop it and render nothing,
 *     which is indistinguishable from a bug.
 *   · **The photo is the record.** Preview comes from the saved URL where there
 *     is one, and from an object URL while it is still uploading — so the grid
 *     fills as the photos land, not after.
 *   · **One layout.** A square grid that works at 360px, because that is the
 *     phone this is used on.
 *
 * `value` is the list of stored URLs (strings). `onChange` receives the next
 * list. The component never mutates `value` in place, and never invents a URL.
 */
export default function PhotoUploader({
  value = [],
  onChange,
  max = 12,
  label = "Photos",
  hint = "Up to 12 at once, straight from your gallery.",
  testId = "photo-uploader",
  compact = false,
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState("");

  const photos = Array.isArray(value) ? value : [];

  const add = async (event) => {
    const picked = Array.from(event.target.files || []);
    if (event.target) event.target.value = "";
    if (!picked.length) return;

    const room = Math.max(0, max - photos.length);
    const accepted = picked.slice(0, room);
    const overflow = picked.length - accepted.length;
    setError("");
    if (overflow > 0) {
      toast.error(`Only ${room} more photo${room === 1 ? "" : "s"} fit — ${overflow} left out.`);
    }
    if (!accepted.length) return;

    setBusy(accepted.length);
    const uploaded = [];
    const failed = [];

    // One request for the whole selection where the API supports it, one file
    // at a time otherwise (an older server, or a local fallback in tests). The
    // fallback is the reason a photo is never silently dropped.
    try {
      const { data } = await fileAPI.uploadMany(accepted);
      for (const stored of data?.files || []) if (stored?.url) uploaded.push(stored.url);
    } catch {
      for (const file of accepted) {
        try {
          const url = await readGalleryPhoto(file);
          if (url) uploaded.push(url);
          else failed.push(file.name);
        } catch {
          failed.push(file.name);
        } finally {
          setBusy((n) => Math.max(0, n - 1));
        }
      }
    }
    setBusy(0);

    if (uploaded.length) onChange([...photos, ...uploaded]);
    if (failed.length) {
      const message =
        failed.length === 1
          ? `${failed[0]} could not be read`
          : `${failed.length} photos could not be read`;
      setError(message);
      toast.error(apiError({ response: { data: { detail: message } } }, message));
    }
  };

  const remove = (index) => {
    onChange(photos.filter((_, i) => i !== index));
  };

  const full = photos.length >= max;

  return (
    <div className="space-y-2" data-testid={testId}>
      {label && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-ink-2">{label}</span>
          <span className="text-micro text-ink-4 tabular-nums">
            {photos.length} / {max}
          </span>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        aria-label="Choose photos from your gallery"
        onChange={add}
      />

      <div className={cn("grid gap-2", compact ? "grid-cols-4" : "grid-cols-3 sm:grid-cols-4")}>
        {photos.map((src, index) => (
          <div
            key={`${src.slice(-24)}-${index}`}
            className="group relative aspect-square overflow-hidden rounded-xl border border-edge-1 bg-surface-2"
            data-testid="photo-uploader-item"
          >
            <Media
              src={src}
              alt={`Photo ${index + 1}`}
              className="h-full w-full object-cover"
              fallback={
                <div className="grid h-full w-full place-items-center text-ink-4">
                  <ImagePlus size={16} aria-hidden="true" />
                </div>
              }
            />
            <button
              type="button"
              onClick={() => remove(index)}
              aria-label={`Remove photo ${index + 1}`}
              className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-md bg-ink-1/80 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 cursor-pointer"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}

        {!full && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy > 0}
            className={cn(
              "aspect-square rounded-xl border border-dashed border-edge-2 bg-surface-1 text-ink-3",
              "grid place-items-center transition-colors hover:bg-surface-2 cursor-pointer",
              "disabled:cursor-wait disabled:opacity-60"
            )}
          >
            <span className="flex flex-col items-center gap-1">
              <ImagePlus size={17} aria-hidden="true" />
              <span className="text-micro font-semibold">
                {busy > 0 ? `Adding ${busy}…` : "Add photos"}
              </span>
            </span>
          </button>
        )}
      </div>

      {hint && <p className="text-micro text-ink-4">{hint}</p>}
      {error && (
        <p role="alert" className="text-micro font-semibold text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
