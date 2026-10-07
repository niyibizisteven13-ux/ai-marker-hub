from __future__ import annotations
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    DateTime,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import Mapped, mapped_column

from models.database import Base


class FileRecord(Base):
    """Tracks every uploaded file through its full processing lifecycle."""

    __tablename__ = "file_records"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[Optional[str]] = mapped_column(String(255), index=True, nullable=True)
    original_name: Mapped[str] = mapped_column(String(512), nullable=False)
    safe_name: Mapped[str] = mapped_column(String(512), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(128), nullable=False)
    category: Mapped[str] = mapped_column(
        String(32), nullable=False
    )  # text | tabular | image | audio | video | archive | unknown
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    # Storage
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)  # local path or S3 key
    storage_driver: Mapped[str] = mapped_column(String(16), nullable=False, default="local")

    # Extraction output
    chunks_path: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )  # path to chunks .json file
    extracted_text_path: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )  # full plain text dump
    page_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    token_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    chunk_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Processing state machine: uploading → processing → ready | failed
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="uploading", index=True
    )
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    progress_pct: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Extractor-specific metadata (EXIF, audio tags, video resolution, etc.)
    file_metadata: Mapped[Optional[dict]] = mapped_column(
        JSON, nullable=True
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return (
            f"<FileRecord id={self.id!r} name={self.original_name!r} "
            f"status={self.status!r} mime={self.mime_type!r}>"
        )
