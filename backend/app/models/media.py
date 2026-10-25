"""Uploaded bytes kept in Postgres.

Why this table exists: the app's only durable dependency in production is the
database. A serverless host mounts the deployment read-only and gives each
instance an ephemeral `/tmp`; a container host throws its filesystem away on the
next deploy. In both cases a product photo uploaded through `POST /api/files/upload`
is gone by the time a buyer's browser asks for it, so `/static/uploads/…` 404s
and every card shows a broken image.

`media_objects` is the honest fallback for a deploy with no object storage:

  · one row per uploaded file, keyed by the same `uploads/<uuid>/<name>` key the
    local disk and S3 use, so the public URL (`/static/<key>`) never changes;
  · `sha256` is stored so an operator can de-duplicate or audit a file without
    reading the bytes;
  · `data` is BYTEA. Product photos are capped by `MAX_UPLOAD_MB` (10 MB by
    default) which is small enough to live inline; a deployment that outgrows
    this should set `S3_BUCKET` and switch `MEDIA_STORE=s3`.

Nothing here is a new domain concept — it is a file, not a listing, a vendor or
a trade.
"""

from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, LargeBinary, String

from app.database import Base


class MediaObject(Base):
    __tablename__ = "media_objects"

    # Same key shape as local/S3: "uploads/<uuid4>/<safe-filename>".
    key = Column(String(400), primary_key=True)
    content_type = Column(String(120), nullable=False)
    byte_size = Column(Integer, nullable=False)
    sha256 = Column(String(64), nullable=False)
    data = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
