from __future__ import annotations
import asyncio
import uuid
from pathlib import Path
from typing import AsyncIterator

import aiofiles
from fastapi import UploadFile
from config import settings
from utils.logger import get_logger

logger = get_logger(__name__)


class LocalStorage:
    """
    Async streaming write to local filesystem.
    Handles files up to 2 GB by reading in STREAM_CHUNK_SIZE chunks.
    """

    def __init__(self) -> None:
        self.base_dir = Path(settings.UPLOAD_DIR)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _make_path(self, file_id: str, original_name: str) -> Path:
        safe_name = Path(original_name).name.replace(" ", "_")
        return self.base_dir / f"{file_id}_{safe_name}"

    async def stream_upload(
        self,
        file: UploadFile,
        file_id: str,
    ) -> tuple[Path, int]:
        """
        Streams UploadFile to disk in chunks.
        Returns (path, total_bytes_written).
        Raises ValueError if file exceeds MAX_UPLOAD_SIZE_MB.
        """
        dest = self._make_path(file_id, file.filename or "upload")
        total_bytes = 0
        max_bytes = settings.max_upload_bytes
        chunk_size = settings.STREAM_CHUNK_SIZE

        async with aiofiles.open(dest, "wb") as out:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > max_bytes:
                    await out.flush()
                    dest.unlink(missing_ok=True)
                    raise ValueError(
                        f"File exceeds maximum upload size of {settings.MAX_UPLOAD_SIZE_MB} MB."
                    )
                await out.write(chunk)

        logger.info(
            "local_upload_complete",
            file_id=file_id,
            path=str(dest),
            bytes=total_bytes,
        )
        return dest, total_bytes

    async def read_bytes(self, path: str) -> bytes:
        async with aiofiles.open(path, "rb") as f:
            return await f.read()

    async def delete(self, path: str) -> None:
        p = Path(path)
        if p.exists():
            p.unlink()


class S3Storage:
    """
    Multipart upload to S3-compatible storage via boto3.
    Uses a thread pool executor to avoid blocking the event loop.
    """

    def __init__(self) -> None:
        import boto3
        self.s3 = boto3.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT or None,
            region_name=settings.S3_REGION,
            aws_access_key_id=settings.S3_ACCESS_KEY_ID,
            aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
        )
        self.bucket = settings.S3_BUCKET

    def _make_key(self, file_id: str, original_name: str) -> str:
        safe_name = Path(original_name).name.replace(" ", "_")
        return f"uploads/{file_id}_{safe_name}"

    async def stream_upload(
        self,
        file: UploadFile,
        file_id: str,
    ) -> tuple[str, int]:
        """
        Multipart upload to S3. Returns (s3_key, total_bytes).
        For simplicity, buffers entire file in memory per part (8 MB).
        """
        key = self._make_key(file_id, file.filename or "upload")
        chunk_size = settings.STREAM_CHUNK_SIZE
        max_bytes = settings.max_upload_bytes

        # Initiate multipart
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: self.s3.create_multipart_upload(Bucket=self.bucket, Key=key),
        )
        upload_id = response["UploadId"]
        parts = []
        part_number = 1
        total_bytes = 0

        try:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > max_bytes:
                    raise ValueError(f"File exceeds {settings.MAX_UPLOAD_SIZE_MB} MB limit.")

                pn = part_number
                chunk_copy = chunk
                part_response = await loop.run_in_executor(
                    None,
                    lambda: self.s3.upload_part(
                        Bucket=self.bucket,
                        Key=key,
                        UploadId=upload_id,
                        PartNumber=pn,
                        Body=chunk_copy,
                    ),
                )
                parts.append({"PartNumber": pn, "ETag": part_response["ETag"]})
                part_number += 1

            await loop.run_in_executor(
                None,
                lambda: self.s3.complete_multipart_upload(
                    Bucket=self.bucket,
                    Key=key,
                    UploadId=upload_id,
                    MultipartUpload={"Parts": parts},
                ),
            )
            logger.info("s3_upload_complete", key=key, bytes=total_bytes)
            return key, total_bytes

        except Exception as e:
            await loop.run_in_executor(
                None,
                lambda: self.s3.abort_multipart_upload(
                    Bucket=self.bucket, Key=key, UploadId=upload_id
                ),
            )
            raise

    async def read_bytes(self, key: str) -> bytes:
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: self.s3.get_object(Bucket=self.bucket, Key=key),
        )
        return response["Body"].read()

    async def delete(self, key: str) -> None:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: self.s3.delete_object(Bucket=self.bucket, Key=key),
        )


def get_storage() -> LocalStorage | S3Storage:
    if settings.STORAGE_DRIVER == "s3":
        return S3Storage()
    return LocalStorage()
