---
name: jobstreet-search
version: 1.0.0
description: >
  Use this skill to search live job listings on JobStreet Philippines
  (ph.jobstreet.com, a SEEK product) — the largest general PH job board — or to
  look up a specific posting. Covers PH IT/BPO/service-desk roles across Metro
  Manila and beyond. Trigger phrases: find a job, job search, jobstreet jobs,
  PH job openings, Philippine vacancies, "are there any X jobs in Metro Manila".
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/jobstreet-search/cli/src/cli.ts *)
---

# JobStreet (PH) Search Skill

Search live job listings from **[JobStreet Philippines](https://ph.jobstreet.com)** —
the largest general PH job board — from public search pages. No authentication, no
API key, and **zero runtime dependencies** — it runs with just `bun`.

> This is a market-specific portal skill for the Philippine job market. Like the
> other portal CLIs, it is auto-discovered by `/scrape` and scoped to PH postings.

## ⚠️ Personal use only

This uses JobStreet's public job pages (SEEK). Automated access is against SEEK's
Terms of Service, so **keep volume low and don't use it commercially or for bulk
data collection.** Run it on your own responsibility.

## When to use this skill

- Search for PH job openings by keyword, optionally filtered to a location (e.g. Metro Manila)
- Filter by recency (listed within the last N days)
- Get the full description of a specific JobStreet posting

## Commands

### Search job listings

```bash
bun run .agents/skills/jobstreet-search/cli/src/cli.ts search [-q "<keywords>"] [-l "<location>"] [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword search (title, skill, role). Recommended.
- `--location <text>` / `-l <text>` — location filter. This is a **soft, ranked**
  filter (SEEK sorts matching postings first rather than hard-excluding the rest),
  so results outside the requested area may still appear — apply the Location
  Filter in `search-queries.md` when evaluating.
- `--jobage <days>` — only postings **listed within N days** (e.g. `14`). This is
  filtered client-side from the card's relative listing label.
- `--page <n>` — 1-indexed page. 30 results per page.
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/jobstreet-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the numeric job ID from `search` results (e.g. `93878544`). You may also
pass a full `https://ph.jobstreet.com/job/<id>` URL. Returns the full description,
company, location, salary, work type, classifications, and apply link.

## Usage examples

```bash
# IT Support roles in Metro Manila, listed in the last 14 days
bun run .agents/skills/jobstreet-search/cli/src/cli.ts search -q "IT Support" -l "Metro Manila" --jobage 14 --format table

# Service desk roles anywhere in the PH
bun run .agents/skills/jobstreet-search/cli/src/cli.ts search -q "service desk" --format table

# Systems administrator roles, table view
bun run .agents/skills/jobstreet-search/cli/src/cli.ts search -q "systems administrator" -l "Makati" --format table

# Full details for a specific job
bun run .agents/skills/jobstreet-search/cli/src/cli.ts detail 93878544 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Data is from JobStreet's public SSR search pages — no credentials required.
- Each card carries `id`, `title`, `company`, `location`, `salary`, `date` (an ISO
  date derived from the relative listing label, `null` when unparseable),
  `dateLabel` (the raw relative text, e.g. "Listed 3 days ago"), `teaser`, and `url`.
- The `--jobage` filter runs client-side; a card whose listing label is unparseable
  is kept (treat "date unknown" as pass, per the Date Filter rule).
- The CLI retries 429/5xx with exponential backoff. Keep volume low (ToS note above).
- `--location` is a soft filter — verify actual job locations against
  `search-queries.md`'s Location Filter when evaluating.
