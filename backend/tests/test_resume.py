"""Tests for the resume upload API - Checkpoint 4.

Covers authentication, upload validation, metadata, cross-user isolation,
replacement safety, and file-storage security using isolated temp DB + storage.
"""
import io
import os
import re
import tempfile
import uuid
import zipfile

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.database import get_db_manager
from app.models.database_models import User, UserStatus
from app.auth import hash_password
from app.routers import resume as resume_router
from app.storage import ResumeStorage

PDF_HEADER = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n"


def build_docx_bytes() -> bytes:
    """Build a minimal valid DOCX (zip with OOXML parts)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types/>')
        zf.writestr("word/document.xml", '<?xml version="1.0"?><document/>')
    return buf.getvalue()


@pytest_asyncio.fixture(scope="function")
async def db_manager():
    db_path = os.path.join(tempfile.gettempdir(), f"test_resume_db_{uuid.uuid4().hex}.db")
    manager = get_db_manager()
    manager._engine = None
    manager._session_factory = None
    manager.initialize(f"sqlite+aiosqlite:///{db_path}", echo=False)
    await manager.create_all()
    yield manager
    await manager.drop_all()
    await manager.close()
    if os.path.exists(db_path):
        os.unlink(db_path)


@pytest_asyncio.fixture(scope="function")
async def client(db_manager):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
def storage_dir(tmp_path):
    return tmp_path / "uploads"


@pytest_asyncio.fixture
def resume_storage(storage_dir, monkeypatch):
    """Point the storage singleton at an isolated temp dir for each test."""
    storage = ResumeStorage(base_dir=storage_dir)
    monkeypatch.setattr(resume_router, "_resume_storage", storage)
    return storage


async def create_user(email: str) -> User:
    async with get_db_manager().session() as session:
        user = User(name="Test User", email=email, password_hash=hash_password("password123"), status=UserStatus.ACTIVE)
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


async def auth_header(client, email: str) -> dict:
    resp = await client.post("/api/auth/login", json={"email": email, "password": "password123"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def upload(client, headers, filename="resume.pdf", content=None):
    return await client.post(
        "/api/resume",
        headers=headers,
        files={"file": (filename, content, "application/octet-stream")},
    )


class TestResumeAuthorization:
    async def test_unauthenticated_post(self, client):
        resp = await client.post("/api/resume", files={"file": ("resume.pdf", PDF_HEADER)})
        assert resp.status_code == 401

    async def test_unauthenticated_get_metadata(self, client):
        assert (await client.get("/api/resume")).status_code == 401

    async def test_unauthenticated_download(self, client):
        assert (await client.get("/api/resume/download")).status_code == 401

    async def test_get_metadata_no_resume(self, client):
        user = await create_user("noresume@example.com")
        resp = await client.get("/api/resume", headers=await auth_header(client, user.email))
        assert resp.status_code == 404


class TestResumeUploadValidation:
    async def test_valid_pdf_upload(self, client, resume_storage):
        user = await create_user("valida@example.com")
        resp = await upload(client, await auth_header(client, user.email), "cv.pdf", PDF_HEADER)
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["filename"] == "cv.pdf"
        assert data["content_type"] == "application/pdf"
        assert data["file_size"] == len(PDF_HEADER)
        assert data["status"] == "uploaded"
        assert "storage_key" not in data
        assert "path" not in data

    async def test_valid_docx_upload(self, client, resume_storage):
        user = await create_user("validdocx@example.com")
        resp = await upload(client, await auth_header(client, user.email), "cv.docx", build_docx_bytes())
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["content_type"] == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        assert data["status"] == "uploaded"

    async def test_empty_file_rejected(self, client, resume_storage):
        user = await create_user("empty@example.com")
        resp = await upload(client, await auth_header(client, user.email), "empty.pdf", b"")
        assert resp.status_code == 400
        assert "empty" in resp.json()["detail"].lower()

    async def test_unsupported_extension_rejected(self, client, resume_storage):
        user = await create_user("txt@example.com")
        resp = await upload(client, await auth_header(client, user.email), "resume.txt", b"hello")
        assert resp.status_code == 400
        assert "unsupported" in resp.json()["detail"].lower()

    async def test_oversized_file_rejected(self, client, resume_storage, monkeypatch):
        from app.config import get_settings
        monkeypatch.setattr(get_settings(), "max_resume_size_mb", 1)
        user = await create_user("big@example.com")
        over = b"%PDF-1.4\n" + b"0" * (1024 * 1024 + 10)
        resp = await upload(client, await auth_header(client, user.email), "big.pdf", over)
        assert resp.status_code == 413
        assert "size limit" in resp.json()["detail"].lower()

    async def test_malformed_content_rejected(self, client, resume_storage):
        user = await create_user("fake@example.com")
        resp = await upload(client, await auth_header(client, user.email), "fake.pdf", b"this is not a pdf")
        assert resp.status_code == 400
        assert "pdf" in resp.json()["detail"].lower()

    async def test_pdf_magic_required_even_with_pdf_extension(
        self, client, resume_storage, storage_dir
    ):
        # A .zip renamed to .pdf must not silently become a resume.
        user = await create_user("renamed@example.com")
        zip_bytes = build_docx_bytes()
        resp = await upload(client, await auth_header(client, user.email), "trick.pdf", zip_bytes)
        assert resp.status_code == 400
        # Nothing should be written to storage.
        assert not storage_dir.exists() or len(list(storage_dir.rglob("*"))) == 0


class TestResumeMetadata:
    async def test_metadata_never_exposes_internal_path(self, client, resume_storage):
        user = await create_user("meta@example.com")
        await upload(client, await auth_header(client, user.email), "cv.pdf", PDF_HEADER)
        resp = await client.get("/api/resume", headers=await auth_header(client, user.email))
        assert resp.status_code == 200
        data = resp.json()
        assert set(data) == {"id", "filename", "content_type", "file_size", "status", "uploaded_at"}
        raw = resp.text.lower()
        for forbidden in ("storage_key", "storage", "uploads", "\\\\", "_key", "path"):
            assert forbidden not in raw

    async def test_fresh_upload_persists_readable_metadata(self, client, resume_storage):
        user = await create_user("fresh@example.com")
        await upload(client, await auth_header(client, user.email), "resume.pdf", PDF_HEADER)
        resp = await client.get("/api/resume", headers=await auth_header(client, user.email))
        assert resp.status_code == 200
        data = resp.json()
        assert data["filename"] == "resume.pdf"
        assert data["file_size"] == len(PDF_HEADER)


class TestResumeStorageSecurity:
    async def test_storage_uses_server_generated_names(self, client, resume_storage, storage_dir):
        user = await create_user("generated@example.com")
        await upload(client, await auth_header(client, user.email), "original-name.pdf", PDF_HEADER)
        user_files = list((storage_dir / user.id).iterdir())
        assert len(user_files) == 1
        assert re.fullmatch(r"[0-9a-f]{32}\.pdf", user_files[0].name), user_files[0].name
        assert user_files[0].name != "original-name.pdf"

    async def test_path_traversal_filename_rejected(self, client, resume_storage, storage_dir):
        user = await create_user("trav@example.com")
        resp = await upload(
            client,
            await auth_header(client, user.email),
            "../../../../../etc/passwd.pdf",
            PDF_HEADER,
        )
        assert resp.status_code == 400
        # Nothing escaped: no file was written outside storage.
        assert not storage_dir.exists() or len(list(storage_dir.rglob("*"))) == 0

    def test_storage_resolve_rejects_traversal_key(self, storage_dir):
        storage = ResumeStorage(base_dir=storage_dir)
        with pytest.raises(ValueError):
            storage.resolve("user-1", "../../escape.pdf")

    def test_original_filename_sanitized_for_display(self):
        from app.storage import sanitize_original_filename
        assert sanitize_original_filename("c:\\fakepath\\folder\\resume.pdf") == "resume.pdf"
        assert sanitize_original_filename("../../etc/shadow.pdf") == "shadow.pdf"
        assert sanitize_original_filename("") == "resume"


class TestResumeDownload:
    async def test_download_returns_stored_content(self, client, resume_storage):
        user = await create_user("dl@example.com")
        await upload(client, await auth_header(client, user.email), "readme.pdf", PDF_HEADER)
        resp = await client.get("/api/resume/download", headers=await auth_header(client, user.email))
        assert resp.status_code == 200
        assert resp.content == PDF_HEADER
        assert resp.headers["content-type"] == "application/pdf"
        assert "attachment" in resp.headers.get("content-disposition", "")
        assert "readme.pdf" in resp.headers["content-disposition"]

    async def test_download_without_resume_404(self, client, resume_storage):
        user = await create_user("nodown@example.com")
        resp = await client.get("/api/resume/download", headers=await auth_header(client, user.email))
        assert resp.status_code == 404


class TestResumeOwnership:
    async def test_user_b_cannot_see_user_a_resume(self, client, resume_storage):
        user_a = await create_user("owner_a@example.com")
        user_b = await create_user("owner_b@example.com")
        await upload(client, await auth_header(client, user_a.email), "a.pdf", PDF_HEADER)

        resp = await client.get("/api/resume", headers=await auth_header(client, user_b.email))
        assert resp.status_code == 404

    async def test_user_b_cannot_download_user_a_resume(self, client, resume_storage):
        user_a = await create_user("dl_a@example.com")
        user_b = await create_user("dl_b@example.com")
        await upload(client, await auth_header(client, user_a.email), "a.pdf", PDF_HEADER)

        resp = await client.get("/api/resume/download", headers=await auth_header(client, user_b.email))
        assert resp.status_code == 404

    async def test_user_b_cannot_replace_user_a_resume(self, client, resume_storage):
        user_a = await create_user("rep_a@example.com")
        user_b = await create_user("rep_b@example.com")
        await upload(client, await auth_header(client, user_a.email), "a.pdf", PDF_HEADER)

        # B replaces only B's own (nonexistent) resume — A stays intact.
        resp_b = await upload(client, await auth_header(client, user_b.email), "b.docx", build_docx_bytes())
        assert resp_b.status_code == 201

        a_meta = await client.get("/api/resume", headers=await auth_header(client, user_a.email))
        assert a_meta.status_code == 200
        assert a_meta.json()["filename"] == "a.pdf"
        assert a_meta.json()["content_type"] == "application/pdf"

        b_meta = await client.get("/api/resume", headers=await auth_header(client, user_b.email))
        assert b_meta.status_code == 200
        assert b_meta.json()["filename"] == "b.docx"


class TestResumeReplacement:
    async def test_upload_replaces_and_removes_old_file(self, client, resume_storage, storage_dir, monkeypatch):
        user = await create_user("replace@example.com")
        headers = await auth_header(client, user.email)

        first = await upload(client, headers, "first.pdf", PDF_HEADER)
        assert first.status_code == 201
        first_key = list((storage_dir / user.id).iterdir())[0]

        second = await upload(client, headers, "second.docx", build_docx_bytes())
        assert second.status_code == 200, second.text
        data = second.json()
        assert data["filename"] == "second.docx"
        assert data["status"] == "uploaded"

        # Old file removed from disk; exactly one active file remains.
        assert not first_key.exists()
        files = list((storage_dir / user.id).iterdir())
        assert len(files) == 1
        assert files[0].suffix == ".docx"

        # Metadata reflects the replacement.
        meta = await client.get("/api/resume", headers=headers)
        assert meta.status_code == 200
        assert meta.json()["filename"] == "second.docx"

    async def test_failed_replacement_preserves_previous_resume(
        self, client, resume_storage, storage_dir, monkeypatch
    ):
        import sqlalchemy.ext.asyncio.session as sess

        user = await create_user("fail@example.com")
        headers = await auth_header(client, user.email)

        first = await upload(client, headers, "original.pdf", PDF_HEADER)
        assert first.status_code == 201
        original_file = list((storage_dir / user.id).iterdir())[0]

        # Simulate a DB failure at commit time after the new file is written.
        # The endpoint's commit is the first call; the dependency's teardown
        # commit must still succeed, so only the first call fails.
        real_commit = sess.AsyncSession.commit
        commits = {"count": 0}

        async def flaky_commit(self):
            commits["count"] += 1
            if commits["count"] == 1:
                raise RuntimeError("simulated db failure")
            return await real_commit(self)

        monkeypatch.setattr(sess.AsyncSession, "commit", flaky_commit)

        resp = await upload(client, headers, "replacement.pdf", PDF_HEADER)
        assert resp.status_code == 500

        # The failed replacement must not have destroyed the existing resume.
        meta = await client.get("/api/resume", headers=headers)
        assert meta.status_code == 200
        assert meta.json()["filename"] == "original.pdf"

        # The new file was rolled back / removed; the original file still exists.
        files = list((storage_dir / user.id).iterdir())
        assert len(files) == 1
        assert files[0] == original_file

        # After restoring commit, the user can still replace normally.
        monkeypatch.undo()
        resp2 = await upload(client, headers, "recovery.pdf", PDF_HEADER)
        assert resp2.status_code == 200
        assert (await client.get("/api/resume", headers=headers)).json()["filename"] == "recovery.pdf"


class TestResumeSingletonReset:
    async def test_storage_reset_isolation(self, client, resume_storage, storage_dir):
        """Sanity: each test gets a fresh storage dir."""
        user = await create_user("reset@example.com")
        await upload(client, await auth_header(client, user.email), "cv.pdf", PDF_HEADER)
        assert (storage_dir / user.id).exists()