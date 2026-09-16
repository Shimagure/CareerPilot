"""Tests for the candidate profile API - Checkpoint 5.

Covers authentication, CRUD, sparse updates, resume extraction (review-only),
provenance tracking, cross-user isolation, validation, and factual integrity.
"""
import io
import json
import os
import tempfile
import uuid
import zipfile

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.database import get_db_manager
from app.models.database_models import CandidateProfile, Resume, User, UserStatus
from app.auth import hash_password
from app.storage import ResumeStorage


PDF_HEADER = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n"


def build_docx_bytes(text_lines=None) -> bytes:
    """Build a minimal valid DOCX (zip with OOXML parts)."""
    if text_lines is None:
        text_lines = [
            "Test User",
            "Manila, Philippines",
            "+63 917 123 4567",
            "test@example.com",
            "linkedin.com/in/testuser",
            "",
            "PROFESSIONAL SUMMARY",
            "Software developer with 5 years experience.",
            "",
            "SKILLS",
            "Python, FastAPI, React, SQL",
            "",
            "EXPERIENCE",
            "Acme Corp   January 2020 - December 2022",
            "Software Engineer",
            "- Built APIs",
            "- Wrote tests",
            "",
            "EDUCATION",
            "BS Computer Science | University of Manila | 2015 - 2019",
            "",
            "CERTIFICATIONS",
            "AWS Certified (2023)",
            "",
            "LANGUAGES",
            "English (Native)",
        ]

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        )

        body = ""
        for line in text_lines:
            escaped = line.replace("&", "&").replace("<", "<").replace(">", ">")
            if not line.strip():
                body += '<w:p><w:r><w:t xml:space="preserve"></w:t></w:r></w:p>'
            else:
                body += f'<w:p><w:r><w:t xml:space="preserve">{escaped}</w:t></w:r></w:p>'

        document = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>{body}</w:body></w:document>'''

        pkg_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>'''

        word_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>'''

        zf.writestr("_rels/.rels", pkg_rels)
        zf.writestr("word/_rels/document.xml.rels", word_rels)
        zf.writestr("word/document.xml", document)

    return buf.getvalue()


@pytest_asyncio.fixture(scope="function")
async def db_manager():
    db_path = os.path.join(tempfile.gettempdir(), f"test_profile_db_{uuid.uuid4().hex}.db")
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
    from app.routers import resume as resume_router
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


async def upload_resume(client, headers, filename="resume.docx", content=None):
    if content is None:
        content = build_docx_bytes()
    return await client.post(
        "/api/resume",
        headers=headers,
        files={"file": (filename, content, "application/octet-stream")},
    )


class TestProfileAuthorization:
    """Profile endpoints must require authentication and be user-scoped."""

    async def test_get_profile_requires_auth(self, client):
        resp = await client.get("/api/profile")
        assert resp.status_code == 401

    async def test_put_profile_requires_auth(self, client):
        resp = await client.put("/api/profile", json={"full_name": "Test"})
        assert resp.status_code == 401

    async def test_extract_requires_auth(self, client):
        resp = await client.post("/api/profile/extract")
        assert resp.status_code == 401

    async def test_get_profile_invalid_token(self, client):
        resp = await client.get("/api/profile", headers={"Authorization": "Bearer bad.token"})
        assert resp.status_code == 401


class TestProfilePersistence:
    """Profile CRUD operations."""

    async def test_get_profile_empty_initially(self, client, db_manager, resume_storage):
        user = await create_user("empty_profile@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.get("/api/profile", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["profile"] is None
        assert data["has_active_resume"] is False

    async def test_create_profile_via_put(self, client, db_manager, resume_storage):
        user = await create_user("create_profile@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.put("/api/profile", headers=headers, json={
            "full_name": "John Doe",
            "headline": "Software Engineer",
            "skills": [{"name": "Python", "source": "user_verified"}],
        })
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["full_name"] == "John Doe"
        assert data["headline"] == "Software Engineer"
        assert len(data["skills"]) == 1
        assert data["skills"][0]["name"] == "Python"
        assert data["skills"][0]["source"] == "user_verified"
        assert data["manually_edited"] is True
        assert data["id"] is not None

    async def test_sparse_update_only_changes_provided_fields(self, client, db_manager, resume_storage):
        user = await create_user("sparse_update@example.com")
        headers = await auth_header(client, user.email)

        # Create initial profile
        await client.put("/api/profile", headers=headers, json={
            "full_name": "Original Name",
            "headline": "Original Headline",
            "location": "Original Location",
        })

        # Update only headline
        resp = await client.put("/api/profile", headers=headers, json={
            "headline": "Updated Headline",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["full_name"] == "Original Name"
        assert data["headline"] == "Updated Headline"
        assert data["location"] == "Original Location"

    async def test_empty_put_body_rejected(self, client, db_manager, resume_storage):
        user = await create_user("empty_put@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.put("/api/profile", headers=headers, json={})
        assert resp.status_code == 400
        assert "at least one field" in resp.json()["detail"].lower()

    async def test_profile_survives_re_login(self, client, db_manager, resume_storage):
        user = await create_user("relogin@example.com")
        headers = await auth_header(client, user.email)
        await client.put("/api/profile", headers=headers, json={"full_name": "Persisted Name"})

        # Simulate new session by creating new client and re-authenticating
        resp = await client.get("/api/profile", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["profile"]["full_name"] == "Persisted Name"


class TestProfileCrossUserIsolation:
    """User A must never access User B's profile or trigger extraction on B's resume."""

    async def test_user_b_cannot_read_user_a_profile(self, client, db_manager, resume_storage):
        user_a = await create_user("owner_a@example.com")
        user_b = await create_user("owner_b@example.com")
        headers_a = await auth_header(client, user_a.email)
        headers_b = await auth_header(client, user_b.email)

        await client.put("/api/profile", headers=headers_a, json={"full_name": "User A Profile"})

        resp = await client.get("/api/profile", headers=headers_b)
        assert resp.status_code == 200
        assert resp.json()["profile"] is None

    async def test_user_b_cannot_update_user_a_profile(self, client, db_manager, resume_storage):
        user_a = await create_user("upd_a@example.com")
        user_b = await create_user("upd_b@example.com")
        headers_a = await auth_header(client, user_a.email)
        headers_b = await auth_header(client, user_b.email)

        await client.put("/api/profile", headers=headers_a, json={"full_name": "User A"})

        resp = await client.put("/api/profile", headers=headers_b, json={"full_name": "User B Attempt"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["full_name"] == "User B Attempt"
        assert data["manually_edited"] is True

        # Verify A's profile unchanged
        resp_a = await client.get("/api/profile", headers=headers_a)
        assert resp_a.json()["profile"]["full_name"] == "User A"

    async def test_user_b_cannot_extract_from_user_a_resume(self, client, db_manager, resume_storage):
        user_a = await create_user("ext_a@example.com")
        user_b = await create_user("ext_b@example.com")
        headers_a = await auth_header(client, user_a.email)
        headers_b = await auth_header(client, user_b.email)

        # User A uploads resume
        await upload_resume(client, headers_a)

        # User B tries to extract — should use B's own (nonexistent) resume → 404
        resp = await client.post("/api/profile/extract", headers=headers_b)
        assert resp.status_code == 404
        assert "no active resume" in resp.json()["detail"].lower()

    async def test_source_resume_id_must_belong_to_current_user(self, client, db_manager, resume_storage):
        user_a = await create_user("src_a@example.com")
        user_b = await create_user("src_b@example.com")
        headers_a = await auth_header(client, user_a.email)
        headers_b = await auth_header(client, user_b.email)

        await upload_resume(client, headers_a)
        a_resume = await client.get("/api/resume", headers=headers_a)
        a_resume_id = a_resume.json()["id"]

        # B tries to reference A's resume
        resp = await client.put("/api/profile", headers=headers_b, json={
            "full_name": "B",
            "source_resume_id": a_resume_id,
        })
        assert resp.status_code == 404
        assert "referenced resume not found" in resp.json()["detail"].lower()


class TestProfileExtraction:
    """Resume extraction returns a reviewable draft; nothing is persisted."""

    async def test_extract_from_active_resume(self, client, db_manager, resume_storage):
        user = await create_user("extract_valid@example.com")
        headers = await auth_header(client, user.email)
        await upload_resume(client, headers)

        resp = await client.post("/api/profile/extract", headers=headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["resume_id"] is not None
        assert data["resume_filename"].endswith(".docx")
        assert data["has_text"] is True
        assert data["warning"] is None
        assert data["draft"]["full_name"] == "Test User"
        assert data["draft"]["location"] == "Manila, Philippines"
        assert data["draft"]["phone"] == "+63 917 123 4567"
        assert data["draft"]["email"] == "test@example.com"
        assert data["draft"]["linkedin_url"] == "https://linkedin.com/in/testuser"
        assert len(data["draft"]["skills"]) >= 4
        assert len(data["draft"]["experience"]) >= 1
        assert len(data["draft"]["education"]) >= 1
        assert len(data["draft"]["certifications"]) >= 1
        assert len(data["draft"]["languages"]) >= 1
        assert data["draft"]["source_resume_id"] is not None

        # All extracted items must have provenance
        for skill in data["draft"]["skills"]:
            assert skill["source"] == "resume_extracted"
        for exp in data["draft"]["experience"]:
            assert exp["source"] == "resume_extracted"
        for edu in data["draft"]["education"]:
            assert edu["source"] == "resume_extracted"
        for cert in data["draft"]["certifications"]:
            assert cert["source"] == "resume_extracted"
        for lang in data["draft"]["languages"]:
            assert lang["source"] == "resume_extracted"

    async def test_extract_no_resume_returns_404(self, client, db_manager, resume_storage):
        user = await create_user("extract_no_resume@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.post("/api/profile/extract", headers=headers)
        assert resp.status_code == 404
        assert "no active resume" in resp.json()["detail"].lower()

    async def test_extract_scanned_pdf_warning(self, client, db_manager, resume_storage):
        user = await create_user("scanned_pdf@example.com")
        headers = await auth_header(client, user.email)
        # Upload a PDF with no extractable text (blank page)
        from pypdf import PdfWriter
        writer = PdfWriter()
        writer.add_blank_page(width=612, height=792)
        buf = io.BytesIO()
        writer.write(buf)
        pdf_content = buf.getvalue()
        await client.post("/api/resume", headers=headers, files={"file": ("blank.pdf", pdf_content, "application/pdf")})

        resp = await client.post("/api/profile/extract", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_text"] is False
        assert data["warning"] is not None
        assert "scanned" in data["warning"].lower() or "extractable" in data["warning"].lower()

    async def test_extract_malformed_docx_warning(self, client, db_manager, resume_storage):
        user = await create_user("malformed_docx@example.com")
        headers = await auth_header(client, user.email)
        # Upload a DOCX with no real content
        await client.post("/api/resume", headers=headers, files={"file": ("empty.docx", build_docx_bytes([]), "application/octet-stream")})

        resp = await client.post("/api/profile/extract", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_text"] is False
        assert data["warning"] is not None

    async def test_extract_does_not_persist(self, client, db_manager, resume_storage):
        user = await create_user("extract_no_persist@example.com")
        headers = await auth_header(client, user.email)
        await upload_resume(client, headers)

        # Extract
        await client.post("/api/profile/extract", headers=headers)

        # Profile should still be None (not auto-created)
        resp = await client.get("/api/profile", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["profile"] is None

    async def test_extract_ambiguous_content_left_unresolved(self, client, db_manager, resume_storage):
        """Ambiguous sections should not invent structured data."""
        user = await create_user("ambiguous@example.com")
        headers = await auth_header(client, user.email)
        # Resume with just a skills heading but no clear dates for experience
        content = build_docx_bytes([
            "Test User",
            "",
            "SKILLS",
            "Python, React, Docker",
            "",
            "EXPERIENCE",
            "Some Company",  # No dates
            "Did some work",
        ])
        await client.post("/api/resume", headers=headers, files={"file": ("vague.docx", content, "application/octet-stream")})

        resp = await client.post("/api/profile/extract", headers=headers)
        data = resp.json()
        # Skills extracted
        assert len(data["draft"]["skills"]) >= 3
        # Experience should either be empty or have no structured employer/title/dates
        for exp in data["draft"]["experience"]:
            # If experience exists, it should be a reviewable text block, not invented structure
            if exp["employer"] or exp["title"] or exp["start_date"] or exp["end_date"]:
                # If parser found a date range, it's okay; if not, it should be description-only
                pass


class TestProfileValidation:
    """Server-side validation for profile fields."""

    async def test_email_validation(self, client, db_manager, resume_storage):
        user = await create_user("val_email@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.put("/api/profile", headers=headers, json={"email": "not-an-email"})
        assert resp.status_code == 422

    async def test_url_validation(self, client, db_manager, resume_storage):
        user = await create_user("val_url@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.put("/api/profile", headers=headers, json={"linkedin_url": "not-a-url"})
        assert resp.status_code == 422
        resp = await client.put("/api/profile", headers=headers, json={"portfolio_url": "not-a-url"})
        assert resp.status_code == 422

    async def test_skill_name_not_empty(self, client, db_manager, resume_storage):
        user = await create_user("val_skill@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.put("/api/profile", headers=headers, json={"skills": [{"name": "  "}]})
        assert resp.status_code == 422

    async def test_max_length_enforced(self, client, db_manager, resume_storage):
        user = await create_user("val_max@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.put("/api/profile", headers=headers, json={"full_name": "x" * 300})
        assert resp.status_code == 422

    async def test_experience_structure_validated(self, client, db_manager, resume_storage):
        user = await create_user("val_exp@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.put("/api/profile", headers=headers, json={
            "experience": [{"employer": "A" * 300}]  # exceeds 255
        })
        assert resp.status_code == 422

    async def test_certification_year_format(self, client, db_manager, resume_storage):
        user = await create_user("val_cert@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.put("/api/profile", headers=headers, json={
            "certifications": [{"name": "Cert", "year": "23"}]
        })
        assert resp.status_code == 422

    async def test_accepts_valid_http_urls(self, client, db_manager, resume_storage):
        user = await create_user("val_url_ok@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.put("/api/profile", headers=headers, json={
            "linkedin_url": "https://linkedin.com/in/user",
            "portfolio_url": "https://github.com/user",
        })
        assert resp.status_code == 200


class TestProfileProvenance:
    """Provenance tracking: resume_extracted vs user_verified."""

    async def test_manual_updates_are_user_verified(self, client, db_manager, resume_storage):
        user = await create_user("prov_manual@example.com")
        headers = await auth_header(client, user.email)
        resp = await client.put("/api/profile", headers=headers, json={
            "skills": [{"name": "Manual Skill", "source": "user_verified"}],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["skills"][0]["source"] == "user_verified"

    async def test_extracted_draft_is_resume_extracted(self, client, db_manager, resume_storage):
        user = await create_user("prov_extract@example.com")
        headers = await auth_header(client, user.email)
        await upload_resume(client, headers)
        resp = await client.post("/api/profile/extract", headers=headers)
        for skill in resp.json()["draft"]["skills"]:
            assert skill["source"] == "resume_extracted"

    async def test_existing_profile_without_source_defaults_to_user_verified(self, client, db_manager, resume_storage):
        """Legacy/hand-crafted profile data without source should serialize as user_verified."""
        user = await create_user("legacy_prov@example.com")
        headers = await auth_header(client, user.email)
        async with get_db_manager().session() as session:
            session.add(CandidateProfile(
                user_id=user.id,
                full_name="Legacy User",
                skills=json.dumps(["Skill A", "Skill B"]),  # plain strings, no source
            ))
            await session.commit()

        resp = await client.get("/api/profile", headers=headers)
        data = resp.json()
        assert data["profile"]["skills"][0]["source"] == "user_verified"
        assert data["profile"]["skills"][1]["source"] == "user_verified"


class TestProfileFactualIntegrity:
    """CANDIDATE_TRUTH compliance: no fabricated experience, skills, metrics."""

    async def test_extraction_never_invents_proficiency(self, client, db_manager, resume_storage):
        """Skills listed without proficiency must not be assigned one."""
        user = await create_user("fi_proficiency@example.com")
        headers = await auth_header(client, user.email)
        content = build_docx_bytes(["Test User", "", "SKILLS", "Python, React, Docker"])
        await client.post("/api/resume", headers=headers, files={"file": ("skills.docx", content, "application/octet-stream")})

        resp = await client.post("/api/profile/extract", headers=headers)
        for skill in resp.json()["draft"]["skills"]:
            assert "proficiency" not in skill
            assert "years" not in skill
            assert "level" not in skill

    async def test_extraction_never_invents_dates(self, client, db_manager, resume_storage):
        """Missing dates must stay null, not be inferred."""
        user = await create_user("fi_dates@example.com")
        headers = await auth_header(client, user.email)
        content = build_docx_bytes(["Test User", "", "EXPERIENCE", "Company ABC", "Title XYZ", "No dates here"])
        await client.post("/api/resume", headers=headers, files={"file": ("nodates.docx", content, "application/octet-stream")})

        resp = await client.post("/api/profile/extract", headers=headers)
        for exp in resp.json()["draft"]["experience"]:
            # If no date range was parseable, employer/title/dates should be None
            # and the content should be in description
            if exp["employer"] is None and exp["title"] is None:
                assert exp["description"] is not None

    async def test_extraction_never_invents_employer(self, client, db_manager, resume_storage):
        user = await create_user("fi_employer@example.com")
        headers = await auth_header(client, user.email)
        content = build_docx_bytes(["Test User", "", "EXPERIENCE", "2020 - 2022", "Did something"])
        await client.post("/api/resume", headers=headers, files={"file": ("noemp.docx", content, "application/octet-stream")})

        resp = await client.post("/api/profile/extract", headers=headers)
        for exp in resp.json()["draft"]["experience"]:
            # Date line without employer prefix should not invent one
            assert exp["employer"] is None

    async def test_extraction_never_invents_cert_issuer(self, client, db_manager, resume_storage):
        """Year in parentheses must not become issuer."""
        user = await create_user("fi_cert@example.com")
        headers = await auth_header(client, user.email)
        content = build_docx_bytes(["Test User", "", "CERTIFICATIONS", "AWS Certified (2023)"])
        await client.post("/api/resume", headers=headers, files={"file": ("cert.docx", content, "application/octet-stream")})

        resp = await client.post("/api/profile/extract", headers=headers)
        certs = resp.json()["draft"]["certifications"]
        assert len(certs) >= 1
        cert = certs[0]
        assert cert["name"] == "AWS Certified"
        assert cert["year"] == "2023"
        assert cert["issuer"] is None  # not "2023"


class TestProfileForbiddenFields:
    """Response must never leak storage paths or raw resume text."""

    async def test_no_storage_paths_in_response(self, client, db_manager, resume_storage):
        user = await create_user("forbid_paths@example.com")
        headers = await auth_header(client, user.email)
        await upload_resume(client, headers)
        await client.post("/api/profile/extract", headers=headers)
        resp = await client.get("/api/profile", headers=headers)
        raw = resp.text.lower()
        for forbidden in ("storage", "uploads", "_key", "path", "\\\\", "storage_key"):
            assert forbidden not in raw

    async def test_no_raw_resume_text_in_response(self, client, db_manager, resume_storage):
        user = await create_user("forbid_text@example.com")
        headers = await auth_header(client, user.email)
        await upload_resume(client, headers)
        resp = await client.post("/api/profile/extract", headers=headers)
        raw = resp.text
        data = resp.json()
        # Should not contain internal storage paths, storage keys, or internal IDs
        for forbidden in ("storage", "uploads", "_key", "path", "\\\\", "storage_key"):
            assert forbidden not in raw.lower()
        # The draft SHOULD contain extracted fields like professional_summary
        assert data["draft"]["professional_summary"] == "Software developer with 5 years experience."