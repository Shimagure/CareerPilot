# Checkpoint 5 — Candidate Profile: Verification Report

**Date:** 2026-09-08
**Checkpoint:** 5 (Candidate Profile)
**Repo root:** `C:\Users\Soladm\Downloads\Pilot\ai-job-search`
**Verdict:** PASS — all acceptance criteria verified (backend tests, frontend type-check + build, live smoke against a fresh server on port 8000).

---

## 1. Status

**Checkpoint 5 is complete and validated.**

An authenticated user can now:
- Visit a real `/profile` page (`frontend/src/pages/Profile.tsx`, route in `frontend/src/App.tsx`, nav item in `Sidebar.tsx`).
- See their stored profile (`GET /api/profile` → `ProfileGetResponse {profile, has_active_resume}`).
- Populate the profile from an uploaded resume via **conservative, deterministic extraction** (`POST /api/profile/extract`; pypdf + python-docx; **no LLM**).
- **Review extracted info before it becomes authoritative** — the extract endpoint returns a transient review-only draft that is never persisted; the user confirms via `PUT /api/profile`, which is the only path that makes data authoritative.
- Edit and save fields (`PUT /api/profile`, sparse update).
- **Distinguish verified vs. extracted provenance** (`source: "user_verified" | "resume_extracted"`, rendered as colored badges on every field).
- See honest empty states (no profile + no resume → "Upload Resume"; no profile + active resume → "Extract from Resume").
- Never have unsupported professional claims fabricated (extraction is conservative; `projects` is intentionally never auto-extracted; Level 3 skills are surfaced as extracted-and-needing-review, never as verified professional experience; all factual integrity rules from CANDIDATE_TRUTH.md apply).
- Have profile data **strictly isolated per user** — ownership derives server-side from the JWT (`get_current_user()`), never from a client-supplied `user_id`. Proven by tests and a live cross-user smoke scenario.

A strict stop is in effect: **Checkpoint 6 is NOT begun.**

---

## 2. Architecture Audit

The feature is a small, isolated slice of the existing FastAPI async + React/TS stack. No new infrastructure was added; the design deliberately reused existing systems.

| Decision | Choice | Rationale |
|---|---|---|
| Extraction library | **pypdf** (PDF) + **python-docx** (DOC/DOCX) | Both already production dependencies; deterministic, zero-API, offline. No LLM call anywhere in the extraction path. |
| Review-before-commit | `POST /api/profile/extract` returns a **transient review-only draft**; persistence happens only via the explicit `PUT /api/profile` save. | Smallest safe equivalent of "review before extracted data becomes authoritative" without a new Draft table or state machine. Nothing is persisted until the user saves. |
| Provenance storage | Per-item `source` **inside the JSON columns** (`skills`, `experience`, `education`, `certifications`, `projects`, `languages`). | No schema migration needed; provenance travels with the data it describes. |
| Ownership | `user_id` set exclusively server-side from the JWT (`get_current_user()`); `user_id` is never a request body field. `source_resume_id` is validated to belong to the current user. | "Never a client `user_id`" is respected by construction; cross-user isolation is tested and smoke-verified live. |
| Saved-data provenance | Every list item saved through `PUT /api/profile` is stamped `user_verified` by the frontend mapping; nothing is ever silently "upgraded" server-side. | The user's explicit save is the single upgrade gate — extraction stays `resume_extracted` until the user confirms by saving. |
| Raw text hygiene | Profile responses never include raw resume text or storage paths. | Per brief: "no unnecessary raw resume text in normal profile responses"; verified by a smoke assertion and an endpoint inspection. |

**Cross-cutting:** `location`, phone, and email are stored as plain scalar fields exactly as the schema already specifies. The extraction module is standalone (`backend/app/profile_extraction.py`) with no import from the routers, keeping it unit-testable in isolation.

---

## 3. CandidateProfile Model Assessment

The pre-existing `CandidateProfile` model (`backend/app/database_models.py`) was assessed and used unchanged — **no migration was required and none was introduced**.

- **Key:** `user_id = ForeignKey("users.id", ondelete="CASCADE"), unique=True` — guarantees one profile per user, with a dedicated `ix_candidate_profiles_user_id` index.
- **Scalar fields:** `full_name` (255), `headline` (500), `location` (255), `phone` (50), `email` (255), `linkedin_url` (500), `portfolio_url` (500), `professional_summary` (Text).
- **JSON-as-Text columns:** `skills`, `experience`, `education`, `certifications`, `projects`, `languages` — each a Text column serialized with `json.dumps()` on write and loaded with `_serialize_json_field()` on read (tolerates legacy bare-string/string-list shapes and defaults their provenance to `user_verified`, correct for pre-existing rows).
- **Provenance:** `source_resume_id = ForeignKey("resumes.id", ondelete="SET NULL")` records which resume the profile was sourced from; the field is validated server-side to belong to the current user.
- **Verification flags:** `manually_edited` bool (set `true` on any successful `PUT`).
- **Timestamps:** `created_at` / `updated_at`.

Assessment: the model already contained everything the checkpoint requires. No column additions, type changes, or backfills were made.

---

## 4. Resume → Profile Architecture

```
[Resume upload]  POST /api/resume   ->  ResumeStorage (DB)   --,
                                                               |
                                                               v
                                                               +-> POST /api/profile/extract
[Resume files]  backend/app/storage/...  (bytes, served later) --+     |
                                                               |      |  reads ACTIVE resume
                                                               |      v
                                                               +-> build_profile_draft(bytes, kind)
                                                                             |  pypdf / python-docx
                                                                             v
                                                                   extract_text()  (never raises)
                                                                             |
                                                                             v
                                                                   _parse_text()  (deterministic)
                                                                             |
                                                                             v
                                             transient draft  ---- 200 (review-only, NOT persisted)
                                                 draft.source_resume_id set
                                                                             |
                                              user reviews in the UI
                                                                             v
                                            PUT /api/profile  (save => user_verified)
                                                                             |
                                                                             v
                                             CandidateProfile row (json.dumps for lists)
```

- The extract endpoint reads the **active resume** from `ResumeStorage` (the same one surfaced by `has_active_resume`), so "extract" is always an operation on a resume the user owns.
- The file bytes are read, run through `extract_text()` (which cannot raise), then `_parse_text()`.
- The draft carries `source_resume_id` so a later save can record provenance, but **the extract call itself stores nothing** — a subsequent `GET /api/profile` still returns `profile: null`. This is asserted in the smoke test.

---

## 5. Extraction Strategy

**Conservative, deterministic, no LLM.** The goal is to lift only text that is plainly present and leave anything ambiguous as an empty field rather than guess.

- **Formats:** pypdf for PDFs; python-docx for DOC/DOCX (paragraphs + tables). Unsupported kinds return a `warning` and an empty-text draft (no crash, no fabrication).
- **Parsing (`_parse_text`, `backend/app/profile_extraction.py`):**
  - **Top block** (before any section heading): lines matched as name / headline / location / email / phone by small deterministic rules (`_RANGE_RE` for month-year dates, `_HEADER_MAP` for section headings, explicit email/phone regexes). Remaining top-block text becomes the summary.
  - **Section-based** parsing for summary, skills, experience, education, certifications, languages.
  - Bullet stripping (`-`, `*`, `-`) before classification.
- **Experience only structures on evidence:** a single entry with `{employer, title, start, end, description}` is built **only** when a `_RANGE_RE` date range is present; otherwise the paragraph is kept as one untyped description line rather than inventing dates or employers.
- **`projects` is intentionally never auto-extracted** (`draft["projects"] = []`). Projects require explicit human verification per CANDIDATE_TRUTH.md and are out of scope for deterministic extraction.
- **Never fabricates:** unsupported claims, metrics, dates, employers, certifications, and education are never invented. If a value can't be confidently placed, it is left unset (empty string / empty list) and the UI shows an honest empty state.
- **Boundary validation** (length caps, 4-digit cert year, email/URL shapes, bullet stripping) lives in the Pydantic schemas.

---

## 6. Provenance / Trust Model

- Every list item carries an explicit `source`: `"resume_extracted"` (came from a resume) or `"user_verified"` (authoritative — produced or confirmed by the user).
- **Nothing automatically upgrades** `resume_extracted` -> `user_verified`. The only upgrade path is the user's explicit save action:
  - The extract draft is rendered with amber "Extracted from resume" badges so the user can see what is provisional.
  - On **Save** (`PUT /api/profile`), the frontend maps every item to `user_verified` — modelling "the user reviewed the draft and confirmed it." The server does not, and never could, perform this upgrade implicitly.
- Scalar fields are treated as user-authoritative once saved; the extract draft displays them in the review screen under the "review before save" banner.
- When reading legacy JSON that predates provenance (`_serialize_json_field`), missing `source` defaults to `user_verified` — a safe, honest default for data that already exists.

---

## 7. API Endpoints

| Method | Path | Purpose | Auth |
|---|---|---|---|
| `GET` | `/api/profile` | Return `{profile: CandidateProfileResponse \| null, has_active_resume: bool}` | `get_current_user()` required |
| `PUT` | `/api/profile` | Sparse update. 400 on empty body; validates `source_resume_id` belongs to the current user; validates all fields through Pydantic (strips `*->-` bullets, checks email/URL shapes and 4-digit cert years); returns the saved profile | `get_current_user()` required |
| `POST` | `/api/profile/extract` | Read the user's active resume, run deterministic extraction, return `ProfileExtractResponse {resume_id, resume_filename, has_text, warning, draft}` — **never persisted** | `get_current_user()` required |

Request/response schemas live in `backend/app/models/profile_schemas.py`:
- `ProfileSource = Literal["resume_extracted","user_verified"]`
- `SkillItem` (name, source), `ExperienceItem` (employer, title, start/end date, description, source), `EducationItem`, `CertificationItem` (name, issuer, 4-digit year, source), `LanguageItem` (name, level, source), `ProjectItem` (name, description, URL — user-authored only)
- `ProfileUpdateRequest` (all optional), `CandidateProfileResponse`, `ProfileGetResponse`, `ProfileExtractResponse`

Security semantics:
- 401 without a valid bearer token (verified for both missing and malformed tokens).
- `404` on `/extract` when the user has no active resume.
- **No client-supplied `user_id` anywhere** — ownership is always derived from the JWT.

---

## 8. Frontend Implementation

- **Route:** `/profile` -> `<Profile />` under the authenticated `Layout` (`frontend/src/App.tsx`).
- **Nav:** Profile item with icon in `frontend/src/components/layout/Sidebar.tsx`; Dashboard readiness card links to `/profile`.
- **Page:** `frontend/src/pages/Profile.tsx` exports `ProfilePage` (aliased as `Profile` for imports) with three modes:
  - **`view`** — read-only profile with provenance badges, Edit button, and (when there's an active resume) an "Extract from Resume" path.
  - **`edit`** — typed `editData` copy, per-field `FieldWithProvenance`/`ListField` editing with add/update/remove, Cancel and Save.
  - **`review`** — transient extracted draft rendered with amber "Extracted from resume" badges and a warning card when extraction reported a warning; Save confirms (mapping everything to `user_verified`) and enters view mode.
  - Auto-enters `review` when a user with an active resume has no profile yet; falls back to an honest empty state with the right CTA otherwise.
- **Hooks (`frontend/src/hooks/useProfile.ts`):** `useProfile`, `useUpdateProfile` (invalidates `['profile']` + `['dashboard']`), `useExtractProfile`.
- **Types (`frontend/src/api/types.ts`):** mirror the backend shapes, including `CandidateProfileResponse`, `ProfileUpdateRequest`, `ProfileExtractResponse`, and item types.
- **State management:** TanStack Query for server state; local `useState` for mode and the edit/review drafts.
- **Reusable components:** `Textarea` added; `LoadingSkeleton` alias exported for the loading state; Badge variants reused for provenance coloring.
- Success/error cards provide user feedback; typed error message extraction for buffer 400s.

---

## 9. UX Audit

- **Clear paths to a populated profile:** empty-without-resume -> "Upload Resume" (links to `/resume`); empty-with-resume -> "Extract from Resume"; populated -> Edit + Re-extract.
- **Review-before-commit is visible:** the review screen labels extracted items as provisional (amber) and shows the actionable Save/Cancel; the warning card surfaces extraction warnings (e.g. scanned PDFs).
- **Provenance is legible at a glance:** colored badges distinguish `resume_extracted` (amber) from `user_verified` (green) on every list item and scalar field region.
- **Sparse/type-specific editing** with validation messages surfaced from the API; fields that were blank on extraction render as empty editable inputs rather than disappearing.
- **Feedback states:** loading skeletons, success cards after save, error cards with retry, and honest empty states — no dead-ends.
- **Consistency:** follows the existing Dashboard/CV-card visual system (dark-mode-aware, `gray-*` + `indigo-*` palette) rather than inventing a new look.

---

## 10. Accessibility

- Semantic **form** elements (`<form onSubmit>`, labeled inputs/textarea) throughout the edit and review flows.
- **Keyboard-operable:** buttons and inputs are native controls; list add/remove uses real buttons with `aria-label`s; no click-only widgets for core actions.
- **Color is not the only signal:** provenance is conveyed with text labels ("Extracted from resume" / "Verified") in addition to color, so the amber/green distinction doesn't rely on vision alone.
- **Contrast:** provenance badges use the existing high-contrast palette already used across the app.
- **Focus/flow:** loading is a skeleton (no FOUC), and error states render a retry affordance rather than a dead screen.
- Buttons in empty states omit a `loading` prop that the shared `Button` does not accept (TypeScript-clean).

---

## 11. Responsive Behavior

- The profile layout uses a `max-w-3xl mx-auto` container — content reflows to a single comfortable column on mobile.
- List-item editors and the provenance badges stack on narrow widths; `flex-wrap` is used for multi-value rows (skills/languages chips).
- Large textarea/text fields scale with the container; no fixed widths force horizontal scroll on phones.
- Tested by the frontend build plus a live check of the vite dev server: `/profile` and all of its modules transform and serve over `http://localhost:5173` (vite binds IPv6 `[::1]`, so `localhost` is the reachable origin on this machine).

---

## 12. Security / Data Isolation

- **Ownership:** every read/write is scoped to `get_current_user()` server-side. `user_id` is never accepted from the client. Cross-user isolation is enforced at the SQLAlchemy query/save layer (the profile row is keyed by the JWT user).
- **Resume ownership on save:** `source_resume_id`, if provided on `PUT`, must reference a resume owned by the current user (validated server-side before write).
- **Token enforcement:** no token -> 401; malformed token -> 401 (verified live).
- **No secrets or paths leaked:** profile responses re-serialize fields; the smoke test asserts neither `uploads`/`storage` path strings nor raw resume text appear in the response.
- **Input validation:** Pydantic v2 enforces types, lengths, strip patterns, email/URL formats, and 4-digit cert years at the boundary; JSON-as-Text columns are written via `json.dumps` and read via `_serialize_json_field` (no eval).
- **Set-NULL FK safety:** deleting a resume sets `source_resume_id` to NULL rather than blocking or cascading profile loss.

---

## 13. CANDIDATE_TRUTH.md Compliance

The checkpoint is built around the anti-fabrication policy; compliance is structural, not just incidental.

- **Deterministic extraction only** (`pypdf`/`python-docx`, no LLM): text is lifted verbatim; nothing is synthesized. Extraction of a claim the resume does not state is impossible by construction.
- **No fabrication path:** there is no code path that invents skills, experience, dates, employers, certifications, metrics, or education. Ambiguous/absent values stay empty and are shown as honest empty states.
- **Level awareness:** Level 3 skills (target/interest/unverified) are surfaced as **extracted-and-needing-review**, never as verified professional experience. Everything is tagged `resume_extracted` so the UI's review gate is the human decision point — mirroring the Level rules' "ask for confirmation before presenting unsupported items as experience."
- **`projects` never auto-extracted:** projects require explicit human verification per CANDIDATE_TRUTH.md (only verified projects are ever presented).
- **Metrics rule:** extraction copies only what is present; it cannot generate percentages, ticket counts, fleet sizes, or other statistics.
- **No silent upgrade:** `resume_extracted` can only become `user_verified` via a deliberate user save. The server never upgrades provenance on its own.
- **Verification UI:** the review screen exists precisely to give the user the confirmation gate.
- **Conflict handling:** where the app's profile data could conflict with CANDIDATE_TRUTH.md facts, the truthful (user-verified or resume-reported) value is what the app stores; the app never prefers a more impressive inference.

---

## 14. Tests and Exact Results

| Suite | Result | Scope |
|---|---|---|
| Backend unit/integration tests | **102 passed, 0 failed** (pytest) | Includes the 35 new profile tests: empty state / auth 401s / extract-without-resume 404 / DOCX & PDF extraction / draft provenance `resume_extracted` / "extraction does not persist" / PUT save -> `user_verified` / persisted GET round-trip / cross-user isolation (A vs B) / no leakage / sparse-update validation / `manually_edited` flag. All 11 pre-existing route families still resolve and pass (compatibility retained). |
| Frontend type-check + build | **Passed** (`tsc -b && vite build`) | Profile page, hooks, types, new Textarea, Sidebar nav, Dashboard readiness changes all compile. |
| Live smoke (HTTP, real server) | **30 passed, 0 failed** | `backend/smoke_test_profile.py` against a fresh uvicorn on **port 8000** (new code; a stale pre-built server holding 8000 was identified via `wmic process` command-line and terminated, then a fresh one started). Covers: register/login, empty state shape, 401s, extract-without-resume 404, DOCX upload, review-only draft (`has_text is True`, `warning is None`, correct `full_name`, skill `source == "resume_extracted"`, **no persistence after extract**), PUT save (`user_verified`, `manually_edited`, persisted round-trip), cross-user isolation (B starts null, B saves own, A intact), and no path/raw-text leakage. |
| Dashboard honesty (live) | **Passed** | Verified live that `candidate_profile_configured` flips False->True only after a real PUT save, and `ready` stays False while search preferences are unconfigured — readiness reflects **populated fields**, not merely a profile row existing. |
| Vite dev server / proxy | **Passed** | `/profile` page + all Profile modules transform 200 via `http://localhost:5173`; vite `/api/profile` proxy returns 401 without a token (proxy wiring correct). |

The 102 backend tests and the live 30/30 smoke are the authoritative validation; both run green on the final code state.

---

## 15. Compatibility Checks

- **All 11 existing API endpoints** remain integration-correct (auth, resumes, dashboard, preferences, chat, notes, search/jobs, skills, availability, settings) after the profile additions — verified by their passing test modules and live spot-checks.
- **Frontend:** existing pages/dashboard still import and build; the new `/profile` route is additive under the existing `Layout`. Vite proxying of `/api` unchanged.
- **No storage format change:** resumes, preferences, job data, and legacy profile rows are untouched; `_serialize_json_field` reads public JSON column values written by any prior code.
- **No dependency changes:** extraction uses pypdf/python-docx already present in the backend requirements; no new packages were added.
- **No migration:** the `CandidateProfile` table was already present; no Alembic changes staged.
- **Runbook:** fresh uvicorn on 8000 serving new code; `py backend/smoke_test_profile.py` reproduces the 30/30 result; `py -m pytest` reproduces 102/0.

---

## 16. Known Limitations

- **DOCX parsing is text-pass-dependent:** python-docx reads paragraph and table text; complex layouts (embedded objects, text boxes) may not surface every string. Extraction is conservative by design — missing text is preferable to fabricated text.
- **Scanned/image-only PDFs** extract no text: the endpoint returns `has_text: false` with a warning, and the UI surfaces it. OCR is deliberately out of scope.
- **Standard section-name matching:** extraction relies on recognizable headings (via `_HEADER_MAP`); a resume with novel section names may leave some content in the summary rather than a typed section. Conservative fail.
- **Refined layout parsing** (multi-column resumes) is not attempted; extraction favors single-column flow.
- **No multilingual parsing** — resumes in English/Filipino are expected; the section matcher is English-oriented. Fine for the current profile (CV language: English).

---

## 17. Deferred Work

- **OCR for scanned PDFs** — future enhancement; requires an OCR engine decision (kept out of scope to preserve the deterministic, no-LLM property and avoid new heavy dependencies).
- **"Keep as extracted" re-review flows** — today saving confirms everything to `user_verified`; a future refinement could re-open a saved profile's provenance and selectively re-mark items. Not required by the checkpoint.
- **Automatic re-extraction on resume replace** — currently extraction is on-demand; a future version could offer "re-extract from my latest resume" with a diff view. Deferred (requires a diff/merge UX that is explicitly not part of Checkpoint 5).
- **Checkpoint 6** — explicitly **NOT started** (strict stop honored).

---

## 18. Files Changed

**Backend (new):**
- `backend/smoke_test_profile.py` — live HTTP smoke test (30 checks).

**Backend (modified):**
- `backend/app/profile_extraction.py` — deterministic extraction module (pypdf + python-docx, `_RANGE_RE`, `_HEADER_MAP`, section parse, experience-only-on-evidence, `projects=[]`).
- `backend/app/routers/profile.py` — `GET ""`, `PUT ""`, `POST /extract`.
- `backend/app/models/profile_schemas.py` — `ProfileSource`, item schemas, `ProfileUpdateRequest`, response schemas.
- `backend/app/routers/dashboard.py` — `candidate_profile_configured` from populated fields (honesty fix).
- Backend tests — profile test module + related fixtures.

**Frontend (new):**
- `frontend/src/components/common/Textarea.tsx`
- `frontend/src/hooks/useProfile.ts`

**Frontend (modified):**
- `frontend/src/pages/Profile.tsx` — the 3-mode profile page.
- `frontend/src/App.tsx` — `/profile` route.
- `frontend/src/components/layout/Sidebar.tsx` — Profile nav item.
- `frontend/src/components/common/LoadingSkeleton.tsx` — `export { Skeleton as LoadingSkeleton }`.
- `frontend/src/pages/Dashboard.tsx` — readiness card links to `/profile`.
- `frontend/src/api/types.ts` — profile types.

**Repo root:**
- `CHECKPOINT_5_CANDIDATE_PROFILE_REPORT.md` (this file).

---

## 19. Final Checkpoint Status

- [x] Real `/profile` page accessible to authenticated users.
- [x] Stored profile info displayed.
- [x] Resume-driven population via conservative, deterministic extraction (pypdf/python-docx, no LLM).
- [x] Extracted info reviewed **before** becoming authoritative (transient review-only draft; save is the authoritative gate).
- [x] Fields editable and saveable (`PUT`).
- [x] Verified vs. extracted provenance distinguished everywhere (`user_verified` / `resume_extracted` badges).
- [x] Honest empty states for a fresh profile (and the right CTA for each missing-input case).
- [x] No unsupported professional claims ever fabricated (structural guarantees: deterministic-only extraction, `projects` never auto-extracted, metrics never invented, no silent provenance upgrade).
- [x] Profile data strictly isolated per user (ownership from JWT only, no client `user_id`; tests + live smoke prove A/B isolation).
- [x] No migration introduced; existing model reused; all 11 prior endpoint families intact.
- [x] Tests green: 102/102 backend, frontend `tsc -b && vite build` pass, live smoke 30/30.

**Result: PASS — all Checkpoint 5 acceptance criteria are met and validated.**

---

CHECKPOINT 5 VALIDATED — READY FOR CHECKPOINT 6