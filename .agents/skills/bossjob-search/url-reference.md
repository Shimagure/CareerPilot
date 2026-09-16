# BossJob Philippines URL Reference

## Base URLs
- **Search (onsite jobs):** `https://www.bossjob.ph/en-us/onsite-job`
- **Job detail:** `https://www.bossjob.ph/job/<slug>-<id>`

## Search Parameters
| Parameter | Key | Example |
|-----------|-----|---------|
| Keywords | `q` | `q=IT+Support` |
| Location | `location` | `location=Metro+Manila` |
| Page | `page` | `page=2` |

## Search URL Examples
- IT Support in Metro Manila: `https://www.bossjob.ph/en-us/onsite-job?q=IT+Support&location=Metro+Manila`
- Service desk: `https://www.bossjob.ph/en-us/onsite-job?q=service+desk`
- Systems admin in Makati: `https://www.bossjob.ph/en-us/onsite-job?q=systems+administrator&location=Makati`

## Job Detail URL Format
- `https://www.bossjob.ph/job/call-center-representative-las-pinas-514073`
- ID is the numeric suffix: `514073`

## HTML Parsing Anchors (CSS Module Classes)

### Search Page Job Cards
- **Container:** `yolo-technology-jobCard` with `data-page` and `data-index` attributes
- **Title:** `index_pc_jobHireTopTitle__<hash>`
- **Company:** `index_pc_jobHireRecruiterName__<hash>`
- **Salary:** `index_pc_salaryText__<hash>`
- **Location/Tag items:** `index_pc_jobCardLocationItem__<hash>`

### Detail Page
- **Title:** `index_pc_jobDetailTitle__<hash>`
- **Company:** `index_pc_jobDetailCompany__<hash>`
- **Location:** `index_pc_jobDetailLocation__<hash>`
- **Salary:** `index_pc_jobDetailSalary__<hash>`
- **Work Type:** `index_pc_jobDetailWorkType__<hash>`
- **Description:** `index_pc_jobDescription__<hash>`
- **Apply Button:** `index_pc_applyBtn__<hash>`

> Note: The `<hash>` suffix changes per build. The regex patterns in helpers.ts match on the stable prefix (e.g., `index_pc_jobHireTopTitle__`).

## CLI Test Queries (from SKILL.md)
```bash
# Search IT Support in Metro Manila, last 14 days
bun run src/cli.ts search -q "IT Support" -l "Metro Manila" --jobage 14 --format table

# Search service desk
bun run src/cli.ts search -q "service desk" --format table

# Search systems admin in Makati
bun run src/cli.ts search -q "systems administrator" -l "Makati" --format table

# Detail by ID
bun run src/cli.ts detail 514073 --format plain

# Detail by URL
bun run src/cli.ts detail "https://www.bossjob.ph/job/call-center-representative-las-pinas-514073" --format plain
```