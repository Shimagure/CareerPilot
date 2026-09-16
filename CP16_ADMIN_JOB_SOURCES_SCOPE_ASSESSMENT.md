# CP16.1 Scope Assessment: Admin Job Sources & Role-Based Access Control (RBAC)

**Date**: 2026-09-11  
**Author**: Antigravity (Advanced Agentic Assistant)  
**Status**: INVESTIGATION COMPLETE (READ-ONLY) — Awaiting Review & Approval  
**Target Milestone**: Checkpoint 16 (Admin Job Sources & System Extensibility)

---

## 1. Executive Summary

CareerPilot currently operates as a single-tenant/single-user desktop and web pipeline where all authenticated users have equal access to application features. Scraping sources are statically defined across 10 portal adapters in `.agents/skills/*` with health monitoring exposed via CP15.5/CP15.6.

**CP16 Objectives**:
1. Introduce a lightweight, backwards-compatible **Role-Based Access Control (RBAC)** model (`USER` vs `ADMIN`) on the existing single `users` table and JWT infrastructure without adding secondary auth systems.
2. Require and capture the **User's Name** during account creation and registration, storing it on the `User` model and propagating it to initialize `CandidateProfile.full_name`.
3. Introduce a persistent **Job Source (`job_sources`)** database entity and lifecycle (`DISCOVERED` → `ANALYZING` → `READY_FOR_REVIEW` → `APPROVED` → `ENABLED` / `DISABLED`).
4. Design a **Safe, Non-Executing URL Analyzer** to inspect portal metadata, detect pagination, structure, and API patterns, enforce strict anti-SSRF protections, and guarantee zero execution of arbitrary user-supplied scraper scripts.
5. Define the **Scraper Integration Bridge** to transition approved sources into developer-controlled CLI adapters.
6. Establish a strict **Account Isolation Taxonomy** separating Global (shared) resources from User-Specific (tenant-isolated) resources.

---

## 2. Existing Auth & Accounts Analysis

### 2.1 Current Implementation State
- **Database Model (`backend/app/models/database_models.py:User`)**:
  - Columns: `id` (UUID string), `email` (String 255, unique), `password_hash` (String 255), `status` (`UserStatus.ACTIVE`), `created_at`, `updated_at`.
  - Missing: `role` column, `name` column.
- **Candidate Profile Model (`CandidateProfile`)**:
  - Has `full_name` (String 255, nullable), `headline`, `location`, `skills`, `experience`, etc.
  - Linked 1-to-1 with `User` via `user_id`.
- **Auth Schemas (`backend/app/models/auth_schemas.py`)**:
  - `UserRegister`: `email` (EmailStr), `password` (min_length=8). Lacks `name`.
  - `UserResponse` / `CurrentUserResponse`: Returns `id`, `email`, `status`, `created_at`.
- **JWT & Dependencies (`backend/app/auth.py`, `backend/app/routers/auth.py`)**:
  - Token claims: `{"sub": user.id}` (no role claim in JWT payload currently, or fetched live on `/me`).
  - Dependency: `get_current_user(token, db) -> User` loads user from DB.
- **Frontend Auth Context & Register Page (`frontend/src/context/AuthContext.tsx`, `frontend/src/pages/Register.tsx`)**:
  - Registration form only renders and submits `{ email, password }`.

### 2.2 Recommended RBAC Design (USER vs ADMIN)
To maintain zero friction and zero duplicate auth infrastructure:
1. **Enum Definition**:
   ```python
   class UserRole(str, Enum):
       USER = "user"
       ADMIN = "admin"
   ```
2. **Schema & Model Extension**:
   - Add `role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.USER, nullable=False)` to `User`.
   - Migration default: `UserRole.USER`.
   - Initial admin assignment: When seeding or running an initial admin promotion script/migration, existing primary user account (`light.jukes@gmail.com` / `Wilson DC. Chiquito`) is granted `UserRole.ADMIN`.
3. **FastAPI Dependencies**:
   - `get_current_user`: Standard user dependency.
   - `get_current_admin_user(current_user: User = Depends(get_current_user)) -> User`:
     - Checks `if current_user.role != UserRole.ADMIN: raise HTTPException(status_code=403, detail="Admin privileges required")`.
4. **JWT Claims**:
   - Include `"role": user.role.value` in JWT payload for immediate client-side route guarding, while still verifying against DB in `get_current_admin_user`.

### 2.3 User Name Requirement & Architectural Location
**Requirement**: Account creation must require and input the user's name.

**Design Decision & Recommendations**:
- **Field Representation**: Use a single `name` field (String 255, required) rather than splitting into `first_name` and `last_name`.
  - *Rationale*: Global name structures vary widely across cultures (single names, multiple patronymics, hyphenated surnames). A single `name` field cleanly aligns with `CandidateProfile.full_name`, LaTeX CV conventions, and `CANDIDATE_TRUTH.md` (`Wilson DC. Chiquito`).
- **Database Storage**:
  1. Add `name: Mapped[str] = mapped_column(String(255), nullable=False)` to `User` table (with migration backfill for existing users defaulting to `Wilson DC. Chiquito` or email username).
  2. When a user registers, `auth.register` writes `User.name` AND automatically initializes `CandidateProfile` with `full_name = user.name` if no profile exists.
- **API Surface Changes**:
  - Update `UserRegister` schema in `auth_schemas.py`:
    ```python
    class UserRegister(BaseModel):
        name: str = Field(..., min_length=1, max_length=255, description="Full name of the user")
        email: EmailStr
        password: str = Field(..., min_length=8)
    ```
  - Update `UserResponse` and `CurrentUserResponse` to include `name: str` and `role: UserRole`.
- **Frontend Changes**:
  - `Register.tsx`: Add Name `<Input id="name" placeholder="Full name (e.g. Wilson DC. Chiquito)" required />`.
  - `AuthContext.tsx`: Update `User` interface to `{ id, email, name, role, status, created_at }`. Pass `name` in `register(name, email, password)`.

---

## 3. Persistent Job Source Model & Lifecycle

### 3.1 SQL Data Model (`job_sources`)
The `JobSource` entity represents a persistent job portal or recruitment platform cataloged in the system.

```python
class JobSourceStatus(str, Enum):
    DISCOVERED = "discovered"          # Initial state upon URL ingestion
    ANALYZING = "analyzing"            # Safe analyzer inspection in progress
    READY_FOR_REVIEW = "ready_for_review" # Analysis complete, awaiting admin approval
    APPROVED = "approved"              # Approved by admin for adapter development
    ENABLED = "enabled"                # Adapter active in live search orchestrator
    DISABLED = "disabled"              # Administratively disabled or health-flagged

class JobSourceType(str, Enum):
    DIRECT_EMPLOYER = "direct_employer" # ATS / Career page (e.g. Workday, Lever, Greenhouse)
    JOB_BOARD = "job_board"             # Commercial aggregator (e.g. Indeed, Jobstreet, LinkedIn)
    GOVERNMENT_PORTAL = "government_portal" # Public labor exchange (e.g. JobBank, JobNet)
    CUSTOM_FEED = "custom_feed"         # RSS / JSON / GraphQL feed

class JobSource(Base):
    __tablename__ = "job_sources"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=generate_uuid)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(150), nullable=False)
    base_url: Mapped[str] = mapped_column(String(500), nullable=False)
    domain: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    source_type: Mapped[JobSourceType] = mapped_column(Enum(JobSourceType), default=JobSourceType.JOB_BOARD, nullable=False)
    
    status: Mapped[JobSourceStatus] = mapped_column(Enum(JobSourceStatus), default=JobSourceStatus.DISCOVERED, nullable=False, index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    
    # Analysis & Adapter metadata
    analysis_data: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    adapter_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True) # Maps to skill name e.g. "indeed-search"
    
    # Health tracking link
    health_status: Mapped[Optional[str]] = mapped_column(String(50), default="insufficient_evidence", nullable=True)
    last_checked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    
    # Audit & Tracking
    created_by_user_id: Mapped[Optional[str]] = mapped_column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    
    # Relationships
    created_by_user: Mapped[Optional["User"]] = relationship("User")
```

### 3.2 Job Source Lifecycle State Machine

```
[ Admin Enters URL ]
        │
        ▼
   DISCOVERED
        │  (Trigger Safe Analyzer)
        ▼
   ANALYZING
        │  (Analyzer finishes inspection)
        ▼
 READY_FOR_REVIEW ──[ Admin Rejects / Archives ]──► (Deleted / Rejected)
        │
        │  [ Admin Approves Source ]
        ▼
    APPROVED
        │  (Developer writes/verifies adapter & registers in registry)
        ▼
    ENABLED ◄────────────────────────┐
        │                            │ (Re-enabled after fix)
        │ (Health block / Disabled)   │
        ▼                            │
    DISABLED ────────────────────────┘
```

1. **DISCOVERED**: The URL is validated, domain extracted, and record created.
2. **ANALYZING**: The safe non-executing metadata inspector is examining page headers, robots.txt, HTML structure, and pagination patterns.
3. **READY_FOR_REVIEW**: The report is presented to the admin with feasibility metrics, anti-bot signals, and detected search interfaces.
4. **APPROVED**: Admin approves the source for inclusion in the roadmap / CLI adapter implementation.
5. **ENABLED**: Adapter is registered in `PORTAL_BASE_TO_SKILL` and active in discovery pipeline.
6. **DISABLED**: Administratively deactivated or auto-disabled via CP15.5 health thresholds.

---

## 4. Safe Non-Executing URL Analyzer & Anti-SSRF Architecture

### 4.1 Threat Model & Security Boundaries
Allowing administrators or users to input arbitrary URLs to be fetched by the server introduces serious security risks:
- **Server-Side Request Forgery (SSRF)**: Attacking internal network services, cloud metadata instances (`169.254.169.254`), localhost (`127.0.0.1`), or local databases.
- **Remote Code Execution (RCE)**: Attempting to interpret or execute remote JavaScript/DOM scripts.
- **Denial of Service (DoS)**: Downloading massive binary files, recursive redirect loops, or slowloris connections.

### 4.2 Security & Anti-SSRF Controls
1. **Strict Scheme & Domain Filtering**:
   - Only `http://` and `https://` allowed (default to HTTPS).
   - No `file://`, `gopher://`, `ftp://`, or `data:` schemes.
2. **DNS Pre-Resolution & IP Blacklisting**:
   - Resolve hostname via socket before connecting.
   - Disallow private, loopback, link-local, multicast, and carrier-grade NAT IP ranges:
     - `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10`, `0.0.0.0/8`, `::1`, `fc00::/7`, `fe80::/10`.
     - Explicit block on `169.254.169.254` (AWS/GCP/Azure instance metadata).
3. **Connection Constraints**:
   - Connection timeout: 5.0 seconds.
   - Read timeout: 8.0 seconds.
   - Max redirects: 3 (each redirect target re-validated against SSRF IP blacklist).
   - Max response payload: 2 MB (stream download and abort if exceeded).
4. **Zero Script Execution Guarantee**:
   - Pure HTTP GET using `httpx` or `urllib` with static HTML parsing via `BeautifulSoup` / `lxml`.
   - **No headless browser (Playwright/Puppeteer/Selenium) execution** during analysis.
   - **No dynamic JavaScript eval or code generation**.

### 4.3 Analysis Capabilities (Non-Executing)
The analyzer extracts:
- **Site Metadata**: Title, meta description, OpenGraph tags, favicon.
- **Platform Detection**: Identifies known ATS signatures (Workday, Greenhouse, Lever, SmartRecruiters, Taleo, Ashby) or standard portal formats.
- **Search & Listing Signals**: Form elements with search keywords (`q`, `query`, `k`, `job_title`, `location`), pagination links (`page=`, `offset=`, `start=`), and structured data (`<script type="application/ld+json">` with `JobPosting` schema).
- **Robots & Accessibility**: Status of `/robots.txt` disallow paths for search endpoints.
- **Feasibility Assessment**: Output structured score (e.g. `HIGH_FEASIBILITY`, `API_AVAILABLE`, `REQUIRES_AUTHENTICATION`, `HIGH_CLOUDFLARE_PROTECTION`).

---

## 5. Scraper Integration & Developer Adapter Bridge

### 5.1 Preventing Arbitrary Scraper Code Execution
Under no circumstances should the application generate, save, and execute arbitrary executable scraper scripts uploaded through the API or generated dynamically by LLMs without developer review.

### 5.2 The Safe Adapter Bridge
```
[ Approved JobSource in DB ]
             │
             ▼ (Developer Bridge)
1. Developer authors `.agents/skills/{source_name}-search/`
2. Developer writes test suite in `job_scraper/tests/`
3. Developer registers source in `app/portal_registry.py` (`PORTAL_BASE_TO_SKILL`)
4. Health engine (CP15.5) monitors error rates
5. FastAPI Portal Health (CP15.6) exposes status
6. DB JobSource status updated to `ENABLED`
```

This guarantees:
- Scraper code is checked into git, peer-reviewed, and statically analyzed.
- Subprocesses run with standard sandboxing and predictable environment variables.
- Zero risk of malicious code injection through the admin UI.

---

## 6. Frontend Architecture & Admin UI Workflow

### 6.1 Admin Navigation & Layout
- **Sidebar (`frontend/src/components/layout/Sidebar.tsx`)**:
  - Add conditional `Admin` navigation group visible only when `user?.role === 'admin'`:
    ```tsx
    {
      label: 'Administration',
      items: [
        { name: 'Job Sources', href: '/admin/sources', icon: Server },
        { name: 'System Users', href: '/admin/users', icon: Users },
      ]
    }
    ```
- **Protected Admin Route Component (`AdminRoute.tsx`)**:
  - Validates `isAuthenticated && user?.role === 'admin'`. Redirects non-admin users to `/dashboard` with a 403 notification.

### 6.2 Admin Job Sources Page (`/admin/sources`)
- **Source Catalog Table**:
  - Columns: Name, Base URL, Source Type, Status Badge, Adapter Name, Health Status, Enabled Switch, Actions.
- **Add Source Dialog**:
  - Inputs: Source Name, Display Name, URL, Source Type.
  - Action: "Analyze URL" (triggers non-executing URL Analyzer).
- **Source Detail & Analysis View**:
  - Displays detected platform, structured data availability, pagination indicators, robots.txt status, and recommended adapter design.
  - Action buttons: "Approve Source", "Deactivate", "Archive".

### 6.3 User Registration Name Capture
- **Register Form (`Register.tsx`)**:
  - Update layout to include `Full Name` as the top input field.
  - Form validation ensures non-empty, trimmed name (1-255 characters).

---

## 7. API Surface Specification

### 7.1 Authentication & User APIs
- `POST /api/auth/register` (Updated)
  - Request: `{ name: string, email: string, password: str }`
  - Response: `{ access_token: str, token_type: "bearer", user: UserResponse }`
- `GET /api/auth/me` (Updated)
  - Response: `{ user: { id: str, name: str, email: str, role: "user" | "admin", status: str, created_at: str } }`

### 7.2 Admin Job Sources API (`/api/admin/sources`) — Admin Only
All endpoints protected by `Depends(get_current_admin_user)`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/sources` | List all job sources with filtering (status, source_type, enabled) |
| `POST` | `/api/admin/sources` | Create a new job source in `DISCOVERED` state |
| `GET` | `/api/admin/sources/{source_id}` | Get detailed job source record including analysis data |
| `PATCH` | `/api/admin/sources/{source_id}` | Update source fields (display_name, source_type, status, enabled, adapter_name) |
| `DELETE` | `/api/admin/sources/{source_id}` | Delete or archive an unapproved job source |
| `POST` | `/api/admin/sources/analyze` | Run safe non-executing URL analysis on a candidate URL |
| `POST` | `/api/admin/sources/{source_id}/analyze` | Trigger safe analysis on an existing registered source |

---

## 8. Account & Data Isolation Taxonomy

| Resource / Model | Scope | Isolation Policy | Rationale |
|---|---|---|---|
| `users` | User-Specific / Auth | Strict tenant isolation | Users manage only their own credentials. |
| `candidate_profiles` | User-Specific | 1-to-1 with `user_id` | Profile data represents a specific jobseeker. |
| `resumes` | User-Specific | FK to `user_id` | LaTeX and PDF CVs belong to individual user. |
| `search_preferences` | User-Specific | FK to `user_id` | Target salaries, locations, and arrangements. |
| `search_runs` | User-Specific | FK to `user_id` | Run history initiated by user. |
| `user_jobs` (saved/ranked) | User-Specific | FK to `user_id` + `job_id` | Personalized job evaluations and triage. |
| `applications` | User-Specific | FK to `user_id` + `job_id` | Application tracking and cover letters. |
| `jobs` | **Global** | Shared across system | Canonical job postings scraped from portals. |
| `job_sources` | **Global** | Shared / Admin-managed | Portal catalog and adapter configurations. |
| `portal_health` | **Global** | Shared / Public read | Infrastructure operational health metrics. |

---

## 9. Comprehensive Testing Strategy

### 9.1 Targeted Test Suites
1. **RBAC & Auth Tests (`test_rbac_auth.py`)**:
   - Register user with `name`, `email`, `password`. Verify `User.name` and `CandidateProfile.full_name` population.
   - Verify non-admin user receives `403 Forbidden` on `/api/admin/*` endpoints.
   - Verify admin user receives `200 OK` on `/api/admin/*` endpoints.
   - Verify unauthenticated requests receive `401 Unauthorized`.
2. **Job Sources CRUD Tests (`test_admin_job_sources.py`)**:
   - Create, list, retrieve, update, and delete `JobSource` entities.
   - Verify state transitions (`DISCOVERED` → `APPROVED` → `ENABLED`).
   - Validate uniqueness constraint on `name` and domain normalization.
3. **Safe URL Analyzer Tests (`test_safe_url_analyzer.py`)**:
   - Verify SSRF blocks on `127.0.0.1`, `localhost`, `10.0.0.1`, `192.168.1.1`, `169.254.169.254`, and AWS metadata hostnames.
   - Verify timeout enforcement and payload truncation on oversized pages.
   - Mock external HTTP responses to test JSON-LD, form, and pagination parsing.
4. **End-to-End Regression Suite**:
   - Run existing test suites (`test_portal_health.py`, `test_jobs.py`, `test_auth.py`, `test_profile.py`) to guarantee zero regression across all 121 baseline backend tests.

---

## 10. Checkpoint Execution Roadmap

| Checkpoint | Scope & Deliverables | Verification Gates |
|---|---|---|
| **CP16.1** | **Scope Assessment & Architecture Investigation (Current)** | Read-only inspection complete; assessment document delivered; zero code mutations. |
| **CP16.2** | **Data Models, RBAC & Auth/Name Extensions** | Alembic migration for `User.name`, `User.role`, and `job_sources` table; updated Auth schemas and registration flow; RBAC test suite. |
| **CP16.3** | **Safe Non-Executing URL Analyzer & Admin APIs** | Anti-SSRF HTTP analyzer service; `/api/admin/sources/*` CRUD & analysis routes; comprehensive unit & security tests. |
| **CP16.4** | **Admin UI & Frontend Integration** | Admin navigation & routes; Job Sources management page; Register form name input; E2E UI verification. |

---

## 11. Verification & Compliance Confirmation

- **Files Inspected**:
  - `backend/app/models/database_models.py`
  - `backend/app/models/auth_schemas.py`
  - `backend/app/models/profile_schemas.py`
  - `backend/app/models/schemas.py`
  - `backend/app/auth.py`
  - `backend/app/routers/auth.py`
  - `backend/app/routers/profile.py`
  - `backend/app/routers/portal_health.py`
  - `backend/app/portal_registry.py`
  - `frontend/src/context/AuthContext.tsx`
  - `frontend/src/pages/Register.tsx`
  - `frontend/src/pages/Login.tsx`
  - `frontend/src/components/layout/Sidebar.tsx`
  - `frontend/src/components/auth/ProtectedRoute.tsx`
  - `frontend/src/App.tsx`
- **Protected Files**: No production code, database migrations, scraper scripts, or frontend components were modified.
- **Git Status**: Clean working tree with no uncommitted changes to production assets.
