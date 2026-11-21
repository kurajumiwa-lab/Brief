import { useEffect, useState } from "react";
import { mediaUrl } from "@/lib/media";

/**
 * MEDIA — an `<img>` that knows what to do when the file is not there.
 *
 * A record can carry a photo that no longer exists: the vendor deleted it, the
 * file lived on an instance that has since restarted, or the URL was stored by
 * a deployment that has moved on. The browser's answer to that is a broken-image
 * glyph in the middle of a designed card, which reads as "the app is broken"
 * rather than "this listing has no photo".
 *
 * So the missing file is a *product state*, not an accident: `fallback` is
 * rendered instead — the card's designed poster/illustration — and the record
 * still shows its title, price and vendor. Nothing is faked and nothing is
 * hidden; the card simply shows what it actually has.
 *
 * `src` is normalised through `mediaUrl()` first, so a bare storage key and a
 * full `/static/...` path reach the same file.
 */
export default function Media({
  src,
  alt = "",
  className,
  fallback = null,
  loading = "lazy",
  /**
   * `fit` keeps the photograph's OWN shape instead of cropping it to a frame.
   *
   * A gallery is the one place this matters: a tall before-and-after and a wide
   * premises shot cannot both live in a 4:3 box without one of them losing the
   * thing that makes it evidence. The browser knows the intrinsic size as soon
   * as the bytes arrive, so the frame is set from that (`aspect-ratio`) and the
   * image is not distorted (`object-contain`). Before the file loads — or if it
   * never does — `fallback` is what fills the frame.
   */
  fit = false,
  onFail,
  ...rest
}) {
  const url = mediaUrl(src);
  const [failed, setFailed] = useState(false);
  const [ratio, setRatio] = useState(null);

  // A card can be recycled with a different record (a carousel that re-renders
  // after a retry); a failure on the old URL must not hide the new one.
  useEffect(() => {
    setFailed(false);
    setRatio(null);
  }, [url]);

  if (!url || failed) return fallback;

  return (
    <img
      src={url}
      alt={alt}
      loading={loading}
      decoding="async"
      className={className}
      style={fit && ratio ? { aspectRatio: ratio } : undefined}
      onLoad={
        fit
          ? (event) => {
              const image = event.currentTarget;
              if (image?.naturalWidth && image?.naturalHeight) {
                setRatio(`${image.naturalWidth} / ${image.naturalHeight}`);
              }
            }
          : undefined
      }
      onError={() => {
        setFailed(true);
        onFail?.();
      }}
      {...rest}
    />
  );
}
