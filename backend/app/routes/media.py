"""`GET /static/<key>` — the one public URL every uploaded file is served from.

Why this is a route and not `StaticFiles(directory=…)`:

  · a serverless image is read-only with an ephemeral /tmp, and a container is
    replaced on every deploy, so the directory a mount pointed at is often not
    the directory the bytes are in any more;
  · with `MEDIA_STORE=db` (the production default when no bucket is set) the
    bytes are rows in `media_objects`, which no static mount can serve;
  · one reader asks `storage` instead of guessing, and returns the same bytes
    and the same URL whichever backend wrote them.

Keys are unguessable (a UUID directory), so the URL is the access control — the
regular uploads ACL. Nothing else under this prefix is served: the key must
match the exact shape `storage.upload()` mints.
"""

import logging

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse

from app.services.storage import MEDIA_KEY, storage

log = logging.getLogger("brief.media")

router = APIRouter()

# Keys are content-addressed by the UUID directory they are minted in: a given
# URL never changes its bytes, so it can be cached forever.
CACHE_CONTROL = "public, max-age=31536000, immutable"


# HEAD is declared explicitly: review tools, link previews, CDNs and the
# `curl -sI` in the go-live guide all ask for headers only, and an image URL
# that answers 405 to HEAD looks broken to every one of them.
@router.api_route("/static/{key:path}", methods=["GET", "HEAD"], include_in_schema=False)
async def serve_media(key: str, request: Request):
    if not MEDIA_KEY.match(key):
        raise HTTPException(404, "Not found")

    # A file still on this machine wins (an older upload, or a dev server), then
    # whatever the configured backend says.
    disk = storage.disk_path(key)
    if disk is not None:
        return FileResponse(disk, headers={"Cache-Control": CACHE_CONTROL}, method=request.method)

    found = await storage.read(key)
    if not found:
        log.info("media miss: %s (store=%s)", key, storage.name)
        raise HTTPException(404, "Not found")

    data, content_type = found
    return Response(
        content=b"" if request.method == "HEAD" else data,
        media_type=content_type,
        headers={"Cache-Control": CACHE_CONTROL, "Content-Length": str(len(data))},
    )
