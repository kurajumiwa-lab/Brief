"""Public share surfaces: the HTML a crawler reads and the image it shows.

These routes live outside `/api` because they *are* the page at `/p/<handle>`
and `/invite/<shop>`. They are registered before the SPA catch-all, so a browser
still gets the built React app (with real meta tags injected into it) while
WhatsApp, Telegram and Facebook get the same tags without running JavaScript.

Nothing here needs a sign-in. Nothing here returns a phone number, an exact
address, a receipt id or a voucher code.
"""

from __future__ import annotations

import html
import os
import re
from functools import lru_cache
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, Response, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.database import get_db
from app.services.og_cards import invite_card, profile_card, render_invite_card, render_profile_card

router = APIRouter()

IMAGE_CACHE = "public, max-age=3600, stale-while-revalidate=86400"
PAGE_CACHE = "public, max-age=300, stale-while-revalidate=3600"


def _origin(request: Request) -> str:
    return str(request.base_url).rstrip("/")


def _clip(value: str, limit: int) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else f"{text[: limit - 1].rstrip()}…"


@lru_cache(maxsize=4)
def _index_template(path: str) -> Optional[str]:
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read()
    except OSError:
        return None


def _dist_index() -> Optional[str]:
    dist = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", settings.FRONTEND_DIST)
    )
    return _index_template(os.path.join(dist, "index.html"))


_EXISTING = (
    re.compile(r"<title[^>]*>.*?</title>", re.I | re.S),
    re.compile(r"<meta[^>]+name=[\"']description[\"'][^>]*>", re.I | re.S),
    re.compile(
        r"<meta[^>]+(?:property|name)=[\"'](?:og:[^\"']+|twitter:[^\"']+)[\"'][^>]*>",
        re.I | re.S,
    ),
    re.compile(r"<link[^>]+rel=[\"']canonical[\"'][^>]*>", re.I | re.S),
)


def _meta_html(card: dict, *, kind: str, index: bool = True) -> str:
    tags = [
        f"<title>{html.escape(_clip(card['title'], 120))}</title>",
        f"<meta name=\"description\" content=\"{html.escape(_clip(card['description'], 240))}\">",
        f"<link rel=\"canonical\" href=\"{html.escape(card['url'])}\">",
        f"<meta property=\"og:type\" content=\"{'profile' if kind == 'profile' else 'website'}\">",
        "<meta property=\"og:site_name\" content=\"Home Office\">",
        f"<meta property=\"og:url\" content=\"{html.escape(card['url'])}\">",
        f"<meta property=\"og:title\" content=\"{html.escape(_clip(card['title'], 120))}\">",
        f"<meta property=\"og:description\" content=\"{html.escape(_clip(card['description'], 240))}\">",
        f"<meta property=\"og:image\" content=\"{html.escape(card['image_url'])}\">",
        "<meta property=\"og:image:type\" content=\"image/jpeg\">",
        "<meta property=\"og:image:width\" content=\"1200\">",
        "<meta property=\"og:image:height\" content=\"630\">",
        f"<meta property=\"og:image:alt\" content=\"{html.escape(_clip(card['title'], 120))}\">",
        "<meta name=\"twitter:card\" content=\"summary_large_image\">",
        f"<meta name=\"twitter:title\" content=\"{html.escape(_clip(card['title'], 120))}\">",
        f"<meta name=\"twitter:description\" content=\"{html.escape(_clip(card['description'], 240))}\">",
        f"<meta name=\"twitter:image\" content=\"{html.escape(card['image_url'])}\">",
        f"<meta name=\"robots\" content=\"{'index,follow' if index else 'noindex,nofollow'}\">",
    ]
    if card.get("alert"):
        # A crawler that ignores og:description still gets the warning. It is a
        # report count on the seller's page, not a finding by the platform.
        tags.append(
            f"<meta name=\"home-office-safety\" content=\"{html.escape(_clip(card['alert'], 160))}\">"
        )
    return "\n    ".join(tags)


def _page(card: dict, *, kind: str, index: bool = True) -> str:
    template = _dist_index()
    meta = _meta_html(card, kind=kind, index=index)
    if template:
        for pattern in _EXISTING:
            template = pattern.sub("", template)
        return template.replace("</head>", f"    {meta}\n  </head>", 1)

    # The API can run without the built frontend (Vercel service mode, a local
    # `uvicorn` beside `vite dev`). The crawler still needs a complete document.
    alert_html = ""
    if card.get("alert"):
        alert_html = (
            '<div class="card" style="border-color:#f59e0b;background:#fffbeb;'
            f'color:#78350f;margin-bottom:16px">{html.escape(card["alert"])}</div>'
        )
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    {meta}
    <style>
      body {{ margin: 0; background: #0f3d2e; color: #fff; font-family: system-ui, sans-serif; }}
      main {{ max-width: 640px; margin: 0 auto; padding: 48px 24px; }}
      a {{ color: #c6e8d3; }}
      .card {{ border: 1px solid #3a705b; border-radius: 20px; padding: 24px; }}
    </style>
  </head>
  <body>
    <main>
      {alert_html}
      <div class="card">
        <p style="letter-spacing:.16em;font-size:12px;color:#c6e8d3">HOME OFFICE</p>
        <h1>{html.escape(card['name'])}</h1>
        <p>{html.escape(card['description'])}</p>
        <p><a href="{html.escape(card['url'])}">Open this page</a></p>
      </div>
    </main>
  </body>
</html>"""


def _not_found_page(origin: str) -> str:
    title = "That page is not on Home Office"
    description = "The address may have changed. Browse people and shops near you on Home Office."
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{html.escape(title)}</title>
    <meta name="description" content="{html.escape(description)}">
    <meta name="robots" content="noindex,nofollow">
    <meta property="og:title" content="{html.escape(title)}">
    <meta property="og:description" content="{html.escape(description)}">
    <meta property="og:site_name" content="Home Office">
  </head>
  <body style="font-family:system-ui,sans-serif;padding:32px">
    <h1>{html.escape(title)}</h1>
    <p>{html.escape(description)}</p>
    <p><a href="{html.escape(origin)}">Go to Home Office</a></p>
  </body>
</html>"""


def _image(data: bytes) -> Response:
    return Response(
        content=data,
        media_type="image/jpeg",
        headers={"Cache-Control": IMAGE_CACHE, "X-Content-Type-Options": "nosniff"},
    )


@router.get("/p/{handle}", include_in_schema=False)
async def public_profile_shell(handle: str, request: Request, db: AsyncSession = Depends(get_db)):
    card = await profile_card(db, handle, _origin(request))
    if card is None:
        from app.services.profile_handles import resolve_alias
        target = await resolve_alias(db, handle)
        if target:
            return RedirectResponse(f"/p/{target}", status_code=301, headers={"Cache-Control": "no-store"})
        return HTMLResponse(_not_found_page(_origin(request)), status_code=404,
                            headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex"})
    return HTMLResponse(
        _page(card, kind="profile"),
        headers={"Cache-Control": PAGE_CACHE, "X-Robots-Tag": "index, follow"},
    )


@router.get("/invite/{slug}", include_in_schema=False)
async def public_invite_shell(slug: str, request: Request, db: AsyncSession = Depends(get_db)):
    card = await invite_card(db, slug, _origin(request))
    if card is None:
        return HTMLResponse(_not_found_page(_origin(request)), status_code=404,
                            headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex"})
    return HTMLResponse(
        _page(card, kind="invite"),
        headers={"Cache-Control": PAGE_CACHE, "X-Robots-Tag": "index, follow"},
    )


@router.get("/og/p/{handle}.jpg", include_in_schema=False)
async def public_profile_image(handle: str, request: Request, db: AsyncSession = Depends(get_db)):
    card = await profile_card(db, handle, _origin(request))
    if card is None:
        raise HTTPException(404, "No share card for that page")
    data = await run_in_threadpool(render_profile_card, card)
    return _image(data)


@router.get("/og/invite/{slug}.jpg", include_in_schema=False)
async def public_invite_image(slug: str, request: Request, db: AsyncSession = Depends(get_db)):
    card = await invite_card(db, slug, _origin(request))
    if card is None:
        raise HTTPException(404, "No share card for that shop")
    data = await run_in_threadpool(render_invite_card, card)
    return _image(data)


@router.get("/e/{slug}", include_in_schema=False)
async def public_event_shell(slug: str, request: Request, db: AsyncSession = Depends(get_db)):
    from app.services.event_og import share_card
    card = await share_card(db, slug, _origin(request))
    if card is None:
        return HTMLResponse(_not_found_page(_origin(request)), status_code=404,
                            headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex"})
    return HTMLResponse(_page(card, kind="event"), headers={"Cache-Control": "public, max-age=120, s-maxage=120"})


@router.api_route("/api/og/events/{slug}.jpg", methods=["GET", "HEAD"], include_in_schema=False)
async def public_event_image(slug: str, request: Request, db: AsyncSession = Depends(get_db)):
    from app.services.event_og import banner_bytes, render_event_card, share_card
    card = await share_card(db, slug, _origin(request))
    if card is None:
        raise HTTPException(404, "No share card for that event")
    banner = await banner_bytes(card['images'])
    data = await run_in_threadpool(render_event_card, card, banner)
    return Response(data if request.method == "GET" else b"", media_type="image/jpeg", headers={
        "Cache-Control": "public, max-age=120, s-maxage=120", "X-Content-Type-Options": "nosniff", "Content-Length": str(len(data)),
    })


@router.get("/api/og/events/{slug}", include_in_schema=False)
async def public_event_resolve(slug: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Resolve a share link for the app without publishing the private roster."""
    from app.services.event_og import share_card
    card = await share_card(db, slug, _origin(request))
    if card is None:
        raise HTTPException(404, "Event not found")
    return {"id": card['id'], "kind": card['kind']}
