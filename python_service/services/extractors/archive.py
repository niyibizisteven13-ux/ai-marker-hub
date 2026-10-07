from __future__ import annotations
import io
import zipfile
import tarfile
from dataclasses import dataclass, field
from typing import Any
from utils.logger import get_logger

logger = get_logger(__name__)

MAX_ARCHIVE_MEMBERS = 500
MAX_MEMBER_SIZE_BYTES = 100 * 1024 * 1024  # 100 MB per member


@dataclass
class ArchiveResult:
    entries: list[dict[str, Any]] = field(default_factory=list)
    total_members: int = 0
    extracted_members: int = 0
    skipped_members: int = 0
    warnings: list[str] = field(default_factory=list)
    combined_text: str = ""


class ArchiveExtractor:
    """
    Recursively extracts ZIP / TAR archives.
    Each member is routed through the MIME router and appropriate extractor.
    ZIP bombs are mitigated by member count and size limits.
    """

    def extract(self, data: bytes, original_name: str = "archive.zip") -> ArchiveResult:
        name_lower = original_name.lower()
        if name_lower.endswith(".zip") or zipfile.is_zipfile(io.BytesIO(data)):
            return self._extract_zip(data)
        elif any(name_lower.endswith(ext) for ext in (".tar", ".tar.gz", ".tgz", ".tar.bz2")):
            return self._extract_tar(data, name_lower)
        else:
            # Attempt ZIP first, then TAR
            try:
                return self._extract_zip(data)
            except Exception:
                try:
                    return self._extract_tar(data, original_name)
                except Exception as e:
                    return ArchiveResult(warnings=[f"Could not open archive: {e}"])

    def _extract_zip(self, data: bytes) -> ArchiveResult:
        result = ArchiveResult()
        text_parts: list[str] = []

        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            members = zf.infolist()
            result.total_members = len(members)

            if len(members) > MAX_ARCHIVE_MEMBERS:
                result.warnings.append(
                    f"Archive has {len(members)} members; processing first {MAX_ARCHIVE_MEMBERS}."
                )
                members = members[:MAX_ARCHIVE_MEMBERS]

            for member in members:
                if member.is_dir():
                    continue
                if member.file_size > MAX_MEMBER_SIZE_BYTES:
                    result.skipped_members += 1
                    result.warnings.append(
                        f"Skipped {member.filename!r}: exceeds {MAX_MEMBER_SIZE_BYTES // 1024 // 1024} MB limit."
                    )
                    continue

                try:
                    member_data = zf.read(member.filename)
                    entry = self._process_member(member.filename, member_data)
                    result.entries.append(entry)
                    result.extracted_members += 1
                    if entry.get("text"):
                        text_parts.append(f"[File: {member.filename}]\n{entry['text']}")
                except Exception as e:
                    result.skipped_members += 1
                    result.warnings.append(f"Error reading {member.filename!r}: {e}")

        result.combined_text = "\n\n".join(text_parts)
        return result

    def _extract_tar(self, data: bytes, name: str) -> ArchiveResult:
        result = ArchiveResult()
        text_parts: list[str] = []
        mode = "r:gz" if name.endswith((".tgz", ".tar.gz")) else "r:bz2" if name.endswith(".tar.bz2") else "r"

        with tarfile.open(fileobj=io.BytesIO(data), mode=mode) as tf:
            members = tf.getmembers()
            result.total_members = len(members)

            if len(members) > MAX_ARCHIVE_MEMBERS:
                result.warnings.append(
                    f"Archive has {len(members)} members; processing first {MAX_ARCHIVE_MEMBERS}."
                )
                members = members[:MAX_ARCHIVE_MEMBERS]

            for member in members:
                if not member.isfile():
                    continue
                if member.size > MAX_MEMBER_SIZE_BYTES:
                    result.skipped_members += 1
                    result.warnings.append(f"Skipped {member.name!r}: too large.")
                    continue

                try:
                    f = tf.extractfile(member)
                    if f is None:
                        continue
                    member_data = f.read()
                    entry = self._process_member(member.name, member_data)
                    result.entries.append(entry)
                    result.extracted_members += 1
                    if entry.get("text"):
                        text_parts.append(f"[File: {member.name}]\n{entry['text']}")
                except Exception as e:
                    result.skipped_members += 1
                    result.warnings.append(f"Error reading {member.name!r}: {e}")

        result.combined_text = "\n\n".join(text_parts)
        return result

    def _process_member(self, filename: str, data: bytes) -> dict[str, Any]:
        """Process a single archive member through the MIME router."""
        from services.mime_router import resolve_mime, classify
        from services.extractors.text import PDFExtractor, DocxExtractor, PlainExtractor, TabularExtractor
        from services.extractors.media import ImageExtractor, AudioExtractor

        mime = resolve_mime(data[:261], filename)
        cls = classify(mime)

        entry: dict[str, Any] = {
            "filename": filename,
            "mime_type": mime,
            "category": cls.category,
            "size_bytes": len(data),
            "text": "",
            "metadata": {},
        }

        try:
            if cls.extractor_key == "pdf":
                r = PDFExtractor().extract(data)
                entry["text"] = r.text
                entry["metadata"] = r.metadata
            elif cls.extractor_key == "docx":
                r = DocxExtractor().extract(data)
                entry["text"] = r.text
                entry["metadata"] = r.metadata
            elif cls.extractor_key in ("plain", "json"):
                r = PlainExtractor().extract(data, mime)
                entry["text"] = r.text
                entry["metadata"] = r.metadata
            elif cls.extractor_key in ("csv", "excel"):
                r = TabularExtractor().extract(data, filename, mime)
                entry["text"] = r.text
                entry["metadata"] = r.metadata
            elif cls.extractor_key == "image":
                r = ImageExtractor().extract(data, filename)
                entry["text"] = r.description
                entry["metadata"] = r.metadata
            elif cls.extractor_key == "audio":
                r = AudioExtractor().extract(data, filename)
                entry["text"] = r.description
                entry["metadata"] = r.metadata
        except Exception as e:
            logger.error("member_extraction_failed", filename=filename, error=str(e))
            entry["warnings"] = [str(e)]

        return entry
