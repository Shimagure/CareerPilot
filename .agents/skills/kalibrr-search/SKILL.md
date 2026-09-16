---
name: kalibrr-search
version: 1.0.0
description: >
  Use this skill to search live job listings on Kalibrr Philippines
  (kalibrr.com) — a major PH job board — or to look up a specific posting. Covers
  PH IT/BPO roles across Metro Manila and beyond. Trigger phrases: find a job, job
  search, kalibrr jobs, PH job openings, Philippine vacancies, "are there any X
  jobs in Metro Manila".
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/kalibrr-search/cli/src/cli.ts *)
---

# Kalibrr (PH) Search Skill

Search live job listings from **[Kalibrr](https://www.kalibrr.com)** — one of the
Philippines' major job boards — from its public job-board pages. No authentication,
no API key, and **zero runtime dependencies** — it runs with just `bun`.

> This is a market-specific portal skill for the Philippine job market. Like the
> other portal CLIs, it is auto-discovered by `/scrape` and scoped to PH postings.

## When to use this skill

- Search for PH job openings by keyword (scoped to Kalibrr's Technology/IT board)
- Filter by recency (activated within the last N days) or location (client-side)
- Get the full description, qualifications, salary, and apply link of a posting

## Commands

### Search job listings

```bash
bun run .agents/skills/kalibrr-search/cli/src/cli.ts search -q "<keywords>" [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword search (title, skill, role). **Required.**
  Searches Kalibrr's Technology/IT board (`/job-board/te/<query>`).
- `--location <text>` / `-l <text>` — client-side location filter, substring match
  on each job's city/region (e.g. `-l "Quezon City"`, `-l "Metro Manila"`).
- `--jobage <days>` — only postings activated within N days (client-side).
- `--limit <n>` / `-n <n>` — cap results emitted (client-side). Default 15.
- `--format json|table|plain` — default `json`.

> **Server-side scope.** Kalibrr's job-board page server-renders only the top ~15
> matches for a query (pagination happens client-side in the browser), so `search`
> returns those top-ranked results. Use varied queries to cover different roles
> rather than relying on deep pages.

### Fetch full job detail

```bash
bun run .agents/skills/kalibrr-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the numeric job ID from `search` results (e.g. `269864`). You may also pass
a search-result URL (`https://www.kalibrr.com/c/<company>/jobs/<id>/<slug>`).
Returns the full description, qualifications, company, location, salary, tenure,
function, work-experience, application deadline, remote flag, and apply link.

## Usage examples

```bash
# IT Support roles activated in the last 14 days
bun run .agents/skills/kalibrr-search/cli/src/cli.ts search -q "IT Support" --jobage 14 --format table

# Service desk roles in Quezon City
bun run .agents/skills/kalibrr-search/cli/src/cli.ts search -q "service desk" -l "Quezon City" --format table

# Systems administrator roles, table view
bun run .agents/skills/kalibrr-search/cli/src/cli.ts search -q "systems administrator" --format table

# Full details for a specific job
bun run .agents/skills/kalibrr-search/cli/src/cli.ts detail 269864 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Data is from Kalibrr's public job-board SSR (search) and its public JSON detail
  endpoint (detail) — no credentials required.
- Each card carries `id`, `title`, `company`, `location`, `salary`, `date`
  (activation date, ISO), `deadline` (application deadline, ISO), and `url`.
- `--jobage` and `--location` run client-side; a card whose activation date is
  missing is kept (treat "date unknown" as pass, per the Date Filter rule).
- The CLI retries 429/5xx with exponential backoff. Keep volume low.
