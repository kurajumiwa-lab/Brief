"""Selected work — the small, public record a service vendor shows on the shop front.

This module is the ONE place that decides what a work item may contain, because
the records are public and are written by the vendor. Two rules:

* **Nothing is stored that a shop front cannot render in one card.** A title,
  one line about the job, one line about the outcome, a discipline, a year and
  an image. There is no rich-text field and no HTML field, by construction — so
  a work item cannot become a page, a case-study theatre or a hidden document.
* **A list is capped.** Twelve cards is a showcase; two hundred is a database
  dump, and a buyer never reads past the third.

The capability this replaces was a 1,700-line separate portfolio page with its
own navigation, dashboard, price list and enquiry pipeline. The capability that
was actually worth keeping is this: *a business can show what it has done, and a
buyer can check it before hiring.* That is what lives here.
"""

from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

MAX_WORK_ITEMS = 12
MAX_TITLE = 120
MAX_SUMMARY = 280
MAX_OUTCOME = 160
MAX_DISCIPLINE = 40
MAX_YEAR = 9
MAX_IMAGE_CHARS = 2_000_000  # a data-URL fallback is allowed, as the gallery does

# An image is either an upload we served, an absolute URL, or a local data URL
# fallback used when the upload endpoint is unavailable. Anything else — a
# javascript: URL, a bare path, a promise of an image — is refused.
ALLOWED_IMAGE_PREFIXES = ("https://", "http://", "/api/", "data:image/")


class WorkItem(BaseModel):
    """One card on a shop front. Every field is optional except the title.

    Unknown fields are refused: this record is public, and a JSONB column will
    happily store anything a client sends it. The shape is the contract.
    """

    model_config = {"extra": "forbid"}

    title: str = Field(min_length=1, max_length=MAX_TITLE)
    summary: str = Field(default="", max_length=MAX_SUMMARY)
    outcome: str = Field(default="", max_length=MAX_OUTCOME)
    discipline: str = Field(default="", max_length=MAX_DISCIPLINE)
    year: str = Field(default="", max_length=MAX_YEAR)
    image_url: str = Field(default="", max_length=MAX_IMAGE_CHARS)

    @field_validator("title", "summary", "outcome", "discipline", "year", "image_url")
    @classmethod
    def _clean(cls, value: str) -> str:
        return " ".join((value or "").split())

    @field_validator("title")
    @classmethod
    def _title_required(cls, value: str) -> str:
        if not value:
            raise ValueError("A work item needs a title")
        return value

    @field_validator("image_url")
    @classmethod
    def _image_must_be_displayable(cls, value: str) -> str:
        if value and not value.startswith(ALLOWED_IMAGE_PREFIXES):
            raise ValueError("Image must be an uploaded file or an http(s) URL")
        return value


def clean_work_items(value: Optional[List[WorkItem]]) -> Optional[list[dict]]:
    """Turn validated items into plain dicts for JSONB, dropping empty fields.

    Returns ``None`` for "nothing was sent", so a PATCH that does not mention
    work never clears it. An explicit empty list clears the showcase.
    """
    if value is None:
        return None
    out: list[dict] = []
    for item in value:
        record = item.model_dump()
        out.append({k: v for k, v in record.items() if v})
    return out


def public_work_items(profile) -> list[dict]:
    """The showcase as a visitor sees it: a list, never None, never malformed."""
    raw = getattr(profile, "work_items", None)
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict) and item.get("title")]
