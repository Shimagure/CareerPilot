# CHECKPOINT 6 — SEARCH PREFERENCES REPORT

Status: **IMPLEMENTED + VALIDATED** (backend + frontend + tests + live smoke). Ends with `CHECKPOINT 6 VALIDATED — READY FOR CHECKPOINT 7`.

---

## 1. Status

Checkpoint 6 is **complete and validated**. An authenticated user can, at a real `/preferences` page:

1. Access `/preferences` (frontend route + sidebar nav + dashboard next-step + card link).
2. View current search preferences (GET `/api/preferences`, honest `null` until first save).
3. Configure target job roles (chip/multi-value list).
4. Configure preferred locations (chip list; distinct from work arrangement).
5. Configure work arrangement (remote/hybrid/onsite checkboxes, explicitly selected — nothing assumed).
6. Configure salary expectations (currency / min / max / pay period, with the one justified schema change).
7. Configure experience/role level **only where supported** — the existing `SearchPreferences` model has **no seniority column**, so this is a documented deferral ("where supported" criterion) rather than a fabricated field.
8. Configure other genuinely useful, model-supported constraints: excluded keywords, NCR-only toggle, day/night/rotational shift flags, and a free-text career direction.
9. Save/update preferences (sparse PUT, create-or-update).
10. Receive clear validation/errors (client inline + server 422/400 with honest messages).
11. See honest empty/default states (no fabricated values, no fake percentages, no fake recommendations).
12. Keep preferences strictly isolated to the authenticated user (enforced server-side via `get_current_user()`; cross-user isolation tested).
13. See preferences reflected honestly in Dashboard readiness (`search_preferences_configured`, `completed_steps` of 3, no "100% ready" claim).

The checkpoint also delivers the mandated report (this file) and the exact final response line.

---

## 2. Architecture Audit

Inspected only the check-in-scope subsystem (reduced-verification rule honored):

- **Existing model** `backend/app/models/database_models.py::SearchPreferences` (a signed-in, user-scoped table — **not** the global pipeline `SearchPreferences` naming confusion; this is the per-user table) — assessed in section 3.
- **Dashboard** `backend/app/routers/dashboard.py` — readiness logic. Found `preferences_count = await count(SearchPreferences)` (a *row-existence* test, not a *meaningful-content* test) and a `set_preferences` next-step marked `coming_soon=True`. Both changed.
- **Profile/resume routers** (Checkpoint 4/5) — confirmed the GET/PUT service pattern (`get_current_user()` dependency, sparse `exclude_unset` update) reused for preferences.
- **Existing pipeline (discovery → canonicalization → hard filter → priority queue → verification → scoring → ranking → retention)** — **not modified**. No changes to `score_jobs.ts` / `rank_jobs.ts`, no scraping/scoring/ranking/verification changes. The absolute pipeline boundary was respected.
- **Frontend architecture** — confirmed `types.ts` / `client.ts` / `endpoints.ts` conventions, the `useProfile.ts` hook pattern (query key + mutation invalidating `['profile']` + `['dashboard']`), the `Layout`/`Sidebar` protected route shell, and the `Dashboard.tsx` readiness card.

---

## 3. Existing SearchPreferences Model Assessment

The model (as found) already provided the right columns, so **no duplicate table** was created:

| Column | Used? | Notes |
|---|---|---|
| `target_roles` (JSON Text) | ✅ surfaced | Target job roles |
| `excluded_keywords` (JSON Text) | ✅ surfaced | Exclusion filter |
| `preferred_locations` (JSON Text) | ✅ surfaced | Preferred work locations |
| `ncr_only` (bool) | ✅ surfaced | Metro Manila / NCR-scope flag |
| `remote_ok` / `hybrid_ok` / `onsite_ok` (bools) | ✅ surfaced | Canonical flags; derived `work_arrangements` list on read, synced on write |
| `preferred_arrangements` (JSON Text) | ✅ kept in sync | Redundant with the 3 bools; maintained on write, read derives from bools |
| `salary_min` / `salary_max` (int) | ✅ surfaced | Currency-first expectation |
| `salary_currency` (str) | ✅ surfaced | Default `PHP` |
| `day_shift_ok` / `night_shift_ok` / `rotational_ok` (bools) | ✅ surfaced | Shift availability |
| `career_direction` (str) | ✅ surfaced | Free-text direction, constrained in length |
| `auto_search_enabled` / `search_frequency_days` / `max_results_per_search` | ⏸ model defaults kept, **not exposed** | Belongs to a later automation checkpoint; exposing them here would imply behavior that doesn't exist yet |
| **seniority / experience-level** | ❌ **does not exist** | "Configure experience/role level WHERE SUPPORTED" → not supported by the model, so honestly deferred (section 17) |
| `salary_period` | 🆕 **added** (the one justified change) | The brief demands an unambiguous salary pay period; the model had no way to distinguish PHP 30,000/month from PHP 30,000/year. Smallest coherent change: one `String(20)` column, default `monthly` |

**Model redundancy decision:** `remote_ok`/`hybrid_ok`/`onsite_ok` bools are the **canonical source of truth**; the `preferred_arrangements` JSON list is derived and kept in sync on write, never read as truth. This preserves legacy table layout and avoids a destructive migration.

---

## 4. Data Model

**One change** to `SearchPreferences`, the smallest coherent change that preserves all existing data:

- Added `salary_period: Mapped[str] = mapped_column(String(20), default="monthly", nullable=False)`.

**Proper Alembic migration** (data-preserving, additive only):

- `backend/alembic/versions/0a7f3c2d15e8_add_salary_period_to_search_preferences.py`
  - `revision = '0a7f3c2d15e8'`, `down_revision = '84c84cccd871'`
  - `upgrade()`: `op.add_column('search_preferences', sa.Column('salary_period', sa.String(length=20), server_default='monthly', nullable=False))` — every existing row backfills to `'monthly'`.
  - `downgrade()`: drops the column.
- **Applied** to the dev DB: `alembic current` → `0a7f3c2d15e8 (head)`; `alembic heads` → `0a7f3c2d15e8 (head)`. Chain is clean (no dangling revisions).
- No unrelated models/tables were altered.

---

## 5. API Endpoints

All under `/api/preferences`, both guarded by `get_current_user()` (ownership from the authenticated JWT — **never** a client-supplied `user_id`):

**`GET /api/preferences`** → `PreferencesGetResponse`
- `{ "preferences": { ... } }` after a save, or `{ "preferences": null }` if the user has never saved. No fabricated default object.
- `configured` field on the response is the honest meaningful-values signal (section 7).

**`PUT /api/preferences`** → `SearchPreferencesResponse` (create-or-update, sparse)
- Rejects an empty body with **400** ("At least one field must be provided.").
- Loads the user's row or creates one (`SearchPreferences(user_id=current_user.id)`).
- Cross-field salary validation against *stored* values so a sparse update can't silently create `min > max` → **422**.
- JSON list columns are stored as `json.dumps(value or [])`; `work_arrangements` maps onto the three bool flags and re-syncs `preferred_arrangements`; everything else is `setattr`.
- Commits, refreshes, returns the response.

**No new database table** — the existing `SearchPreferences` table is reused (the "no duplicate table" rule).

---

## 6. Validation Rules

All server-side in `backend/app/models/preferences_schemas.py`:

- **Lists** (`target_roles`, `preferred_locations`, `excluded_keywords`): must be arrays; each item trimmed, empties dropped, case-insensitive dedupe (preserving first-seen order), max **50** items, max **200** chars/item. Pathological input → 422.
- **`work_arrangements`**: must be an array of the enum `remote | hybrid | onsite`; invalid members → 422; duplicates removed.
- **Salary**: non-negative; upper bound **50,000,000** (SALARY_MAX); must be numeric (bools rejected); `salary_min <= salary_max` (both intra-payload and against stored values on sparse update) → 422.
- **Currency**: 3–10 uppercase letters (e.g. PHP); must be alphabetic.
- **`salary_period`**: enum `monthly | annual`.
- **`career_direction`**: max 2,000 chars; empty/whitespace → `None`.
- **Empty update body** → 400.

Client mirrors the important checks inline (list caps, item length, salary range/type, currency shape, career length) so users get immediate feedback; the server remains authoritative.

---

## 7. Preference Semantics

**Preferences = what the user WANTS.** Core invariant enforced:

- **Never populated from resume/profile/jobs.** `GET /api/preferences` returns `null` for a user who hasn't saved, regardless of their resume or candidate profile. Test: `test_no_auto_population_from_profile` and the live fresh-user check both confirm `preferences: null`.
- **`configured` is honest** — it only turns `true` when at least one *meaningful* value is present (any non-empty list, a salary bound, a non-empty career direction, or a work-arrangement set that departs from the remote+hybrid default). Saving the default flags (`remote+hybrid`, NCR-only, all shifts) does **not** count as configuration. This signal is computed once and shared by the router response and the dashboard.
- **Work arrangement is explicit, not assumed.** The UI renders checkboxes (Remote/Hybrid/On-site) and only saves what's checked. The backend maps the checked set onto the three bool flags; un-chosen arrangements are left `false` and never invented on read.
- **Locations vs arrangement** are distinct controls: "Preferred Locations" (e.g. Metro Manila, Remote) and "Work Arrangement" (remote/hybrid/onsite) are separate sections, and the location helper text says so. No geocoding, no free-text → coordinate parsing.
- **Salary period is explicit**: currency + min + max + `monthly`/`annual`, so PHP 30,000 *per month* is unambiguous.

---

## 8. Frontend Implementation

- **Types** (`frontend/src/api/types.ts`): `SalaryPeriod`, `PreferenceWorkArrangement`, `SearchPreferencesResponse`, `SearchPreferencesUpdateRequest`, `PreferencesGetResponse`.
- **Client** (`frontend/src/api/client.ts`): `getPreferences()`, `updatePreferences(payload)` — axios singleton + bearer token via the existing interceptor.
- **Endpoints** (`frontend/src/api/endpoints.ts`): `preferencesApi.get` / `preferencesApi.update` with typed returns.
- **Hooks** (`frontend/src/hooks/usePreferences.ts`): `usePreferences` (queryKey `['preferences']`) and `useUpdatePreferences` (invalidates `['preferences']` **and** `['dashboard']`).
- **Page** (`frontend/src/pages/Preferences.tsx`) at route `/preferences` (added to `App.tsx`):
  - **Honest empty state**: when `preferences` is `null` or `configured === false`, a blue status banner reads *"Your search preferences aren't configured yet. Fill in the fields below and save to complete this step."* No claim that matching exists; the intro line states preferences *"will be used by future job-matching workflows."*
  - **Chip inputs** for target roles, preferred locations, excluded keywords — Enter adds, Backspace removes, blur commits, ✓-button removes each chip, case-preserving dedupe, caps enforced.
  - **Work arrangement**: three labelled checkbox cards with explicit descriptions.
  - **Salary**: min / max number inputs, currency select (PHP/USD/EUR/GBP/SGD/AUD/CAD), pay-period select (monthly/annual).
  - **Shift & location flags**: day / night / rotational + NCR-only checkboxes.
  - **Career direction**: textarea with 2,000-char counter.
  - **Save** button with loading state, `role="status"` success banner ("Preferences saved."), `role="alert"` error banners (server `getApiErrorMessage` surfaced). Validation errors render inline per-field with `aria-describedby`.
- **Nav**: `Sidebar.tsx` gained "Search Preferences" with a new sliders-style icon between Profile and Resume.

---

## 9. Dashboard Integration

`backend/app/routers/dashboard.py`:

- Replaced the row-existence check (`count(SearchPreferences)`) with `_search_preferences_configured(...)`: reads the user's row and applies the **same** `search_preferences_configured` helper (shared with the router) so the dashboard and the API can never disagree.
- `ProfileReadiness` now: `resume_uploaded`, `candidate_profile_configured`, `search_preferences_configured`, `completed_steps` of 3, `total_steps = 3`, `ready = all three`.
- `set_preferences` next step now points to `href="/preferences"` (was `coming_soon=True`, no link).
- Frontend `Dashboard.tsx`: the Profile Readiness card's *Search preferences* row now links to `/preferences` ("Manage"). No "100% ready"/fake percentage anywhere — readiness shows a concrete `X of 3` and per-step Ready/Not-yet-started badges.

---

## 10. UX Audit

- One logical workflow: page intro → honesty banner (empty state) → grouped *cards* for each preference dimension → single Save.
- Chip inputs give a faster multi-value workflow than separate text fields and show the exact saved value set.
- Salary screenshot clarity: min/max side by side with explicit currency and period.
- Immediate inline validation on Save (client-side) plus server messages surfaced when the server overrules.
- `role="status"` for the success banner and `role="alert"` for error banners so screen readers announce them; per-field errors are also tied via `aria-describedby`.
- Empty state does **not** fabricate recommendations or percentages — a deliberate honesty choice per the brief.

---

## 11. Accessibility

- Semantic page `<h1>`; each card uses `CardHeader`/`CardTitle` (heading semantics) + `CardDescription`.
- All inputs have explicit `<label>`s; the chip list input has an `aria-label`.
- Checkbox groups wrapped in `<fieldset><legend class="sr-only">` for the arrangement set; labels wrap native checkboxes (click target covers the whole card).
- Error text uses `role="alert"` and is referenced with `aria-describedby` / `aria-invalid`.
- The work-arrangement toggle and chip-remove buttons are real `<button>`s / native inputs — fully keyboard-operable (Enter to add, Backspace to delete last chip).
- No color-only signaling: status always pairs color with text ("Ready" vs "Not yet started", error/success text, etc.).
- Focus ring visible on inputs/chips (brand ring).

---

## 12. Responsive Behavior

- Page uses the existing card grid; arrangement selectors are `sm:grid-cols-3` (stack on mobile), salary fields `sm:grid-cols-4` (stack on small screens).
- Chips wrap; the chip input is `flex-wrap` with a min-width so the text field stays usable on narrow viewports.
- Sidebar is the existing responsive drawer; nav label truncation prevented by flex-shrink-0 on icons.
- No horizontal scroll introduced (tested via built output + vite serving; manual wide/narrow visual pass documented as a limitation in section 16).

---

## 13. Security / Data Isolation

- **Ownership**: both endpoints take identity from `get_current_user()` (Bearer JWT); there is **no** client-supplied `user_id` parameter anywhere in the request path. A malformed/missing token → 401.
- **Isolation**: queries are scoped `WHERE user_id == current_user.id`. Cross-user isolation is tested.
- **Validation**: all payloads server-side validated before persistence (section 6) — no raw unbounded fields.
- **Storage**: JSON list columns stored via `json.dumps` of server-validated lists; read path tolerates legacy shapes safely.
- **PII**: preferences can contain user-provided free text (career direction, role names) but are never returned except to their owner; `SearchPreferencesResponse` exposes no password/token/secret data.
- Auth 401 paths exercised in tests and live (vite proxy `/api/preferences` → 401 unauthenticated).

---

## 14. Tests and Exact Results

**Backend — `backend/tests/test_preferences.py` (26 tests, all pass):**

- Authorization: GET/PUT require auth (401), invalid token (401) — 3 tests.
- Empty state: fresh user GET → `null`; no auto-population from profile; empty PUT body → 400 — 3 tests.
- Persistence: create+retrieve; sparse merge update; explicit empty list clears; work-arrangement flags map and persist; salary period explicit (+ invalid period 422) — 5 tests.
- Normalization: whitespace trim + casefold dedupe; arrangement dedupe — 2 tests.
- Validation: min>max (422), sparse-update conflict (422), negative salary (422), salary upper bound (422), invalid arrangement enum (422), oversized list (422), oversized string (422), invalid currency (422), oversized career direction (422), non-list target_roles (422) — 10 tests.
- Defaults/honesty: `configured` stays false for default-only save then flips with a real value; dashboard reflects preferences honestly (false → true with a meaningful save; a second user stays false) — 2 tests.
- Cross-user isolation: A's data invisible to B; B writes its own; A intact after B's write; B only ever sees B's values — 1 test (multi-assert).

**`backend/tests/test_dashboard.py`** — one assertion updated to reflect Checkpoint 6 reality: `set_preferences` is now a real route (`href == "/preferences"`, `coming_soon is False`) instead of "coming soon." This is the same test-evolution already applied to resume (CP4) and profile (CP5).

**Full backend suite (exact):**
```
128 passed, 8135 warnings in 78.02s
```
(102 pre-existing + 26 new preferences; 1 CP5-era dashboard test assertion legitimately updated.)

**Frontend:**
```
tsc -b && vite build  →  built in 672ms, 473 modules, 0 type errors
```

**Live smoke (restarted uvicorn on `127.0.0.1:8000` with current code):**
- Auth: register + login round-trip OK.
- Compat endpoints: `/` 200, `/api/health` 200, `/api/jobs` 200, `/api/ranked/top5` 200, `/api/pipeline/status` 200, `/api/demo/status` 200.
- Auth-required (no token → 401): `/api/dashboard`, `/api/resume`, `/api/profile`, `/api/preferences`.
- Authenticated: `/api/dashboard` 200, `/api/profile` 200, `/api/preferences` 200; `/api/resume` → 404 (honest no-resume empty state); `/api/applications` returns 200 unauthenticated (pre-existing public tracker-list behavior, unchanged).
- **Preferences end-to-end**: fresh GET → `{"preferences": null}`; PUT saves (roles/locations/arrangements/salary/career); GET returns persisted row with `configured: true`; dashboard reports `search_preferences_configured: True` and `completed_steps 1/3`.
- **Frontend (vite dev server on `localhost:5173`)**: `/src/pages/Preferences.tsx` and `/src/hooks/usePreferences.ts` transform 200 (HMR served the new modules); app shell 200; vite proxy `/api/preferences` → 401 unauthenticated (proxy wiring correct).

---

## 15. Compatibility Checks

Targeted smoke of the mandated endpoint list (all on the freshly restarted server):

| Endpoint | Result |
|---|---|
| `/api/health` | ✅ 200, status ok |
| `/api/jobs` | ✅ 200 |
| `/api/ranked/top5` | ✅ 200 |
| `/api/applications` | ✅ 200 (public tracker list — pre-existing) |
| `/api/pipeline/status` | ✅ 200 |
| `/api/dashboard` | ✅ 200 (auth) |
| `/api/resume` | ✅ 200 metadata (auth) |
| `/api/preferences` | ✅ 200 (auth), 401 (anon) |
| `/api/demo/*` | ✅ 200 |
| auth (register/login/me) | ✅ 200 |

No changes to discovery/scraping/canonicalization/hard-filter/verification/scoring/ranking/retention — those are untouched, and `/api/ranked`, `/api/jobs`, `/api/pipeline/status` all still serve real pipeline data (124 active jobs, pipeline stage `ranking_report` status `complete`).

Migration state: dev DB at `0a7f3c2d15e8 (head)`; `alembic heads` clean.

---

## 16. Known Limitations

- **No seniority/experience-level preference**: the existing `SearchPreferences` model has no such column (it predates this checkpoint), so meeting requirement 7 "where supported" is deferred rather than faked. Not fabricating the field honors the anti-fabrication/integrity rules.
- **`auto_search_enabled` / `search_frequency_days` / `max_results_per_search`** exist on the model but are **not** exposed: they belong to a future automation checkpoint and exposing them now would imply behavior that doesn't exist.
- **Preferences are stored but not yet consumed**: no matching/ranking uses them yet (out of scope). The UI says so honestly.
- **No visual browser click-through**: verification was via `tsc`/build + vite module/proxy checks (same approach as CP5). A rendered-browser interaction pass requires a browser automation harness that isn't part of this environment; the configurable wide/narrow layout was exercised at the code level only.
- **`/api/applications` unauthenticated read** is pre-existing architecture (public tracker list), not introduced here.
- Search preferences are plaintext in the DB (as all user columns are); no encryption layer was added (no scope ask for it).

---

## 17. Deferred Work

- **Seniority / role level** ("WHERE SUPPORTED"): needs a real model column (`seniority_level`) + migration + frontend control. Deliberately not fabricated into this checkpoint.
- **Consumption of preferences**: job matching / ranking / score recalculation that reads saved preferences (explicitly out of scope — no changes to `score_jobs.ts` / `rank_jobs.ts`).
- **Include/preferred keywords**: only `excluded_keywords` exists; an "included keywords" affinity list would be a new model field.
- **Automation fields** (`auto_search_enabled`, `search_frequency_days`, `max_results_per_search`): belongs to a scheduled-search/automation checkpoint.
- **Salary normalization / currency conversion** across currencies (e.g. computing a PHP-equivalent for USD salaries): the brief says "no salary normalization yet".
- **Preferences preview of matching results** (live match count) — depends on matching existing (deferred).

---

## 18. Files Changed

**New:**
- `backend/app/models/preferences_schemas.py` — Pydantic schemas, validators, constants, honest-configured helper.
- `backend/app/routers/preferences.py` — GET/PUT `/api/preferences` router (ownership via `get_current_user()`).
- `backend/tests/test_preferences.py` — 26 tests (auth, empty state, persistence, normalization, validation, defaults/honesty, isolation).
- `backend/alembic/versions/0a7f3c2d15e8_add_salary_period_to_search_preferences.py` — additive migration (applied; dev DB at head).
- `frontend/src/hooks/usePreferences.ts` — `usePreferences` + `useUpdatePreferences`.
- `frontend/src/pages/Preferences.tsx` — the `/preferences` page.

**Modified:**
- `backend/app/models/database_models.py` — added `salary_period` column to `SearchPreferences`.
- `backend/app/main.py` — wired `preferences.router`.
- `backend/app/routers/dashboard.py` — honest `_search_preferences_configured` + `set_preferences` next-step now links to `/preferences`.
- `backend/tests/test_dashboard.py` — `set_preferences` assertion updated (now a real route).
- `frontend/src/api/types.ts` — preference types.
- `frontend/src/api/client.ts` — `getPreferences()` / `updatePreferences()`.
- `frontend/src/api/endpoints.ts` — `preferencesApi`.
- `frontend/src/App.tsx` — `/preferences` route.
- `frontend/src/components/layout/Sidebar.tsx` — "Search Preferences" nav entry + icon.
- `frontend/src/pages/Dashboard.tsx` — Search preferences readiness row links to `/preferences`.

**Data:** `careerpilot.db` migrated to `0a7f3c2d15e8` (additive, data preserved).

**Not touched (pipeline boundary):** discovery/scraping, canonicalization, hard filter, verification, scoring, ranking (`score_jobs.ts`, `rank_jobs.ts`), retention, job JSON/CSV pipeline, CLI.

---

## 19. Final Checkpoint Status

**CHECKPOINT 6 VALIDATED — READY FOR CHECKPOINT 7**

All 13 primary objectives met; scope boundary respected; preferences are pure user-intent (never populated from resume/profile/jobs); ownership enforced via `get_current_user()`; cross-user isolation tested; the one justified schema change shipped with a proper data-preserving Alembic migration; dashboard readiness is honest; 128/128 backend tests pass; frontend builds clean; live API + vite proxy smoke green.