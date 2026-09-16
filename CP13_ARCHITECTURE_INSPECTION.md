# CP13 Architecture Inspection — Categorized Findings

Based on targeted inspection of backend (Resume/CandidateProfile/Application models, routers, profile_extraction.py, job detail endpoint, file storage, auth patterns) and frontend (Resume/Profile/JobDetail/RankedJobs/Applications pages, API client, TanStack hooks, reusable components) plus CANDIDATE_TRUTH.md and cv/main_example.tex.

---

## KEEP — Working, well-architected, use as-is

| Component | Reason |
|-----------|--------|
| **Backend: Resume router** (`resume.py`) | Clean upload/replace/download with atomic writes, per-user isolation, content-type validation. |
| **Backend: Profile router** (`profile.py`) | Proper sparse updates, extraction endpoint returns draft only (review gate), JSON field serialization. |
| **Backend: Application router** (`applications.py`) | DB-backed CRUD, ownership via JWT `sub`, timeline honesty (timestamps set once on transition), 404 for foreign rows. |
| **Backend: Saved Jobs router** (`saved_jobs.py`) | Idempotent upsert/unsave, honest assembly from UserJob + global job data. |
| **Backend: Job/ranked endpoints** (`jobs.py`, `ranked.py`) | Authenticated, use DataStore, proper response models. |
| **Backend: Profile extraction** (`profile_extraction.py`) | Conservative, deterministic, tags everything `resume_extracted`, never assigns proficiency/years, never fabricates dates/employers. |
| **Backend: File storage** (`storage.py`) | Per-user subdirs, server-generated UUID keys, atomic temp+replace, path traversal prevention. |
| **Backend: Auth** (`auth.py`) | bcrypt password hashing, JWT with HS256, `sub` claim for user identity. |
| **Backend: Database models** (`database_models.py`) | UUID PKs, proper relationships, indexes, enums for statuses. |
| **Frontend: API client** (`client.ts`) | Axios singleton, request/response interceptors for auth token, 401 handling, dev logging. |
| **Frontend: Endpoints** (`endpoints.ts`) | Centralized, typed API definitions for all features. |
| **Frontend: TanStack Query hooks** (useApplications, useProfile, useResume, useSavedJobs, etc.) | Consistent query keys, proper invalidation (applications + dashboard), 404→null for resume. |
| **Frontend: Reusable components** (Card, Badge, Button, SavedToggleButton, LoadingSkeleton, ErrorState, EmptyState) | Consistent design system, accessible, dark mode support. |
| **Frontend: Resume page** (`Resume.tsx`) | Clean upload/replace/download UX, client-side validation, empty/uploaded states. |
| **Frontend: Profile page** (`Profile.tsx`) | Multi-mode (view/edit/review), provenance badges (`resume_extracted`/`user_verified`), FieldWithProvenance, ListField for repeatable sections. |
| **Frontend: JobDetail page** (`JobDetail.tsx`) | Application integration (linkedApplication by stable_id), timeline display, fit_rating shown as /100. |
| **Frontend: RankedJobs page** (`RankedJobs.tsx`) | Application status map by stable_id, desktop table + mobile cards, saved toggle, honest global pipeline disclaimer. |
| **Frontend: Applications page** (`Applications.tsx`) | Inline editing (status select, fit_rating badge, notes), remove with confirmation, linked job navigation, mobile cards. |
| **CANDIDATE_TRUTH.md** | Authoritative Level 1/2/3 classification, anti-fabrication rules, 32 L1 items, 8 L2 items, 22 L3 items, 20 items needing confirmation. |
| **cv/main_example.tex** | Master CV (moderncv banking style) with profile, core competencies, 4 experiences, education, 5 certifications, 3 projects. |

---

## IMPROVE — Works but needs enhancement for CP13

| Component | Needed Improvement |
|-----------|-------------------|
| **Profile extraction output schema** | Current draft lacks `fit_rating`, `match_analysis`, `tailored_bullets` fields needed for application assistant. Add optional AI-enriched fields to `ProfileExtractResponse`. |
| **Application model** | Add `resume_snapshot_id`, `cover_letter_path`, `tailored_cv_path` columns to link generated documents to application. |
| **Job detail endpoint** | Extend `/api/jobs/{stable_id}` response to include `evaluation` (fit dimensions, strengths, gaps) already present in JobRecord but not exposed. |
| **Profile GET response** | Add `completeness_score` and `missing_sections` to guide user toward complete profile before generation. |
| **Dashboard** | Add "ready to apply" indicator combining: resume uploaded + profile verified + preferences configured. |
| **Frontend: SavedToggleButton** | Works but only on ranked/detail pages; add to Applications page for consistency. |
| **Frontend: Profile page "review" mode** | Good UX but needs "accept all" / "reject all" bulk actions for extracted items. |
| **Backend: profile_extraction.py** | Add `projects` extraction (currently returns empty array) — parse from resume if present. |

---

## REFACTOR — Structural changes needed to support CP13 cleanly

| Component | Refactor Direction |
|-----------|-------------------|
| **AI/Provider abstraction** | **Does not exist.** Need a thin provider interface (`LLMProvider` protocol) with `complete(prompt: string) -> string` and `embed(texts: string[]) -> number[][]`. Implement OpenAI and Anthropic adapters. Register via DI in FastAPI lifespan. |
| **Document generation** | **Does not exist.** Need `DocumentGenerator` service: `generate_cv(profile: CandidateProfile, job: JobRecord, template: str) -> bytes` and `generate_cover_letter(...) -> bytes`. Use LaTeX compilation (lualatex for CV, xelatex for cover). |
| **Application-create flow** | Current `POST /api/applications` creates draft from job_stable_id only. Extend to accept optional `resume_snapshot_id`, `cover_letter_content`, `tailored_cv_content` and create document records atomically. |
| **Profile extraction → CandidateProfile merge** | Current `POST /api/profile/extract` returns draft only. Add `POST /api/profile/merge-extraction` that accepts reviewed draft and merges into CandidateProfile with `source: user_verified`. |
| **Frontend: Application creation** | Move "Apply" logic from JobDetail into a shared `useCreateApplicationWithDocuments` hook that handles resume snapshot + cover letter + tailored CV in one flow. |
| **TanStack Query invalidation** | Add `['documents']` query key and invalidate on application create/update when documents attached. |

---

## REPLACE — Remove and rebuild differently

| Component | Replacement |
|-----------|-------------|
| **None identified** | No existing component is fundamentally wrong; all can be extended or refactored. The architecture is sound for CP13. |

---

## FUTURE — Out of scope for minimal CP13, track for later

| Component | Future Work |
|-----------|-------------|
| **ATS keyword verification** | Extract PDF text layer, compare against job requirements — nice-to-have, not required for MVP. |
| **Multi-template CV support** | Currently only moderncv banking; add template registry later. |
| **Cover letter template variants** | Current cover.cls is single template; add variants per role type. |
| **Interview prep generation** | Separate feature after application assistant works. |
| **Bulk application actions** | "Apply to top 5" etc. — requires batch document generation. |
| **Application analytics** | Conversion funnel, source tracking — post-CP13. |
| **Webhook/email notifications** | On status change — not needed for core assistant. |
| **AI-powered gap analysis** | Current FitAnalysis is pipeline-scored; LLM-enhanced gap suggestions are FUTURE. |

---

## Minimal CP13 Implementation Scope

**Goal:** Resume/Application Assistant — generate tailored CV + cover letter for a specific job, attach to application, all grounded in CANDIDATE_TRUTH.md.

### 1. Backend Additions (3 new files + 2 modifications)

| File | Purpose |
|------|---------|
| `backend/app/services/llm_provider.py` | `LLMProvider` protocol + `OpenAIProvider`/`AnthropicProvider` implementations, DI registration. |
| `backend/app/services/document_generator.py` | `generate_cv(profile, job, template_path) -> bytes`, `generate_cover_letter(...) -> bytes`, LaTeX compilation with lualatex/xelatex, 1-page enforcement. |
| `backend/app/services/application_assistant.py` | Orchestrator: `build_tailored_cv(profile, job)`, `build_cover_letter(profile, job)`, `create_application_with_documents(user, job, profile, cv_bytes, cl_bytes) -> ApplicationRecord`. Enforces CANDIDATE_TRUTH.md Level 1/2 only. |
| `backend/app/models/application_schemas.py` | Add `ApplicationCreateWithDocuments`, `DocumentRecord` schemas. |
| `backend/app/routers/applications.py` | Add `POST /api/applications/with-documents` endpoint; extend `ApplicationRecord` response with document URLs. |

### 2. Database Migration

- Add `resume_snapshot_id` (FK to Resume), `cover_letter_storage_key`, `tailored_cv_storage_key` to `applications` table.
- Add `documents` table: `id`, `application_id`, `kind` (cover_letter|tailored_cv), `storage_key`, `created_at`.

### 3. Frontend Additions (2 new components + 2 modifications)

| File | Purpose |
|------|---------|
| `frontend/src/components/application/DocumentGenerator.tsx` | Button-triggered modal: select job → review profile completeness → generate CV + cover letter → preview (PDF via blob URL) → confirm → create application with documents. |
| `frontend/src/hooks/useApplicationAssistant.ts` | `useGenerateDocuments(jobId)` mutation, `useCreateApplicationWithDocuments()` mutation. |
| `frontend/src/pages/JobDetail.tsx` | Add "Generate Application" button (when profile + resume ready) that opens DocumentGenerator modal. |
| `frontend/src/pages/Applications.tsx` | Add document icons/links in "Linked Job" column when documents exist; add "Regenerate" action. |

### 4. Verification Gates (Mandatory per CLAUDE.md)

- Every generated CV: compile with `lualatex`, verify exactly 1 page, no orphaned `\cventry`, ATS text extraction clean.
- Every generated cover letter: compile with `xelatex`, verify exactly 1 page, bullet font matches body.
- Anti-fabrication: only Level 1 + Level 2 items from CANDIDATE_TRUTH.md used; Level 3 items appear only as "Learning/Target" or acknowledged gaps.

---

## Dependencies on Existing Architecture

| CP13 Feature | Existing Foundation |
|--------------|---------------------|
| Profile as factual source | `CandidateProfile` model + `profileApi.get()` + `useProfile()` — **KEEP** |
| Resume as PDF source | `ResumeStorage` + `resumeApi.download()` — **KEEP** |
| Job data for tailoring | `jobsApi.get(stable_id)` + `useJob()` — **KEEP** |
| Application persistence | `applicationsApi.create/update` + `useCreateApplication()` — **IMPROVE** (add docs) |
| Auth/JWT scoping | `get_current_user` → `user.id` ownership — **KEEP** |
| TanStack invalidation | `['applications']`, `['dashboard']`, `['profile']`, `['resume']` — **KEEP** + add `['documents']` |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| LaTeX compilation failures in CI | Bundle `lualatex`/`xelatex` in Dockerfile; add compilation test to CI. |
| LLM hallucination of skills | Prompt template enforces "ONLY use skills from provided profile JSON"; post-generation verification against CANDIDATE_TRUTH.md Level 1/2 list. |
| Token cost | Single LLM call per document (CV + cover letter); cache provider responses per (profile_hash, job_hash). |
| Page count overflow | `document_generator.py` enforces 1 page via `\enlargethispage` and content truncation; re-compile loop max 3 attempts. |

---

## Next Step

Implement minimal CP13 in this order:
1. `llm_provider.py` + DI registration in `main.py`
2. Database migration for document fields
3. `document_generator.py` with LaTeX templates (reuse `cv/main_example.tex` structure + `cover_letters/cover.cls`)
4. `application_assistant.py` orchestrator with CANDIDATE_TRUTH.md gate
5. Extended application router endpoint
6. Frontend hook + DocumentGenerator modal
7. JobDetail integration
8. Live smoke test: generate CV + cover letter for a ranked job → verify PDFs → create application → confirm in Applications page