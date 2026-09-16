# Indeed Philippines URL & parsing reference

The endpoints, parameters, and markup anchors this skill depends on. This is the
file to update if Indeed's markup changes — a degraded search or a broken parser
will usually trace back to one of the anchors below.

## Base URLs

| Purpose | URL |
|---------|-----|
| Search | `https://ph.indeed.com/jobs` |
| Detail | `https://ph.indeed.com/viewjob?jk=<jk>` |
| Detail (canonical) | `https://ph.indeed.com/job/<slug>-<jk>` — the page that actually serves SSR content |
| Apply redirect | `https://ph.indeed.com/rc/clk?jk=<jk>` — 302s to the canonical detail page |

## Search parameters (`GET /jobs`)

| Param | Maps to CLI flag | Notes |
|-------|------------------|-------|
| `q` | `--query` / `-q` | Keyword full-text search. |
| `l` | `--location` / `-l` | Soft, ranked location filter (Indeed ranks matching postings first; it does not hard-exclude the rest). |
| `fromage` | `--jobage` | Server-side recency filter: only postings listed within N days. |

`--limit` is applied client-side and has no URL param. There is **no `start`**
param: Indeed only renders page 1 for anonymous requests — `start=10` (page 2)
redirects to a "Sign In" account page with zero job cards. Do not attempt
pagination.

## Parsing anchors (search page)

The search page is SSR HTML. Each job card is a `<div class="job_seen_beacon">`
element. The parser splits the page on `data-jk="`'s enclosing beacon
(`<div class="job_seen_beacon">`) and parses each chunk independently.

| Field | Anchor | Example |
|-------|--------|---------|
| `id` | `data-jk="<hex>"` (card anchor attr) | `853646db09938fc2` |
| `title` | `id="jobTitle-<jk>"` `title` attribute | `IT Support Specialist` |
| `title` (fallback) | `aria-label="full details of <title>"` | `full details of IT Support Specialist` |
| `company` | `data-testid="company-name"` inner text | `Example Corp` |
| `location` | `data-testid="text-location"` inner text | `Makati City, Metro Manila` |
| `salary` | first `<span>` inside `data-testid="attribute_snippet_testid salary-snippet-container"` | `PHP18,000 - PHP20,000 a month` |
| `teaser` | `class="job-snippet"` inner text (may be null) | short description snippet |
| `date` | — | always `null` (client-rendered, absent from SSR) |
| `url` | derived: `https://ph.indeed.com/viewjob?jk=<id>` | — |

`id` is the `data-jk` value: 16 hex chars (Indeed occasionally serves
placeholder-looking values like `abcdef0123456789` for certain sponsored/test
cards — parse them like any other, they carry real title/company/location).
Cards whose `jk` or title cannot be extracted are skipped so one malformed card
cannot break the rest.

## Parsing anchors (detail page)

`viewjob?jk=` is behind a "Security Check" for anonymous clients, so the CLI
first follows `/rc/clk?jk=<id>` (302) to the canonical `/job/<slug>-<id>` page,
which serves full SSR content. That page embeds Emotion CSS-in-JS `<style>`
blocks inside content containers — the parser strips `<style>`/`<script>`
blocks before extracting text. The parser reads:

| Field | Anchor |
|-------|--------|
| `title` | `id="jobTitle"` (fallback: `<h1 class="...jobsearch-JobInfoHeader-title...">`) |
| `company` | `data-testid="inlineHeader-companyName"` (fallback `id="companyName"`) |
| `location` | `data-testid="inlineHeader-companyLocation"` |
| `salary` | first `<span>` inside `data-testid="jobsearch-JobMetadataHeader-item salary-snippet-container"` |
| `description` | inner HTML of `<div id="jobDescriptionText">` (nesting-aware; tags stripped, block tags → newlines) |
| `applyUrl` | `href` of `id="applyButtonLinkContainer"` (relative `/rc/clk?...` resolved to `https://ph.indeed.com/...`) |

The stored `url` on the returned detail is the canonical `/job/<slug>-<jk>`
URL (tracking params included), not the login-walled `viewjob` URL.

## Parsing notes

- Fetch uses a browser-ish User-Agent (`Chrome/126`), `Accept-Language: en-US`, and
  exponential backoff with jitter on 429/5xx (max 6 retries). Indeed may rate-limit
  aggressive clients; keep volume low.
- The page is minified single-line HTML — count matches with `split(...).length - 1`,
  never `grep -c` (line-based) when debugging.
- HTML entities (`&amp;`, `&#39;`, numeric refs) are decoded; tags are stripped with
  block tags (`</p>`, `</li>`, etc.) mapped to newlines for the description.
- A "Sign In | Indeed Accounts" title with zero `job_seen_beacon` markers means the
  request hit a login wall — a sign the page structure changed or pagination was
  requested; the parser returns no cards either way.
