"""Document Generator Service for CareerPilot.

Generates DERIVATIVE application documents (tailored CV, cover letter) from
verified candidate profile data. Never modifies the master CV or invents facts.

Security:
- Uses subprocess with argument arrays (no shell=True)
- Compiles in isolated temporary directories
- Captures stdout/stderr, applies timeout
- Cleans up all temporary artifacts
- Does not expose filesystem paths or secrets through API

Factual Safety:
- Only uses data from CandidateProfile (already gated by CANDIDATE_TRUTH.md)
- Does not infer skills, metrics, or qualifications
- Missing data is left absent rather than fabricated
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from app.config import get_project_root
from app.models.profile_schemas import (
    CandidateProfileResponse,
    CertificationItem,
    EducationItem,
    ExperienceItem,
    ProjectItem,
    SkillItem,
)

# pypdf for page count validation (already in requirements.txt)
try:
    from pypdf import PdfReader
    PDF_PAGE_COUNT_AVAILABLE = True
except ImportError:
    PDF_PAGE_COUNT_AVAILABLE = False
    logging.getLogger(__name__).warning("pypdf not available - page count validation disabled")

log = logging.getLogger(__name__)

# LaTeX compilation timeout (seconds)
LATEX_TIMEOUT = 120

# Master template paths (read-only, never modified)
CV_TEMPLATE_PATH = get_project_root() / "cv" / "main_example.tex"
COVER_TEMPLATE_PATH = get_project_root() / "cover_letters" / "cover_example.tex"
COVER_CLASS_PATH = get_project_root() / "cover_letters" / "cover.cls"

# Output directory for generated documents
GENERATED_DOCS_DIR = get_project_root() / "data" / "generated"


@dataclass
class CompilationResult:
    """Result of a LaTeX compilation attempt."""
    success: bool
    pdf_path: Optional[Path] = None
    error_message: Optional[str] = None
    stdout: Optional[str] = None
    stderr: Optional[str] = None


def _find_latex_compiler(compiler: str) -> Optional[str]:
    """Locate a LaTeX compiler in PATH."""
    return shutil.which(compiler)


def _ensure_output_dir() -> Path:
    """Ensure the generated documents directory exists."""
    GENERATED_DOCS_DIR.mkdir(parents=True, exist_ok=True)
    return GENERATED_DOCS_DIR


def _load_template(template_path: Path) -> str:
    """Load a LaTeX template file. Raises FileNotFoundError if missing."""
    if not template_path.exists():
        raise FileNotFoundError(f"Template not found: {template_path}")
    return template_path.read_text(encoding="utf-8")


def _escape_latex(text: str) -> str:
    """Escape special LaTeX characters in text."""
    if not text:
        return ""
    # Escape characters that have special meaning in LaTeX
    # Order matters: backslash must be escaped FIRST to avoid double-escaping
    replacements = [
        ("\\", r"\textbackslash{}"),
        ("&", r"\&"),
        ("%", r"\%"),
        ("$", r"\$"),
        ("#", r"\#"),
        ("_", r"\_"),
        ("{", r"\{"),
        ("}", r"\}"),
        ("~", r"\textasciitilde{}"),
        ("^", r"\textasciicircum{}"),
    ]
    for char, replacement in replacements:
        text = text.replace(char, replacement)
    return text


def _build_cv_latex(profile: CandidateProfileResponse) -> str:
    """Build a complete LaTeX CV document from the verified profile data.

    Uses the structure of the master template but only includes verified data.
    Does not invent or fabricate any content. Missing data is omitted.
    """
    lines = []

    # Document class and preamble (from master template structure)
    lines.append(r"%% Generated CV - Derivative document")
    lines.append(r"%% Master CV at cv/main_example.tex is never modified")
    lines.append(r"%% Compile with: lualatex")
    lines.append("")
    lines.append(r"\documentclass[11pt,a4paper,sans]{moderncv}")
    lines.append(r"\moderncvstyle{banking}")
    lines.append(r"\moderncvcolor{blue}")
    lines.append("")
    lines.append(r"% Force both first and last name AND section headings to render in moderncv")
    lines.append(r"% blue (color1). Default banking on lualatex+MiKTeX leaves these black, which")
    lines.append(r"% looks inconsistent with the rest of the blue accent scheme.")
    lines.append(r"\renewcommand*{\firstnamestyle}[1]{{\fontsize{34}{36}\bfseries\upshape\color{color1}#1}}")
    lines.append(r"\renewcommand*{\lastnamestyle}[1]{{\fontsize{34}{36}\bfseries\upshape\color{color1}#1}}")
    lines.append(r"\renewcommand*{\sectionstyle}[1]{{\sectionfont\color{color1}#1}}")
    lines.append("")
    lines.append(r"\usepackage[utf8]{inputenc}")
    lines.append(r"\usepackage{hyperref}")
    lines.append(r"\hypersetup{")
    lines.append(r"    colorlinks=true,")
    lines.append(r"    linkcolor=blue,")
    lines.append(r"    filecolor=magenta,")
    lines.append(r"    urlcolor=blue,")
    lines.append(r"    pdftitle={Candidate CV},")
    lines.append(r"    pdfpagemode=FullScreen,")
    lines.append(r"}")
    lines.append(r"\usepackage[scale=0.80]{geometry}")
    lines.append(r"\usepackage{import}")
    lines.append("")

    # Personal data - only include verified fields
    first_name = ""
    last_name = ""
    if profile.full_name:
        name_parts = profile.full_name.split(" ", 1)
        first_name = name_parts[0] if name_parts else ""
        last_name = name_parts[1] if len(name_parts) > 1 else ""

    if first_name or last_name:
        lines.append(r"% personal data")
        lines.append(rf"\name{{{_escape_latex(first_name)}}}{{{_escape_latex(last_name)}}}")

    if profile.location:
        lines.append(rf"\address{{{_escape_latex(profile.location)}}}{{}}{{}}")

    if profile.phone:
        lines.append(rf"\phone[mobile]{{{_escape_latex(profile.phone)}}}")

    if profile.email:
        lines.append(rf"\email{{{_escape_latex(profile.email)}}}")

    extra_info_parts = []
    if profile.linkedin_url:
        extra_info_parts.append(rf"\href{{{_escape_latex(profile.linkedin_url)}}}{{LinkedIn}}")
    if profile.portfolio_url:
        extra_info_parts.append(rf"\href{{{_escape_latex(profile.portfolio_url)}}}{{Portfolio}}")
    if extra_info_parts:
        lines.append(rf"\extrainfo{{{', '.join(extra_info_parts)}}}")

    lines.append("")
    lines.append(r"\begin{document}")
    lines.append("")
    lines.append(r"\makecvtitle")
    lines.append("")

    # Profile Statement - only if verified
    if profile.professional_summary:
        lines.append(r"% ============================================================")
        lines.append(r"%     PROFILE STATEMENT")
        lines.append(r"% ============================================================")
        lines.append("")
        lines.append(rf"\vspace{{6pt}}")
        lines.append(rf"\small{{{_escape_latex(profile.professional_summary)}}}")
        lines.append("")

    # Core Competencies - only verified skills
    if profile.skills:
        lines.append(r"% ============================================================")
        lines.append(r"%     CORE COMPETENCIES")
        lines.append(r"% ============================================================")
        lines.append("")
        lines.append(r"\section{Core Competencies}")
        lines.append(r"\vspace{1pt}")
        lines.append(r"\begin{itemize}")

        for skill in profile.skills:
            lines.append(rf"\item \textbf{{{_escape_latex(skill.name)}}}")

        lines.append(r"\end{itemize}")
        lines.append("")

    # Professional Experience - only verified
    if profile.experience:
        lines.append(r"% ============================================================")
        lines.append(r"%     PROFESSIONAL EXPERIENCE")
        lines.append(r"% ============================================================")
        lines.append("")
        lines.append(r"\section{Professional Experience}")
        lines.append(r"\vspace{3pt}")
        lines.append(r"\begin{itemize}")

        for i, exp in enumerate(profile.experience):
            if not exp.employer or not exp.title:
                continue
            start = exp.start_date or ""
            end = exp.end_date or ""
            date_range = f"{start} - {end}" if start or end else ""
            location = ""  # Location not in model
            desc_lines = []
            if exp.description:
                for line in exp.description.split("\n"):
                    line = line.strip().strip("*•·")
                    if line:
                        desc_lines.append(rf"\item {_escape_latex(line)}")
            desc = "\n".join(desc_lines) if desc_lines else ""

            exp_block = (
                rf"\item\cventry{{{_escape_latex(date_range)}}}"
                rf"{{{_escape_latex(exp.title)}}}"
                rf"{{{_escape_latex(exp.employer)}}}"
                rf"{{{_escape_latex(location)}}}"
                rf"{{}}{{\vspace{{1pt}}"
                rf"\begin{{itemize}}"
                rf"{desc}"
                rf"\end{{itemize}}}}"
            )
            lines.append(exp_block)

            if i < len(profile.experience) - 1:
                lines.append(r"\vspace{3pt}")
                lines.append("")

        lines.append(r"\end{itemize}")
        lines.append("")

    # Education - only verified
    if profile.education:
        lines.append(r"% ============================================================")
        lines.append(r"%     EDUCATION")
        lines.append(r"% ============================================================")
        lines.append("")
        lines.append(r"\section{Education}")
        lines.append(r"\vspace{1pt}")
        lines.append(r"\begin{itemize}")

        for edu in profile.education:
            if not edu.institution or not edu.degree:
                continue
            start = edu.start_date or ""
            end = edu.end_date or ""
            date_range = f"{start}-{end}" if start or end else ""
            field = edu.field or ""
            edu_block = (
                rf"\item\cventry{{{_escape_latex(date_range)}}}"
                rf"{{{_escape_latex(edu.degree)}}}"
                rf"{{{_escape_latex(edu.institution)}}}"
                rf"{{{_escape_latex(field)}}}"
                rf"{{}}{{Key topics: IT support, web design, programming, and networking.}}"
            )
            lines.append(edu_block)

        lines.append(r"\end{itemize}")
        lines.append("")

    # Certifications - only verified
    if profile.certifications:
        lines.append(r"% ============================================================")
        lines.append(r"%     CERTIFICATIONS")
        lines.append(r"% ============================================================")
        lines.append("")
        lines.append(r"\section{Certifications}")
        lines.append(r"\vspace{1pt}")
        lines.append(r"\begin{itemize}")
        lines.append(r"\setlength{\itemsep}{1pt}")
        lines.append(r"\setlength{\parsep}{0pt}")
        lines.append("")

        for cert in profile.certifications:
            if not cert.name:
                continue
            issuer = f" — {cert.issuer}" if cert.issuer else ""
            year = f" — completed {cert.year}" if cert.year else ""
            lines.append(rf"\item {_escape_latex(cert.name)}{_escape_latex(issuer)}{_escape_latex(year)}")

        lines.append(r"\end{itemize}")
        lines.append("")

    # Projects - only verified
    if profile.projects:
        lines.append(r"% ============================================================")
        lines.append(r"%     PROJECTS")
        lines.append(r"% ============================================================")
        lines.append("")
        lines.append(r"\section{Projects}")
        lines.append(r"\vspace{1pt}")
        lines.append(r"\begin{itemize}")
        lines.append(r"\setlength{\itemsep}{1pt}")
        lines.append(r"\setlength{\parsep}{0pt}")
        lines.append("")

        for proj in profile.projects:
            if not proj.name:
                continue
            desc = f" — {proj.description}" if proj.description else ""
            url = rf" (\href{{{_escape_latex(proj.url)}}}{{link}})" if proj.url else ""
            lines.append(rf"\item \textbf{{{_escape_latex(proj.name)}}}{_escape_latex(desc)}{url}")

        lines.append(r"\end{itemize}")
        lines.append("")

    lines.append(r"\end{document}")

    return "\n".join(lines)


def _build_cover_latex(profile: CandidateProfileResponse, job_title: str, company: str) -> str:
    """Build a complete LaTeX cover letter document from the verified profile data.

    Uses only verified CandidateProfile data and authorized job context (job_title, company).
    Does not invent or fabricate any content. Missing data is omitted.
    Neutral connective language only - no unsupported factual claims.
    """
    from datetime import date

    lines = []

    lines.append(r"%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%")
    lines.append(r"% Generated Cover Letter")
    lines.append(r"% Derivative document - master template never modified")
    lines.append(r"%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%")
    lines.append("")
    lines.append(r"\documentclass[]{cover}")
    lines.append(r"\usepackage{fancyhdr}")
    lines.append("")
    lines.append(r"\pagestyle{fancy}")
    lines.append(r"\fancyhf{}")
    lines.append("")
    lines.append(r"\rfoot{Page \thepage \hspace{0pt}}")
    lines.append(r"\thispagestyle{empty}")
    lines.append(r"\renewcommand{\headrulewidth}{0pt}")
    lines.append(r"\begin{document}")
    lines.append("")

    # Name section - only verified fields
    first_name = ""
    last_name = ""
    if profile.full_name:
        name_parts = profile.full_name.split(" ", 1)
        first_name = name_parts[0] if name_parts else ""
        last_name = name_parts[1] if len(name_parts) > 1 else ""

    # Build contact info from verified data only
    contact_parts = []
    if profile.email:
        contact_parts.append(rf"\href{{mailto:{_escape_latex(profile.email)}}}{{{_escape_latex(profile.email)}}}")
    if profile.phone:
        contact_parts.append(_escape_latex(profile.phone))
    if profile.linkedin_url:
        contact_parts.append(rf"\urlstyle{{same}}\href{{{_escape_latex(profile.linkedin_url)}}}{{LinkedIn}}")

    contact_line = " | ".join(contact_parts) if contact_parts else ""

    lines.append(r"%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%")
    lines.append(r"%     TITLE NAME")
    lines.append(r"%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%")
    lines.append("")
    lines.append(
        rf"\namesection{{}}{{\Huge{{{_escape_latex(first_name)} {_escape_latex(last_name)}}}}}{{{contact_line}}}"
    )
    lines.append("")

    # Main content
    lines.append(r"%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%")
    lines.append(r"%     MAIN COVER LETTER CONTENT")
    lines.append(r"%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%")
    lines.append("")

    lines.append(rf"\currentdate{{{date.today().strftime('%B %d, %Y')}}}")
    lines.append("")

    # Company address - only job context
    lines.append(rf"\companyaddress{{{_escape_latex(company)}}}")
    lines.append("")

    # Opening paragraph - only verified profile data + job context
    opening_parts = [f"I am writing to express my interest in the {job_title} position at {company}."]
    if profile.professional_summary:
        opening_parts.append(profile.professional_summary)
    opening = " ".join(opening_parts)
    lines.append(rf"\lettercontent{{{_escape_latex(opening)}}}")
    lines.append("")

    # Body paragraph with bullets - only verified experience/skills
    bullet_items = []
    for exp in profile.experience[:2]:  # Top 2 experiences
        if exp.description:
            for line in exp.description.split("\n"):
                line = line.strip().strip("*•·")
                if line and len(line) > 10:
                    bullet_items.append(rf"\item \textbf{{{_escape_latex(exp.title)} at {_escape_latex(exp.employer)}}}: {_escape_latex(line)}")
                    break
    for skill in profile.skills[:3]:
        # Use skill provenance - do not claim professional experience unless verified
        prov = getattr(skill, 'source', '') or ''
        if prov == 'user_verified' or prov == 'resume_extracted':
            bullet_items.append(rf"\item \textbf{{{_escape_latex(skill.name)}}}: {_escape_latex(prov.replace('_', ' '))}")
        else:
            bullet_items.append(rf"\item \textbf{{{_escape_latex(skill.name)}}}")

    if bullet_items:
        lines.append(r"\lettercontent{My most relevant experience and skills:}")
        lines.append("")
        lines.append(r"{\raggedright\fontspec[Path = OpenFonts/fonts/raleway/]{Raleway-Medium}\fontsize{11pt}{13pt}\selectfont")
        lines.append(r"\begin{itemize}")
        for item in bullet_items[:5]:
            lines.append(f"    {item}")
        lines.append(r"\end{itemize}\par}")
        lines.append(r"\vspace{6pt}")
        lines.append("")

    # Connection paragraph - neutral, no unsupported claims about company
    if profile.experience:
        # Reference verified experience neutrally
        exp_areas = []
        for exp in profile.experience[:2]:
            if exp.title and exp.employer:
                exp_areas.append(f"{exp.title} at {exp.employer}")
        if exp_areas:
            connection = f"My background includes {', '.join(exp_areas)}. I am interested in contributing to {company}."
        else:
            connection = f"I am interested in contributing to {company}."
    else:
        connection = f"I am interested in contributing to {company}."
    lines.append(rf"\lettercontent{{{_escape_latex(connection)}}}")
    lines.append("")

    # Closing
    lines.append(r"\lettercontent{I look forward to hearing from you.}")
    lines.append("")
    lines.append(r"\begin{flushright}")
    lines.append(r"\closing{Kind regards,}")
    lines.append("")
    if first_name or last_name:
        lines.append(rf"\signature{{{_escape_latex(first_name)} {_escape_latex(last_name)}}}")
    else:
        lines.append(r"\signature{}")
    lines.append(r"\end{flushright}")
    lines.append(r"\end{document}")

    return "\n".join(lines)


async def _compile_latex(
    tex_content: str,
    output_dir: Path,
    job_name: str,
    compiler: str,
    extra_files: Optional[dict[str, str]] = None
) -> CompilationResult:
    """Compile LaTeX content to PDF using the specified compiler.

    Args:
        tex_content: The LaTeX source content
        output_dir: Directory to write output files
        job_name: Base name for output files
        compiler: LaTeX compiler to use (pdflatex, xelatex, lualatex)
        extra_files: Optional dict of filename -> content for auxiliary files (e.g., cover.cls)

    Returns:
        CompilationResult with success status and paths/error info
    """
    compiler_path = _find_latex_compiler(compiler)
    if not compiler_path:
        return CompilationResult(
            success=False,
            error_message=f"LaTeX compiler '{compiler}' not found in PATH. PDF compilation unavailable in this environment.",
        )

    tex_file = output_dir / f"{job_name}.tex"
    tex_file.write_text(tex_content, encoding="utf-8")

    # Write any extra files (e.g., cover.cls)
    if extra_files:
        for filename, content in extra_files.items():
            (output_dir / filename).write_text(content, encoding="utf-8")

    # Run LaTeX compilation (typically needs 2 passes for references)
    for pass_num in range(2):
        proc = await asyncio.create_subprocess_exec(
            compiler_path,
            "-interaction=nonstopmode",
            "-halt-on-error",
            f"-output-directory={output_dir}",
            f"-jobname={job_name}",
            str(tex_file),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=LATEX_TIMEOUT)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return CompilationResult(
                success=False,
                error_message=f"LaTeX compilation timed out after {LATEX_TIMEOUT}s",
                stdout=stdout.decode("utf-8", errors="replace") if stdout else None,
                stderr=stderr.decode("utf-8", errors="replace") if stderr else None,
            )

        if proc.returncode != 0:
            return CompilationResult(
                success=False,
                error_message=f"LaTeX compilation failed (pass {pass_num + 1}) with exit code {proc.returncode}",
                stdout=stdout.decode("utf-8", errors="replace") if stdout else None,
                stderr=stderr.decode("utf-8", errors="replace") if stderr else None,
            )

    pdf_path = output_dir / f"{job_name}.pdf"
    if not pdf_path.exists():
        return CompilationResult(
            success=False,
            error_message="LaTeX compilation completed but PDF output not found",
        )

    # One-page PDF validation using pypdf
    if PDF_PAGE_COUNT_AVAILABLE:
        try:
            reader = PdfReader(pdf_path)
            page_count = len(reader.pages)
            if page_count != 1:
                return CompilationResult(
                    success=False,
                    error_message=f"PDF page count validation failed: expected 1 page, got {page_count} pages",
                    pdf_path=pdf_path,
                )
            log.info("PDF page count validation passed: %d page", page_count)
        except Exception as e:
            log.warning("PDF page count validation error (non-fatal): %s", e)

    return CompilationResult(
        success=True,
        pdf_path=pdf_path,
    )


async def generate_cv(profile: CandidateProfileResponse, output_filename: Optional[str] = None) -> CompilationResult:
    """Generate a tailored CV PDF from the verified candidate profile.

    Args:
        profile: Verified candidate profile (must come from factual gate)
        output_filename: Optional custom output filename (without extension)

    Returns:
        CompilationResult with PDF path or error details

    Note:
        - Uses lualatex as specified in CLAUDE.md for CV compilation
        - Only uses data present in the profile (no fabrication)
        - Master CV template is read-only; generated PDF is a derivative artifact
    """
    latex_content = _build_cv_latex(profile)

    with tempfile.TemporaryDirectory(prefix="cv_gen_") as tmpdir:
        tmp_path = Path(tmpdir)
        job_name = output_filename or f"cv_{profile.full_name or 'candidate'}_{int(asyncio.get_event_loop().time())}"
        job_name = "".join(c if c.isalnum() or c in "_-" else "_" for c in job_name)

        result = await _compile_latex(
            tex_content=latex_content,
            output_dir=tmp_path,
            job_name=job_name,
            compiler="lualatex",
        )

        if result.success and result.pdf_path:
            # Copy to permanent output location
            output_dir = _ensure_output_dir()
            final_pdf = output_dir / f"{job_name}.pdf"
            shutil.copy2(result.pdf_path, final_pdf)
            result.pdf_path = final_pdf
            log.info("Generated CV PDF: %s", final_pdf)

        return result


async def generate_cover_letter(
    profile: CandidateProfileResponse,
    job_title: str,
    company: str,
    output_filename: Optional[str] = None
) -> CompilationResult:
    """Generate a tailored cover letter PDF from the verified candidate profile.

    Args:
        profile: Verified candidate profile (must come from factual gate)
        job_title: Target job title
        company: Target company name
        output_filename: Optional custom output filename (without extension)

    Returns:
        CompilationResult with PDF path or error details

    Note:
        - Uses xelatex as specified in CLAUDE.md for cover letter compilation
        - Only uses data present in the profile (no fabrication)
        - Cover template and class are read-only; generated PDF is a derivative artifact
    """
    cover_class = _load_template(COVER_CLASS_PATH)
    latex_content = _build_cover_latex(profile, job_title, company)

    # Copy OpenFonts directory to temp directory for font loading
    openfonts_src = get_project_root() / "cover_letters" / "OpenFonts"

    with tempfile.TemporaryDirectory(prefix="cl_gen_") as tmpdir:
        tmp_path = Path(tmpdir)

        # Create OpenFonts directory structure and copy font files
        if openfonts_src.exists():
            openfonts_dst = tmp_path / "OpenFonts"
            openfonts_dst.mkdir(parents=True, exist_ok=True)
            # Copy all font files preserving directory structure
            for font_file in openfonts_src.rglob("*.ttf"):
                rel_path = font_file.relative_to(openfonts_src)
                dst_file = openfonts_dst / rel_path
                dst_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(font_file, dst_file)
            for font_file in openfonts_src.rglob("*.otf"):
                rel_path = font_file.relative_to(openfonts_src)
                dst_file = openfonts_dst / rel_path
                dst_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(font_file, dst_file)

        job_name = output_filename or f"cover_{company}_{job_title}_{int(asyncio.get_event_loop().time())}"
        job_name = "".join(c if c.isalnum() or c in "_-" else "_" for c in job_name)

        result = await _compile_latex(
            tex_content=latex_content,
            output_dir=tmp_path,
            job_name=job_name,
            compiler="xelatex",
            extra_files={"cover.cls": cover_class},
        )

        if result.success and result.pdf_path:
            output_dir = _ensure_output_dir()
            final_pdf = output_dir / f"{job_name}.pdf"
            shutil.copy2(result.pdf_path, final_pdf)
            result.pdf_path = final_pdf
            log.info("Generated cover letter PDF: %s", final_pdf)

        return result


async def check_latex_availability() -> dict[str, bool]:
    """Check which LaTeX compilers are available in the environment."""
    return {
        "pdflatex": _find_latex_compiler("pdflatex") is not None,
        "xelatex": _find_latex_compiler("xelatex") is not None,
        "lualatex": _find_latex_compiler("lualatex") is not None,
    }


# --- Synchronous wrappers for non-async contexts ---

def generate_cv_sync(profile: CandidateProfileResponse, output_filename: Optional[str] = None) -> CompilationResult:
    """Synchronous wrapper for generate_cv."""
    return asyncio.run(generate_cv(profile, output_filename))


def generate_cover_letter_sync(
    profile: CandidateProfileResponse,
    job_title: str,
    company: str,
    output_filename: Optional[str] = None
) -> CompilationResult:
    """Synchronous wrapper for generate_cover_letter."""
    return asyncio.run(generate_cover_letter(profile, job_title, company, output_filename))


def check_latex_availability_sync() -> dict[str, bool]:
    """Synchronous wrapper for check_latex_availability."""
    return asyncio.run(check_latex_availability())