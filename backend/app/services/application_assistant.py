"""Application Assistant orchestrator for CareerPilot CP13B.

Integrates document_generator.py with CandidateProfile to provide the
Resume/Application Assistant workflow. Enforces CANDIDATE_TRUTH.md Level 1/2
factual boundary in production.

Never invents candidate facts, employer claims, skills, experience, metrics,
dates, certifications, or responsibilities. Only uses verified profile data.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from app.config import get_project_root
from app.models.profile_schemas import CandidateProfileResponse
from app.services import document_generator
from app.services.document_generator import CompilationResult

log = logging.getLogger(__name__)

# Storage directory for generated application documents
GENERATED_DOCS_DIR = get_project_root() / "data" / "generated"


@dataclass
class GeneratedDocuments:
    """Result of application document generation."""
    cv_success: bool
    cover_letter_success: bool
    cv_path: Optional[Path] = None
    cv_error: Optional[str] = None
    cover_letter_path: Optional[Path] = None
    cover_letter_error: Optional[str] = None


def _ensure_generated_dir() -> Path:
    """Ensure the generated documents directory exists."""
    GENERATED_DOCS_DIR.mkdir(parents=True, exist_ok=True)
    return GENERATED_DOCS_DIR


async def build_tailored_cv(
    profile: CandidateProfileResponse,
    job_title: str,
    company: str,
    output_filename: Optional[str] = None,
) -> CompilationResult:
    """Generate a tailored CV from verified candidate profile.

    Enforces CANDIDATE_TRUTH.md Level 1/2 factual boundary:
    - Only uses data present in the verified profile
    - No fabrication of skills, experience, or qualifications
    - Missing data is omitted, not invented

    Args:
        profile: Verified candidate profile (must come from CandidateProfile model)
        job_title: Target job title (from job posting)
        company: Target company name (from job posting)
        output_filename: Optional custom filename (without extension)

    Returns:
        CompilationResult with PDF path or error details

    Note:
        The profile data has already been gated by profile_extraction.py which
        only extracts Level 1/2 items and tags everything as resume_extracted.
        This function does NOT re-verify against CANDIDATE_TRUTH.md - it trusts
        that the CandidateProfile model contains only verified data.
    """
    _ensure_generated_dir()

    # Delegate to document_generator.py (already implements factual safety)
    result = await document_generator.generate_cv(profile, output_filename)

    if result.success:
        log.info(
            "Generated tailored CV for %s at %s: %s",
            job_title,
            company,
            result.pdf_path,
        )
    else:
        log.warning(
            "Failed to generate tailored CV for %s at %s: %s",
            job_title,
            company,
            result.error_message,
        )

    return result


async def build_cover_letter(
    profile: CandidateProfileResponse,
    job_title: str,
    company: str,
    output_filename: Optional[str] = None,
) -> CompilationResult:
    """Generate a cover letter from verified candidate profile.

    Enforces CANDIDATE_TRUTH.md Level 1/2 factual boundary:
    - Only uses verified profile data + authorized job context (job_title, company)
    - No unsupported claims about company reputation, initiatives, or culture
    - Skills presented with actual provenance (resume_extracted/user_verified)
    - No automatic upgrade from skill to professional experience

    Args:
        profile: Verified candidate profile (must come from CandidateProfile model)
        job_title: Target job title (from job posting, trusted as job context)
        company: Target company name (from job posting, trusted as job context)
        output_filename: Optional custom filename (without extension)

    Returns:
        CompilationResult with PDF path or error details
    """
    _ensure_generated_dir()

    # Delegate to document_generator.py (already implements factual safety)
    result = await document_generator.generate_cover_letter(
        profile, job_title, company, output_filename
    )

    if result.success:
        log.info(
            "Generated cover letter for %s at %s: %s",
            job_title,
            company,
            result.pdf_path,
        )
    else:
        log.warning(
            "Failed to generate cover letter for %s at %s: %s",
            job_title,
            company,
            result.error_message,
        )

    return result


async def generate_application_documents(
    profile: CandidateProfileResponse,
    job_title: str,
    company: str,
    generate_cv: bool = True,
    generate_cover: bool = True,
    job_stable_id: Optional[str] = None,
) -> GeneratedDocuments:
    """Generate both CV and cover letter for an application.

    Enforces CANDIDATE_TRUTH.md Level 1/2 factual boundary for both documents.
    Returns paths to generated PDFs or error details.

    Args:
        profile: Verified candidate profile
        job_title: Target job title
        company: Target company name
        generate_cv: Whether to generate CV (default True)
        generate_cover: Whether to generate cover letter (default True)
        job_stable_id: Optional job identifier for filename generation

    Returns:
        GeneratedDocuments with success flags and paths/errors for each document
    """
    # Build filename base from job info
    safe_company = "".join(c if c.isalnum() or c in "_-" else "_" for c in company)
    safe_title = "".join(c if c.isalnum() or c in "_-" else "_" for c in job_title)
    base_name = f"{safe_company}_{safe_title}"
    if job_stable_id:
        base_name = f"{job_stable_id}_{base_name}"

    cv_result = None
    cover_result = None

    if generate_cv:
        cv_filename = f"cv_{base_name}"
        cv_result = await build_tailored_cv(profile, job_title, company, cv_filename)

    if generate_cover:
        cover_filename = f"cover_{base_name}"
        cover_result = await build_cover_letter(profile, job_title, company, cover_filename)

    return GeneratedDocuments(
        cv_success=cv_result.success if cv_result else False,
        cv_path=cv_result.pdf_path if cv_result and cv_result.success else None,
        cv_error=cv_result.error_message if cv_result and not cv_result.success else None,
        cover_letter_success=cover_result.success if cover_result else False,
        cover_letter_path=cover_result.pdf_path if cover_result and cover_result.success else None,
        cover_letter_error=cover_result.error_message if cover_result and not cover_result.success else None,
    )
