// Data source: JobStreet Philippines public search pages (SEEK). No authentication.
// Search returns an SSR HTML list of job cards; detail returns a single job page.
// The markup is shallow and stable (SEEK's `data-automation` attributes), so we
// parse it with regex rather than a DOM parser.

export const SEARCH_URL = "https://ph.jobstreet.com/jobs"
export const DETAIL_URL = "https://ph.jobstreet.com/job"

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
  dateLabel: string | null // raw relative text, e.g. "Listed 3 days ago"
  teaser: string | null
  url: string
}

export interface JobDetail extends JobCard {
  description: string | null
  classifications: string | null
  workType: string | null
  applyUrl: string | null
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
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

/** Extract the inner HTML of a <div> keyed by a `data-automation` value, tracking nesting depth. */
export function extractDivByAutomation(html: string, automation: string): string | null {
  const escaped = automation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const openRe = new RegExp(`<div[^>]*data-automation="${escaped}"[^>]*>`, "i")
  const open = openRe.exec(html)
  if (!open) return null

  let i = open.index + open[0].length
  let depth = 1

  while (depth > 0 && i < html.length) {
    const nextOpen = html.indexOf("<div", i)
    const nextClose = html.indexOf("</div>", i)
    if (nextClose === -1) return null
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      i = nextOpen + 4
    } else {
      depth--
      i = nextClose + 6
    }
  }
  return html.slice(open.index + open[0].length, i - 6)
}

/** Inner text of the first element carrying a `data-automation` value. */
function automationText(html: string, automation: string): string | null {
  const re = new RegExp(`data-automation="${automation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>([\\s\\S]*?)<\\/[a-z0-9]+>`, "i")
  const m = re.exec(html)
  return m ? clean(m[1]) || null : null
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
}

/** Convert SEEK's relative listing label ("Listed 3 days ago") into days ago. */
export function relativeDaysAgo(label: string | null): number | null {
  if (!label) return null
  const text = label.replace(/^Listed\s+/i, "").toLowerCase()
  if (/today/.test(text)) return 0
  if (/yesterday/.test(text)) return 1
  const unitMap: Record<string, number> = {
    minute: 1 / 1440,
    hour: 1 / 24,
    day: 1,
    week: 7,
    month: 30,
    year: 365,
  }
  const numMatch = text.match(/(\d+)\+?\s*(minute|hour|day|week|month|year)s?\s+ago/)
  if (numMatch) return Math.max(0, Math.ceil(parseFloat(numMatch[1]) * unitMap[numMatch[2]]))
  const wordMatch = text.match(/([a-z]+)\+?\s*(minute|hour|day|week|month|year)s?\s+ago/)
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
 * Parse the search page: one job card per `data-job-id` article. Split on the
 * marker and parse each chunk independently so one malformed card cannot break
 * the rest.
 */
export function parseJobCards(html: string): JobCard[] {
  const results: JobCard[] = []
  const chunks = html.split(/data-job-id="/).slice(1)

  for (const chunk of chunks) {
    const idMatch = chunk.match(/^(\d+)/)
    if (!idMatch) continue
    const id = idMatch[1]

    const title = automationText(chunk, "jobTitle")
    if (!title) continue
    const company = automationText(chunk, "jobCompany")
    const location = automationText(chunk, "jobCardLocation")
    const salary = automationText(chunk, "jobSalary")
    const teaser = automationText(chunk, "jobShortDescription")

    const dateLabelMatch = chunk.match(/>Listed\s+([^<]{1,40})<\/div>/i)
    const dateLabel = dateLabelMatch ? `Listed ${clean(dateLabelMatch[1])}` : null
    const daysAgo = relativeDaysAgo(dateLabel)
    const date = daysAgo !== null ? isoDaysAgo(daysAgo) : null

    results.push({
      id,
      title,
      company,
      location,
      salary,
      date,
      dateLabel,
      teaser,
      url: `${DETAIL_URL}/${id}`,
    })
  }
  return results
}

/** Parse a single job detail page. */
export function parseJobDetail(html: string, id: string): JobDetail {
  const title = automationText(html, "job-detail-title")
  const company = automationText(html, "advertiser-name")
  const location = automationText(html, "job-detail-location")
  const salary = automationText(html, "job-detail-salary")
  const classifications = automationText(html, "job-detail-classifications")
  const workType = automationText(html, "job-detail-work-type")

  let description: string | null = null
  const descHtml = extractDivByAutomation(html, "jobAdDetails")
  if (descHtml) {
    const withBreaks = descHtml
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
    description = decodeHtmlEntities(stripTags(withBreaks)).replace(/\n{3,}/g, "\n\n").trim() || null
  }

  const applyMatch = html.match(/data-automation="job-detail-apply"[^>]*href="([^"]+)"/i)
  const applyUrl = applyMatch ? decodeHtmlEntities(applyMatch[1]) : null

  return {
    id,
    title: title ?? "(untitled)",
    company,
    location,
    salary,
    date: null,
    dateLabel: null,
    teaser: null,
    url: `${DETAIL_URL}/${id}`,
    description,
    classifications,
    workType,
    applyUrl,
  }
}
