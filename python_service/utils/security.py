from __future__ import annotations
import hashlib
from typing import Optional
import filetype
from jose import JWTError, jwt
from fastapi import HTTPException, Header
from config import settings
from utils.logger import get_logger

logger = get_logger(__name__)

# Hard-rejected MIME types — never process regardless of claimed type
BLOCKED_MIMES = {
    "application/x-msdownload",
    "application/x-executable",
    "application/x-sharedlib",
    "application/x-shellscript",
    "text/x-shellscript",
    "application/x-msdos-program",
}

MAX_FILENAME_LEN = 255


def detect_mime(data: bytes) -> Optional[str]:
    """Detect MIME type from magic bytes using filetype library.
    Falls back to None if unknown."""
    kind = filetype.guess(data)
    return kind.mime if kind else None


def validate_upload(
    filename: str,
    data: bytes,
    claimed_mime: Optional[str] = None,
) -> str:
    """
    Validates a file upload:
    - Sanitises filename
    - Detects real MIME from magic bytes
    - Rejects blocked types
    - Returns the authoritative detected MIME (or claimed_mime as fallback)
    """
    if not filename or len(filename) > MAX_FILENAME_LEN:
        raise HTTPException(status_code=400, detail="Invalid filename.")

    detected = detect_mime(data[:261])  # filetype only needs first 261 bytes
    mime = detected or claimed_mime or "application/octet-stream"

    if detected and claimed_mime and detected != claimed_mime:
        logger.warning(
            "mime_mismatch",
            filename=filename,
            claimed=claimed_mime,
            detected=detected,
        )
        # Use detected MIME — never trust client-supplied type
        mime = detected

    if mime in BLOCKED_MIMES:
        raise HTTPException(
            status_code=400,
            detail=f"File type '{mime}' is not permitted.",
        )

    return mime


def sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_filename(name: str) -> str:
    """Remove path separators and null bytes from filenames."""
    import re
    name = name.replace("\\", "_").replace("/", "_")
    name = re.sub(r"[\x00-\x1f]", "", name)
    return name[:MAX_FILENAME_LEN] or "unnamed"


async def verify_jwt(authorization: str = Header(default="")) -> dict:
    """FastAPI dependency: validates Bearer JWT if AUTH_ENABLED."""
    if not settings.AUTH_ENABLED:
        return {"sub": "anonymous"}
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token.")
    token = authorization[7:]
    if not settings.JWT_SECRET:
        raise HTTPException(status_code=500, detail="JWT_SECRET not configured.")
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )
        return payload
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")
