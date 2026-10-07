from __future__ import annotations
import base64
import subprocess
import json
from dataclasses import dataclass, field
from typing import Any, Optional
from utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class MediaResult:
    category: str                            # image | audio | video
    metadata: dict[str, Any] = field(default_factory=dict)
    base64_payload: Optional[str] = None     # For images: full base64
    description: str = ""                   # Human-readable summary for context
    warnings: list[str] = field(default_factory=list)


# ── Image Extractor ───────────────────────────────────────────────────────────

class ImageExtractor:
    """Extracts EXIF metadata and provides base64 payload for multimodal AI."""

    # Max image size to embed as base64 (5 MB). Larger images are referenced only.
    MAX_EMBED_BYTES = 5 * 1024 * 1024

    def extract(self, data: bytes, filename: str = "image") -> MediaResult:
        try:
            from PIL import Image
            from PIL.ExifTags import TAGS
            import io
        except ImportError:
            return MediaResult(
                category="image",
                warnings=["Pillow not installed."],
            )

        img = Image.open(io.BytesIO(data))
        meta: dict[str, Any] = {
            "format": img.format,
            "mode": img.mode,
            "width": img.size[0],
            "height": img.size[1],
            "size_bytes": len(data),
        }

        # Extract EXIF data if available
        try:
            exif_data = img._getexif()  # type: ignore[attr-defined]
            if exif_data:
                meta["exif"] = {
                    TAGS.get(tag_id, str(tag_id)): str(value)
                    for tag_id, value in exif_data.items()
                    if tag_id in TAGS
                }
        except Exception:
            pass

        # Base64 for multimodal context injection (size-limited)
        b64: Optional[str] = None
        if len(data) <= self.MAX_EMBED_BYTES:
            b64 = base64.b64encode(data).decode("ascii")
        else:
            meta["embed_skipped"] = True
            meta["reason"] = f"Image exceeds {self.MAX_EMBED_BYTES // 1024 // 1024} MB embed limit."

        description = (
            f"{img.format or 'Image'} file, {img.size[0]}x{img.size[1]} pixels, "
            f"mode={img.mode}, size={len(data) / 1024:.1f} KB."
        )

        return MediaResult(
            category="image",
            metadata=meta,
            base64_payload=b64,
            description=description,
        )


# ── Audio Extractor ───────────────────────────────────────────────────────────

class AudioExtractor:
    """Extracts audio metadata using mutagen. No transcription (out-of-scope)."""

    def extract(self, data: bytes, filename: str = "audio") -> MediaResult:
        try:
            from mutagen import File as MutagenFile
            import io
        except ImportError:
            return MediaResult(
                category="audio",
                warnings=["mutagen not installed."],
            )

        try:
            audio = MutagenFile(io.BytesIO(data), filename=filename)
            if audio is None:
                return MediaResult(
                    category="audio",
                    warnings=["Could not parse audio file with mutagen."],
                )

            info = audio.info
            meta: dict[str, Any] = {
                "duration_seconds": round(getattr(info, "length", 0), 2),
                "bitrate_kbps": getattr(info, "bitrate", None),
                "sample_rate_hz": getattr(info, "sample_rate", None),
                "channels": getattr(info, "channels", None),
                "codec": type(info).__module__.split(".")[-1],
                "size_bytes": len(data),
            }

            # Extract ID3 tags / Vorbis comments
            tags: dict[str, str] = {}
            if audio.tags:
                for key, val in audio.tags.items():
                    try:
                        tags[str(key)] = str(val)
                    except Exception:
                        pass
            meta["tags"] = tags

            duration = meta["duration_seconds"]
            mins, secs = divmod(int(duration), 60)
            description = (
                f"Audio file: {mins}m {secs}s, "
                f"{meta.get('bitrate_kbps', '?')} kbps, "
                f"{meta.get('sample_rate_hz', '?')} Hz."
            )
            if tags.get("TIT2") or tags.get("TITLE"):
                description += f" Title: {tags.get('TIT2') or tags.get('TITLE')}"

            return MediaResult(
                category="audio",
                metadata=meta,
                description=description,
            )
        except Exception as e:
            logger.error("audio_extraction_failed", error=str(e))
            return MediaResult(
                category="audio",
                warnings=[f"Audio extraction failed: {e}"],
            )


# ── Video Extractor ───────────────────────────────────────────────────────────

class VideoExtractor:
    """Extracts video metadata using ffprobe (subprocess). Gracefully degrades if absent."""

    def extract(self, data: bytes, filename: str = "video") -> MediaResult:
        import tempfile
        import os

        meta: dict[str, Any] = {"size_bytes": len(data)}
        warnings: list[str] = []

        # Write to temp file (ffprobe needs a seekable file)
        with tempfile.NamedTemporaryFile(suffix=f"_{filename}", delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name

        try:
            result = subprocess.run(
                [
                    "ffprobe",
                    "-v", "quiet",
                    "-print_format", "json",
                    "-show_streams",
                    "-show_format",
                    tmp_path,
                ],
                capture_output=True,
                text=True,
                timeout=30,
            )

            if result.returncode == 0:
                probe = json.loads(result.stdout)
                fmt = probe.get("format", {})
                streams = probe.get("streams", [])

                meta["duration_seconds"] = round(float(fmt.get("duration", 0)), 2)
                meta["format_name"] = fmt.get("format_long_name", "")
                meta["bit_rate_kbps"] = round(int(fmt.get("bit_rate", 0)) / 1000, 1)

                for stream in streams:
                    codec_type = stream.get("codec_type")
                    if codec_type == "video":
                        meta["video_codec"] = stream.get("codec_name")
                        meta["width"] = stream.get("width")
                        meta["height"] = stream.get("height")
                        meta["fps"] = stream.get("r_frame_rate", "?")
                    elif codec_type == "audio":
                        meta["audio_codec"] = stream.get("codec_name")
                        meta["audio_sample_rate"] = stream.get("sample_rate")

                duration = meta.get("duration_seconds", 0)
                mins, secs = divmod(int(duration), 60)
                description = (
                    f"Video: {mins}m {secs}s, "
                    f"{meta.get('width', '?')}x{meta.get('height', '?')}, "
                    f"{meta.get('video_codec', '?')} codec, "
                    f"{meta.get('bit_rate_kbps', '?')} kbps."
                )
            else:
                warnings.append("ffprobe returned non-zero exit code. Metadata extraction may be incomplete.")
                description = "Video file (metadata unavailable — ffprobe error)."

        except FileNotFoundError:
            warnings.append("ffprobe not found. Install ffmpeg for video metadata extraction.")
            description = "Video file (ffprobe not installed — metadata unavailable)."
        except subprocess.TimeoutExpired:
            warnings.append("ffprobe timed out after 30s.")
            description = "Video file (metadata extraction timed out)."
        except Exception as e:
            warnings.append(f"Video metadata extraction failed: {e}")
            description = "Video file."
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

        return MediaResult(
            category="video",
            metadata=meta,
            description=description,
            warnings=warnings,
        )
