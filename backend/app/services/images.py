"""
PHOTOGRAPH PREPARATION — what happens to a phone photo before it is stored.
---------------------------------------------------------------------------
Two things were true at once, and together they read as "photos don't show up":

1. **iPhones hand over HEIC.** A gallery selection from an iPhone is
   `IMG_0421.HEIC` unless the phone is set to "Most Compatible". The uploader
   refused it as an unsupported type — a 400 the user never saw past a toast —
   or, worse, stored it and served an `image/heic` that no browser except Safari
   can paint. The listing then had a photo that was invisible everywhere.

2. **Phones hand over enormous photos.** A 12-megapixel JPEG with EXIF
   orientation is 3–5 MB, over the default cap, and points the wrong way once it
   is stripped of metadata. A shop owner photographing a shelf should not have to
   know any of that.

So every image that arrives is normalised here, once:

    HEIC/HEIF  → JPEG      (only when `pillow` + a HEIF reader are installed)
    > 2000 px  → 2000 px   (long edge, aspect preserved)
    EXIF       → applied to the pixels, then dropped
    > cap      → refused with the size in the message, never silently

Everything else passes through byte-for-byte, which matters for PDFs and CSVs
and means this module can never corrupt a document.

If Pillow is not installed (it is an optional dependency — see
`requirements.txt`), `prepare_image` degrades honestly: JPEG/PNG/WEBP/GIF are
accepted untouched, and a HEIC file is refused with a message that tells the
person what to do instead of leaving them with an invisible photograph.
"""

from __future__ import annotations

import io
from typing import Optional, Tuple

try:  # pragma: no cover - exercised only when the dependency is present
    from PIL import Image, ImageOps

    PIL_AVAILABLE = True
except Exception:  # pragma: no cover
    Image = None  # type: ignore[assignment]
    ImageOps = None  # type: ignore[assignment]
    PIL_AVAILABLE = False

try:  # pragma: no cover - optional
    import pillow_heif  # type: ignore

    pillow_heif.register_heif_opener()
    HEIF_AVAILABLE = True
except Exception:  # pragma: no cover
    HEIF_AVAILABLE = False


#: The long edge a stored photograph is reduced to — 2400 px, chosen from
#: evidence rather than taste. A phone screenshot is 1080×2400, and downscaling
#: one below its native height costs the OCR reader real lines (470 → 451 on the
#: Khetia specimen, 23 → 22 confirmed prices). 2400 leaves every screenshot
#: untouched, still shrinks a 4000 px camera photo by 40%, and keeps a shelf of
#: twelve photographs loadable on a 3G phone.
MAX_EDGE = 2400
#: JPEG quality for anything we re-encode. 85 is the point where a price tag
#: written in marker pen is still legible after compression.
JPEG_QUALITY = 85

HEIF_EXTENSIONS = (".heic", ".heif")
HEIF_TYPES = ("image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence")

NO_HEIF_MESSAGE = (
    "This looks like an iPhone HEIC photo, which browsers cannot display. "
    "Set Camera → Formats → Most Compatible, or share the photo as a JPEG / take a "
    "screenshot, and upload that."
)


class UnsupportedImage(Exception):
    """The file claims to be an image and cannot be turned into one."""


def _looks_like_heif(data: bytes) -> bool:
    # ISO-BMFF box: bytes 4..8 are "ftyp", then a brand. "heic"/"heix"/"mif1".
    return len(data) > 12 and data[4:8] == b"ftyp" and data[8:12] in {
        b"heic", b"heix", b"hevc", b"heim", b"heis", b"mif1", b"msf1",
    }


def is_heif(filename: str, content_type: Optional[str], data: bytes = b"") -> bool:
    name = (filename or "").lower()
    ctype = (content_type or "").split(";", 1)[0].strip().lower()
    return (
        name.endswith(HEIF_EXTENSIONS)
        or ctype in HEIF_TYPES
        or _looks_like_heif(data or b"")
    )


def prepare_image(
    data: bytes,
    filename: str,
    content_type: str,
    *,
    max_bytes: Optional[int] = None,
) -> Tuple[bytes, str, str]:
    """Return `(bytes, filename, content_type)` safe to store and to serve.

    Non-images are returned unchanged. A HEIC image is transcoded to JPEG when
    the reader is available, refused with an actionable message when it is not.
    An image larger than `max_bytes` after normalisation is refused — but only
    after normalisation, because the point of downscaling is that a 5 MB phone
    photo fits inside a 3 MB cap.
    """
    ctype = (content_type or "").split(";", 1)[0].strip().lower()
    name = filename or "file"
    looks_image = ctype.startswith("image/") or data[:4] in (
        b"\xff\xd8\xff\xe0",  # JPEG SOI + APP0
        b"\xff\xd8\xff\xe1",
        b"\x89PNG",
        b"GIF8",
        b"RIFF",
    ) or _looks_like_heif(data)

    if not looks_image:
        if max_bytes is not None and len(data) > max_bytes:
            raise UnsupportedImage(
                f"{name} is larger than {max_bytes // (1024 * 1024)} MB"
            )
        return data, name, ctype

    heif = is_heif(name, ctype, data)
    if heif and not (PIL_AVAILABLE and HEIF_AVAILABLE):
        raise UnsupportedImage(NO_HEIF_MESSAGE)
    if not PIL_AVAILABLE:
        if max_bytes is not None and len(data) > max_bytes:
            raise UnsupportedImage(
                f"{name} is larger than {max_bytes // (1024 * 1024)} MB — "
                "resize it, or ask operations to enable image resizing"
            )
        return data, name, ctype

    try:
        with Image.open(io.BytesIO(data)) as probe:
            # The fast path: a screenshot that is already upright, already small
            # enough and already under the cap is stored byte-for-byte. Re-encoding
            # it would cost a generation of quality and a second of upload time to
            # change nothing.
            try:
                orientation = probe.getexif().get(0x0112, 1)
            except Exception:
                orientation = 1
            already_fine = (
                not heif
                and max(probe.size) <= MAX_EDGE
                and orientation in (None, 0, 1)
                and (max_bytes is None or len(data) <= max_bytes)
            )
            if already_fine:
                return data, name, ctype or "image/jpeg"

            # `draft` lets libjpeg decode a big JPEG at 1/2, 1/4 or 1/8 scale for
            # free — the difference between a 400 ms and a 4 s upload on a phone.
            if hasattr(probe, "draft"):
                try:
                    probe.draft("RGB", (MAX_EDGE, MAX_EDGE))
                except Exception:
                    pass
            probe.load()
            # An EXIF orientation tag is metadata a browser may or may not apply;
            # applying it to the pixels and dropping the tag makes every viewer
            # agree about which way up the shelf was.
            image = ImageOps.exif_transpose(probe) if ImageOps else probe
            image = image.convert("RGB") if image.mode not in ("RGB", "L") else image

            # Encode at the target edge first, then step down only if the file is
            # still over the cap. A shop is not a photograph of noise, so the
            # first attempt almost always fits; the ladder exists so that "too
            # big" is never the answer for a real photograph.
            prepared = b""
            for edge, quality in ((MAX_EDGE, JPEG_QUALITY), (1600, 82), (1200, 80), (900, 78)):
                working = image.copy()
                if max(working.size) > edge:
                    working.thumbnail((edge, edge), Image.LANCZOS)
                out = io.BytesIO()
                working.save(out, format="JPEG", quality=quality, optimize=True)
                prepared = out.getvalue()
                if max_bytes is None or len(prepared) <= max_bytes:
                    break
    except UnsupportedImage:
        raise
    except Exception:
        # A file that Pillow will not open is not automatically a bad file: it
        # may be a progressive JPEG this build of libjpeg dislikes, a format with
        # a future, or a fixture from an older import. Keeping the original bytes
        # is the safe answer — refusing here would delete photographs that a
        # browser can still paint.
        if max_bytes is not None and len(data) > max_bytes:
            raise UnsupportedImage(
                f"{name} is larger than {max_bytes // (1024 * 1024)} MB and could not be resized"
            )
        return data, name, ctype

    if max_bytes is not None and len(prepared) > max_bytes:
        raise UnsupportedImage(
            f"{name} is still larger than {max_bytes // (1024 * 1024)} MB after resizing"
        )

    stem = name.rsplit(".", 1)[0] if "." in name else name
    return prepared, f"{stem}.jpg", "image/jpeg"


def supported() -> dict:
    """What this deployment can do, so the client can say it before it tries."""
    return {
        "resize": PIL_AVAILABLE,
        "heif": PIL_AVAILABLE and HEIF_AVAILABLE,
        "max_edge": MAX_EDGE if PIL_AVAILABLE else None,
    }
