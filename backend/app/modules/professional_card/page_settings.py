"""The owner's Page settings: a tagline, About text, and which sections show on /page/:handle.

Only the owner writes these (the route uses the signed-in vendor). A blank About means the Page
uses the business description. A section switched off is left out of the public response, so
it is not sent to strangers at all.
"""

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

SECTIONS = ("offers", "hours", "credentials")
TAGLINE_MAX = 140
ABOUT_MAX = 1000


class PageSettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tagline: Optional[str] = Field(default=None, max_length=TAGLINE_MAX)
    about: Optional[str] = Field(default=None, max_length=ABOUT_MAX)
    show_offers: bool = True
    show_hours: bool = True
    show_credentials: bool = True


def clean(raw: dict) -> dict:
    """Stored form. Text is trimmed, blanks become None, and only known keys are kept."""
    tagline = (raw.get("tagline") or "").strip() or None
    about = (raw.get("about") or "").strip() or None
    return {
        "tagline": tagline,
        "about": about,
        "sections": {s: bool(raw.get(f"show_{s}", True)) for s in SECTIONS},
    }


def view(stored: Optional[dict]) -> dict:
    """What the owner sees in the editor."""
    s = stored or {}
    sections = s.get("sections") or {}
    return {
        "tagline": s.get("tagline"),
        "about": s.get("about"),
        "show_offers": bool(sections.get("offers", True)),
        "show_hours": bool(sections.get("hours", True)),
        "show_credentials": bool(sections.get("credentials", True)),
    }


def apply_public(card: dict, stored: Optional[dict]) -> dict:
    """Apply the owner's settings to the public card. Hidden sections are removed, not just hidden in the UI."""
    s = clean(view(stored)) if stored else clean({})
    card["tagline"] = s["tagline"]
    if s["about"]:
        card["description"] = s["about"]
    sections = s["sections"]
    if not sections.get("offers", True):
        card["services"] = []
    if not sections.get("hours", True):
        card["hours"] = []
    if not sections.get("credentials", True):
        card["registrations"] = []
    card["sections"] = sections
    return card
