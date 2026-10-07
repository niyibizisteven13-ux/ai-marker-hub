from __future__ import annotations
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import settings
from utils.logger import get_logger, setup_logging
from models.database import init_db
from routers import files as files_router
from routers import ai as ai_router

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle."""
    setup_logging(debug=settings.DEBUG)
    logger.info("service_starting", port=settings.PORT, debug=settings.DEBUG)

    # Ensure required directories exist
    for directory in [settings.UPLOAD_DIR, settings.TEMP_DIR]:
        Path(directory).mkdir(parents=True, exist_ok=True)
    logger.info("directories_ready", upload=settings.UPLOAD_DIR, temp=settings.TEMP_DIR)

    # Initialise database tables
    await init_db()
    logger.info("database_ready")

    yield

    logger.info("service_stopped")


def create_app() -> FastAPI:
    app = FastAPI(
        title="Bwenge Universal File API",
        description=(
            "Production-grade file processing and AI query engine. "
            "Supports PDFs, DOCX, CSV, JSON, images, audio, video, and ZIP archives. "
            "Powered by GonkaRouter."
        ),
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    # ── CORS ─────────────────────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Global exception handler ──────────────────────────────────────────────
    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        logger.error("unhandled_exception", path=str(request.url), error=str(exc))
        return JSONResponse(
            status_code=500,
            content={"error": "Internal server error", "detail": str(exc) if settings.DEBUG else None},
        )

    # ── Health ────────────────────────────────────────────────────────────────
    @app.get("/health", tags=["Health"])
    async def health():
        return {
            "status": "ok",
            "service": "bwenge-file-api",
            "gonka_configured": bool(settings.GONKA_API_KEY),
            "storage": settings.STORAGE_DRIVER,
        }

    # ── Routers ───────────────────────────────────────────────────────────────
    app.include_router(files_router.router, prefix="/api/v1")
    app.include_router(ai_router.router, prefix="/api/v1")

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level="debug" if settings.DEBUG else "info",
    )
