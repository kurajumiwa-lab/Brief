import { fileAPI } from "@/lib/api";

/**
 * Read a File into a URL: uploads through `/api/files/upload` when available,
 * and falls back to a local data URL so gallery selection still works offline
 * (or in tests, where there is no upload endpoint).
 *
 * This lived inside `VendorProfile.jsx` until selected work also needed it.
 * Two surfaces picking images from the same phone should share one rule about
 * what happens when the upload fails — silently dropping the photo is worse
 * than storing a local preview the owner can see.
 */
export async function readGalleryPhoto(file) {
  if (!file) return "";
  try {
    const res = await fileAPI?.upload?.(file);
    if (res?.data?.url) return res.data.url;
  } catch {
    /* fall back to a local data URL preview */
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read image file"));
    reader.readAsDataURL(file);
  });
}
