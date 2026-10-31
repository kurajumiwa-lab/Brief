import { fileAPI, apiError } from "@/lib/api";

/**
 * Read a picked File into a **stored** URL.
 * ---------------------------------------------------------------------------
 * The old version of this function did something that looked kind: if the
 * upload failed, it read the file into a `data:` URL and saved *that* as the
 * photo. The seller saw their picture on the card they had just made, so
 * nothing looked broken — and every other person, on every other device, saw a
 * blank tile, because a `data:` URL only exists in the browser tab that made it.
 *
 * That is the bug behind "photos aren't visible in the whole app": the app was
 * not losing the photo, it was storing a picture that could never be seen by
 * anyone else, and saying nothing. Six megabytes of base64 in a JSON body also
 * made the list endpoints slow enough that shelves rendered without them.
 *
 * So there is exactly one behaviour now:
 *
 *   · the photo goes up through `/api/files/upload` and the URL that comes back
 *     is the URL that gets saved;
 *   · if the upload fails, this throws with the reason the server gave — the
 *     uploader learns what happened instead of shipping an invisible photo;
 *   · nothing here ever invents a URL, a path or a blob.
 *
 * Callers must catch. The few surfaces that already show a toast do; the rest
 * were updated when this changed.
 */
export class PhotoUploadError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "PhotoUploadError";
    this.cause = cause;
  }
}

const DEFAULT_MESSAGE = "That photo could not be uploaded. Check the connection and try again.";

export async function readGalleryPhoto(file) {
  if (!file) return "";

  // 1. An iPhone hands over HEIC unless it is set to "Most Compatible". The
  //    server transcodes it, so it is not refused here — but naming the case in
  //    the message is the difference between a fixable problem and a mystery.
  const looksHeic =
    /heic|heif/i.test(file.type || "") || /\.(heic|heif)$/i.test(file.name || "");

  try {
    const res = await fileAPI?.upload?.(file);
    const url = res?.data?.url;
    if (typeof url === "string" && url.trim()) return url.trim();
    throw new PhotoUploadError(DEFAULT_MESSAGE);
  } catch (err) {
    if (err instanceof PhotoUploadError) throw err;
    const message = apiError(err, DEFAULT_MESSAGE);
    throw new PhotoUploadError(
      looksHeic
        ? `${message} — iPhone HEIC photos need to be shared as a JPEG or a screenshot.`
        : message,
      err
    );
  }
}

export default readGalleryPhoto;
