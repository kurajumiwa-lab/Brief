"""Gallery — the board of photographs a page shows, and the tags that sort it.

A page is read in pictures before it is read in words: a cleaner's before-and-
after, a kitchen's plates, a tailor's fits, a shop's shelves. "Selected work"
answers *what have you delivered*; the gallery answers *what does it look like*.
Both live on the same page because they are the same question asked twice.

Three rules, and they are the whole design:

* **A photograph is the record.** Every item needs a served image URL. There is
  no "coming soon" tile and no placeholder that pretends to be a photo — a page
  with no photos shows no board.
* **One tag, from a short list.** The chips on the page are only useful if they
  are the same words on every page, so the tag vocabulary is fixed here and
  mirrored in `frontend/src/config/showcase.js`. Free text would give us
  "cleaning", "Cleaning services" and "deep clean" in three cards and a chip
  row that filters nothing.
* **A board is capped.** Thirty pictures is a portfolio; three hundred is a
  camera roll, and the page loads for a stranger on a phone.
"""

from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

MAX_GALLERY_ITEMS = 30
MAX_CAPTION = 160

# The chip vocabulary. Mirrored in `frontend/src/config/showcase.js`; a test on
# each side keeps the two lists honest.
TAGS = (
    "work",
    "before-after",
    "premises",
    "team",
    "product",
    "event",
    "other",
)
DEFAULT_TAG = "work"

ALLOWED_IMAGE_PREFIXES = ("https://", "http://", "/", "uploads/")


class GalleryItem(BaseModel):
    """One photograph on the board. A URL, an optional caption, one tag."""

    model_config = {"extra": "forbid"}

    image_url: str = Field(min_length=1, max_length=500)
    caption: str = Field(default="", max_length=MAX_CAPTION)
    tag: str = Field(default=DEFAULT_TAG, max_length=40)

    @field_validator("caption")
    @classmethod
    def _clean_caption(cls, value: str) -> str:
        return " ".join((value or "").split())

    @field_validator("tag")
    @classmethod
    def _known_tag(cls, value: str) -> str:
        # An unknown tag is not an error the person can act on, and it must not
        # become a chip nobody else has. Keep the photo: a blank tag files it
        # under the default, anything unrecognised under `other`.
        slug = " ".join((value or "").split()).lower()
        if not slug:
            return DEFAULT_TAG
        return slug if slug in TAGS else "other"

    @field_validator("image_url")
    @classmethod
    def _displayable(cls, value: str) -> str:
        url = (value or "").strip()
        if not url.startswith(ALLOWED_IMAGE_PREFIXES):
            raise ValueError("A gallery photo must be an uploaded file or an http(s) URL")
        if url.lower().startswith(("data:", "blob:")):
            raise ValueError("Upload the photo so everyone can see it, not just this device")
        return url


def clean_gallery_items(value: Optional[List[GalleryItem]]) -> Optional[list[dict]]:
    """Plain dicts for JSONB. ``None`` means "not mentioned" — never a wipe."""
    if value is None:
        return None
    out: list[dict] = []
    for item in value:
        record = item.model_dump()
        out.append({k: v for k, v in record.items() if v})
    return out


def public_gallery_items(profile) -> list[dict]:
    """The board as a visitor sees it: a list, never None, never malformed."""
    raw = getattr(profile, "gallery_items", None)
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        url = item.get("image_url")
        if not isinstance(url, str) or not url.strip():
            continue
        out.append(
            {
                "image_url": url.strip(),
                "caption": (item.get("caption") or "").strip(),
                "tag": item.get("tag") if item.get("tag") in TAGS else DEFAULT_TAG,
            }
        )
    return out


def tag_counts(items: list[dict]) -> dict:
    """``{tag: count}`` in the order of ``TAGS`` — the chip row's numbers."""
    return {tag: sum(1 for item in items if item.get("tag") == tag) for tag in TAGS}
