# Kalibrr URL & parsing reference

The endpoints and response shapes this skill depends on. This is the file to
update if Kalibrr's markup or API changes — a broken search or detail will usually
trace back to one of the anchors below.

## Base URLs

| Purpose | URL |
|---------|-----|
| Search (Technology/IT board) | `https://www.kalibrr.com/job-board/te/<query>` |
| Detail (public JSON API) | `https://www.kalibrr.com/api/jobs/<numeric-id>` |
| Job page (canonical) | `https://www.kalibrr.com/c/<company-code>/jobs/<id>/<slug>` |

## Search (`GET /job-board/te/<query>`)

The `te` segment is Kalibrr's Technology/IT board; `<query>` is the URL-encoded
keyword text (spaces work as `%20`, e.g. `it%20support`). The page is Next.js SSR:
job data lives in the `__NEXT_DATA__` script tag at `props.pageProps.jobs`.

**Server-side scope:** the page renders only `filters.offset = 0` (the top ~15
matches). URL query params for pagination/`location`/`sort` are read by the client
router, not the SSR render, so they do **not** change the served HTML. The CLI
applies `--jobage`, `--location`, and `--limit` client-side on the served cards.

### Search job object (the fields the CLI reads)

```jsonc
{
  "id": 269864,                       // -> card.id
  "name": "IT Service Desk and Deskside Support Assistant", // -> card.title
  "slug": "it-service-desk-and-deskside-support-assistant",
  "companyName": "Ateneo de Manila University",
  "company": { "code": "ateneo-de-manila-university-1" },
  "googleLocation": { "addressComponents": { "city": "Quezon City", "region": "Metro Manila", "country": "Philippines" } },
  "activationDate": "2026-07-15T03:32:52Z",   // -> card.date (ISO date)
  "applicationEndDate": "2026-09-12T16:00:00Z", // -> card.deadline (ISO date)
  "salaryShown": true,
  "baseSalary": null, "maximumSalary": null,
  "salaryCurrency": null, "salaryInterval": null
}
```

Card `url` is built as `https://www.kalibrr.com/c/<company.code>/jobs/<id>/<slug>`.
Salary is rendered best-effort when `salaryShown` and a base/max value exist.

### Search-page extraction

`extractJobsFromNextData` in `cli/src/helpers.ts` extracts the
`__NEXT_DATA__" type="application/json">...` script and parses
`props.pageProps.jobs` (array). A missing blob or array yields `[]` (empty result),
never a throw.

## Detail (`GET /api/jobs/<numeric-id>`)

A public JSON endpoint returning the full job object. The CLI reads (snake_case):

| Field | Maps to |
|-------|---------|
| `name` | `title` |
| `company_name` | `company` |
| `google_location.formatted_address` / `.raw_string` | `location` |
| `description`, `qualifications` | `description`, `qualifications` (HTML stripped, block tags → newlines) |
| `base_salary`, `maximum_salary`, `salary_currency`, `salary_interval` | `salary` (rendered) |
| `activation_date`, `application_end_date` | `date`, `deadline` (ISO date) |
| `tenure`, `function`, `work_experience` | `tenure`, `function`, `workExperience` |
| `apply_redirect_url` | `applyUrl` |
| `is_work_from_home` | `isRemote` |

A `404` maps to `NOT_FOUND` on stderr.

## Parsing notes

- Fetch uses a browser-ish User-Agent (`Chrome/126`), `Accept-Language: en-US`, and
  exponential backoff with jitter on 429/5xx (max 6 retries).
- Search requests send an HTML `Accept` header; detail requests send
  `Accept: application/json`.
- HTML in `description`/`qualifications` is decoded with `<br>` and block-tag
  closings mapped to newlines, then tags stripped.
