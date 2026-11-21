/**
 * Read a coordinate pair out of a pasted map link or a typed pin.
 *
 * The common share formats all carry the same two numbers:
 *   https://maps.google.com/?q=-0.0917,34.7680
 *   https://www.google.com/maps/@-0.0917,34.7680,15z
 *   https://www.google.com/maps/search/?api=1&query=-0.0917,34.7680
 *   geo:-0.0917,34.7680
 *   -0.0917, 34.7680
 *
 * A shortened `maps.app.goo.gl/...` link has no coordinates until it is opened;
 * this function returns null for it rather than pretending to know the place.
 */
const NUMBER = String.raw`-?\d{1,3}(?:\.\d+)?`;

export function parsePin(input) {
  const text = String(input || "").trim();
  if (!text) return null;

  const latLng = text.match(new RegExp(`(${NUMBER})\\s*,\\s*(${NUMBER})`));
  let lat = latLng ? Number(latLng[1]) : null;
  let lng = latLng ? Number(latLng[2]) : null;

  if (lat === null || lng === null) {
    const named = text.match(new RegExp(`(?:[?&](?:lat|latitude)=)(${NUMBER})[^0-9-]+(?:lon|lng|longitude)=(${NUMBER})`, "i"));
    if (named) {
      lat = Number(named[1]);
      lng = Number(named[2]);
    }
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  // A pair of zeroes is a real ocean coordinate, but it is almost always a
  // placeholder in a paste. Do not pretend it is the person's neighbourhood.
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}
