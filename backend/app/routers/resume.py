"""Resume router: upload, retrieve metadata, and download the authenticated user's resume."""
import io
import zipfile

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..database import get_db_session
from ..models.database_models import Resume, ResumeStatus, User
from ..models.resume_schemas import ResumeResponse
from ..storage import (
    ALLOWED_EXTENSIONS,
    CONTENT_TYPES,
    ResumeStorage,
    extension_of,
    sanitize_original_filename,
    storage_key_for,
)
from .auth import get_current_user

router = APIRouter(prefix="/api/resume", tags=["resume"])

_resume_storage: ResumeStorage | None = None


def get_resume_storage() -> ResumeStorage:
    """Singleton storage instance (reset by tests for isolated temp dirs)."""
    global _resume_storage
    if _resume_storage is None:
        _resume_storage = ResumeStorage()
    return _resume_storage


async def _get_active_resume(session: AsyncSession, user_id: str) -> Resume | None:
    result = await session.execute(
        select(Resume)
        .where(Resume.user_id == user_id, Resume.is_active.is_(True))
        .order_by(Resume.uploaded_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


def _validate_file(filename: str) -> str:
    """Validate the filename and return its allowed extension.

    A resume filename must be a plain basename — reject anything carrying
    directory components (either separator), which is how path traversal is
    expressed in a filename.
    """
    raw = filename or ""
    normalized = raw.replace("\\", "/")
    basename = normalized.rsplit("/", 1)[-1]
    if not raw or basename != normalized:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid filename")
    extension = extension_of(basename)
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unsupported file type. Only {', '.join(sorted(ALLOWED_EXTENSIONS)).upper()} resumes are accepted.",
        )
    return extension


def _validate_content(extension: str, content: bytes) -> None:
    """Reject empty files and content that does not match the declared type."""
    if not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Uploaded file is empty")

    if extension == "pdf":
        if not content.startswith(b"%PDF-"):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "File content does not match a PDF. Upload a valid PDF resume.",
            )
        return

    # DOCX: must be a zip (OLE/ZIP) containing the OOXML parts.
    if not content.startswith(b"PK"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "File content does not match a DOCX. Upload a valid DOCX resume.",
        )
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            names = archive.namelist()
    except zipfile.BadZipFile:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "File content does not match a DOCX. Upload a valid DOCX resume.",
        )
    if "[Content_Types].xml" not in names or "word/document.xml" not in names:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "File content does not match a DOCX. Upload a valid DOCX resume.",
        )


async def _read_upload(stream: UploadFile, max_bytes: int) -> bytes:
    """Read an upload with a hard server-side size cap (10 MB default)."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await stream.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            await stream.close()
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                f"Resume exceeds the {max_bytes // (1024 * 1024)} MB size limit.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("", response_model=ResumeResponse)
async def upload_resume(
    response: Response,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
    storage: ResumeStorage = Depends(get_resume_storage),
    file: UploadFile = File(..., description="Resume file (PDF or DOCX)"),
):
    """Upload or replace the authenticated user's resume.

    Replacement is write-safe: the new file is stored and persisted before the
    previous file is removed, so a failed upload never destroys the existing
    valid resume.
    """
    max_bytes = get_settings().max_resume_size_mb * 1024 * 1024

    # Capture the identity as a plain value up front: a failed commit rolls back
    # and expires every ORM object, and any attribute access after that would do
    # lazy sync IO outside a greenlet context.
    user_id = current_user.id

    extension = _validate_file(file.filename or "")
    content = await _read_upload(file, max_bytes)
    _validate_content(extension, content)

    safe_filename = sanitize_original_filename(file.filename or "resume")
    storage_key = storage_key_for(extension)

    old_resume = await _get_active_resume(session, user_id)
    # Snapshot the previous file identity before any DB mutation.
    old_user_id: str | None = None
    old_storage_key: str | None = None
    if old_resume is not None:
        old_user_id = old_resume.user_id
        old_storage_key = old_resume.storage_key

    # 1) Persist the new file on disk (atomic write).
    await storage.write(user_id, storage_key, content)

    # 2) Persist the new row and deactivate the previous one.
    try:
        new_resume = Resume(
            user_id=user_id,
            original_filename=safe_filename,
            storage_key=storage_key,
            file_type=CONTENT_TYPES[extension],
            file_size=len(content),
            status=ResumeStatus.UPLOADED,
            is_active=True,
        )
        if old_resume is not None:
            old_resume.is_active = False
        session.add(new_resume)
        await session.commit()
        await session.refresh(new_resume)
    except Exception as exc:
        # Failed replacement must not corrupt the existing resume nor orphan a file.
        await session.rollback()
        await storage.delete(user_id, storage_key)
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "Failed to save resume. The previous resume was kept. Please try again.",
        ) from exc

    # 3) The old file is removed only after the new state is durably persisted.
    if old_storage_key is not None:
        await storage.delete(old_user_id, old_storage_key)

    response.status_code = (
        status.HTTP_201_CREATED if old_resume is None else status.HTTP_200_OK
    )
    return ResumeResponse.model_validate(new_resume)


@router.get("", response_model=ResumeResponse)
async def get_resume(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
):
    """Return the current user's active resume metadata."""
    resume = await _get_active_resume(session, current_user.id)
    if resume is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No resume uploaded yet")
    return ResumeResponse.model_validate(resume)


@router.get("/download")
async def download_resume(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
    storage: ResumeStorage = Depends(get_resume_storage),
):
    """Stream the current user's stored resume as a file download."""
    resume = await _get_active_resume(session, current_user.id)
    if resume is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No resume uploaded yet")
    path = storage.resolve(current_user.id, resume.storage_key)
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resume file not found on disk")
    return FileResponse(
        path,
        media_type=resume.file_type,
        filename=resume.original_filename,
        content_disposition_type="attachment",
    )