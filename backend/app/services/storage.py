"""
File storage abstraction (Directive v2.1 §2.4).

    url = await storage.upload(file_bytes, filename, content_type)
    await storage.delete(url)

S3 (or any S3-compatible endpoint — MinIO, R2, Spaces) when S3_BUCKET is set;
otherwise local files under UPLOAD_DIR, which main.py serves at /static.

Keys are `uploads/<uuid>/<safe-filename>`: unguessable, so the public URL is
the access control — the same model a spec-sheet link needs when a patron on
another device opens it from a chat message.
"""

import logging
import mimetypes
import re
import uuid
from pathlib import Path
from typing import Optional

from app.config import settings

log = logging.getLogger("brief.storage")

ALLOWED_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".csv": "text/csv",
}
_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


class StorageError(Exception):
    pass


def safe_filename(filename: str, content_type: Optional[str] = None) -> tuple[str, str]:
    """Strip paths and odd characters; resolve the content type from the
    extension (or the declared type when the name has none)."""
    name = Path(filename or "").name
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_TYPES:
        guessed = mimetypes.guess_extension(content_type or "") or ""
        guessed = ".jpg" if guessed == ".jpe" else guessed
        if guessed not in ALLOWED_TYPES:
            raise StorageError("Unsupported file type. Allowed: PDF, PNG, JPG, WEBP, GIF, CSV")
        ext = guessed
        name = (Path(name).stem or "file") + ext
    stem = _SAFE.sub("-", Path(name).stem).strip("-.") or "file"
    return f"{stem[:80]}{ext}", ALLOWED_TYPES[ext]


def max_bytes() -> int:
    return int(settings.MAX_UPLOAD_MB) * 1024 * 1024


class StorageService:
    """Abstract file storage — S3 in production, local in dev."""

    def __init__(self):
        self.use_s3 = bool(settings.S3_BUCKET)
        self.bucket = settings.S3_BUCKET
        self._s3 = None
        self.local_root = Path(settings.UPLOAD_DIR).resolve()

    @property
    def name(self) -> str:
        return "s3" if self.use_s3 else "local"

    @property
    def s3(self):
        if self._s3 is None:
            try:
                import boto3  # optional dependency; only needed with S3_BUCKET
            except ImportError as exc:  # pragma: no cover
                raise StorageError("S3 storage needs `pip install boto3`") from exc
            self._s3 = boto3.client(
                "s3",
                aws_access_key_id=settings.AWS_ACCESS_KEY or None,
                aws_secret_access_key=settings.AWS_SECRET_KEY or None,
                region_name=settings.AWS_REGION or None,
                endpoint_url=settings.S3_ENDPOINT or None,
            )
        return self._s3

    def public_url(self, key: str) -> str:
        if not self.use_s3:
            return f"/static/{key}"
        if settings.S3_PUBLIC_URL:
            return f"{settings.S3_PUBLIC_URL.rstrip('/')}/{key}"
        if settings.S3_ENDPOINT:  # MinIO / R2 path-style
            return f"{settings.S3_ENDPOINT.rstrip('/')}/{self.bucket}/{key}"
        return f"https://{self.bucket}.s3.{settings.AWS_REGION}.amazonaws.com/{key}"

    async def upload(self, file_bytes: bytes, filename: str, content_type: str) -> str:
        name, ctype = safe_filename(filename, content_type)
        key = f"uploads/{uuid.uuid4()}/{name}"
        if self.use_s3:
            params = {"Bucket": self.bucket, "Key": key, "Body": file_bytes, "ContentType": ctype}
            if settings.S3_PUBLIC_ACL:
                params["ACL"] = "public-read"
            self.s3.put_object(**params)
        else:
            path = self.local_root / key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(file_bytes)
        return self.public_url(key)

    def _key_from_url(self, url: str) -> Optional[str]:
        if not url:
            return None
        marker = "uploads/"
        idx = url.find(marker)
        return url[idx:] if idx >= 0 else None

    async def delete(self, url: str) -> None:
        key = self._key_from_url(url)
        if not key:
            return
        try:
            if self.use_s3:
                self.s3.delete_object(Bucket=self.bucket, Key=key)
            else:
                path = (self.local_root / key).resolve()
                if self.local_root in path.parents:
                    path.unlink(missing_ok=True)
        except Exception:  # pragma: no cover
            log.warning("could not delete stored file %s", key)


storage = StorageService()


def local_root() -> Optional[str]:
    """Directory main.py mounts at /static (local backend only)."""
    if storage.use_s3:
        return None
    storage.local_root.mkdir(parents=True, exist_ok=True)
    return str(storage.local_root)


def storage_mode() -> str:
    """'s3' or 'local' — surfaced by /api/ops/status."""
    return storage.name


def is_public_url(url: str) -> bool:
    return bool(url) and (url.startswith("/static/") or url.startswith("http://") or url.startswith("https://"))
