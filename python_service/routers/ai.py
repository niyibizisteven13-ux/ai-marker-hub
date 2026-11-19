from __future__ import annotations
from typing import AsyncIterator

import httpx

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from config import settings
from models.database import get_db
from models.file_record import FileRecord
from models.schemas import AIQueryRequest, AIQueryResponse
from services.ai_query import AIQueryEngine
from utils.security import verify_jwt
from utils.logger import get_logger

logger = get_logger(__name__)
router = APIRouter(prefix="/ai", tags=["AI Query"])

_engine = AIQueryEngine()


@router.post(
    "/query",
    summary="AI query with file context",
    description=(
        "Pass a prompt and an array of file_ids. The engine loads the processed "
        "document chunks and injects them into Claude's context window. "
        "For large document sets it automatically switches to RAG retrieval. "
        "Set stream=true for Server-Sent Events (SSE) streaming."
    ),
)
async def ai_query(
    body: AIQueryRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(verify_jwt),
):
    if not settings.ANTHROPIC_API_KEY.strip():
        raise HTTPException(status_code=503, detail="Claude is not configured.")

    user_id = user.get("sub") or user.get("userId")

    # Validate and load file records
    file_records: list[dict] = []
    if body.file_ids:
        result = await db.execute(
            select(FileRecord).where(
                and_(
                    FileRecord.id.in_(body.file_ids),
                    FileRecord.status == "ready",
                )
            )
        )
        records = result.scalars().all()

        # Ownership check
        for rec in records:
            if settings.AUTH_ENABLED and rec.user_id and rec.user_id != user_id:
                raise HTTPException(
                    status_code=403,
                    detail=f"Access denied to file {rec.id!r}.",
                )

        # Warn about files not yet ready
        found_ids = {r.id for r in records}
        not_found = set(body.file_ids) - found_ids
        if not_found:
            logger.warning(
                "files_not_ready",
                user_id=user_id,
                not_found=list(not_found),
            )

        file_records = [
            {
                "file_id": r.id,
                "original_name": r.original_name,
                "chunks_path": r.chunks_path,
                "category": r.category,
            }
            for r in records
        ]

    logger.info(
        "ai_query_received",
        user_id=user_id,
        file_count=len(file_records),
        prompt_len=len(body.prompt),
        stream=body.stream,
    )

    if body.stream:
        # Return SSE stream
        async def generate() -> AsyncIterator[str]:
            try:
                generator = await _engine.query(
                    prompt=body.prompt,
                    file_records=file_records,
                    max_tokens=body.max_tokens,
                    model=body.model,
                    stream=True,
                )
                async for chunk in generator:
                    yield chunk
            except (httpx.HTTPError, RuntimeError, ValueError) as exc:
                logger.warning("claude_stream_failed", error_type=type(exc).__name__)
                yield 'data: {"type":"error","message":"Bwenge could not complete the AI request."}\n\n'


        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )
    else:
        # Non-streaming JSON response
        try:
            result = await _engine.query(
                prompt=body.prompt,
                file_records=file_records,
                max_tokens=body.max_tokens,
                model=body.model,
                stream=False,
            )
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("claude_request_failed", error_type=type(exc).__name__)
            raise HTTPException(status_code=502, detail="Bwenge could not complete the AI request.") from exc
        return AIQueryResponse(**result)
