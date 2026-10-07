from __future__ import annotations
import asyncio
import hashlib
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from config import settings
from models.database import get_db
from models.file_record import FileRecord
from models.schemas import FileFootprint, FileStatus
from services.mime_router import resolve_mime, classify
from services.storage import get_storage
from services.chunker import TextChunker, save_chunks
from services.extractors.text import PDFExtractor, DocxExtractor, PlainExtractor, TabularExtractor
from services.extractors.media import ImageExtractor, AudioExtractor, VideoExtractor
from services.extractors.archive import ArchiveExtractor
from utils.security import safe_filename, sha256_of, validate_upload, verify_jwt
from utils.logger import get_logger

logger = get_logger(__name__)
router = APIRouter(prefix="/files", tags=["Files"])

CHUNKS_DIR = Path(settings.UPLOAD_DIR) / "chunks"
CHUNKS_DIR.mkdir(parents=True, exist_ok=True)


# ── Background processing pipeline ────────────────────────────────────────────

async def _process_file(file_id: str, data: bytes, mime_type: str, category: str, extractor_key: str, original_name: str) -> None:
    """Background task: extract text/metadata, chunk, and update DB status."""
    from models.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        record = await db.get(FileRecord, file_id)
        if not record:
            return
        record.status = "processing"
        record.progress_pct = 10
        await db.commit()

    extracted_text = ""
    page_count = None
    file_metadata: dict = {}
    warnings: list[str] = []
    chunks_path_str: Optional[str] = None
    token_count = 0
    chunk_count = 0

    try:
        if extractor_key == "pdf":
            result = PDFExtractor().extract(data)
            extracted_text = result.text
            page_count = result.page_count
            file_metadata = result.metadata
            warnings = result.warnings
        elif extractor_key == "docx":
            result = DocxExtractor().extract(data)
            extracted_text = result.text
            file_metadata = result.metadata
        elif extractor_key in ("plain", "json"):
            result = PlainExtractor().extract(data, mime_type)
            extracted_text = result.text
            file_metadata = result.metadata
        elif extractor_key in ("csv", "excel"):
            result = TabularExtractor().extract(data, original_name, mime_type)
            extracted_text = result.text
            file_metadata = result.metadata
            warnings = result.warnings
        elif extractor_key == "image":
            result = ImageExtractor().extract(data, original_name)
            extracted_text = result.description
            file_metadata = result.metadata
        elif extractor_key == "audio":
            result = AudioExtractor().extract(data, original_name)
            extracted_text = result.description
            file_metadata = result.metadata
            warnings = result.warnings
        elif extractor_key == "video":
            result = VideoExtractor().extract(data, original_name)
            extracted_text = result.description
            file_metadata = result.metadata
            warnings = result.warnings
        elif extractor_key in ("zip", "tar"):
            result = ArchiveExtractor().extract(data, original_name)
            extracted_text = result.combined_text
            file_metadata = {
                "total_members": result.total_members,
                "extracted_members": result.extracted_members,
                "skipped_members": result.skipped_members,
                "warnings": result.warnings,
            }

        if warnings:
            file_metadata["warnings"] = warnings

        # Chunk extracted text
        if extracted_text.strip():
            chunker = TextChunker()
            chunks = chunker.chunk(extracted_text, file_id, original_name)
            token_count = sum(c.token_count for c in chunks)
            chunk_count = len(chunks)
            chunks_path = CHUNKS_DIR / f"{file_id}_chunks.json"
            save_chunks(chunks, chunks_path)
            chunks_path_str = str(chunks_path)

        # Save extracted text to file
        text_path = CHUNKS_DIR / f"{file_id}_text.txt"
        text_path.write_text(extracted_text, encoding="utf-8")

        # Update DB
        async with AsyncSessionLocal() as db:
            record = await db.get(FileRecord, file_id)
            if record:
                record.status = "ready"
                record.progress_pct = 100
                record.page_count = page_count
                record.token_count = token_count
                record.chunk_count = chunk_count
                record.chunks_path = chunks_path_str
                record.extracted_text_path = str(text_path)
                record.file_metadata = file_metadata
                await db.commit()

        logger.info("file_processing_complete", file_id=file_id, chunks=chunk_count, tokens=token_count)

    except Exception as e:
        logger.error("file_processing_failed", file_id=file_id, error=str(e))
        async with AsyncSessionLocal() as db:
            record = await db.get(FileRecord, file_id)
            if record:
                record.status = "failed"
                record.error_message = str(e)[:1000]
                await db.commit()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post(
    "/upload",
    response_model=FileFootprint,
    status_code=202,
    summary="Universal file upload",
    description="Upload any file type (PDF, DOCX, CSV, JSON, image, audio, video, ZIP). Processing happens in the background.",
)
async def upload_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(verify_jwt),
) -> FileFootprint:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required.")

    # Read first 261 bytes for MIME detection without loading entire file
    header = await file.read(261)
    await file.seek(0)  # Reset for streaming

    mime = resolve_mime(header, file.filename, file.content_type)
    validate_upload(file.filename, header, file.content_type)  # security check
    cls = classify(mime)

    file_id = str(uuid.uuid4())
    s_name = safe_filename(file.filename)
    storage = get_storage()

    # Stream to storage
    try:
        if settings.STORAGE_DRIVER == "s3":
            storage_path, size_bytes = await storage.stream_upload(file, file_id)
        else:
            storage_path, size_bytes = await storage.stream_upload(file, file_id)
            storage_path = str(storage_path)
    except ValueError as e:
        raise HTTPException(status_code=413, detail=str(e))

    # Read full data for background processing (from disk if local)
    if settings.STORAGE_DRIVER == "local":
        import aiofiles
        async with aiofiles.open(storage_path, "rb") as f:
            data = await f.read()
    else:
        data = await storage.read_bytes(storage_path)

    sha256 = sha256_of(data)

    # Persist record
    record = FileRecord(
        id=file_id,
        user_id=user.get("sub") or user.get("userId"),
        original_name=file.filename,
        safe_name=s_name,
        mime_type=mime,
        category=cls.category,
        size_bytes=size_bytes,
        sha256=sha256,
        storage_path=storage_path,
        storage_driver=settings.STORAGE_DRIVER,
        status="processing",
        progress_pct=5,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    # Kick off background processing
    background_tasks.add_task(
        _process_file,
        file_id=file_id,
        data=data,
        mime_type=mime,
        category=cls.category,
        extractor_key=cls.extractor_key,
        original_name=file.filename,
    )

    logger.info(
        "upload_accepted",
        file_id=file_id,
        name=file.filename,
        mime=mime,
        bytes=size_bytes,
    )

    return FileFootprint(
        file_id=file_id,
        original_name=file.filename,
        safe_name=s_name,
        mime_type=mime,
        category=cls.category,
        size_bytes=size_bytes,
        sha256=sha256,
        storage_driver=settings.STORAGE_DRIVER,
        status="processing",
        created_at=record.created_at,
    )


@router.get(
    "/status/{file_id}",
    response_model=FileStatus,
    summary="Get file processing status",
)
async def get_file_status(
    file_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(verify_jwt),
) -> FileStatus:
    result = await db.execute(select(FileRecord).where(FileRecord.id == file_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail=f"File {file_id!r} not found.")

    # Ownership check
    user_id = user.get("sub") or user.get("userId")
    if settings.AUTH_ENABLED and record.user_id and record.user_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied.")

    return FileStatus(
        file_id=record.id,
        original_name=record.original_name,
        mime_type=record.mime_type,
        category=record.category,
        size_bytes=record.size_bytes,
        status=record.status,
        progress_pct=record.progress_pct,
        error_message=record.error_message,
        page_count=record.page_count,
        token_count=record.token_count,
        chunk_count=record.chunk_count,
        file_metadata=record.file_metadata,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


@router.delete(
    "/{file_id}",
    status_code=204,
    summary="Delete a file and its processed data",
)
async def delete_file(
    file_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(verify_jwt),
) -> None:
    result = await db.execute(select(FileRecord).where(FileRecord.id == file_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail=f"File {file_id!r} not found.")

    user_id = user.get("sub") or user.get("userId")
    if settings.AUTH_ENABLED and record.user_id and record.user_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied.")

    # Delete from storage
    storage = get_storage()
    try:
        await storage.delete(record.storage_path)
    except Exception as e:
        logger.warning("storage_delete_failed", file_id=file_id, error=str(e))

    # Delete chunks and text files
    for path_attr in ("chunks_path", "extracted_text_path"):
        path = getattr(record, path_attr, None)
        if path:
            try:
                Path(path).unlink(missing_ok=True)
            except Exception:
                pass

    await db.delete(record)
    await db.commit()
    logger.info("file_deleted", file_id=file_id)
