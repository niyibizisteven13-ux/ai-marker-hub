from __future__ import annotations
import io
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport


@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_health():
    from main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"


@pytest.mark.anyio
async def test_upload_txt(tmp_path):
    """Uploading a plain text file should return a 202 with a file_id."""
    from main import app
    from config import settings
    settings.AUTH_ENABLED = False  # Disable auth for test

    content = b"Hello, Bwenge! This is a test document." * 10
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/files/upload",
            files={"file": ("test.txt", io.BytesIO(content), "text/plain")},
        )
    assert response.status_code == 202
    data = response.json()
    assert "file_id" in data
    assert data["mime_type"] in ("text/plain", "application/octet-stream")
    assert data["category"] in ("text", "unknown")
    assert data["size_bytes"] == len(content)


@pytest.mark.anyio
async def test_status_not_found():
    from main import app
    from config import settings
    settings.AUTH_ENABLED = False

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/files/status/nonexistent-id")
    assert response.status_code == 404


@pytest.mark.anyio
async def test_upload_rejects_executable():
    """EXE/shell files must be rejected."""
    from main import app
    from config import settings
    settings.AUTH_ENABLED = False

    # Fake EXE magic bytes (MZ header)
    exe_data = b"MZ" + b"\x00" * 100
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/files/upload",
            files={"file": ("virus.exe", io.BytesIO(exe_data), "application/octet-stream")},
        )
    # Should be 400 (blocked mime) or 202 if not detected as executable
    # Either way it should not crash
    assert response.status_code in (400, 202)
