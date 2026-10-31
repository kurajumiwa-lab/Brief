"""
PHOTO URLs — one rule for every field that holds a picture.
---------------------------------------------------------------------------
A photograph is stored as a short string that a browser can resolve. That is the
whole contract, and it had been broken by a well-meaning fallback: when an upload
failed, the client saved a `data:` URL — the entire image, base64-encoded, into a
JSON list. The seller saw their own photo (it was in the same tab) and everyone
else saw a blank tile for ever. Nobody was told.

So the rule is enforced where the data lands, not only where it is produced:

    a picture is a served path, or an absolute http(s) URL, and nothing else

`data:` and `blob:` are refused by name, because they are the exact shapes that
look like a photo and behave like one only on the machine that created them.
Inline SVG is refused for a second reason: an SVG is a document that can carry
script, and these URLs are rendered in `<img>` tags across the app.

Twelve, because that is the number of photographs a phone gallery selection
sends in one go and the number the intake desk reads in one batch. Two rules with
two different numbers would be two rules to explain.
"""

from __future__ import annotations

from typing import Iterable, Optional
from urllib.parse import urlparse

MAX_IMAGES = 12
MAX_URL_LENGTH = 500


class MediaUrlError(ValueError):
    """A picture field held something that is not a picture."""


def _one(value, *, allow_empty: bool = False) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, dict):
        value = value.get("url")
    if not isinstance(value, str):
        raise MediaUrlError("A photo must be a URL string")
    url = value.strip()
    if not url:
        if allow_empty:
            return None
        raise MediaUrlError("A photo URL cannot be empty")
    if len(url) > MAX_URL_LENGTH:
        raise MediaUrlError("That photo URL is too long to store")

    lowered = url.lower()
    if lowered.startswith("data:"):
        # The bug this module exists for. Say what to do, not just "invalid".
        raise MediaUrlError(
            "That photo was embedded in the page instead of uploaded. "
            "Upload it again so everyone can see it, not just this device."
        )
    if lowered.startswith("blob:"):
        raise MediaUrlError(
            "That photo was only in the browser's memory. Upload it again to save it."
        )
    if lowered.endswith(".svg") or "image/svg" in lowered:
        raise MediaUrlError("SVG images are not accepted — upload a JPG, PNG or WEBP")

    if url.startswith("/"):
        return url
    if url.startswith("uploads/"):
        return f"/static/{url}"
    scheme = urlparse(url).scheme.lower()
    if scheme in ("http", "https"):
        return url
    if not scheme and "." in url.split("/")[0]:
        # A bare host ("cdn.example.com/a.jpg") is an absolute URL that lost its
        # scheme to an import; it is unambiguous once https is put back.
        return f"https://{url}"
    raise MediaUrlError("A photo must be an uploaded file or an http(s) URL")


def clean_image_urls(
    values: Iterable | None,
    *,
    max_images: int = MAX_IMAGES,
    required_min: int = 0,
) -> list[str]:
    """Return the storable list, or raise `MediaUrlError` with what is wrong.

    Duplicates collapse (the same file added twice is one photograph), order is
    the order the person picked them, and the first entry is the cover.
    """
    if values is None:
        if required_min:
            raise MediaUrlError("At least one photo is required")
        return []
    if isinstance(values, (str, bytes)):
        raise MediaUrlError("Photos must be a list of URLs")

    out: list[str] = []
    for raw in values:
        cleaned = _one(raw, allow_empty=True)
        if cleaned and cleaned not in out:
            out.append(cleaned)

    if len(out) > max_images:
        raise MediaUrlError(f"Up to {max_images} photos at a time")
    if len(out) < required_min:
        raise MediaUrlError("At least one photo is required")
    return out
