# Search Queries for Job Scraper

## Master Baseline (MANDATORY)

**This search strategy operates under `MASTER_JOB_SEARCH_BASELINE.md`** — the permanent operating standard. Key baseline rules that apply:
- Target roles (Section 1): EUC, IT Support, Desktop Support, Technical Support, Service Desk, Tier 2/L2, Systems Administration, Cloud/Infrastructure, Endpoint/IT Security
- Work arrangement priority: remote → hybrid NCR → onsite NCR (if justified)
- Salary target: ₱30,000–45,000 gross/month (flexible for technical growth)
- Shift: day/night/rotational/weekend all acceptable
- Language: English (professional) + Filipino/Tagalog (native) — hard gate on undeclared languages
- Location: Philippines, NCR/Metro Manila focus
- Deduplication: check both job_search_tracker.csv AND job_scraper/seen_jobs.json

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Shipped country-agnostic CLIs include `linkedin-search` and `freehire-search`; Danish demos and any skill you add with `/add-portal` are included the same way. You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file below the "Primary" list are **supplementary WebSearch sources** — run proactively on every `/scrape` in parallel with the CLIs, not merely as a failure fallback. They cover portals with no CLI (client-rendered boards) and company career pages.

**Language scope:** Wilson works in English (professional working proficiency) and Filipino/Tagalog (native). Philippine IT postings are overwhelmingly written in English, so queries are written in English; a posting requiring Tagalog/Filipino as a job condition is a pass for Wilson. A posting requiring any language not in the CLAUDE.md Languages table is excluded before scoring — see `04-job-evaluation.md`'s Language Gate, the single source of truth for this rule.

## Search Sites

Primary (your market's job boards - scaffold one with `/add-portal`):
- **ph.jobstreet.com** - JobStreet Philippines, the largest general PH job board; covered by the `jobstreet-search` CLI
- **linkedin.com/jobs** - LinkedIn job listings (filter: Philippines / Metro Manila); covered by the `linkedin-search` CLI
- **ph.indeed.com** - Indeed Philippines; covered by the `indeed-search` CLI
- **kalibrr.com** - Kalibrr PH, growing PH tech/BPO board; covered by the `kalibrr-search` CLI
- **bossjob.ph** - BossJob PH, growing PH tech/BPO board; covered by the `bossjob-search` CLI

US remote boards (WebSearch fallback; relevant to Wilson only for remote-friendly postings):
- **builtin.com** - Built In, US tech/startup jobs board (no CLI - client-rendered; use `site:` queries below)
- **hiringcafe.com** - HiringCafe, US startup jobs aggregator (no CLI - fully client-rendered; use `site:` queries below)

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters for known target companies (BPO/IT services in Metro Manila)

## Query Categories

Queries are grouped by priority. Combine each query with location terms (e.g. Metro Manila, Philippines, or remote) where the site supports it. For remote roles, add "remote" or "work from home" as an explicit qualifier.

### Priority 1: End User Computing / IT Support (primary)

These match Wilson's strongest and most desired career direction.

```
site:ph.jobstreet.com "End User Computing" Philippines
site:ph.jobstreet.com "IT Support" "Tier 2" Metro Manila
site:ph.jobstreet.com "Desktop Support" Philippines
site:ph.indeed.com "IT Support Specialist" Philippines
site:ph.indeed.com "Technical Support" Metro Manila remote
site:linkedin.com/jobs "End User Computing" Philippines
site:linkedin.com/jobs "Desktop Support" "Metro Manila"
```

### Priority 2: Enterprise IT Administration (domain expertise)

These match Wilson's domain expertise - the tools he administers day to day.

```
site:ph.jobstreet.com "Microsoft 365" "Active Directory" Metro Manila
site:ph.jobstreet.com "Endpoint Management" OR "Intune" Philippines
site:ph.indeed.com "Active Directory" "Windows Server" Metro Manila
site:ph.indeed.com "CrowdStrike" OR "endpoint security" Philippines
site:linkedin.com/jobs "Microsoft 365" "IT Support" Philippines
site:linkedin.com/jobs "PowerShell" "Active Directory" Metro Manila
```

### Priority 3: Systems Administration / Cloud Support (adjacent)

Adjacent roles Wilson could pivot into from Tier 2 support.

```
site:ph.jobstreet.com "Systems Administrator" Metro Manila
site:ph.jobstreet.com "Cloud Support" Philippines
site:ph.jobstreet.com "IT Administrator" remote Philippines
site:ph.indeed.com "Systems Administrator" "Windows Server" Metro Manila
site:ph.indeed.com "Azure" OR "AWS" "IT Support" Philippines
site:linkedin.com/jobs "Systems Administrator" Philippines
site:linkedin.com/jobs "Cloud Support Engineer" "Metro Manila"
```

### Priority 4: IT Security / Endpoint Security (adjacent)

Security-focused entry points leveraging CrowdStrike, AD, and cybersecurity fundamentals.

```
site:ph.jobstreet.com "Endpoint Security" Philippines
site:ph.jobstreet.com "SOC Analyst" OR "Security Operations" Metro Manila
site:ph.jobstreet.com "Cybersecurity" "IT" Philippines
site:ph.indeed.com "Endpoint Security" OR "CrowdStrike" Philippines
site:linkedin.com/jobs "Endpoint Security Analyst" Philippines
site:linkedin.com/jobs "SOC" "Tier 1" "Metro Manila"
```

### Broader: IT Operations / Remote Support (wider net)

```
site:ph.jobstreet.com "IT Helpdesk" OR "Service Desk" Philippines
site:ph.jobstreet.com "Remote Support" OR "Work From Home" "IT" Philippines
site:ph.indeed.com "NOC" OR "IT Operations" Metro Manila
site:linkedin.com/jobs "IT Helpdesk" remote Philippines
site:linkedin.com/jobs "Technical Support Engineer" "Metro Manila"
```

### US remote boards (WebSearch fallback — remote-only relevance)

builtin.com and hiringcafe.com are US-based boards with no CLI (client-rendered);
for a PH candidate they only matter for fully-remote roles, so queries are
remote-qualified. Expect sparse, US-centric hits — these complement, never replace,
the PH boards above.

```
site:builtin.com "IT Support" remote
site:builtin.com "Technical Support" remote
site:builtin.com "Service Desk" remote
site:hiringcafe.com "IT Support" remote
site:hiringcafe.com "Technical Support" remote
site:hiringcafe.com "Service Desk" remote
```

## Location Filter

When evaluating results, verify the job location is within reasonable commute distance from home (Muzon, San Jose del Monte, Bulacan). Define acceptable areas:
- Remote (ideal)
- NCR / Metro Manila (acceptable for hybrid or onsite)
- Bulacan, Cavite, Rizal, Laguna near the Metro Manila boundary (borderline - commute to Metro Manila feasible)
- Outside the NCR region (too far for routine commuting; only consider onsite roles if compensation and growth clearly justify it)

## Language Filter

Wilson's working languages and levels are in CLAUDE.md's Languages table: English (professional working proficiency) and Filipino/Tagalog (native). When filtering scraped results, apply `04-job-evaluation.md`'s Language Gate: a posting requiring a language not declared at all is excluded; a posting requiring a higher level than declared in a language Wilson does work in is not excluded, flag it clearly instead (see `job-scraper/SKILL.md`'s Step 3 "Quick Fit Assessment" for how the flag surfaces in `/scrape` output). Postings simply *written* in English (the norm in the PH market) need no gate.

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape security" -> Priority 4 queries + custom security queries (e.g. "endpoint protection", "security operations center", "identity and access management")
- "/scrape remote" -> remote-qualified variants across all categories
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
