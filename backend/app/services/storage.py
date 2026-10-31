"""
File storage abstraction (Directive v2.1 §2.4).

    url = await storage.upload(file_bytes, filename, content_type)
    bytes, ctype = await storage.read(key)
    await storage.delete(url)

Three backends, chosen once by `MEDIA_STORE` (see `settings.media_store`):

    s3     any S3-compatible bucket — MinIO, R2, Spaces (S3_BUCKET required)
    db     the `media_objects` table, served by GET /static/<key>
    local  UPLOAD_DIR on this machine's disk

`auto` resolves to S3 when a bucket is configured, **Postgres in production
otherwise**, and the local disk in development. The production choice is not
cosmetic: a serverless image is read-only with a per-instance /tmp, and a
container is replaced on every deploy, so a locally-stored photo dies with the
instance that wrote it. The public URL (`/static/<key>`) is identical in all
three backends, which is why an existing `images` array keeps working after a
switch.

Voice notes are deliberately different: a separate private directory (or private
S3 objects) and returned only through the authenticated chat playback route.

Keys are `uploads/<uuid>/<safe-filename>`: unguessable, so the public URL is
the access control — the same model a spec-sheet link needs when a patron on
another device opens it from a chat message.
"""

import hashlib
import logging
import mimetypes
import re
import tempfile
import uuid
from pathlib import Path
from typing import Optional, Tuple

from app.config import settings

log = logging.getLogger("brief.storage")

ALLOWED_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    # iPhone gallery defaults. Accepted here and transcoded to JPEG in
    # `app/services/images.py` before storage, because no browser outside Safari
    # paints HEIC — a stored-but-invisible photo is the bug this exists to kill.
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".csv": "text/csv",
}
VOICE_TYPES = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mp4": ".m4a",
    "audio/aac": ".aac",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
}
_SAFE = re.compile(r"[^A-Za-z0-9._-]+")
_VOICE_KEY = re.compile(r"^voice-notes/[0-9a-f-]{36}\.(webm|ogg|m4a|aac|mp3|wav)$")

# The only shape `/static/<key>` will serve: exactly the key `upload()` mints.
# Anything else — a traversal, a nested path, an empty segment — is a 404 before
# the filesystem or the database is touched.
MEDIA_KEY = re.compile(r"^uploads/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$")

STORE_S3 = "s3"
STORE_DB = "db"
STORE_LOCAL = "local"


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
            raise StorageError("Unsupported file type. Allowed: PDF, PNG, JPG, WEBP, GIF, HEIC, CSV")
        ext = guessed
        name = (Path(name).stem or "file") + ext
    stem = _SAFE.sub("-", Path(name).stem).strip("-.") or "file"
    return f"{stem[:80]}{ext}", ALLOWED_TYPES[ext]


def max_bytes() -> int:
    return int(settings.MAX_UPLOAD_MB) * 1024 * 1024


def _ensure_writable_dir(path: Path, kind: str) -> Path:
    """Create `path`, falling back to a private temp dir when the disk is read-only.

    Serverless hosts (Vercel Functions among them) mount the deployment image
    read-only and hand each instance an ephemeral /tmp. The module-level
    `local_root()` call in main.py used to mkdir() straight into that read-only
    tree and raise OSError at import time — the whole API died before serving a
    single request, so sign-in and registration both failed with a 500 and
    nothing reached the database. Falling back keeps the app bootable; files
    written to the fallback live only as long as that instance, which is why
    `MEDIA_STORE=db` (the production default) does not write files at all.
    """
    try:
        path.mkdir(parents=True, exist_ok=True)
        return path
    except OSError as exc:
        fallback = Path(tempfile.gettempdir()) / f"brief-{kind}"
        if fallback == path:
            raise
        log.warning("storage: %s is not writable (%s); using %s for this instance", path, exc, fallback)
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback


class StorageService:
    """Abstract file storage — S3, Postgres or local disk."""

    def __init__(self, store: Optional[str] = None):
        self.store = (store or settings.media_store).strip().lower()
        self.bucket = settings.S3_BUCKET
        self._s3 = None
        self._local_root = Path(settings.UPLOAD_DIR).resolve()
        self._voice_root = Path(settings.VOICE_UPLOAD_DIR).resolve()
        self._local_ready = False
        self._voice_ready = False

    # ── which backend ─────────────────────────────────────────────────────

    @property
    def use_s3(self) -> bool:
        return self.store == STORE_S3

    @property
    def use_db(self) -> bool:
        return self.store == STORE_DB

    @property
    def use_local(self) -> bool:
        return self.store == STORE_LOCAL

    @property
    def name(self) -> str:
        return self.store

    # ── paths ─────────────────────────────────────────────────────────────

    @property
    def local_dir(self) -> Path:
        """The public upload root as a path — never created, only read.

        `GET /static/<key>` serves any file that is still on disk, whichever
        backend new uploads go to, so switching to `db` does not orphan the
        photos a deployment already had.
        """
        return self._local_root

    def disk_candidates(self, key: str) -> list[Path]:
        """Every place an upload might still be on this machine.

        A read-only deployment image means `UPLOAD_DIR` could not be written and
        `_ensure_writable_dir` diverted the file to `/tmp/brief-static`. Both
        locations are checked (without creating either) so those files stay
        readable and deletable for the life of the instance.
        """
        roots = [self.local_dir, Path(tempfile.gettempdir()) / "brief-static"]
        out: list[Path] = []
        for root in roots:
            path = root / key
            if path not in out:
                out.append(path)
        return out

    def disk_path(self, key: str) -> Optional[Path]:
        """The on-disk copy of `key`, if this instance still has one."""
        for path in self.disk_candidates(key):
            try:
                if path.is_file():
                    return path
            except OSError:  # pragma: no cover - an unreadable path is a miss
                continue
        return None

    @property
    def local_root(self) -> Path:
        """Public upload root for WRITING, created on first use (/tmp fallback)."""
        if not self._local_ready:
            self._local_root = _ensure_writable_dir(self._local_root, "static")
            self._local_ready = True
        return self._local_root

    @property
    def voice_root(self) -> Path:
        """Private voice-note root, created on first use (with a /tmp fallback)."""
        if not self._voice_ready:
            self._voice_root = _ensure_writable_dir(self._voice_root, "voice")
            self._voice_ready = True
        return self._voice_root

    def _ensure_voice_root_private(self) -> None:
        # Prevent a configuration typo from placing supposedly private voice
        # files underneath the directory mounted publicly at /static (or vice versa).
        if self.voice_root == self.local_root or self.voice_root in self.local_root.parents or self.local_root in self.voice_root.parents:
            raise StorageError("VOICE_UPLOAD_DIR must be separate from the public UPLOAD_DIR")

    # ── S3 client ─────────────────────────────────────────────────────────

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

    # ── public files ──────────────────────────────────────────────────────

    async def upload(self, file_bytes: bytes, filename: str, content_type: str) -> str:
        name, ctype = safe_filename(filename, content_type)
        key = f"uploads/{uuid.uuid4()}/{name}"
        if self.use_s3:
            params = {"Bucket": self.bucket, "Key": key, "Body": file_bytes, "ContentType": ctype}
            if settings.S3_PUBLIC_ACL:
                params["ACL"] = "public-read"
            self.s3.put_object(**params)
        elif self.use_db:
            await self._db_put(key, file_bytes, ctype)
        else:
            # Refuse rather than write into a disk that will be thrown away.
            #
            # This is the exact failure that emptied a shop front: the deploy had
            # no ENVIRONMENT variable, `media_store` resolved to `local`, the
            # write succeeded into the function's /tmp, the row kept the URL, and
            # the next invocation answered 404 for every photograph. An upload
            # that fails now is a five-minute fix; an upload that succeeds and
            # then evaporates is a mystery blamed on the phone.
            if settings.is_managed_host:
                raise StorageError(
                    "This host cannot store uploaded files: its disk is discarded "
                    "between requests, so the photo would disappear. Set "
                    "MEDIA_STORE=db (or S3_BUCKET for object storage) on the "
                    "deployment and redeploy."
                )
            path = self.local_root / key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(file_bytes)
        return self.public_url(key)

    async def available(self, keys: list[str]) -> set[str]:
        """Which of `keys` this deployment can actually serve right now.

        Bulk on purpose: the caller is auditing records after a deployment that
        wrote media to a disk it lost, and one query beats one per photograph.
        Anything that is not a `/static/uploads/<uuid>/<name>` key is the
        caller's business, not this method's.
        """
        candidates = [key for key in keys if key and MEDIA_KEY.match(key)]
        if not candidates:
            return set()

        present = {key for key in candidates if self.disk_path(key) is not None}

        if self.use_db:
            try:
                from sqlalchemy import select

                from app.database import async_session
                from app.models.media import MediaObject

                async with async_session() as session:
                    rows = await session.execute(
                        select(MediaObject.key).where(MediaObject.key.in_(candidates))
                    )
                    present.update(row[0] for row in rows)
            except Exception as exc:  # a missing table must not break the audit
                log.warning("storage: cannot check media_objects: %s", exc)
        return present

    async def read(self, key: str) -> Optional[Tuple[bytes, str]]:
        """Return `(bytes, content_type)` for a public key, or None.

        The disk is checked first so a deployment that has just switched to
        `db` keeps serving the files it already had, and a local development
        machine never needs the database for an image it wrote itself.
        """
        if not key or not MEDIA_KEY.match(key):
            return None

        disk = self.disk_path(key)
        if disk is not None:
            try:
                ctype = ALLOWED_TYPES.get(disk.suffix.lower()) or "application/octet-stream"
                return disk.read_bytes(), ctype
            except OSError:  # pragma: no cover - unreadable file is a miss, not a 500
                return None

        return await self._db_get(key)

    # ── Postgres-backed bytes ─────────────────────────────────────────────

    async def _db_put(self, key: str, data: bytes, content_type: str) -> None:
        # Imported lazily: app.database builds the engine at import time and
        # storage is imported by main.py before the routers.
        from app.database import async_session
        from app.models.media import MediaObject

        try:
            async with async_session() as session:
                session.add(MediaObject(
                    key=key,
                    content_type=content_type,
                    byte_size=len(data),
                    sha256=hashlib.sha256(data).hexdigest(),
                    data=data,
                ))
                await session.commit()
        except Exception as exc:
            # The one failure worth naming: the schema is behind the code.
            raise StorageError(
                "Cannot store uploads in the database (media_objects) — "
                "run `alembic upgrade head`, or set S3_BUCKET / MEDIA_STORE=local"
            ) from exc

    async def _db_get(self, key: str) -> Optional[Tuple[bytes, str]]:
        from sqlalchemy import select

        from app.database import async_session
        from app.models.media import MediaObject

        try:
            async with async_session() as session:
                row = (await session.execute(
                    select(MediaObject.content_type, MediaObject.data).where(MediaObject.key == key)
                )).first()
        except Exception as exc:  # table not migrated yet, database down, …
            log.warning("storage: media lookup failed for %s (%s)", key, exc)
            return None
        if not row:
            return None
        return bytes(row[1]), row[0]

    async def _db_delete(self, key: str) -> None:
        from sqlalchemy import delete

        from app.database import async_session
        from app.models.media import MediaObject

        async with async_session() as session:
            await session.execute(delete(MediaObject).where(MediaObject.key == key))
            await session.commit()

    # ── voice notes (always private) ──────────────────────────────────────

    async def upload_voice(self, file_bytes: bytes, content_type: str) -> str:
        """Save a chat recording privately and return its opaque storage key.

        Unlike ordinary product uploads, voice notes never receive a public URL
        or the shared uploads ACL; reads go through the room-authorized API.
        """
        mime = (content_type or "").split(";", 1)[0].strip().lower()
        ext = VOICE_TYPES.get(mime)
        if not ext:
            raise StorageError("Unsupported audio format")
        key = f"voice-notes/{uuid.uuid4()}{ext}"
        if self.use_s3:
            # Intentionally omit ACL: audio remains private even when regular
            # product assets are configured for public-read.
            self.s3.put_object(
                Bucket=self.bucket, Key=key, Body=file_bytes, ContentType=mime,
                CacheControl="private, no-store",
            )
        else:
            self._ensure_voice_root_private()
            if settings.is_managed_host:  # see the public-upload comment above
                raise StorageError(
                    "This host cannot store voice notes: its disk is discarded "
                    "between requests. Set MEDIA_STORE=db or S3_BUCKET on the deployment."
                )
            path = self.voice_root / key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(file_bytes)
        return key

    async def read_voice(self, key: str) -> tuple[bytes, str]:
        """Read one validated voice key. Never accept arbitrary object paths."""
        if not key or not _VOICE_KEY.fullmatch(key):
            raise StorageError("Invalid voice note key")
        ext = Path(key).suffix
        mime = next((mime for mime, suffix in VOICE_TYPES.items() if suffix == ext), "application/octet-stream")
        if self.use_s3:
            obj = self.s3.get_object(Bucket=self.bucket, Key=key)
            return obj["Body"].read(), mime
        self._ensure_voice_root_private()
        path = (self.voice_root / key).resolve()
        if self.voice_root not in path.parents:
            raise StorageError("Invalid voice note path")
        try:
            return path.read_bytes(), mime
        except FileNotFoundError as exc:
            raise StorageError("Voice note not found") from exc

    async def delete_voice(self, key: str) -> None:
        """Best-effort rollback helper for an upload whose DB write failed."""
        if not key or not _VOICE_KEY.fullmatch(key):
            return
        try:
            if self.use_s3:
                self.s3.delete_object(Bucket=self.bucket, Key=key)
            else:
                self._ensure_voice_root_private()
                path = (self.voice_root / key).resolve()
                if self.voice_root in path.parents:
                    path.unlink(missing_ok=True)
        except Exception:  # pragma: no cover - storage may be temporarily unavailable
            log.warning("could not delete private voice note %s", key)

    # ── deletion ──────────────────────────────────────────────────────────

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
                return
            # A key may exist on disk (older upload) and in the database (newer),
            # so removing one record removes both copies.
            for path in self.disk_candidates(key):
                if path.exists():
                    path.unlink(missing_ok=True)
            if self.use_db:
                await self._db_delete(key)
        except Exception:  # pragma: no cover - storage may be temporarily unavailable
            log.warning("could not delete stored file %s", key)


storage = StorageService()


def local_root() -> Optional[str]:
    """Directory main.py used to mount at /static (local backend only).

    Kept for compatibility; `/static` is now served by `app/routes/media.py`,
    which reads the disk and the database through `storage.read()`.
    """
    if not storage.use_local:
        return None
    return str(storage.local_root)


def storage_mode() -> str:
    """'s3', 'db' or 'local' — surfaced by /api/ops/status."""
    return storage.name


def is_public_url(url: str) -> bool:
    return bool(url) and (url.startswith("/static/") or url.startswith("http://") or url.startswith("https://"))
