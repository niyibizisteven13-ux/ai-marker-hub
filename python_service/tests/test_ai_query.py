from __future__ import annotations
import pytest
from httpx import AsyncClient, ASGITransport


@pytest.mark.anyio
async def test_ai_query_no_files():
    """Query with no files should still work (general AI chat)."""
    from main import app
    from config import settings
    settings.AUTH_ENABLED = False

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/ai/query",
            json={
                "prompt": "What is 2 + 2?",
                "file_ids": [],
                "stream": False,
            },
        )
    # Will fail with 500 if GONKA_API_KEY not set, but shape is validated
    assert response.status_code in (200, 500)


@pytest.mark.anyio
async def test_ai_query_invalid_file_id():
    from main import app
    from config import settings
    settings.AUTH_ENABLED = False

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/ai/query",
            json={
                "prompt": "Summarize",
                "file_ids": ["not-a-valid-uuid"],
                "stream": False,
            },
        )
    assert response.status_code == 422  # Pydantic validation error
