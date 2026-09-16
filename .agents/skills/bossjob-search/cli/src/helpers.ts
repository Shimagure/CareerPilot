// Data source: BossJob Philippines public search pages. No authentication.
// Search returns SSR HTML with Next.js streaming; detail returns a single job page.
// The markup uses CSS modules (yolo-technology-jobCard, etc.), so we parse with regex.

export const SEARCH_URL = "https://www.bossjob.ph/en-us/onsite-job"
export const DETAIL_URL = "https://www.bossjob.ph/job"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

/** Fetch HTML with exponential backoff on 429/5xx. Returns "" on a 404. */
export async function htmlFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return ""
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  salary: string | null
  date: string | null // ISO date, derived from the relative listing label
  dateLabel: string | null // raw relative text, e.g. "3 days ago"
  teaser: string | null
  url: string
}

export interface JobDetail extends JobCard {
  description: string | null
  workType: string | null
  applyUrl: string | null
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/'/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html))
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, twenty: 20, thirty: 30,
}

/** Convert relative listing label ("3 days ago", "today", "yesterday") into days ago. */
export function relativeDaysAgo(label: string | null): number | null {
  if (!label) return null
  const text = label.toLowerCase().trim()
  if (/today|just\s+now/.test(text)) return 0
  if (/yesterday/.test(text)) return 1
  const unitMap: Record<string, number> = {
    minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365,
  }
  // Matches "3 days ago", "1 day ago", "2 weeks ago", etc.
  const numMatch = text.match(/(\d+)\+?\s*(minute|hour|day|week|month|year)s?\s+ago/)
  if (numMatch) return Math.max(0, Math.ceil(parseFloat(numMatch[1]) * unitMap[numMatch[2]]))
  // Matches "a day ago", "an hour ago"
  const wordMatch = text.match(/^(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty)\+?\s*(minute|hour|day|week|month|year)s?\s+ago$/)
  if (wordMatch) {
    const n = NUMBER_WORDS[wordMatch[1]]
    if (n !== undefined) return Math.max(0, Math.ceil(n * unitMap[wordMatch[2]]))
  }
  return null
}

/** ISO date N days ago (local), used to give cards a comparable date field. */
export function isoDaysAgo(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

/**
 * Parse the search page. The job data is served as a Next.js SSR payload
 * plus streaming updates. We extract from:
 * 1. The initial escaped JSON array under `\"jobs\":[ ... ]` in the HTML
 * 2. All `self.__next_f.push([1, "..."])` streaming payloads that contain `"jobs":[...]`
 * Field locations (verified against live HTML):
 *   job_id, job_title, location, job_url, salary_info.text,
 *   company.company_name, job_detail.job_description.description_html
 */

function mapJobToCard(job: any): JobCard | null {
  const id = String(job.job_id ?? "")
  const title = typeof job.job_title === "string" ? job.job_title.trim() : ""
  if (!id || !title) return null

  const company =
    job.company && typeof job.company.company_name === "string"
      ? job.company.company_name.trim()
      : null
  const location = typeof job.location === "string" ? job.location.trim() : null
  const salary =
    job.salary_info && typeof job.salary_info.text === "string"
      ? job.salary_info.text.trim()
      : null

  return {
    id,
    title,
    company,
    location,
    salary,
    date: null,
    dateLabel: null,
    teaser: null,
    url: `${DETAIL_URL}/${id}`,
  }
}

/**
 * Recursively search for a "jobs" key whose value is an array of job objects.
 * Returns the first such array found.
 */
function findJobsArray(obj: any): any[] | null {
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findJobsArray(item)
      if (found) return found
    }
    return null
  }
  if (obj && typeof obj === "object") {
    if (Array.isArray(obj.jobs)) {
      return obj.jobs
    }
    for (const key of Object.keys(obj)) {
      const found = findJobsArray(obj[key])
      if (found) return found
    }
  }
  return null
}

/**
 * Extract jobs from the SSR HTML which contains an escaped JSON array.
 * The jobs array is under `\"jobs\":[ ... ]` in the HTML.
 */
function extractJobsFromSSR(html: string): JobCard[] {
  const results: JobCard[] = []

  const prefix = '\\"jobs\\":['
  const startIdx = html.indexOf(prefix)
  if (startIdx === -1) return results

  const contentStart = startIdx + prefix.length - 1 // the '['
  let depth = 1
  let endIdx = -1
  for (let i = contentStart; i < html.length; i++) {
    const ch = html[i]
    if (ch === "[") depth++
    else if (ch === "]") {
      depth--
      if (depth === 0) {
        endIdx = i
        break
      }
    }
  }
  if (endIdx === -1) return results

  const jobsArray = html.slice(contentStart, endIdx + 1)
  const unescaped = jobsArray
    .replace(/\\u0026/g, "&")
    .replace(/\\\\n/g, "\\n")
    .replace(/\\\\r/g, "\\r")
    .replace(/\\\\t/g, "\\t")
    .replace(/\\"/g, '"')

  let jobs: any[]
  try {
    jobs = JSON.parse(unescaped)
  } catch {
    return results
  }
  if (!Array.isArray(jobs)) return results

  for (const job of jobs) {
    const card = mapJobToCard(job)
    if (card) results.push(card)
  }
  return results
}

/**
 * Extract jobs from a Next.js streaming push content string.
 * The push content is React Flight format (not standard JSON), so we string-search
 * for the jobs array and extract it directly, then unescape and parse.
 */
function extractJobsFromStreaming(content: string): JobCard[] {
  const results: JobCard[] = []

  // Find the jobs array in the streaming content. It appears as "jobs":[ ... ]
  // The React Flight format wraps everything in a special structure, but the
  // jobs array itself is a valid JSON array once extracted and unescaped.
  const jobsIdx = content.indexOf('"jobs":[')
  if (jobsIdx === -1) return results

  // "jobs":[' is 8 chars (",j,o,b,s,",:,[), so '[' is at jobsIdx + 7
  const arrayStart = jobsIdx + 7

  // Track bracket depth properly (handle strings and escapes)
  let depth = 0
  let inString = false
  let escapeNext = false
  let endIdx = -1
  for (let i = arrayStart; i < content.length; i++) {
    const ch = content[i]
    if (!inString && ch === "[") depth++
    else if (!inString && ch === "]") {
      depth--
      if (depth === 0) { endIdx = i; break; }
    } else if (ch === '"' && !escapeNext) {
      inString = !inString
    } else if (ch === "\\" && inString) {
      escapeNext = true
    } else {
      escapeNext = false
    }
  }
  if (endIdx === -1) return results

  const jobsArray = content.slice(arrayStart, endIdx + 1)

  // Unescape the jobs array
  const unescaped = jobsArray
    .replace(/\\u0026/g, "&")
    .replace(/\\\\n/g, "\\n")
    .replace(/\\\\r/g, "\\r")
    .replace(/\\\\t/g, "\\t")
    .replace(/\\"/g, '"')

  let jobs: any[]
  try {
    jobs = JSON.parse(unescaped)
  } catch {
    return results
  }
  if (!Array.isArray(jobs)) return results

  for (const job of jobs) {
    const card = mapJobToCard(job)
    if (card) results.push(card)
  }
  return results
}

export function parseJobCards(html: string): JobCard[] {
  const results: JobCard[] = []
  const seenIds = new Set<string>()

  // 1. Parse from initial SSR HTML
  const ssrJobs = extractJobsFromSSR(html)
  for (const job of ssrJobs) {
    if (!seenIds.has(job.id)) {
      seenIds.add(job.id)
      results.push(job)
    }
  }

  // 2. Parse from Next.js streaming pushes
  const pushRegex = /self\.__next_f\.push\((\[.*?\])\)/g
  let match
  while ((match = pushRegex.exec(html)) !== null) {
    const arrStr = match[1]
    try {
      const arr = JSON.parse(arrStr)
      if (Array.isArray(arr) && arr.length >= 2) {
        const content = arr[1]
        if (typeof content === "string" && (content.includes('"jobs":[') || content.includes('\\"jobs\\":['))) {
          const streamingJobs = extractJobsFromStreaming(content)
          for (const job of streamingJobs) {
            if (!seenIds.has(job.id)) {
              seenIds.add(job.id)
              results.push(job)
            }
          }
        }
      }
    } catch {
      // Skip parse errors for individual pushes
    }
  }

  return results
}

/** Parse a single job detail page. */
export function parseJobDetail(html: string, id: string): JobDetail {
  // Title - in JobHeader h3
  const titleMatch = html.match(/class="[^"]*JobHeader_pc_jobHeader__[^"]*"[\s\S]*?<h3[^>]*>([^<]+)<\/h3>/)
  const title = titleMatch ? clean(titleMatch[1]) : "(untitled)"

  // Company - in JobHeader companyName
  const companyMatch = html.match(/class="[^"]*JobHeader_pc_companyName__[^"]*"[^>]*>([^<]+)</)
  const company = companyMatch ? clean(companyMatch[1]) : null

  // Location & Work Type - in JobHeader detailInfo spans
  const detailInfoMatch = html.match(/class="[^"]*JobHeader_pc_detailInfo__[^"]*"[\s\S]*?<\/div>/)
  let location: string | null = null
  let workType: string | null = null
  if (detailInfoMatch) {
    const spanMatches = detailInfoMatch[0].matchAll(/<span[^>]*>([^<]+)<\/span>/g)
    const spans: string[] = []
    for (const m of spanMatches) {
      const txt = clean(m[1])
      if (txt) spans.push(txt)
    }
    // First span is location (e.g., "On-site - Pasig")
    if (spans.length >= 1) location = spans[0]
    // Look for work type keywords in spans
    for (const span of spans) {
      if (/full.time|part.time|contract|intern|freelance/i.test(span)) {
        workType = span
        break
      }
    }
  }

  // Salary - in JobHeader salaryInfo
  const salaryMatch = html.match(/class="[^"]*JobHeader_pc_salaryInfo__[^"]*"[^>]*>([\s\S]*?)<\/div>/)
  let salary: string | null = null
  if (salaryMatch) {
    salary = decodeHtmlEntities(stripTags(salaryMatch[1])).trim() || null
  }

  // Description - in Desc richText ql-editor
  let description: string | null = null
  const descMatch = html.match(/class="[^"]*Desc_pc_richText__[^"]*"[\s\S]*?class="ql-editor"([\s\S]*?)<\/div>\s*<\/div>/)
  if (descMatch) {
    const withBreaks = descMatch[1]
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
    description = decodeHtmlEntities(stripTags(withBreaks)).replace(/\n{3,}/g, "\n\n").trim() || null
  }

  // Apply URL - the apply button is in Chat_pc_button with disabled state, no href
  // Try to find any apply link in the page
  const applyMatch = html.match(/href="([^"]*apply[^"]*)"/i)
  const applyUrl = applyMatch ? decodeHtmlEntities(applyMatch[1]) : null

  return {
    id,
    title,
    company,
    location,
    salary,
    date: null,
    dateLabel: null,
    teaser: null,
    url: `${DETAIL_URL}/${id}`,
    description,
    workType,
    applyUrl,
  }
}