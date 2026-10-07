from __future__ import annotations
from dataclasses import dataclass
from typing import Optional
import mimetypes
import filetype
from utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class MimeClassification:
    mime_type: str
    category: str  # text | tabular | image | audio | video | archive | unknown
    extractor_key: str


_MIME_MAP: dict[str, tuple[str, str]] = {
    # PDF
    "application/pdf": ("text", "pdf"),
    # DOCX / Office
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ("text", "docx"),
    "application/msword": ("text", "docx"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ("tabular", "excel"),
    "application/vnd.ms-excel": ("tabular", "excel"),
    # Text-based
    "text/plain": ("text", "plain"),
    "text/markdown": ("text", "plain"),
    "text/html": ("text", "plain"),
    "text/csv": ("tabular", "csv"),
    "application/json": ("text", "json"),
    "application/xml": ("text", "plain"),
    "text/xml": ("text", "plain"),
    # Archives
    "application/zip": ("archive", "zip"),
    "application/x-zip-compressed": ("archive", "zip"),
    "application/x-tar": ("archive", "tar"),
    "application/gzip": ("archive", "tar"),
    "application/x-7z-compressed": ("archive", "zip"),
    "application/x-rar-compressed": ("archive", "zip"),
}

_PREFIX_MAP: list[tuple[str, str, str]] = [
    ("image/", "image", "image"),
    ("audio/", "audio", "audio"),
    ("video/", "video", "video"),
    ("text/", "text", "plain"),
]


def classify(mime_type: str) -> MimeClassification:
    """Maps a MIME type string to a processing category and extractor key."""
    lower = mime_type.lower().split(";")[0].strip()

    if lower in _MIME_MAP:
        category, extractor_key = _MIME_MAP[lower]
        return MimeClassification(mime_type=lower, category=category, extractor_key=extractor_key)

    for prefix, category, extractor_key in _PREFIX_MAP:
        if lower.startswith(prefix):
            return MimeClassification(mime_type=lower, category=category, extractor_key=extractor_key)

    logger.warning("unknown_mime_type", mime=mime_type)
    return MimeClassification(mime_type=lower, category="unknown", extractor_key="unknown")


def detect_from_bytes(header: bytes) -> Optional[str]:
    """Detect MIME type from the first 261 bytes (magic number detection)."""
    kind = filetype.guess(header)
    if kind:
        return kind.mime
    return None


def detect_from_filename(filename: str) -> Optional[str]:
    mime, _ = mimetypes.guess_type(filename)
    return mime


def resolve_mime(
    header: bytes,
    filename: str,
    claimed_mime: Optional[str] = None,
) -> str:
    """
    Authoritative MIME resolution:
    1. Magic bytes (most trusted)
    2. Filename extension
    3. Client-claimed MIME
    4. Fallback: application/octet-stream
    """
    detected = detect_from_bytes(header)
    if detected:
        return detected

    by_name = detect_from_filename(filename)
    if by_name:
        return by_name

    if claimed_mime:
        logger.warning("using_claimed_mime_as_fallback", filename=filename, claimed=claimed_mime)
        return claimed_mime

    return "application/octet-stream"
