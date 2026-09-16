---
name: indeed-search
version: 1.0.0
description: >
  Use this skill to search live job listings on Indeed Philippines
  (ph.indeed.com) — the largest global job board's PH market — or to look up a
  specific posting. Covers PH IT/BPO/service-desk roles across Metro Manila and
  beyond. Trigger phrases: find a job, job search, indeed jobs, PH job openings,
  Philippine vacancies, "are there any X jobs in Metro Manila".
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/indeed-search/cli/src/cli.ts *)
---

# Indeed (PH) Search Skill

Search live job listings from **[Indeed Philippines](https://ph.indeed.com)** — the
world's largest job board's PH market — from public search pages. No
authentication, no API key, and **zero runtime dependencies** — it runs with just
`bun`.

> This is a market-specific portal skill for the Philippine job market. Like the
> other portal CLIs, it is auto-discovered by `/scrape` and scoped to PH postings.

## ⚠️ Personal use only

This uses Indeed's public job pages. Automated access is against Indeed's Terms of
Service, so **keep volume low and don't use it commercially or for bulk data
collection.** Run it on your own responsibility.

## When to use this skill

- Search for PH job openings by keyword, optionally filtered to a location (e.g. Metro Manila)
- Filter by recency (listed within the last N days — enforced server-side)
- Get the full description of a specific Indeed posting

## Commands

### Search job listings

```bash
bun run .agents/skills/indeed-search/cli/src/cli.ts search [-q "<keywords>"] [-l "<location>"] [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword search (title, skill, role). Recommended.
- `--location <text>` / `-l <text>` — location filter. This is a **soft, ranked**
  filter (Indeed sorts matching postings first rather than hard-excluding the rest),
  so results outside the requested area may still appear — apply the Location
  Filter in `search-queries.md` when evaluating.
- `--jobage <days>` — only postings **listed within N days** (e.g. `14`). Applied
  **server-side** via Indeed's `fromage` param (card dates are client-rendered and
  absent from the page's server-rendered HTML).
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

**Page 1 only.** Indeed walls pagination behind a sign-in: `start=N` URLs redirect
anonymous visitors to an account page with no job cards. The CLI therefore never
requests page 2+ — results are the first page of matches for the query.

### Fetch full job detail

```bash
bun run .agents/skills/indeed-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the lowercase hex job `jk` from `search` results (e.g. `853646db09938fc2`).
You may also pass a full `https://ph.indeed.com/viewjob?jk=<id>` URL. Returns the
full description, company, location, salary, and apply link.

## Usage examples

```bash
# IT Support roles in Metro Manila, listed in the last 14 days
bun run .agents/skills/indeed-search/cli/src/cli.ts search -q "IT Support" -l "Metro Manila" --jobage 14 --format table

# Service desk roles anywhere in the PH
bun run .agents/skills/indeed-search/cli/src/cli.ts search -q "service desk" --format table

# Systems administrator roles, table view
bun run .agents/skills/indeed-search/cli/src/cli.ts search -q "systems administrator" -l "Makati" --format table

# Full details for a specific job
bun run .agents/skills/indeed-search/cli/src/cli.ts detail 853646db09938fc2 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Data is from Indeed's public SSR search page — no credentials required.
- Each card carries `id`, `title`, `company`, `location`, `salary`, `url`, and
  `date`/`dateLabel` both **`null`** — Indeed renders dates client-side, so there is
  no date in the server-rendered page. Recency is instead enforced server-side via
  `--jobage` (`fromage`).
- The CLI retries 429/5xx with exponential backoff. Keep volume low (ToS note above).
- `--location` is a soft filter — verify actual job locations against
  `search-queries.md`'s Location Filter when evaluating.
- Some search results are "promoted"/sponsored cards — the parser returns whatever
  cards appear; treat them as normal rows but be aware the count can include
  sponsored placements.
