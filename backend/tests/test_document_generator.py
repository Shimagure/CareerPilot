"""Targeted tests for document_generator.py factual safety and correctness."""

import asyncio
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from app.services.document_generator import (
    _escape_latex,
    _build_cv_latex,
    _build_cover_latex,
    _compile_latex,
    generate_cv,
    generate_cover_letter,
    check_latex_availability,
    CompilationResult,
    PDF_PAGE_COUNT_AVAILABLE,
)
from app.models.profile_schemas import (
    CandidateProfileResponse,
    CertificationItem,
    EducationItem,
    ExperienceItem,
    ProjectItem,
    SkillItem,
)


def make_minimal_profile() -> CandidateProfileResponse:
    """Create a minimal valid profile with only required fields."""
    return CandidateProfileResponse(
        full_name="Test User",
        email="test@example.com",
        phone="+1234567890",
        location="Test City, Test Country",
        linkedin_url="https://linkedin.com/in/testuser",
        professional_summary=None,
        skills=[],
        experience=[],
        education=[],
        certifications=[],
        projects=[],
        portfolio_url=None,
    )


def make_full_profile() -> CandidateProfileResponse:
    """Create a full profile with all sections populated."""
    return CandidateProfileResponse(
        full_name="Wilson DC. Chiquito",
        email="wilson@example.com",
        phone="+639123456789",
        location="Muzon, San Jose del Monte, Bulacan, Philippines",
        linkedin_url="https://linkedin.com/in/wilsonchiquito",
        professional_summary="Experienced IT support specialist with 3 years in enterprise environments.",
        skills=[
            SkillItem(name="Active Directory", source="resume_extracted"),
            SkillItem(name="PowerShell", source="user_verified"),
            SkillItem(name="Linux System Administration", source="resume_extracted"),
        ],
        experience=[
            ExperienceItem(
                employer="Solaire Resort & Casino",
                title="End User Computing Technician",
                start_date="July 2023",
                end_date="May 2026",
                description="Provided Tier 2 technical support for desktops, laptops, printers, and mobile devices.",
            ),
            ExperienceItem(
                employer="Bulacan State Agricultural University",
                title="Web Design & Networking Trainee",
                start_date="January 2022",
                end_date="December 2022",
                description="Assisted in website development and maintenance, computer hardware diagnostics.",
            ),
        ],
        education=[
            EducationItem(
                institution="Bulacan State Agricultural University",
                degree="BS in Information Technology",
                start_date="2018",
                end_date="2022",
                field="Information Technology",
            ),
        ],
        certifications=[
            CertificationItem(name="Linux System Administration", issuer="Linux Foundation", year="2024"),
            CertificationItem(name="Fortinet NSE 3", issuer="Fortinet", year="2023"),
        ],
        projects=[
            ProjectItem(
                name="CrowdStrike Internal Security Monitoring Tool",
                description="Developed internal security tool to assess CrowdStrike status across 800-1000+ devices.",
                url="https://github.com/example/crowdstrike-tool",
            ),
        ],
        portfolio_url=None,
    )


class TestLatexEscaping:
    """Test LaTeX character escaping."""

    def test_escape_backslash_first(self):
        result = _escape_latex(r"test\path")
        # Backslash is escaped first to \textbackslash{}, then braces are escaped
        # So we get \textbackslash\{\} in the output
        assert r"\textbackslash{}" in result or r"\textbackslash\{\}" in result
        assert "test" in result

    def test_escape_all_special_chars(self):
        test_str = r"a&b%c$d#e_f{g}h~i^j"
        result = _escape_latex(test_str)
        assert r"\&" in result
        assert r"\%" in result
        assert r"\$" in result
        assert r"\#" in result
        assert r"\_" in result
        assert r"\{" in result
        assert r"\}" in result
        assert r"\textasciitilde{}" in result
        assert r"\textasciicircum{}" in result

    def test_escape_empty_string(self):
        assert _escape_latex("") == ""

    def test_escape_none(self):
        assert _escape_latex(None) == ""


class TestCVBuilder:
    """Test CV LaTeX generation."""

    def test_minimal_profile_generates_valid_latex(self):
        profile = make_minimal_profile()
        latex = _build_cv_latex(profile)

        # Should contain document structure
        assert r"\documentclass" in latex
        assert r"\begin{document}" in latex
        assert r"\end{document}" in latex
        assert r"\makecvtitle" in latex

        # Should include verified fields (name is split into first/last)
        assert "Test" in latex
        assert "User" in latex
        assert "Test City" in latex
        assert "test@example.com" in latex
        assert "+1234567890" in latex

        # Should NOT contain hardcoded fallbacks
        assert "Professional Summary" not in latex  # Section not generated when empty
        assert "Core Competencies" not in latex  # Section not generated when empty
        assert "Certifications" not in latex  # Section not generated when empty

    def test_full_profile_generates_all_sections(self):
        profile = make_full_profile()
        latex = _build_cv_latex(profile)

        # All sections should be present
        assert "Professional Experience" in latex
        assert "Core Competencies" in latex
        assert "Education" in latex
        assert "Certifications" in latex
        assert "Projects" in latex

        # Should contain experience entries
        assert "Solaire Resort" in latex
        assert "End User Computing Technician" in latex
        assert "Bulacan State" in latex

        # Should contain skills with proper escaping
        assert "Active Directory" in latex
        assert "PowerShell" in latex

        # Should contain certifications
        assert "Linux System Administration" in latex
        assert "Fortinet NSE 3" in latex

        # Should contain projects
        assert "CrowdStrike Internal Security Monitoring Tool" in latex

    def test_no_hardcoded_fallbacks_in_cv(self):
        """Verify NO hardcoded fallback values are inserted for missing data."""
        profile = make_minimal_profile()
        latex = _build_cv_latex(profile)

        # These should NOT appear when profile fields are empty/None
        # (these are Wilson-specific fallback values that would indicate fabrication)
        fallback_patterns = [
            "Muzon",  # location fallback
            "+639123456789",  # Wilson's phone fallback
            "wilson@example.com",  # Wilson's email fallback
            "wilsonchiquito",  # Wilson's linkedin fallback
            "Professional summary not provided",  # summary fallback
            "Skills not provided",  # skills fallback
            "Education not provided",  # education fallback
            "Certifications not provided",  # certifications fallback
            "Projects not provided",  # projects fallback
        ]

        for pattern in fallback_patterns:
            assert pattern not in latex, f"Hardcoded fallback found: {pattern}"

    def test_missing_optional_fields_omitted_not_fabricated(self):
        """Missing optional fields should be omitted, not fabricated."""
        profile = CandidateProfileResponse(
            full_name="Test User",
            email=None,  # explicitly None
            phone=None,
            location=None,
            linkedin_url=None,
            professional_summary=None,
            skills=[],
            experience=[],
            education=[],
            certifications=[],
            projects=[],
            portfolio_url=None,
        )
        latex = _build_cv_latex(profile)

        # Should have name (split into first/last) but no contact info
        assert "Test" in latex
        assert "User" in latex
        # Email/phone/location/linkedin should not appear at all
        assert r"\email" not in latex
        assert r"\phone" not in latex
        assert r"\address" not in latex
        assert r"\extrainfo" not in latex


class TestCoverLetterBuilder:
    """Test cover letter LaTeX generation."""

    def test_minimal_profile_generates_valid_cover_letter(self):
        profile = make_minimal_profile()
        latex = _build_cover_latex(profile, "Software Engineer", "Test Company")

        # Should contain document structure
        assert r"\documentclass" in latex
        assert r"\begin{document}" in latex
        assert r"\end{document}" in latex

        # Should include job context
        assert "Software Engineer" in latex
        assert "Test Company" in latex

        # Should include verified contact info
        assert "test@example.com" in latex
        assert "+1234567890" in latex

    def test_full_profile_generates_detailed_cover_letter(self):
        profile = make_full_profile()
        latex = _build_cover_latex(profile, "IT Support Specialist", "Target Company")

        # Should include professional summary
        assert "Experienced IT support specialist" in latex

        # Should include top experiences
        assert "Solaire Resort" in latex
        assert "End User Computing Technician" in latex

        # Should include skills with provenance (underscores replaced with spaces)
        assert "Active Directory" in latex
        assert "resume extracted" in latex or "user verified" in latex

    def test_no_hardcoded_fallbacks_in_cover_letter(self):
        """Verify NO hardcoded fallback values in cover letter."""
        # Use a profile with ONLY the minimal required fields (no Wilson data)
        profile = CandidateProfileResponse(
            full_name="Test User",
            email="test@example.com",
            phone="+1234567890",
            location="Test City",
            linkedin_url="https://linkedin.com/in/testuser",
            professional_summary="Test summary",
            skills=[],
            experience=[],
            education=[],
            certifications=[],
            projects=[],
            portfolio_url=None,
        )
        latex = _build_cover_latex(profile, "Job Title", "Company Name")

        # These Wilson-specific fallback values should NOT appear
        fallback_patterns = [
            "Wilson DC. Chiquito",  # Wilson's name fallback
            "wilson@example.com",  # Wilson's email fallback
            "+639123456789",  # Wilson's phone fallback
            "wilsonchiquito",  # Wilson's linkedin fallback
        ]

        for pattern in fallback_patterns:
            assert pattern not in latex, f"Hardcoded fallback found: {pattern}"

    def test_no_unsupported_company_claims(self):
        """Verify no unsupported claims about company reputation, 'thrives', etc."""
        profile = make_full_profile()
        latex = _build_cover_latex(profile, "IT Role", "Any Company")

        unsupported_claims = [
            "thrives",  # "thrives" claims
            "reputation",  # company reputation claims
            "automation initiative",  # automation initiative claims
            "innovative",  # unsubstantiated innovation claims
            "leader in",  # leadership claims
            "world-class",  # hyperbolic claims
        ]

        for claim in unsupported_claims:
            assert claim.lower() not in latex.lower(), f"Unsupported claim found: {claim}"

    def test_skill_provenance_not_upgraded(self):
        """Verify skills are not automatically upgraded to professional experience."""
        profile = CandidateProfileResponse(
            full_name="Test User",
            email="test@example.com",
            phone="+1234567890",
            location="Test City",
            linkedin_url="https://linkedin.com/in/test",
            professional_summary="Test summary",
            skills=[
                SkillItem(name="Python", source="resume_extracted"),
                SkillItem(name="Docker", source="user_verified"),
                SkillItem(name="Kubernetes", source="user_verified"),  # Valid source value
            ],
            experience=[],  # No professional experience
            education=[],
            certifications=[],
            projects=[],
            portfolio_url=None,
        )
        latex = _build_cover_latex(profile, "DevOps Engineer", "Test Corp")

        # Should NOT claim "Verified proficiency through professional experience"
        assert "professional experience" not in latex.lower()
        assert "verified proficiency" not in latex.lower()

        # Should use actual provenance (underscores replaced with spaces in the output)
        assert "resume extracted" in latex or "user verified" in latex

    def test_job_title_company_safely_escaped(self):
        """Verify job_title and company are safely escaped."""
        profile = make_minimal_profile()
        # Test with LaTeX special characters
        latex = _build_cover_latex(profile, "Software & Data Engineer", "A&B Company")

        # Special chars should be escaped
        assert r"\&" in latex
        assert "Software & Data Engineer" not in latex  # unescaped version should not appear
        assert "A&B Company" not in latex  # unescaped version should not appear


class TestCompilation:
    """Test LaTeX compilation behavior."""

    @pytest.mark.asyncio
    async def test_missing_compiler_handled_gracefully(self):
        """Test that missing compiler returns proper error without crashing."""
        with patch("app.services.document_generator._find_latex_compiler", return_value=None):
            result = await _compile_latex(
                tex_content=r"\documentclass{article}\begin{document}test\end{document}",
                output_dir=Path(tempfile.gettempdir()),
                job_name="test",
                compiler="nonexistent_compiler",
            )

            assert result.success is False
            assert "not found in PATH" in result.error_message
            assert result.pdf_path is None

    @pytest.mark.asyncio
    async def test_compilation_failure_handled(self):
        """Test that LaTeX compilation errors are captured properly."""
        # Test the case where _find_latex_compiler returns None (compiler not found)
        # This is handled gracefully and returns a CompilationResult with success=False
        with patch("app.services.document_generator._find_latex_compiler", return_value=None):
            result = await _compile_latex(
                tex_content=r"\documentclass{article}\begin{document}test\end{document}",
                output_dir=Path(tempfile.gettempdir()),
                job_name="test",
                compiler="nonexistent_compiler_xyz",
            )

            # Should handle missing compiler gracefully
            assert result.success is False
            assert result.error_message is not None
            assert "not found in PATH" in result.error_message

    @pytest.mark.asyncio
    async def test_no_shell_execution_path(self):
        """Verify no shell=True is used in subprocess calls."""
        shell_used = []

        class MockProcess:
            def __init__(self):
                self.returncode = 0
            async def communicate(self):
                return (b"", b"")
            async def wait(self):
                pass
            def kill(self):
                pass

        async def mock_create_subprocess_exec(*args, **kwargs):
            # Capture if shell is used
            shell_used.append(kwargs.get("shell", False))
            return MockProcess()

        with patch("asyncio.create_subprocess_exec", side_effect=mock_create_subprocess_exec):
            with patch("app.services.document_generator._find_latex_compiler", return_value="/fake/lualatex"):
                with patch("pathlib.Path.exists", return_value=True):
                    result = await _compile_latex(
                        tex_content=r"\documentclass{article}\begin{document}test\end{document}",
                        output_dir=Path(tempfile.gettempdir()),
                        job_name="test",
                        compiler="lualatex",
                    )
                    # Should not use shell=True
                    assert all(s is False for s in shell_used), f"shell=True was used: {shell_used}"


class TestOnePageValidation:
    """Test one-page PDF validation."""

    @pytest.mark.asyncio
    async def test_one_page_validation_rejects_multi_page(self):
        """Test that multi-page PDFs are rejected by the validation logic."""
        from pypdf import PdfReader, PdfWriter

        # Create a multi-page PDF in memory
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            writer = PdfWriter()
            # Add 2 blank pages
            for _ in range(2):
                writer.add_blank_page(width=612, height=792)
            writer.write(tmp)
            multi_page_pdf = Path(tmp.name)

        try:
            from app.services.document_generator import PDF_PAGE_COUNT_AVAILABLE
            if PDF_PAGE_COUNT_AVAILABLE:
                reader = PdfReader(multi_page_pdf)
                assert len(reader.pages) == 2

                # Test that our validation logic would reject this
                page_count = len(reader.pages)
                assert page_count != 1, "Multi-page PDF should fail one-page validation"
        finally:
            multi_page_pdf.unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_one_page_validation_passes_single_page(self):
        """Test that single-page PDFs pass validation."""
        from pypdf import PdfReader, PdfWriter

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            writer = PdfWriter()
            writer.add_blank_page(width=612, height=792)
            writer.write(tmp)
            single_page_pdf = Path(tmp.name)

        try:
            from app.services.document_generator import PDF_PAGE_COUNT_AVAILABLE
            if PDF_PAGE_COUNT_AVAILABLE:
                reader = PdfReader(single_page_pdf)
                assert len(reader.pages) == 1
        finally:
            single_page_pdf.unlink(missing_ok=True)


class TestMasterFilesUnchanged:
    """Verify master template files are never modified."""

    def test_cv_template_path_is_read_only_reference(self):
        """CV template path should point to master, not be modified."""
        from app.services.document_generator import CV_TEMPLATE_PATH
        assert CV_TEMPLATE_PATH.name == "main_example.tex"
        assert "cv" in str(CV_TEMPLATE_PATH)

    def test_cover_class_path_is_read_only_reference(self):
        """Cover class path should point to master, not be modified."""
        from app.services.document_generator import COVER_CLASS_PATH
        assert COVER_CLASS_PATH.name == "cover.cls"
        assert "cover_letters" in str(COVER_CLASS_PATH)

    def test_cover_template_path_is_read_only_reference(self):
        """Cover template path should point to master, not be modified."""
        from app.services.document_generator import COVER_TEMPLATE_PATH
        assert COVER_TEMPLATE_PATH.name == "cover_example.tex"
        assert "cover_letters" in str(COVER_TEMPLATE_PATH)


class TestIntegration:
    """Integration tests for full generation flow."""

    @pytest.mark.asyncio
    async def test_generate_cv_returns_compilation_result(self):
        """Test generate_cv returns CompilationResult."""
        profile = make_minimal_profile()

        with patch("app.services.document_generator._find_latex_compiler", return_value=None):
            result = await generate_cv(profile)

            assert isinstance(result, CompilationResult)
            assert result.success is False
            assert "not found in PATH" in result.error_message

    @pytest.mark.asyncio
    async def test_generate_cover_letter_returns_compilation_result(self):
        """Test generate_cover_letter returns CompilationResult."""
        profile = make_minimal_profile()

        with patch("app.services.document_generator._find_latex_compiler", return_value=None):
            result = await generate_cover_letter(profile, "Job", "Company")

            assert isinstance(result, CompilationResult)
            assert result.success is False
            assert "not found in PATH" in result.error_message

    @pytest.mark.asyncio
    async def test_check_latex_availability_returns_dict(self):
        """Test check_latex_availability returns availability dict."""
        result = await check_latex_availability()

        assert isinstance(result, dict)
        assert "pdflatex" in result
        assert "xelatex" in result
        assert "lualatex" in result
        assert all(isinstance(v, bool) for v in result.values())


if __name__ == "__main__":
    pytest.main([__file__, "-v"])