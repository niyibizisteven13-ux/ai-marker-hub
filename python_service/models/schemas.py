from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
import uuid

from pydantic import BaseModel, Field, field_validator


# ── File Upload Response ──────────────────────────────────────────────────────

class FileFootprint(BaseModel):
    """Returned immediately on successful upload. Tracking starts here."""

    file_id: str = Field(description="Unique UUID for this file.")
    original_name: str
    safe_name: str
    mime_type: str
    category: str = Field(
        description="text | tabular | image | audio | video | archive | unknown"
    )
    size_bytes: int
    sha256: str
    storage_driver: str
    status: str = Field(default="processing")
    created_at: datetime
    message: str = Field(default="File received. Processing started in background.")


# ── File Status Response ──────────────────────────────────────────────────────

class ChunkSummary(BaseModel):
    chunk_index: int
    token_count: int
    text_preview: str = Field(description="First 120 characters of the chunk.")


class FileStatus(BaseModel):
    file_id: str
    original_name: str
    mime_type: str
    category: str
    size_bytes: int
    status: str  # uploading | processing | ready | failed
    progress_pct: int
    error_message: Optional[str] = None
    page_count: Optional[int] = None
    token_count: Optional[int] = None
    chunk_count: Optional[int] = None
    file_metadata: Optional[dict] = None
    created_at: datetime
    updated_at: datetime


# ── AI Query Request / Response ───────────────────────────────────────────────

class AIQueryRequest(BaseModel):
    prompt: str = Field(
        min_length=1,
        max_length=32_000,
        description="The user's question or instruction.",
    )
    file_ids: list[str] = Field(
        default_factory=list,
        max_length=20,
        description="List of file_ids to include as context.",
    )
    stream: bool = Field(
        default=True,
        description="If true, response is streamed as Server-Sent Events.",
    )
    model: Optional[str] = Field(
        default=None,
        description="Override the Gonka model. Defaults to GONKA_MODEL env var.",
    )
    max_tokens: int = Field(
        default=4096,
        ge=64,
        le=16384,
    )
    temperature: float = Field(default=0.3, ge=0.0, le=2.0)

    @field_validator("file_ids")
    @classmethod
    def validate_uuids(cls, v: list[str]) -> list[str]:
        for fid in v:
            try:
                uuid.UUID(fid)
            except ValueError:
                raise ValueError(f"Invalid file_id format: {fid!r}")
        return v


class ContextChunk(BaseModel):
    file_id: str
    file_name: str
    chunk_index: int
    text: str
    token_count: int


class AIQueryResponse(BaseModel):
    """Used for non-streaming responses."""

    answer: str
    model: str
    file_ids_used: list[str]
    context_strategy: str = Field(
        description="direct_injection | rag | no_context"
    )
    chunks_used: int
    total_tokens_in_context: int
    usage: Optional[dict[str, Any]] = None


# ── Error ─────────────────────────────────────────────────────────────────────

class ErrorResponse(BaseModel):
    error: str
    detail: Optional[str] = None
