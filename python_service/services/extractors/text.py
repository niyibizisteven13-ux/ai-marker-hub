from __future__ import annotations
import io
import json
from pathlib import Path
from typing import Any

import chardet
from utils.logger import get_logger

logger = get_logger(__name__)


# ── Result dataclass ──────────────────────────────────────────────────────────

from dataclasses import dataclass, field


@dataclass
class ExtractionResult:
    text: str
    page_count: int = 1
    metadata: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


# ── PDF Extractor ─────────────────────────────────────────────────────────────

class PDFExtractor:
    """Extracts text from PDF files using PyMuPDF (fitz)."""

    def extract(self, data: bytes) -> ExtractionResult:
        try:
            import fitz  # PyMuPDF
        except ImportError:
            return ExtractionResult(
                text="",
                warnings=["PyMuPDF not installed. Install with: pip install PyMuPDF"],
            )

        doc = fitz.open(stream=data, filetype="pdf")
        pages_text: list[str] = []
        images_found = 0

        for page_num, page in enumerate(doc):
            # Extract text blocks with layout preservation
            text = page.get_text("text")  # type: ignore[attr-defined]
            if text.strip():
                pages_text.append(f"[Page {page_num + 1}]\n{text.strip()}")

            # Count images
            images_found += len(page.get_images(full=False))

        doc.close()

        full_text = "\n\n".join(pages_text)
        warnings = []
        if not full_text.strip():
            warnings.append("PDF appears to be image-only (scanned). Text extraction returned empty.")

        return ExtractionResult(
            text=full_text,
            page_count=len(pages_text),
            metadata={"images_in_pdf": images_found, "pages": len(pages_text)},
            warnings=warnings,
        )


# ── DOCX Extractor ────────────────────────────────────────────────────────────

class DocxExtractor:
    """Extracts text from DOCX files using python-docx."""

    def extract(self, data: bytes) -> ExtractionResult:
        try:
            from docx import Document
        except ImportError:
            return ExtractionResult(
                text="",
                warnings=["python-docx not installed."],
            )

        doc = Document(io.BytesIO(data))
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        tables_text: list[str] = []

        for table in doc.tables:
            rows = []
            for row in table.rows:
                row_text = " | ".join(
                    cell.text.strip() for cell in row.cells
                )
                rows.append(row_text)
            tables_text.append("[TABLE]\n" + "\n".join(rows))

        full_text = "\n\n".join(paragraphs)
        if tables_text:
            full_text += "\n\n" + "\n\n".join(tables_text)

        return ExtractionResult(
            text=full_text,
            metadata={
                "paragraph_count": len(paragraphs),
                "table_count": len(doc.tables),
            },
        )


# ── Plain Text / JSON Extractor ───────────────────────────────────────────────

class PlainExtractor:
    """Handles TXT, Markdown, HTML, XML — any text/plain variant."""

    def extract(self, data: bytes, mime_type: str = "text/plain") -> ExtractionResult:
        # Auto-detect encoding
        detected = chardet.detect(data)
        encoding = detected.get("encoding") or "utf-8"
        confidence = detected.get("confidence", 0.0)

        try:
            text = data.decode(encoding, errors="replace")
        except (LookupError, UnicodeDecodeError):
            text = data.decode("utf-8", errors="replace")
            encoding = "utf-8"

        metadata: dict[str, Any] = {
            "encoding": encoding,
            "encoding_confidence": round(confidence, 3),
            "char_count": len(text),
            "line_count": text.count("\n") + 1,
        }

        # For JSON: also parse and pretty-print for better readability
        if mime_type == "application/json":
            try:
                parsed = json.loads(text)
                text = json.dumps(parsed, indent=2, ensure_ascii=False)
                metadata["json_valid"] = True
                metadata["json_root_type"] = type(parsed).__name__
                if isinstance(parsed, list):
                    metadata["json_array_length"] = len(parsed)
            except json.JSONDecodeError as e:
                metadata["json_valid"] = False
                metadata["json_error"] = str(e)

        return ExtractionResult(text=text, metadata=metadata)


# ── Tabular Extractor ─────────────────────────────────────────────────────────

class TabularExtractor:
    """Handles CSV and Excel files. Converts to structured text + JSON records."""

    def extract(
        self,
        data: bytes,
        filename: str = "file.csv",
        mime_type: str = "text/csv",
    ) -> ExtractionResult:
        try:
            import pandas as pd
        except ImportError:
            return ExtractionResult(text="", warnings=["pandas not installed."])

        ext = Path(filename).suffix.lower()
        warnings: list[str] = []

        try:
            if ext in (".xlsx", ".xls") or "excel" in mime_type or "spreadsheet" in mime_type:
                df = pd.read_excel(io.BytesIO(data), sheet_name=None)  # All sheets
                sheets: dict[str, Any] = {}
                text_parts: list[str] = []
                for sheet_name, sheet_df in df.items():
                    sheets[sheet_name] = {"rows": len(sheet_df), "cols": len(sheet_df.columns)}
                    text_parts.append(
                        f"[Sheet: {sheet_name}]\n"
                        + sheet_df.to_string(index=False, max_rows=200)
                    )
                return ExtractionResult(
                    text="\n\n".join(text_parts),
                    metadata={"sheets": sheets, "total_sheets": len(df)},
                )
            else:
                # CSV — detect encoding first
                encoding_info = chardet.detect(data)
                encoding = encoding_info.get("encoding") or "utf-8"
                df = pd.read_csv(
                    io.BytesIO(data),
                    encoding=encoding,
                    encoding_errors="replace",
                    on_bad_lines="warn",
                )
                sample_rows = min(500, len(df))
                if len(df) > sample_rows:
                    warnings.append(f"Large file: showing first {sample_rows} of {len(df)} rows.")

                text = (
                    f"Columns: {', '.join(df.columns.tolist())}\n"
                    f"Rows: {len(df)}\n\n"
                    + df.head(sample_rows).to_string(index=False)
                )
                return ExtractionResult(
                    text=text,
                    metadata={
                        "rows": len(df),
                        "columns": df.columns.tolist(),
                        "dtypes": df.dtypes.astype(str).to_dict(),
                        "encoding": encoding,
                    },
                    warnings=warnings,
                )
        except Exception as e:
            logger.error("tabular_extraction_failed", error=str(e))
            return ExtractionResult(
                text="",
                warnings=[f"Tabular extraction failed: {e}"],
            )
