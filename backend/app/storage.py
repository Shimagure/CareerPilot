"""Secure resume file storage for CareerPilot.

Uploaded files are untrusted input. Every file is written under a
server-generated storage key into a per-user subdirectory, never under its
original filename, so path traversal and arbitrary filesystem writes are
impossible. Writes are atomic (temp file + os.replace) so a partially
written file is never visible at the final path.
"""
from __future__ import annotations

import os
from pathlib import Path
from uuid import uuid4

from .config import get_upload_dir

ALLOWED_EXTENSIONS = {"pdf", "docx"}
# Maps the validated extension to a canonical content type. The browser-supplied
# MIME type is never trusted.
CONTENT_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def sanitize_original_filename(filename: str, max_len: int = 255) -> str:
    """Return a display-only basename for the uploaded file.

    Strips any directory components (path traversal), control characters, and
    truncates to a sane length. Never used as a filesystem path.
    """
    name = Path(filename or "resume").name
    name = "".join(ch for ch in name if ch.isprintable() and ch not in "\x00\r\n")
    name = name.strip() or "resume"
    return name[:max_len]


def extension_of(filename: str) -> str:
    """Return the lowercased extension without the dot, or '' if none."""
    return Path(filename).suffix.lower().lstrip(".")


def storage_key_for(extension: str) -> str:
    """Generate a server-side storage identifier (uuid + safe extension only)."""
    suffix = extension if extension in ALLOWED_EXTENSIONS else ""
    return f"{uuid4().hex}{('.' + suffix) if suffix else ''}"


class ResumeStorage:
    """Filesystem-backed resume store, namespaced per user."""

    def __init__(self, base_dir: Path | None = None):
        self.base_dir = (base_dir or get_upload_dir()).resolve()

    def _user_dir(self, user_id: str) -> Path:
        # user_id is a server-derived UUID string; treating it as a single path
        # segment keeps each user's files isolated even if a key ever leaked.
        return self.base_dir / user_id

    def resolve(self, user_id: str, storage_key: str) -> Path:
        """Resolve a stored file path, guaranteeing it stays in this user's dir."""
        user_dir = self._user_dir(user_id)
        path = (user_dir / storage_key).resolve()
        if not path.is_relative_to(user_dir):
            raise ValueError("storage key escapes the user directory")
        return path

    async def write(self, user_id: str, storage_key: str, content: bytes) -> Path:
        """Atomically write content to its final path. Returns the path."""
        user_dir = self._user_dir(user_id)
        user_dir.mkdir(parents=True, exist_ok=True)
        final_path = self.resolve(user_id, storage_key)

        tmp = final_path.with_suffix(final_path.suffix + ".tmp")
        with tmp.open("wb") as fh:
            fh.write(content)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, final_path)
        return final_path

    async def read(self, user_id: str, storage_key: str) -> bytes:
        path = self.resolve(user_id, storage_key)
        return path.read_bytes()

    async def delete(self, user_id: str, storage_key: str) -> bool:
        path = self.resolve(user_id, storage_key)
        try:
            path.unlink()
        except FileNotFoundError:
            return False
        return True

    def path_exists(self, user_id: str, storage_key: str) -> bool:
        return self.resolve(user_id, storage_key).exists()