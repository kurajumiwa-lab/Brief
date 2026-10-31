"""Reading a photograph — the optional OCR layer.

The product's job is to turn a seller's public advertising into structured
market data. That only needs *text*; a photograph is one way to get it. So this
module is deliberately small and deliberately optional:

    available()        is an OCR engine installed on this machine?
    read_lines(bytes)  the text lines in an image, or [] if there is no engine

**Why it is optional.** The engine used here (`rapidocr-onnxruntime`) pulls in
onnxruntime, OpenCV and ~80 MB of model weights. That is fine on a worker and
wrong for a serverless function: it would triple the cold start and blow the
deployment bundle. So it lives in `requirements-ocr.txt`, which an operator
installs where they run the intake desk, and the API degrades honestly without
it — `ocr_engine: null` and a message saying the text has to be pasted instead.
Nothing downstream cares where the lines came from.

The engine choice is a deliberate one: RapidOCR is Apache-2.0, runs offline,
ships its models in the wheel, and reads printed shop signage and screenshots
well. Tesseract would also work and is a two-line adapter away — but it needs a
system binary, which is one more thing that can be missing on a host we do not
control.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Iterable, Optional

log = logging.getLogger("brief.intake.ocr")

# Lines longer than this are a paragraph, not a sign. Nothing on a price board
# needs more, and truncating keeps a pathological image from filling the batch.
MAX_LINE_CHARS = 200
MAX_LINES = 400


@lru_cache(maxsize=1)
def _engine():
    """Load the OCR engine once, or record that there is none.

    Cached because model load is the slow part (seconds, not milliseconds) and
    because a failed import must not be retried on every photograph.
    """
    try:
        from rapidocr_onnxruntime import RapidOCR  # type: ignore
    except Exception:  # ImportError, or a missing libGL / onnxruntime build
        log.info("intake: no OCR engine installed — text entry only")
        return None
    try:
        return RapidOCR()
    except Exception:  # pragma: no cover - broken install
        log.exception("intake: OCR engine failed to start")
        return None


def available() -> bool:
    return _engine() is not None


def engine_name() -> Optional[str]:
    return "rapidocr" if available() else None


def _clean(lines: Iterable[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in lines:
        line = " ".join(str(raw or "").split())
        if not line or len(line) > MAX_LINE_CHARS:
            continue
        # The same slogan is printed on every card in a collage; reading it
        # once is enough, and the duplicate would otherwise become a "product".
        key = line.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(line)
        if len(out) >= MAX_LINES:
            break
    return out


def read_lines(image: bytes) -> list[str]:
    """Every text line in one image, in reading order. [] when there is no engine."""
    engine = _engine()
    if engine is None or not image:
        return []
    try:
        result, _elapsed = engine(image)
    except Exception:  # pragma: no cover - a corrupt image is not a 500
        log.warning("intake: OCR could not read one image", exc_info=True)
        return []
    if not result:
        return []
    # RapidOCR returns [box, text, score]; keep the text, in the order given.
    return _clean(row[1] for row in result if len(row) >= 2)
