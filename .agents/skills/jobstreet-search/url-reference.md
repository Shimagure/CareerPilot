# JobStreet Philippines URL & parsing reference

The endpoints, parameters, and markup anchors this skill depends on. This is the
file to update if JobStreet's (SEEK's) markup changes — a degraded search or a
broken parser will usually trace back to one of the anchors below.

## Base URLs

| Purpose | URL |
|---------|-----|
| Search | `https://ph.jobstreet.com/jobs` |
| Detail | `https://ph.jobstreet.com/job/<numeric-id>` |

## Search parameters (`GET /jobs`)

| Param | Maps to CLI flag | Notes |
|-------|------------------|-------|
| `keywords` | `--query` / `-q` | Keyword full-text search. |
| `location` | `--location` / `-l` | Soft, ranked location filter (SEEK ranks matching postings first; it does not hard-exclude the rest). |
| `page` | `--page` | 1-indexed page. 30 results per page. |

`--jobage` and `--limit` are applied client-side and have no URL param.

## Parsing anchors (search page)

The search page is SSR HTML with SEEK's `data-automation` attributes. Cards live in
`<article data-testid="job-card" data-job-id="<id>">` elements. The parser splits
the page on `data-job-id="` and parses each chunk independently.

| Field | Anchor | Example |
|-------|--------|---------|
| `id` | `data-job-id="<digits>"` (article attr) | `93878544` |
| `title` | `data-automation="jobTitle"` inner text | `IT STAFF` |
| `company` | `data-automation="jobCompany"` inner text | `Law Firm of E.B. Astudillo and Associates` |
| `location` | `data-automation="jobCardLocation"` inner text | `Makati City, Metro Manila` |
| `salary` | `data-automation="jobSalary"` inner text | `₱30,000 per month` |
| `teaser` | `data-automation="jobShortDescription"` inner text | short description snippet |
| `dateLabel` | `>Listed <text></div>` just above the title block | `Listed 3 days ago` |
| `url` | derived: `https://ph.jobstreet.com/job/<id>` | — |

`date` is derived from `dateLabel` via the relative-date parser (`relativeDaysAgo`
in `cli/src/helpers.ts`): "today" → 0 days, "yesterday" → 1, "N day(s) ago" → N,
word numbers ("twelve hours ago") supported for small values. Unparseable labels
yield `date: null` and the card is kept (date-unknown pass).

## Parsing anchors (detail page)

`GET /job/<id>` is also SSR. The parser reads these `data-automation` attributes:

| Field | Anchor |
|-------|--------|
| `title` | `data-automation="job-detail-title"` |
| `company` | `data-automation="advertiser-name"` |
| `location` | `data-automation="job-detail-location"` |
| `salary` | `data-automation="job-detail-salary"` |
| `workType` | `data-automation="job-detail-work-type"` |
| `classifications` | `data-automation="job-detail-classifications"` |
| `description` | inner HTML of `data-automation="jobAdDetails"` div (tags stripped, block tags → newlines) |
| `applyUrl` | `href` of the `data-automation="job-detail-apply"` element |

## Parsing notes

- Fetch uses a browser-ish User-Agent (`Chrome/126`), `Accept-Language: en-US`, and
  exponential backoff with jitter on 429/5xx (max 6 retries). SEEK may rate-limit
  aggressive clients; keep volume low.
- The page is minified single-line HTML in places — count matches with
  `split(...).length - 1`, never `grep -c` (line-based) when debugging.
- HTML entities (`&amp;`, `&#39;`, numeric refs) are decoded; tags are stripped with
  block tags (`</p>`, `</li>`, etc.) mapped to newlines for the description.
