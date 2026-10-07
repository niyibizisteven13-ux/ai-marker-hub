from __future__ import annotations
from functools import lru_cache
from typing import Literal
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file="../.env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Server ────────────────────────────────────────────────────
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = False
    ALLOWED_ORIGINS: str = "http://localhost:3000,http://localhost:5173"

    # ── Gonka Router (sole AI provider) ──────────────────────────
    GONKA_API_KEY: str = ""
    GONKA_BASE_URL: str = "https://api.gonkarouter.io/v1"
    GONKA_MODEL: str = "zai-org/GLM-5.3-Flash"
    GONKA_TIMEOUT: int = 120

    # ── Database ─────────────────────────────────────────────────
    DATABASE_URL: str = "sqlite+aiosqlite:///./file_service.db"

    # ── Storage ──────────────────────────────────────────────────
    STORAGE_DRIVER: Literal["local", "s3"] = "local"
    UPLOAD_DIR: str = "./uploads"
    TEMP_DIR: str = "./tmp"
    MAX_UPLOAD_SIZE_MB: int = 2048          # 2 GB hard cap
    STREAM_CHUNK_SIZE: int = 8 * 1024 * 1024  # 8 MB per read chunk

    # ── S3-compatible storage (optional) ─────────────────────────
    S3_ENDPOINT: str = ""
    S3_BUCKET: str = "ai-marker-hub"
    S3_REGION: str = "us-east-1"
    S3_ACCESS_KEY_ID: str = ""
    S3_SECRET_ACCESS_KEY: str = ""

    # ── Auth ─────────────────────────────────────────────────────
    JWT_SECRET: str = ""
    JWT_ALGORITHM: str = "HS256"
    AUTH_ENABLED: bool = True               # set False for dev/testing

    # ── RAG / Chunking ───────────────────────────────────────────
    CONTEXT_TOKEN_LIMIT: int = 100_000      # tokens before RAG kicks in
    RAG_TOP_K: int = 10
    CHUNK_SIZE_TOKENS: int = 800
    CHUNK_OVERLAP_TOKENS: int = 100
    EMBEDDING_MODEL: str = "all-MiniLM-L6-v2"

    @property
    def max_upload_bytes(self) -> int:
        return self.MAX_UPLOAD_SIZE_MB * 1024 * 1024

    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",")]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
