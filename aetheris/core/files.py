"""File storage and management for Aetheris.

Provides an in-memory file store for uploading, storing, and managing files
(text, code, data, images, etc.). Files are stored with metadata and can be
listed, searched, and downloaded. The store is bounded by a configurable
memory limit.

Files can be:
* Uploaded via multipart form or base64
* Organised with tags and directories
* Searched by name, type, or content
* Linked to conversations and workflows
* Auto-indexed into the RAG system on upload
"""

from __future__ import annotations

import base64
import hashlib
import mimetypes
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field


class FileInfo(BaseModel):
    id: str
    filename: str
    content_type: str
    size_bytes: int
    checksum: str
    directory: str
    tags: list[str]
    created_at: float
    metadata: dict[str, Any]


class FileUploadResult(BaseModel):
    id: str
    filename: str
    content_type: str
    size_bytes: int
    checksum: str
    indexed: bool = False


# --- Internal -----------------------------------------------------------------

@dataclass
class _File:
    id: str
    filename: str
    content_type: str
    data: bytes
    checksum: str
    directory: str
    tags: list[str]
    created_at: float
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def size_bytes(self) -> int:
        return len(self.data)

    def to_info(self) -> FileInfo:
        return FileInfo(
            id=self.id, filename=self.filename,
            content_type=self.content_type, size_bytes=self.size_bytes,
            checksum=self.checksum, directory=self.directory,
            tags=self.tags, created_at=self.created_at,
            metadata=self.metadata,
        )


# --- Store --------------------------------------------------------------------

class FileStore:
    """Thread-safe bounded in-memory file store."""

    def __init__(self, max_files: int = 200, max_total_bytes: int = 100 * 1024 * 1024) -> None:
        self._files: dict[str, _File] = {}
        self._lock = Lock()
        self._max_files = max_files
        self._max_bytes = max_total_bytes

    def put(
        self,
        filename: str,
        data: bytes,
        *,
        content_type: str = "",
        directory: str = "/",
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> _File:
        """Store a file."""
        checksum = hashlib.sha256(data).hexdigest()[:16]
        if not content_type:
            content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"

        with self._lock:
            # Check capacity
            if len(self._files) >= self._max_files:
                raise ValueError(f"Maximum of {self._max_files} files reached.")
            total = sum(f.size_bytes for f in self._files.values())
            if total + len(data) > self._max_bytes:
                raise ValueError(f"Storage limit exceeded. Max {self._max_bytes} bytes.")

            f = _File(
                id=f"file_{uuid.uuid4().hex[:10]}",
                filename=filename, content_type=content_type,
                data=data, checksum=checksum,
                directory=directory, tags=tags or [],
                created_at=time.time(), metadata=metadata or {},
            )
            self._files[f.id] = f
        return f

    def get(self, file_id: str) -> _File | None:
        with self._lock:
            return self._files.get(file_id)

    def delete(self, file_id: str) -> bool:
        with self._lock:
            return self._files.pop(file_id, None) is not None

    def list_files(
        self, *, directory: str | None = None, tags: list[str] | None = None,
        content_type_prefix: str | None = None,
    ) -> list[_File]:
        with self._lock:
            files = list(self._files.values())
        if directory:
            files = [f for f in files if f.directory.startswith(directory)]
        if tags:
            files = [f for f in files if any(t in f.tags for t in tags)]
        if content_type_prefix:
            files = [f for f in files if f.content_type.startswith(content_type_prefix)]
        return sorted(files, key=lambda f: f.created_at, reverse=True)

    def search(self, query: str, *, limit: int = 20) -> list[_File]:
        import re
        pattern = re.compile(re.escape(query), re.IGNORECASE)
        with self._lock:
            files = list(self._files.values())
        results = [f for f in files if pattern.search(f.filename)]
        # Also search text content for text files
        for f in files:
            if f in results:
                continue
            if f.content_type.startswith("text/") or "json" in f.content_type:
                try:
                    text = f.data.decode("utf-8")
                    if pattern.search(text):
                        results.append(f)
                except Exception:
                    pass
        return results[:limit]

    def stats(self) -> dict[str, Any]:
        with self._lock:
            total_bytes = sum(f.size_bytes for f in self._files.values())
            by_type: dict[str, int] = {}
            for f in self._files.values():
                ct = f.content_type.split("/")[0] if "/" in f.content_type else f.content_type
                by_type[ct] = by_type.get(ct, 0) + 1
            return {
                "total_files": len(self._files),
                "total_bytes": total_bytes,
                "max_files": self._max_files,
                "max_bytes": self._max_bytes,
                "by_type": by_type,
            }

    def clear(self) -> int:
        with self._lock:
            count = len(self._files)
            self._files.clear()
        return count


_store: FileStore | None = None


def get_file_store() -> FileStore:
    global _store
    if _store is None:
        _store = FileStore()
    return _store


__all__ = ["FileInfo", "FileUploadResult", "FileStore", "get_file_store"]
