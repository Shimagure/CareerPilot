# CHECKPOINT 4 — RESUME UPLOAD

**Status: VALIDATED**

Authenticated users can upload, view, download, replace, and manage their resume.
Uploads are validated on the server, stored securely outside the source tree in
per-user directories with server-generated identifiers, associated with the
authenticated user, and never exposed across accounts.

---

## 1. Status

| Area | Verdict |
|------|---------|
| Backend API (upload / metadata / download) | Implemented + validated |
| Upload validation (server-authoritative) | Implemented + validated |
| Secure storage (server-generated keys, atomic writes) | Implemented + validated |
| Cross-user isolation | Implemented + validated (tests) |
| Replacement safety (failed replacement preserves previous) | Implemented + validated (tests) |
| Frontend Resume page | Implemented + validated (type-check/build + nav verification) |
| Dashboard integration | Implemented + validated (test + build) |
| Backward compatibility | Validated (live smoke) |
| Browser automation | NOT present in repo — page validated via type-check/build, route resolution, and live API smoke, not a real browser |

---

## 2. Architecture audit (targeted)

Focus: `backend/app/routers/resume.py`, `backend/app/storage.py`,
`backend/app/models/resume_schemas.py`, `backend/app/models/database_models.py`
(`Resume` model), `backend/app/config.py`, `frontend/src/App.tsx`,
`frontend/src/api/{client,endpoints,types}.ts`, `frontend/src/pages/Dashboard.tsx`.

Key findings that shaped the implementation:

- **Existing `Resume` model already in the schema.** `resumes` exists in
  migration `84c84cccd871` and the live DB — **no migration was required**.
  The model has `user_id` FK, `original_filename`, `storage_key`, `file_type`,
  `file_size`, `status`, `uploaded_at`, `is_active`, plus the
  `ix_resumes_user_active` index — exactly what resume ownership needs.
- **Broken navigation routing.** `frontend/src/App.tsx` nested all workspace
  children under `<Route path="/dashboard">`, producing `/dashboard/jobs`
  style URLs, while the Sidebar/Header nav targets absolute `/jobs`, `/ranked`,
  etc. `matchRoutes` confirmed every non-dashboard target was a blank page, and
  `/resume` could not exist. **Fixed** by making the `Layout` route pathless
  with absolute child paths (repairs existing nav AND makes `/resume`
  reachable).
- Auth foundation: `get_current_user()` resolves identity from the JWT `sub` —
  ownership is derived server-side; the frontend never supplies `user_id`.
- Singleton `get_db_manager()` / `get_db_session()` dependency uses
  `expire_on_commit=False` but **rollback expires objects** — a failure-path
  detail that required snapshotting ORM values before the transaction (see
  Security).

---

## 3. Files changed

### Backend (new)
- `backend/app/storage.py` — secure resume storage (server-generated keys,
  per-user dirs, atomic writes, path-traversal guard).
- `backend/app/models/resume_schemas.py` — `ResumeResponse` (public metadata
  only; storage internals intentionally absent).
- `backend/app/routers/resume.py` — `POST /api/resume`, `GET /api/resume`,
  `GET /api/resume/download`.
- `backend/tests/test_resume.py` — 25 tests.

### Backend (modified)
- `backend/app/config.py` — `upload_dir` and `max_resume_size_mb` settings +
  `get_upload_dir()` helper.
- `backend/app/routers/__init__.py` — register `resume` router export.
- `backend/app/main.py` — include `resume.router`.
- `backend/app/routers/dashboard.py` — `upload_resume` step now points to
  `/resume` (was `coming_soon`).
- `backend/requirements.txt` — added `python-multipart==0.0.32`
  (FastAPI `UploadFile` dependency).
- `backend/tests/test_dashboard.py` — new assertions for the `/resume` step.

### Frontend
- `frontend/src/App.tsx` — pathless `Layout` route + absolute child paths +
  `/resume` route.
- `frontend/src/api/types.ts` — `ResumeRecord`.
- `frontend/src/api/client.ts` — `getResumeMetadata`, `uploadResume`
  (FormData, boundary handled by browser), `downloadResume` (blob).
- `frontend/src/api/endpoints.ts` — `resumeApi`.
- `frontend/src/hooks/useResume.ts` — `useResume` (+404 → `null`) and
  `useUploadResume` (invalidates `['resume']` + `['dashboard']`).
- `frontend/src/pages/Resume.tsx` — **new** Resume page.
- `frontend/src/components/layout/Sidebar.tsx` — Resume nav item.
- `frontend/src/pages/Dashboard.tsx` — ProfileReadiness resume step now links
  to `/resume` ("Manage" instead of "Coming soon").
- `frontend/src/utils/formatters.ts` — `formatFileSize`.

---

## 4. Database changes

**None required.** The `resumes` table already exists (migration
`84c84cccd871`, present in the live `careerpilot.db`). Verified live before
implementation. No assertions/data migration were added; existing user data is
untouched. Replacement is recorded in-place: the previous row is set
`is_active = False` and a new active row is inserted (history preserved, single
active resume per user via `_get_active_resume` ordering + `ix_resumes_user_active`).

---

## 5. API endpoints

All behind the existing JWT auth dependency (`get_current_user`); ownership is
`current_user.id`, never a client-supplied id.

| Endpoint | Method | Auth | Behavior |
|----------|--------|------|----------|
| `/api/resume` | `POST` | Required | Upload or replace the active resume. `201` first upload, `200` replacement. Validates extension + content + size. |
| `/api/resume` | `GET` | Required | Active resume metadata; `404` if none. |
| `/api/resume/download` | `GET` | Required | Streams the active resume as `attachment` with the original filename; `404` if missing (no resume, or file absent on disk). |

Response shape (`ResumeResponse`):
`{ id, filename, content_type, file_size, status, uploaded_at }` — **no storage
key, no filesystem path, no hash serialized**.

---

## 6. Upload validation (server-authoritative)

The browser/MIME type is never trusted. Validation order in `upload_resume`:

1. **Filename sanity** — rejects empty/missing names and any name carrying
   directory components (`/` or `\`), which is how path traversal is expressed.
2. **Extension allow-list** — `pdf` or `docx`; anything else → `400`.
3. **Hard size cap** — streamed in 1 MB chunks with an aggregate `10 MB` cap
   (`max_resume_size_mb`, configurable); over → `413`.
4. **Content inspection** (magic bytes + structure):
   - PDF must begin with `%PDF-` magic bytes.
   - DOCX must be a valid ZIP (`PK`) containing OOXML parts
     (`[Content_Types].xml` + `word/document.xml`).
   - Empty content → `400`.
   - A renamed zip (e.g. `.docx` bytes saved as `.pdf`) is rejected.
5. **Safe display filename** — `sanitize_original_filename` strips control
   chars and directory components; used only for metadata + download
   `Content-Disposition`, never as a storage path.

Tests explicitly cover: empty, unsupported extension, oversized, non-PDF bytes,
and a zip disguised as a PDF (nothing written to storage).

---

## 7. Storage design

`backend/app/storage.py` (`ResumeStorage`):

- Default root: `PROJECT_ROOT/data/uploads/resumes` — **outside the source
  code directories** (configurable via `settings.upload_dir`).
- **Per-user namespace**: `<root>/<user_id>/<storage_key>`.
- **Server-generated storage key**: `uuid4().hex` + allowed suffix
  (`32 hex chars`), never the client's filename.
- **Atomic writes**: temp file in the target dir → write → `flush()+fsync()` →
  `os.replace()`. A crash mid-write leaves no partial file.
- **Read/delete/path-exists** guarded by `Path.is_relative_to(user_dir)` —
  any key escaping the user's directory raises `ValueError`.
- Download resolves the stored key against the user's own directory only.

---

## 8. Security controls

- **Ownership from the JWT, never the client.** `current_user.id` is the only
  identity used; there is no `/api/resume/{user_id}` route. Cross-user tests
  prove A cannot read/download/replace B's resume.
- **No path traversal** — directory components rejected at validation;
  storage keys are server-generated and re-guarded on resolve.
- **No storage-path/key serialization** — `ResumeResponse` omits them; a test
  asserts the forbidden tokens (`storage`, `uploads`, `_key`, `path`, `\\`)
  never appear in the response body.
- **Content validated, MIME ignored** — a hostile extension or mislabeled
  browser type cannot smuggle a non-resume payload into storage.
- **Failed replacement is non-destructive** — the new file is written, then
  the new DB row persisted and the old row deactivated *before* the previous
  file is deleted. If the DB commit fails, the transaction is rolled back, the
  new file is deleted, and the existing resume + file remain intact (tested by
  monkeypatching `AsyncSession.commit`).
- **No orphans on failure** — the written file is cleaned up on rollback.
- **Antivirus / malware scanning** — **not implemented** (no scanning service
  is wired into the environment). Documented as a **future hardening** item
  (see Deferred).
- **ORMs/expiration** — a rollback expires ORM objects; plain-string user id
  and old storage key are snapshotted before the transaction so the cleanup
  path performs no lazy sync DB access (this fixed a `MissingGreenlet` bug
  found by the replacement-failure test).

---

## 9. Replacement semantics

`POST /api/resume` treats a second (or later) upload as a replacement:

1. Validate new file (extension/content/size).
2. Snapshot current active row's `user_id`/`storage_key`.
3. Persist the new file to disk (atomic).
4. Insert new active row, set old row `is_active = False`, commit.
5. **After** commit, delete the old file from disk.
6. On any DB failure: rollback, delete the newly written file, `500` with a
   clear message — previous resume and file untouched.

Result: exactly one active resume + one file per user; old file removed only
after the new state is durable. Verified live (replace → `200`, download bytes
match the replacement) and by tests (including failure preservation + recovery
upload after the failure is cleared).

---

## 10. Frontend implementation

`frontend/src/pages/Resume.tsx` answers the page's questions directly:

- **What resume do I currently have?** A details card with file name, file
  type (PDF/DOCX badge), file size, upload date, and status. Answers "no
  resume on file" with a dedicated empty state when none.
- **Is it ready?** Status badge ("Uploaded"). No filesystem paths are ever
  shown — only user-meaningful metadata.
- **What file? When?** Filename + human-readable upload date/size.
- **Can I replace it?** The "Replace resume" card; a second upload replaces the
  existing resume (the UI says so explicitly before upload).
- **What happens next?** The "What happens next?" card honestly states the file
  is stored securely and account-linked, and that profile building from the
  file is an upcoming capability — **nothing is extracted from the resume yet**
  (consistent with the CANDIDATE_TRUTH anti-fabrication rule: no inferred
  skills/profile are presented).

States implemented: initial loading (skeleton), empty, existing-resume,
file-selected (client-side validation preview), uploading (spinner + disabled),
success (green banner, `role="status"`), and error (server `detail` surfaced in
a `role="alert"` banner; query failures get `ErrorState`/`NetworkError` with
retry). Success invalidates the resume query and the dashboard's profile
readiness via React Query.

Client pre-validation (extension + 10 MB) gives fast feedback, but the server
remains authoritative. The download button streams via `GET /api/resume/download`
as a blob and saves with the original filename.

---

## 11. UX / accessibility audit (senior frontend pass)

Applied while building against `frontend/src/components/common/*` conventions:

- **KEEP** (existing): `Card`/`Badge`/`Button`/`EmptyState`/`ErrorState`,
  skeleton loading, brand color tokens, light/dark variants active across the
  page, `NetworkError` vs `ErrorState` distinction.
- **IMPROVE** (applied): honest microcopy ("Nothing is extracted from your
  resume yet"); confirm-style two-step replacement (choose → review → upload)
  reducing accidental overwrites; success/error banners keyed by
  `role="status"` / `role="alert"`.
- **REFACTOR** (applied): the broken `App.tsx` route nesting → pathless layout
  with absolute children; the ProfileReadiness dead "Coming soon" resume item →
  real `/resume` "Manage" link.
- **REPLACE**: none — no bespoke component reimplementation was warranted.
- **Accessibility**: programmatic label associations (`sr-only` file input
  triggered by buttons), status/alert live regions, `aria-busy` during load,
  keyboard-usable (buttons), SVG icons `aria-hidden`, high-contrast text on
  gray/brand backgrounds in both themes.
- **Responsive**: two-column card grid collapses to one column below `lg`;
  detail rows wrap (`break-all`) so long filenames never overflow; consistent
  with the rest of the workspace. No horizontal scroll on the page.

---

## 12. Responsive behavior

- Grid `lg:grid-cols-2` for the status+upload cards → single column on smaller
  screens.
- Header/sidebar navigation unchanged; Resume added to the Sidebar (all breakpoints).
- Long filenames constrained with `break-all` + right-aligned values; `dl`
  rows flex and wrap on narrow widths.
- Banner and "What happens next" stack vertically under `sm:`.
- No page-level horizontal overflow introduced (verified in markup review;
  visual browser check was not run — see Known limitations).

---

## 13. Tests + exact results

### Backend — full suite: **67 passed**

```
tests/test_auth.py ...................  19 passed
tests/test_dashboard.py .........         9 passed
tests/test_database_foundation.py ...... 14 passed
tests/test_resume.py .........................  25 passed
============================= 67 passed in 40.87s =============================
```

`test_resume.py` (25) covers:
- **Authorization (4)**: unauthenticated POST/GET/download → 401; metadata
  404 when nothing uploaded.
- **Upload validation (7)**: valid PDF, valid DOCX, empty → 400, unsupported
  ext → 400, oversized (1 MB cap via settings) → 413, non-PDF bytes → 400,
  docx-as-pdf renamed → 400 and **nothing written to storage**.
- **Metadata (2)**: exact key set
  `{id, filename, content_type, file_size, status, uploaded_at}`; forbidden
  internal tokens absent from raw response text.
- **Storage security (4)**: server-generated 32-hex names; traversal filename
  → 400 with nothing escaped; `resolve()` rejects `../` keys; filename
  sanitization.
- **Download (2)**: stored bytes + original filename in `Content-Disposition`
  + attachment; 404 when none.
- **Ownership (3)**: B cannot read, download, or replace A's resume.
- **Replacement (2)**: success removes the old file and updates metadata;
  **failure preserves the previous resume and file, cleans up the new file,
  and normal replacement works again afterward** (flaky-commit injection).
- **Singleton reset (1)**: fresh isolated storage per test.

`test_dashboard.py` additions: `upload_resume` step has `href == "/resume"`
with `coming_soon is False`; other setup steps remain `coming_soon is True`.

### Frontend
- `npm run build` (`tsc -b && vite build`) — **passes**, 0 type errors.
- Route resolution via react-router `matchRoutes` — **all 10 nav targets
  MATCH**: `/dashboard`, `/jobs`, `/jobs/:stable_id`, `/jobs/:stable_id/fit`,
  `/ranked`, `/applications`, `/pipeline`, `/health`, `/retention`, `/resume`.

### Live smoke (real server, real DB, real storage)
- Unauthenticated `/api/resume` and `/api/resume/download` → 401.
- Register → upload → `201`; metadata GET → clean shape (no storage fields);
  download → `200`, `Content-Disposition: attachment; filename="..."`,
  **bytes match**; replace → `200` + download bytes match replacement; `.txt`
  upload → `400`, **existing resume still on file**.
- Storage on disk: `data/uploads/resumes/<user_id>/<32-hex>.pdf` — per-user,
  server-generated names, outside source code.

---

## 14. Compatibility (backward-compat smoke, all green)

Live server smoke (restarted with the new code):

```
/api/health            -> 200
/api/jobs              -> 200
/api/ranked/top5       -> 200
/api/applications      -> 200
/api/pipeline/status   -> 200
/api/dashboard         -> 401 (unauthenticated, as designed)
/api/demo/status       -> 200
/                      -> 200
```

The production job pipeline, Demo Mode, auth, and all existing workspace routes
are unchanged; `App.tsx` now resolves every existing nav target (fix, no
regression). The CLI pipeline and job-scraper files were not touched.

---

## 15. Known limitations

- **No antivirus / malware scanning** of uploads (no scanning service wired in).
  Content validation stops obvious non-PDF/non-DOCX payloads but is not a
  substitute for AV. Recommended before this endpoint is exposed publicly.
- **No browser-automation tests.** The repo has no Playwright/Cypress setup;
  the Resume page is validated by type-checking, the production build, route
  resolution, and a live API smoke — not a real-browser click-through.
- **Download uses the browser's native save** (blob + anchor). Content is
  matched to truly stored bytes; filename attribute is the sanitized original.
- **DOCX content checked at the OOXML-container level**, not full document
  validity; acceptable for the checkpoint scope.
- Local dev DB contains a few `cp4smoke*` throwaway accounts/resumes from the
  live smoke run.

---

## 16. Deferred future work (out of scope, per checkpoint boundary)

- Candidate profile extraction from the resume (the resume page says so
  honestly — nothing is extracted yet).
- Skill extraction, AI resume scoring, job matching from the resume.
- Resume rewriting / cover-letter generation tied to the uploaded file.
- Search preferences / candidate profile configuration screens.
- Application assistant flow.
- OCR for scanned resumes and background AI processing.
- Antivirus scanning / malware-scanning hook on upload.
- Frontend browser-automation test harness.
- Any change to the production job-scraping pipeline or Demo Mode.

---

## 17. Final checkpoint status

**VALIDATED.** Checkpoint 4 (Resume Upload) is complete: secure server-side
upload with content validation, stored outside the source tree in per-user
directories under server-generated keys, owned by the authenticated user with
proven cross-user isolation, safe replacement that never destroys a valid
previous resume, a polished and honest Resume page with full loading/success/
error states, dashboard integration, and no regressions to existing routes or
endpoints. Ready to proceed to Checkpoint 5.

---

**CHECKPOINT 4 VALIDATED — READY FOR CHECKPOINT 5**