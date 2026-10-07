from __future__ import annotations
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Optional

from config import settings
from utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class Chunk:
    chunk_index: int
    text: str
    token_count: int
    char_start: int
    char_end: int
    file_id: str
    file_name: str = ""
    embedding: Optional[list[float]] = None  # populated lazily during RAG


class TextChunker:
    """
    Splits large text into overlapping token-counted chunks.
    Uses tiktoken for accurate GPT-family token counts.
    """

    def __init__(
        self,
        chunk_size: int = settings.CHUNK_SIZE_TOKENS,
        overlap: int = settings.CHUNK_OVERLAP_TOKENS,
    ) -> None:
        self.chunk_size = chunk_size
        self.overlap = overlap
        self._enc = None

    def _get_encoder(self):
        if self._enc is None:
            try:
                import tiktoken
                self._enc = tiktoken.get_encoding("cl100k_base")
            except ImportError:
                logger.warning("tiktoken_not_installed", msg="Using character-based chunking fallback.")
        return self._enc

    def count_tokens(self, text: str) -> int:
        enc = self._get_encoder()
        if enc:
            return len(enc.encode(text, disallowed_special=()))
        # Fallback: ~4 chars per token
        return max(1, len(text) // 4)

    def chunk(
        self,
        text: str,
        file_id: str,
        file_name: str = "",
    ) -> list[Chunk]:
        """Split text into overlapping chunks by token count."""
        if not text.strip():
            return []

        enc = self._get_encoder()
        if enc:
            return self._chunk_by_tokens(text, file_id, file_name, enc)
        return self._chunk_by_chars(text, file_id, file_name)

    def _chunk_by_tokens(
        self, text: str, file_id: str, file_name: str, enc
    ) -> list[Chunk]:
        tokens = enc.encode(text, disallowed_special=())
        chunks: list[Chunk] = []
        stride = self.chunk_size - self.overlap
        idx = 0
        char_cursor = 0

        while idx < len(tokens):
            end_idx = min(idx + self.chunk_size, len(tokens))
            chunk_tokens = tokens[idx:end_idx]
            chunk_text = enc.decode(chunk_tokens)

            chunks.append(
                Chunk(
                    chunk_index=len(chunks),
                    text=chunk_text,
                    token_count=len(chunk_tokens),
                    char_start=char_cursor,
                    char_end=char_cursor + len(chunk_text),
                    file_id=file_id,
                    file_name=file_name,
                )
            )
            char_cursor += len(enc.decode(tokens[idx:idx + stride]))
            idx += stride
            if idx >= len(tokens):
                break

        logger.info(
            "chunked_text",
            file_id=file_id,
            total_tokens=len(tokens),
            chunks=len(chunks),
        )
        return chunks

    def _chunk_by_chars(self, text: str, file_id: str, file_name: str) -> list[Chunk]:
        """Fallback: character-based chunking (~4 chars per token)."""
        char_size = self.chunk_size * 4
        overlap_chars = self.overlap * 4
        chunks: list[Chunk] = []
        stride = char_size - overlap_chars
        pos = 0

        while pos < len(text):
            end = min(pos + char_size, len(text))
            chunk_text = text[pos:end]
            chunks.append(
                Chunk(
                    chunk_index=len(chunks),
                    text=chunk_text,
                    token_count=len(chunk_text) // 4,
                    char_start=pos,
                    char_end=end,
                    file_id=file_id,
                    file_name=file_name,
                )
            )
            pos += stride

        return chunks


def save_chunks(chunks: list[Chunk], dest_path: Path) -> None:
    """Persist chunks to a JSON file for later retrieval."""
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    data = [asdict(c) for c in chunks]
    dest_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def load_chunks(path: str) -> list[Chunk]:
    """Load chunks from a JSON file."""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    return [Chunk(**item) for item in raw]
