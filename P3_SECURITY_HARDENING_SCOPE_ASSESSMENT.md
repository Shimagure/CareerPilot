# P3 — Security Hardening Scope Assessment

**Project:** CareerPilot (`ai-job-search`)
**Scope:** READ-ONLY assessment of the actual repository code. No files were modified; nothing was committed or pushed.
**P1 status:** CLOSED (public/private data boundary). **P2 status:** CLOSED (production configuration). This report is the checkpoint that precedes any P3 implementation and defines what P3 will cover.
**Method:** Direct inspection of the current source (backend `app/`, routers, services, frontend `src/`) plus the existing security test suite. Every finding below cites the exact file and behavior observed. Nothing is asserted "because a report says so."

---

## 1. Executive summary

CareerPilot's security posture at the P3 gate is **strong on the authorization and input-handling side and weak on the abuse-limiting side**. The codebase already has the hard structural controls (verified below): a genuine public/private data boundary with no runtime `demo=true` toggle, authenticated real-data routes, admin-role gating, per-user object ownership checks (no IDOR/BOLA found), conservative LaTeX escaping plus arg-array subprocess execution, allowlisted CLI flags, an SSRF-guarded admin URL analyzer, and strict production configuration validation.

What P3 must add — and what is currently **absent** in the code — is concentrated in four gaps:

1. **No rate limiting anywhere** (no `slowapi`/`limits` dependency exists) on login, register, portal-search triggers, or document generation, combined with **open self-service registration**.
2. **No resource quotas / cooldowns** on the two most expensive authenticated operations, and a **single global search-run lock** that one user can hoard — a real-world DoS and abuse vector on a public deployment.
3. **Interactive API docs exposed to unauthenticated users** (`/docs`, `/redoc`, `/openapi.json` all enabled; the root endpoint even advertises `/docs`).
4. **Session/transport hygiene is incomplete**: JWT lives in `localStorage` with no revocation story, and no security-response headers (CSP, `X-Content-Type-Options`, etc.) are set at the app layer.

There are **no CRITICAL findings** and no cross-user data-access vulnerability found. The recommended P3 exit is gated on the alias row in Section 13: the HIGH item (unquota'd expensive endpoints + open signup + global lock) is the only true public-launch blocker; everything else is launch-worthy hardening or post-launch improvement.

---

## 2. Current security architecture (as built, not as documented)

| Layer | Mechanism | Evidence |
|---|---|---|
| Transport/config | `Settings` from pydantic-settings; `validate_production_config()` runs at startup and **rejects** the default secret, wildcard CORS-with-credentials, and a relative SQLite path **when `environment=production`** | `backend/app/config.py:81-105`, `backend/app/main.py:24-30` |
| Password storage | bcrypt (`hash_password`/`verify_password`) | `backend/app/auth.py` |
| Session | Stateless JWT (HS256, jose). 30-min TTL default. Token carries `sub` (user id) + `role` claim | `backend/app/auth.py`, `backend/app/config.py:29` |
| AuthN dependency | `get_current_user`: Bearer-scheme parse → `decode_token` → `sub` present → User exists → **DB re-check of `status == ACTIVE` on every request** | `backend/app/routers/auth.py:20-80` |
| AuthZ dependencies | `get_current_admin_user` enforces `role == ADMIN` else 403 | `backend/app/routers/auth.py:83-92` |
| Object isolation | All user-scoped queries filter `user_id == current_user.id`; foreign-owner reads return **404** (existence non-leak) | `backend/app/routers/applications.py` `_get_owned`; saved_jobs/profile/preferences/resume/search routers |
| Global data | Job/pipeline data is deliberately shared across all **authenticated** users (single-user product fact); not treated as an IDOR | `backend/app/routers/jobs.py` etc. |
| Public plane | `public.py` + `demo.py` serve only `demo_store.py` (reads `backend/demo_data/*`); no real-store import; demo reset explicitly does **not** invalidate the real store | `backend/app/demo_store.py`, `backend/app/routers/demo.py:83`, `backend/app/main.py:58,65` |
| Documents (LaTeX) | `_escape_latex`, filename sanitization `[A-Za-z0-9_-]`, `create_subprocess_exec` (no shell), temp-dir compile, 120 s timeout, pypdf 1-page validation; only verified candidate profile data feeds generation (CP13 gate) | `backend/app/services/document_generator.py`, `backend/app/services/application_assistant.py` |
| External commands | Allowlisted portal CLI paths, `ALLOWED_FLAGS` allowlist, argv-array construction, `validate_search_term` (rejects shell-active chars / leading `-` / empty), 180 s timeout, sequential execution | `backend/app/services/pipeline_adapter.py`, `backend/app/validation.py` |
| Admin SSRF | `analyze_url` blocks loopback/private/link-local/CGNAT IPs and metadata hostnames; manual redirect validation (max 3) | `backend/app/routers/admin_sources.py` (§ "SSRF protection"), `_analyze_source` |
| Uploads | Filename sanitized (no path separators), magic-byte check (`%PDF-`, OOXML zip parts), 10 MB streaming cap, per-user dirs, atomic write, `resolve()` guard | `backend/app/storage.py`, `backend/app/routers/resume.py` |
| Download path guard | `_DOCUMENT_KIND_FIELD` allowlist + `Path.is_relative_to(data/generated)` refusal | `backend/app/routers/applications.py` |
| Frontend XSS baseline | React escapes text by default; `whitespace-pre-wrap` renders `job.description` as text; **no** `dangerouslySetInnerHTML`/`innerHTML`/`document.write` in `frontend/src` (grep-verified) | `frontend/src/pages/JobDetail.tsx:257`, grep |

**What is NOT present (the P3 gap):**
- No rate limiter / throttle dependency (confirmed absent from `requirements.txt:1-4` and no usage anywhere in `app/`).
- No per-user quota or cooldown on `/api/search` or `/api/applications/with-documents`.
- No security-response headers middleware; CORS is the only middleware in `main.py:49-55`.
- No docs disablement: `FastAPI(...)` at `main.py:37-42` leaves `/docs`, `/redoc`, `/openapi.json` at defaults.
- No audit logging of auth or admin events.

---

## 3. Findings by area

### Area 1 — API documentation exposure — **MEDIUM (M1)**

`app/__main__` at `backend/app/main.py:37-42` builds `FastAPI(title=..., version=..., lifespan=...)` with **no `docs_url=None`, `openapi_url=None`, or `redoc_url=None`**. `/docs`, `/redoc`, and `/openapi.json` are therefore live and **unauthenticated**. The root endpoint explicitly advertises them: `backend/app/main.py:104` returns `"docs": "/docs"`.

Impact: anyone can enumerate every endpoint, request/response schema, model field, and router prefix without logging in — a free reconnaissance map and attack-surface inventory. It does not itself leak data (the underlying endpoints still enforce auth), so this is enumeration/disclosure, not data disclosure.

Fix direction (P3): disable docs in production (`docs_url=None` when `settings.is_production`) or gate the routes behind `get_current_admin_user` in development/staging too.

### Area 2 — Authentication & rate limiting — **HIGH (H1), MEDIUM (M2)**

`POST /api/auth/register` (`backend/app/routers/auth.py:95-130`) and `POST /api/auth/login` (`:133-163`) have **no rate limiting, account lockout, captcha, or client-IP throttle**. Registration is fully open and self-service; a new user is created with `role=USER`, `status=ACTIVE`, and an access token in one request.

Impact:
- Online password brute-force / credential stuffing against login (bcrypt slows each guess, but there is no throttle, so a distributed attempt is feasible; there is also no lockout on repeated failures).
- Open-signup amplification: nothing prevents a script from minting accounts, which then unlocks every authenticated-but-abusive feature below.

The auth dependency itself is sound: `get_current_user` (`auth.py:20-80`) re-validates the token and re-checks the DB row's `status == ACTIVE` per request, returns 401 on bad/expired tokens, and `get_current_admin_user` (`:83-92`) enforces the role claim against the **database** (not the token claim) — so demotion takes effect immediately and there is no role-escalation path via a forged claim without the signing secret.

### Area 3 — JWT storage & session security — **MEDIUM (M3)**

- Access token stored in `localStorage` under `careerpilot_token` (`frontend/src/context/AuthContext.tsx`, read in `frontend/src/api/client.ts:19`). Any same-origin XSS (or a supply-chain-injected script, or another app on the same origin) can exfiltrate it; it is not `HttpOnly`/Secure.
- Stateless JWT: no refresh-token rotation, no blacklist/revocation. Logout (`auth.py:166-171`) only tells the client to delete the token. A **password change does not invalidate previously issued tokens** until their 30-min TTL lapses.
- Positive: a deactivated account is locked immediately because every request re-reads `status` from the DB (`get_current_user` `:73-78`), and `./me` recovers `role` from DB too. The residual risk is token theft, not stale-session staleness.

Fix direction (P3): for production, prefer a Secure+HttpOnly cookie session (or at minimum stop storing bearer tokens in `localStorage`); add server-side token-shortlist/deny on password change; keep the 30-min TTL.

### Area 4 — Authorization & account isolation (IDOR/BOLA) — **LOW (residual)**

Strong and verified:
- All user-owned resources are queried with a `user_id` predicate derived from the JWT sub.
- `applications.py` `_get_owned(session, user_id, app_id)` returns **404** for a foreign owner — serial/UUID enumeration leaks nothing.
- Document download re-checks ownership, then `_DOCUMENT_KIND_FIELD` allowlist, then refuses any path not `Path.is_relative_to(data/generated)` — traversal-guarded.
- Admin routes (`/api/admin/sources`, `/api/admin/users`) are behind `get_current_admin_user`; a regular user gets 403 ("Admin privileges required"), verified by `test_security_boundary.py:274-296` and `test_rbac_auth.py:221-238`.

No cross-user data access was found. The job/pipeline dataset is intentionally shared among all authenticated users (product design), so it is not an IDOR. Residual work is not a control fix but coverage: object-level tests for *every* per-user endpoint asserting 404-on-foreign-owner, to lock the isolation in.

### Area 5 — HTML / scraped-content safety (XSS) — **LOW (L1)**

- Rendering is safe by construction: React escapes text, `job.description` is rendered with `whitespace-pre-wrap` (`JobDetail.tsx:257`), and there is **no `dangerouslySetInnerHTML`, `innerHTML`, or `document.write`** anywhere in `frontend/src` (grep-verified).
- Residual: `job.url` is bound directly into `<a href={job.url} target="_blank" rel="noopener noreferrer">` (`JobDetail.tsx:224`) with **no scheme allowlist**. The description body is untrusted scraped text; while description text cannot inject HTML under React, a **`javascript:`/`data:` URL in the scraped `url` field** would be rendered into a live `href`. This affects any Anchor rendering a pipeline-controlled `url` (job links, profile `linkedin_url`/`portfolio_url`).
- Severity is LOW today because text rendering is escaping-safe and no sink exists; the fix is a shared URL-scheme validator (`http`/`https` only) applied at render or ingest.

### Area 6 — LaTeX / document generation (CP13) — **LOW (residual)**

Controls verified in `backend/app/services/document_generator.py`:
- `_escape_latex` escapes `\ & % $ # _ { } ~ ^` (backslash first — correct ordering).
- `generate_cv`/`generate_cover_letter` sanitize `job_name` to `[A-Za-z0-9_-]`; `job_title`/`company` are escaped when injected.
- `_compile_latex`: `asyncio.create_subprocess_exec(..., [lualatex/xelatex, ...])` — arg array, **no shell**; per-run temp dir; 120 s timeout; pypdf page-count check (1 page enforced).
- CP13 gate: only candidate-profile truth feeds generation; no arbitrary user LaTeX is ever accepted. `application_assistant.py` builds `base_name` from company/title/`job_stable_id`.

Residual verification items to include in P3 tests (not confirmed defects): confirm no portal/user string reaches a LaTeX verbatim/URL command path unescaped; confirm field length caps bound worst-case compile input. No injection sink was found.

### Area 7 — Subprocess / command input validation — **LOW (residual)**

Verified in `backend/app/services/pipeline_adapter.py`:
- Portal CLIs are **pinned allowlisted absolute paths** (`PORTAL_CLIS`).
- `ALLOWED_FLAGS` allowlist (`-q`, `-l`, `--jobage`, `--limit`, `--format`); `_build_cli_args` returns an argv array.
- `_validate_argument_list` enforces `validate_search_term` (`backend/app/validation.py`): rejects the shell-active set `;&|`$<>(){}[]'"\#~!*?=`, leading `-`, and empties.
- `create_subprocess_exec` is used — no `shell=True`, `os.system`, or `subprocess.Popen(shell=...)` anywhere in `app/` (grep-verified). `job_sync.py` is subprocess-free and validates `stable_id` with `^[0-9a-fA-F]{64}$`.

Command-injection is effectively closed. Residual is defense-in-depth (strict input-length caps and a unit test asserting `validate_search_term` rejects each shell char).

### Area 8 — Operational error leakage — **LOW (L2)**

- FastAPI has no custom exception handlers registered (`grep "exception_handler"` → none), so unhandled errors return the generic 500 with no stack/detail (FastAPI's default client-facing body is `{"detail": "Internal Server Error"}`), and exceptions are not forwarded.
- Leak surface found: `SearchRunManager` composes `pipeline_error = f"Execution error: {type(e).__name__}: {e}"` (`backend/app/services/search_manager.py`), surfaced to an **authenticated** user who triggered the run. The exception text can include filesystem paths or internal message details.

Fix direction (P3): return a fixed, non-informative error string to the client and log the full exception server-side.

### Area 9 — Document-generation abuse / resource limits — **HIGH (H1)**

- `POST /api/applications/with-documents` (`backend/app/routers/applications.py`) triggers **one or two full LaTeX compiles per call** (lualatex CV + xelatex cover letter). Any authenticated user can call it repeatedly with no per-user quota or cooldown.
- `POST /api/search` (`backend/app/routers/search.py`) triggers a **portal scrape via the CLI** — the most expensive operation in the app — with no quota (grep confirms only pagination caps, `MAX_PAGE_LIMIT`).
- `SearchRunManager.start_run` enforces a **single global active run** (`status in (QUEUED, RUNNING)` → 409). This bounds concurrency but is itself an abuse surface: one user (or the open-signup bot farm from H1) can start a scrap, and **every other user is blocked until it finishes or times out** — a trivial denial of service using the app's own features.

Combined with open registration (Area 2), this is the report's **one HIGH**: an unauthenticated-signup + unquota'd-expense + shared-global-lock combination that permits resource exhaustion and feature-DoS on a public deployment.

### Area 10 — Other material P3 risks — **MEDIUM (M4: SSRF gap), LOW (M5 headers, L3 audit)**

- **Admin SSRF — mostly closed, one gap.** `analyze_url` blocks loopback/private/link-local/CGNAT IPv4+IPv6 ranges and cloud-metadata hostnames, requires `http/https`, and manually validates redirects (max 3) — an unusually complete guard, tested in `test_rbac_auth.py:377-503`. Residual: **DNS rebinding** (a hostname validated as a public IP at check time re-resolves to a private IP at fetch time) has no countermeasure (no re-resolution pinning, no egress allowlist). Admin-only trigger → MEDIUM.
- **Security headers.** `main.py` registers CORS only (`:49-55`). No `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, or `Referrer-Policy` at the app layer; `Strict-Transport-Security` is assumed delegated to the reverse proxy (per `.env.example` checklist). LOW at the app layer, but recommended before a public web deployment.
- **Audit logging (L3).** No auth-event or admin-mutation logging exists. Improvement, not a defect.
- **Demo plane.** `/api/demo/*` GET endpoints are intentionally unauthenticated (`backend/app/routers/demo.py`), but they serve only `demo_store` data — verified isolated (see Section 12). Keep them demo-only; do not repoint to real data.

---

## 4. Severity summary

| ID | Severity | Area | Finding |
|---|---|---|---|
| H1 | **HIGH** | 2, 9 | Open self-service signup + no rate limiting + unquota'd expensive endpoints (`/api/search`, `/api/applications/with-documents`) + single global search-run lock → resource exhaustion / feature-DoS. The only public-launch blocker. |
| M1 | MEDIUM | 1 | `/docs`, `/redoc`, `/openapi.json` enabled and unauthenticated; root advertises `/docs`. |
| M2 | MEDIUM | 2 | No rate limiting / lockout on login and register. |
| M3 | MEDIUM | 3 | JWT in `localStorage`; no revocation on password change; logout client-side only. |
| M4 | MEDIUM | 10 | Admin `analyze_url` SSRF guard has a DNS-rebinding gap and no egress allowlist. |
| M5 | MEDIUM | 10 | No security-response headers (CSP, X-Content-Type-Options, X-Frame-Options) at the app layer. |
| L1 | LOW | 5 | Pipeline-controlled URLs rendered into `href` with no `http/https` scheme allowlist. |
| L2 | LOW | 8 | `pipeline_error` may surface exception text to an authenticated user. |
| L3 | LOW | 10 | No audit logging of auth/admin events. |
| — | None | 4, 6, 7 | No CRITICAL findings; IDOR/BOLA clean; LaTeX injection and command injection effectively closed. |

---

## 5. Evidence index (file → observed behavior)

- `backend/app/main.py:37-42,49-55,58-74,98-106` — FastAPI without docs disable; CORS-only middleware; router inclusion map (PUBLIC/PRIVATE/ADMIN/INTERNAL comments); root exposes `/docs`.
- `backend/app/config.py:81-105` — `validate_production_config` (rejects default secret, wildcard CORS+credentials, relative SQLite path; active only when `environment=production`).
- `backend/app/routers/auth.py:20-80` — `get_current_user` (Bearer parse, decode, `sub`, DB existence + `ACTIVE` per request); `:83-92` admin role check (DB role); `:95-163` register/login **no rate limit**; `:166-171` stateless logout.
- `backend/app/routers/applications.py` — `_get_owned` 404-for-foreign; `download_application_document` re-check + `_DOCUMENT_KIND_FIELD` + `Path.is_relative_to`; `with-documents` triggers LaTeX (no quota).
- `backend/app/services/document_generator.py` — `_escape_latex`, filename `[A-Za-z0-9_-]`, `create_subprocess_exec`, temp-dir, 120 s timeout, pypdf 1-page check.
- `backend/app/services/pipeline_adapter.py` — pinned `PORTAL_CLIS`, `ALLOWED_FLAGS`, argv-array, 180 s timeout, sequential.
- `backend/app/validation.py` — `SHELL_UNSAFE_CHARS`, `validate_search_term`.
- `backend/app/services/search_manager.py` — single-global-run lock (409); `pipeline_error` builds exception text.
- `backend/app/routers/search.py:123,131,150` — only pagination caps; no quota/cooldown.
- `backend/app/routers/admin_sources.py` — SSRF blocklist (§ "SSRF protection"); `httpx.Limits(max_connections=1)`.
- `backend/app/demo_store.py` / `backend/app/routers/demo.py:83` — demo reads `demo_data/*`; demo reset does **not** invalidate real store.
- `frontend/src/context/AuthContext.tsx` — `TOKEN_KEY='careerpilot_token'`, `localStorage`.
- `frontend/src/api/client.ts:19,40-47` — token injection; 401 → token removal + `careerpilot:unauthorized`.
- `frontend/src/pages/JobDetail.tsx:224,257` — `href={job.url}` unsanitized scheme; description rendered as escaped text.
- `backend/requirements.txt:1-4` — no rate-limit dependency present.
- Tests: `backend/tests/test_security_boundary.py` (P1 boundary), `backend/tests/test_rbac_auth.py` (RBAC + SSRF suite).

---

## 6. Existing protections to preserve (do not regress in P3)

P3 work must **not** weaken or remove:

1. **P1 structural boundary** — `public.py`/`demo.py` serve only `demo_store`; real-data routers are authenticated; **no runtime `demo=true` toggle**; demo reset never touches the real store (`demo.py:83`; `test_security_boundary.py` `TestDemoDataIsolation`/`TestDataStoreSeparation`).
2. **P2 production config** — startup validation (default-secret, wildcard-CORS, relative-SQLite rejects), CORS allowlist semantics, `.env` production checklist (`.env.example`). Never bypass with `--no-verify`-style shortcuts.
3. **Admin role gating** — DB-backed role check (`get_current_admin_user`), 403 for non-admins.
4. **Per-user object isolation** — 404-on-foreign-owner pattern everywhere.
5. **LaTeX/subprocess controls** — `_escape_latex`, filename sanitization, `create_subprocess_exec` arg arrays, allowlisted flags, timeouts, pypdf page check, CP13 factual gate.
6. **Upload/download guards** — magic-bytes + size cap + atomic per-user storage; `is_relative_to` traversal refusal.
7. **SSRF blocklist + redirect validation** in `admin_sources.py` (P3 adds rebinding/egress on top; do not remove the existing block).
8. **Anti-fabrication / candidate-truth compliance** — CP13 gate must remain intact while adding rate limits.

---

## 7. Recommended P3 scope

Ordered by risk reduction (each item maps to an ID above):

- **P3-R1 (H1/M2)** — Add a rate limiter and enforce it on: `POST /api/auth/login`, `POST /api/auth/register` (per-IP + per-account on login), `POST /api/search` and its run-triggered work (per-user cooldown + daily cap), and `POST /api/applications/with-documents` (per-user daily cap on LaTeX compiles). Add repeated-failure lockout (sliding window) to the auth dependency.
- **P3-R2 (H1)** — Hardening of the global search-run lock: enforce a max run duration (kill + release the lock on timeout/failure), add per-user concurrency (one run per user), and surface a clean "another run in progress" 429/409 that never blocks unrelated endpoints.
- **P3-R3 (M1)** — Disable docs in production: `docs_url=None`/`redoc_url=None` when `settings.is_production` (or gate behind admin role). Keep a dev convenience.
- **P3-R4 (M5)** — Add security-response headers middleware: `Content-Security-Policy` (frontend), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`; document `Strict-Transport-Security` for the proxy.
- **P3-R5 (L1)** — Shared URL-scheme validator (`http`/`https` only) applied to every rendered `href` fed by pipeline/user data (job URL, LinkedIn/portfolio URLs), at render or ingest.
- **P3-R6 (L2)** — Error hygiene: fixed non-informative `pipeline_error` to the client; full exception logged server-side.
- **P3-R7 (M4)** — Close the admin SSRF DNS-rebinding gap: resolve host once, pin the validated IP for the fetch (short-window re-resolve + mismatch reject), or add an egress allowlist in front of the analyzer.
- **P3-R8 (M3)** — Token strategy decision + hardening: move to `HttpOnly`+`Secure` cookie session for production (or a documented mitigation while staying in `localStorage`), and add a server-side expiry bump on password change so changed passwords invalidate outstanding tokens.
- **P3-R9 (L3)** — Structured audit log (stderr/file): auth success/failure + admin mutations (source CRUD, user status/role changes), no secrets.

---

## 8. Explicitly deferred (NOT in P3)

- Full identity provider / SSO / OIDC / SAML; MFA/2FA (P3-R8's lockout work is groundwork, not MFA).
- Refresh-token infrastructure, token blacklist via Redis, or push-based revocation.
- Encryption at rest for the SQLite/Postgres data and uploaded resumes; secrets-vault integration (env-var management stays).
- Re-architecting JWT storage wholesale on the frontend beyond the P3-R8 decision.
- Changing the product decision that pipeline data is shared across all authenticated users (multi-tenancy is out of scope).
- Cloud/WAF/CDN-level hardening (rate limiting at a WAF, bot management) — P3 implements app-level limits that make the app correct regardless of hosting.
- **CP16.7 and any later checkpoint** — out of scope for P3 by definition; P3 and CP16.x are independent workstreams. Only start with explicit instruction.

---

## 9. Recommended checkpoint breakdown

A tight break-up that lands one independently-shippable, test-verifiable increment per checkpoint:

- **P3.1 — Abuse & rate limiting (HIGH first).** `slowapi` (or a small in-process token bucket) wired as a dependency usable on any route; policy defaults; enforced on login/register/search/with-documents; per-user + per-IP keying; login-failure lockout; search-run max-duration + per-user concurrency; quota failure responses (429). _Exit: no route in the class can be hammered past its quota in tests; lock releases on timeout._
- **P3.2 — API surface & transport hygiene.** Disable docs in production (or admin-gate); security headers middleware + proxy HSTS note; URL-scheme validator applied to all pipeline/user `href`s.
- **P3.3 — Error & audit & admin-SSRF closure.** Fixed client error strings; server-side full logging; audit log for auth/admin events; DNS-rebinding pin in `analyze_url` (+ egress route for the analyzer).
- **P3.4 — Session hardening & P1/P2/P3 regression gate.** Token-storage decision (cookie vs documented mitigation), password-change token invalidation; full security test suite run (existing `test_security_boundary.py` + `test_rbac_auth.py` + new P3 tests) green; exit criteria below met; no P1/P2 regressions.

Each checkpoint lands on its own commit with the Co-Authored-By attribution line.

---

## 10. P3 exit criteria

P3 is **complete** only when all of the following hold, verified by tests and by direct inspection:

1. **H1 closed:** register/login/search/with-documents are rate-limited and quota'd (429 above limits); open signup can no longer drive unbounded backend work; a single search run cannot DoS other users (max-duration + per-user concurrency).
2. **M1 closed:** in `environment=production`, `/docs`, `/redoc`, `/openapi.json` return 404 (or are admin-gated); dev behavior unchanged.
3. **M5 closed:** responses carry `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`; HSTS documented for the proxy.
4. **L1 closed:** no pipeline- or user-controlled URL renders through an unsanitized `href`; `javascript:`/`data:` schemes are rejected.
5. **L2 closed:** client-facing run errors contain no exception text or paths; full detail is server-logged.
6. **M4 advanced:** `analyze_url` rejects the DNS-rebinding case (pinned IP used for the fetch) and preserves all existing blocklist + redirect tests green.
7. **M3 decision made + implemented:** production token flow decided (HttpOnly cookie or documented mitigation) and password change invalidates outstanding tokens; logout still client-side-clean.
8. **L3 delivered:** structured audit logs for auth + admin mutations.
9. **Regression:** `test_security_boundary.py` (P1) and `test_rbac_auth.py` (RBAC/SSRF) remain green; frontend build passes; no tracked P1/P2 control removed.
10. **Documented:** this assessment's findings map 1:1 to P3.1–P3.4 commits; deferred list stays deferred.

---

## 11. Test strategy

- **Reuse existing patterns:** `test_security_boundary.py` (per-endpoint 401/403/200 matrix with `ASGITransport`) and `test_rbac_auth.py` (role gating + SSRF) are the templates for new `test_rate_limit.py`, `test_headers_docs.py`, `test_url_sanitization.py`, `test_error_hygiene.py`, `test_audit_log.py`.
- **Rate-limit tests:** hammer login/register/search/with-documents past the quota in-tests (a fast limiter under a short test window) and assert `429`/`Retry-After`; reset state between tests so the limiter doesn't bleed into other suites; keep a keyed (user+IP) test proving per-user isolation.
- **Docs/headers tests:** start the app with `environment=production` settings and assert `/docs`/`/redoc`/`/openapi.json` are not served, and `nosniff`/CSP present; assert the dev default still serves docs.
- **Search-lock tests:** start a run, assert a second run returns 409/429 (not hang), force the run task past its max duration and assert the lock is released and a subsequent run proceeds.
- **URL sanitizer tests:** table-driven — `javascript:`/`data:`/`vbscript:` rejected, `http/https` allowed, whitespace/control-char variations rejected.
- **SSRF rebinding test:** a host resolving to public at validate-time and private at fetch-time is rejected (simulate with a test DNS/mock fetcher).
- **LaTeX/subprocess retention tests:** keep `test_document_generator.py`/`test_application_assistant.py` green; add a case asserting `validate_search_term` rejects every `SHELL_UNSAFE_CHARS` char and that escaped LaTeX output stays balanced for adversarial strings.
- **Full regression:** entire `backend/tests/` suite + `frontend` build before each checkpoint close.

---

## 12. P1/P2 regression assessment (verified against current code)

**P1 — Structural public/private boundary: PASS (intact).**

- `backend/app/main.py:58-74` — router inclusion map: `public` (demo-only) and `demo` (GET plane + authenticated bootstrap/reset) are marked PUBLIC/INTERNAL; all real-data routers are marked PRIVATE; admin routers marked ADMIN.
- `public.py` serves only `demo_store` (`backend/app/demo_store.py`) which reads `backend/demo_data/*` (`demo_seen_jobs.json`, `demo_checkpoints.json`, `demo_tracker.csv`) — there is **no import of the real store** on the public path.
- `demo.py:83` explicitly removed `invalidate_store_cache()` — demo reset cannot touch real data; `test_security_boundary.py` `test_demo_reset_does_not_invalidate_real_store` asserts this.
- **No runtime `demo=true` toggle** exists — the boundary is structural (separate stores), not behavioral.
- Private real-data endpoints return 401 without auth and 200 with auth; admin endpoints 403 for regular users — exercised by `test_security_boundary.py` (`TestPrivateEndpointsRequireAuth`, `TestAdminEndpointsRequireAdminRole`).

No P1 regression found.

**P2 — Production configuration: PASS (intact).**

- `backend/app/config.py:81-105` — startup validation rejects, in production: default `SECRET_KEY`, wildcard CORS with credentials, relative SQLite path; wired at `main.py:24-30` (startup raise → process refuses to serve).
- `backend/app/config.py:29` `access_token_expire_minutes=30`; `:32` `cors_allowed_origins` comma-list semantics unchanged.
- `.env.example` still carries the production checklist (SECRET_KEY, explicit CORS, absolute/Postgres DATABASE_URL, HTTPS via reverse proxy, `.env` permissions).
- **Note:** no `.env` file is present in the working copy (only `.env.example`), so nothing is running in production mode here; the guards activate when `ENVIRONMENT=production` is set at deploy time. No P2 regression found.
- CP16.6 enabled-state bridge (`enabled_bridge.py`, `portal_registry.py`, `job_sync.py`) unchanged and intact; do not modify as part of P3.

---

## 13. Public-launch blockers vs post-launch improvements

**Block before public launch (must be closed by P3):**
1. **H1** — open signup + missing rate limits + unquota'd expensive endpoints + single global search-run lock (resource exhaustion / feature DoS).
2. **M1** — interactive API docs exposed to unauthenticated users on a public instance.
3. **M2/M5** — no login/register throttle/lockout; no security-response headers on the deployed origin.
4. **M3** — token-in-`localStorage` + no password-change invalidation (resolve before real users store real candidate data).
5. **L1** — `javascript:`-scheme `href` from scraped data (cheap to close; close it before it becomes a real account compromise).

**Post-launch (hardening, not launch-gating):**
6. **M4** — admin SSRF DNS-rebinding closure and egress allowlisting (admin-triggered; fix once admin source analysis is used in anger — still a P3.3 item).
7. **L2** — error-string hygiene / **L3** — audit logging (improvements; no data exposure found).
8. Anything in Section 8 (SSO, MFA, refresh-token infra, encryption at rest, vault, WAF).

---

*End of assessment. Intentional no-change request honored: this report is the only file written; no tracked files were modified, nothing committed, nothing pushed, and no P3/P4 implementation was started.*