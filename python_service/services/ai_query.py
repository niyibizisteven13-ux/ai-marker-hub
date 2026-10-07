from __future__ import annotations
import json
from typing import AsyncIterator, Optional

import httpx
from config import settings
from services.chunker import Chunk, load_chunks
from utils.logger import get_logger

logger = get_logger(__name__)

BWENGE_SYSTEM_PROMPT = """You are Bwenge — a highly capable AI assistant powered by GonkaRouter.
You have been provided with document context extracted from user-uploaded files.
Answer the user's question accurately and thoroughly based on the provided context.
If the answer is not in the context, say so clearly rather than hallucinating.
Cite specific file names and sections when referencing content."""


class GonkaClient:
    """Async HTTP client for GonkaRouter — the sole AI provider."""

    def __init__(self) -> None:
        if not settings.GONKA_API_KEY:
            logger.warning("gonka_api_key_missing")
        self.base_url = settings.GONKA_BASE_URL.rstrip("/")
        self.headers = {
            "Authorization": f"Bearer {settings.GONKA_API_KEY}",
            "Content-Type": "application/json",
        }
        self.model = settings.GONKA_MODEL

    async def chat(
        self,
        system: str,
        messages: list[dict],
        max_tokens: int = 4096,
        temperature: float = 0.3,
        model: Optional[str] = None,
    ) -> dict:
        """Non-streaming chat completion."""
        payload = {
            "model": model or self.model,
            "messages": [{"role": "system", "content": system}, *messages],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": False,
        }
        async with httpx.AsyncClient(timeout=settings.GONKA_TIMEOUT) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers=self.headers,
                json=payload,
            )
            response.raise_for_status()
            return response.json()

    async def stream_chat(
        self,
        system: str,
        messages: list[dict],
        max_tokens: int = 4096,
        temperature: float = 0.3,
        model: Optional[str] = None,
    ) -> AsyncIterator[str]:
        """Streaming chat — yields text tokens as they arrive."""
        payload = {
            "model": model or self.model,
            "messages": [{"role": "system", "content": system}, *messages],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": True,
        }
        async with httpx.AsyncClient(timeout=settings.GONKA_TIMEOUT) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                headers=self.headers,
                json=payload,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    line = line.strip()
                    if not line or not line.startswith("data:"):
                        continue
                    data_str = line[5:].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        data = json.loads(data_str)
                        token = (
                            data.get("choices", [{}])[0]
                            .get("delta", {})
                            .get("content", "")
                        )
                        if token:
                            yield token
                    except json.JSONDecodeError:
                        continue


class AIQueryEngine:
    """
    Loads document chunks for the requested file_ids,
    applies context-window injection or RAG, and queries GonkaRouter.
    """

    def __init__(self) -> None:
        self.gonka = GonkaClient()

    def _build_context_block(self, chunks: list[Chunk]) -> tuple[str, int]:
        """Build the context string and return (context_text, total_tokens)."""
        parts: list[str] = []
        total_tokens = 0
        for chunk in chunks:
            header = f"\n### [{chunk.file_name} — Chunk {chunk.chunk_index + 1}]\n"
            parts.append(header + chunk.text)
            total_tokens += chunk.token_count
        return "\n".join(parts), total_tokens

    def _rag_retrieve(
        self,
        query: str,
        chunks: list[Chunk],
        top_k: int = settings.RAG_TOP_K,
    ) -> list[Chunk]:
        """
        Semantic retrieval using sentence-transformers.
        Falls back to first top_k chunks if embeddings unavailable.
        """
        try:
            from sentence_transformers import SentenceTransformer
            import numpy as np

            model = SentenceTransformer(settings.EMBEDDING_MODEL)
            query_emb = model.encode([query])[0]
            texts = [c.text for c in chunks]
            chunk_embs = model.encode(texts)

            # Cosine similarity
            query_norm = query_emb / (np.linalg.norm(query_emb) + 1e-9)
            chunk_norms = chunk_embs / (np.linalg.norm(chunk_embs, axis=1, keepdims=True) + 1e-9)
            scores = chunk_norms @ query_norm

            top_indices = scores.argsort()[::-1][:top_k]
            return [chunks[i] for i in top_indices]
        except ImportError:
            logger.warning("sentence_transformers_not_installed", msg="Falling back to first N chunks.")
            return chunks[:top_k]
        except Exception as e:
            logger.error("rag_retrieval_failed", error=str(e))
            return chunks[:top_k]

    async def query(
        self,
        prompt: str,
        file_records: list[dict],  # List of {file_id, chunks_path, original_name}
        max_tokens: int = 4096,
        temperature: float = 0.3,
        model: Optional[str] = None,
        stream: bool = False,
    ):
        """
        Main query method.
        Returns a dict for non-streaming or an async generator for streaming.
        """
        # Load all chunks from disk
        all_chunks: list[Chunk] = []
        for rec in file_records:
            chunks_path = rec.get("chunks_path")
            if not chunks_path:
                continue
            try:
                file_chunks = load_chunks(chunks_path)
                # Tag each chunk with file_name
                for c in file_chunks:
                    c.file_name = rec.get("original_name", c.file_id)
                all_chunks.extend(file_chunks)
            except Exception as e:
                logger.error("chunk_load_failed", file_id=rec.get("file_id"), error=str(e))

        context_strategy = "no_context"
        chunks_to_use = all_chunks
        total_tokens_in_context = 0

        if all_chunks:
            context_text, total_tokens = self._build_context_block(all_chunks)

            if total_tokens <= settings.CONTEXT_TOKEN_LIMIT:
                # Direct injection: all chunks fit in context window
                context_strategy = "direct_injection"
            else:
                # RAG: too many tokens, retrieve most relevant chunks
                logger.info(
                    "rag_mode_activated",
                    total_tokens=total_tokens,
                    limit=settings.CONTEXT_TOKEN_LIMIT,
                )
                context_strategy = "rag"
                chunks_to_use = self._rag_retrieve(prompt, all_chunks)

            context_text, total_tokens_in_context = self._build_context_block(chunks_to_use)
            system = (
                BWENGE_SYSTEM_PROMPT
                + "\n\n## DOCUMENT CONTEXT\n"
                + context_text
                + "\n\n## END OF CONTEXT\n"
                + "Now answer the user's question based solely on the context above."
            )
        else:
            system = BWENGE_SYSTEM_PROMPT

        messages = [{"role": "user", "content": prompt}]
        file_ids_used = list({c.file_id for c in chunks_to_use})

        if stream:
            return self._stream_response(
                system=system,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
                model=model,
                meta={
                    "file_ids_used": file_ids_used,
                    "context_strategy": context_strategy,
                    "chunks_used": len(chunks_to_use),
                    "total_tokens_in_context": total_tokens_in_context,
                },
            )

        # Non-streaming
        response = await self.gonka.chat(
            system=system,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            model=model,
        )
        answer = response.get("choices", [{}])[0].get("message", {}).get("content", "")
        usage = response.get("usage")

        return {
            "answer": answer,
            "model": response.get("model", settings.GONKA_MODEL),
            "file_ids_used": file_ids_used,
            "context_strategy": context_strategy,
            "chunks_used": len(chunks_to_use),
            "total_tokens_in_context": total_tokens_in_context,
            "usage": usage,
        }

    async def _stream_response(
        self,
        system: str,
        messages: list[dict],
        max_tokens: int,
        temperature: float,
        model: Optional[str],
        meta: dict,
    ) -> AsyncIterator[str]:
        # First yield metadata as SSE comment
        yield f"data: {json.dumps({'type': 'meta', **meta})}\n\n"

        async for token in self.gonka.stream_chat(
            system=system,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            model=model,
        ):
            yield f"data: {json.dumps({'type': 'token', 'text': token})}\n\n"

        yield "data: [DONE]\n\n"
