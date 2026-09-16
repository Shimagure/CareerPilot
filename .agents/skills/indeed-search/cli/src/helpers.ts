// Data source: Indeed Philippines public search page. No authentication.
// Search returns an SSR HTML list of job cards (page 1 only — Indeed walls
// pagination behind a sign-in, so `start` is not rendered server-side).
// The markup uses stable `data-testid` attributes and a per-card beacon div,
// so we parse it with regex rather than a DOM parser.

export const SEARCH_URL = "https://ph.indeed.com/jobs"
export const DETAIL_URL = "https://ph.indeed.com/viewjob"
export const APPLY_REDIRECT_URL = "https://ph.indeed.com/rc/clk"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

export const UA =
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

/** The canonical /job/<slug>-<jk> page, which serves SSR content. The apply
 *  redirect /rc/clk?jk=<id> 302s to it; viewjob?jk= is behind a security check
 *  for anonymous clients. Returns the canonical URL, or the passed fallback. */
export async function resolveCanonicalUrl(jk: string): Promise<string> {
  try {
    const response = await fetch(`${APPLY_REDIRECT_URL}?jk=${jk}`, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    })
    const location = response.headers.get("location")
    if (location && /\/job\//.test(location)) return location
  } catch {
    // fall through to the viewjob URL; htmlFetch reports the failure cleanly
  }
  return `${DETAIL_URL}?jk=${jk}`
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  salary: string | null
  date: string | null // ISO date, derived from the relative listing label
  dateLabel: string | null // raw relative text
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

/** Drop <style>/<script> blocks (Emotion CSS-in-JS embeds them inside content
 *  containers). Applied before regex captures so their text never leaks, and
 *  again inside stripTags for balanced blocks (the description path). */
function sansStyleScript(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
}

function stripTags(html: string): string {
  return sansStyleScript(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html))
}

/** Inner text of the first element carrying a `data-testid` value. */
function testidText(html: string, testid: string): string | null {
  const safe = sansStyleScript(html)
  const re = new RegExp(`data-testid="${testid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>([\\s\\S]*?)<\\/[a-z0-9]+>`, "i")
  const m = re.exec(safe)
  return m ? clean(m[1]) || null : null
}

/** Inner text of the first element carrying an `id` attribute. */
function idText(html: string, id: string): string | null {
  const safe = sansStyleScript(html)
  const re = new RegExp(`id="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>([\\s\\S]*?)<\\/[a-z0-9]+>`, "i")
  const m = re.exec(safe)
  return m ? clean(m[1]) || null : null
}

/** Extract the inner HTML of a <div> keyed by an `id` attribute, tracking nesting depth. */
export function extractDivById(html: string, id: string): string | null {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const openRe = new RegExp(`<div[^>]*id="${escaped}"[^>]*>`, "i")
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

/**
 * Parse the search page: one job card per `job_seen_beacon` div. Split on the
 * marker and parse each chunk independently so one malformed card cannot break
 * the rest.
 */
export function parseJobCards(html: string): JobCard[] {
  const results: JobCard[] = []
  const chunks = html.split('<div class="job_seen_beacon">').slice(1)

  for (const chunk of chunks) {
    const jkMatch = chunk.match(/data-jk="([a-f0-9]+)"/)
    if (!jkMatch) continue
    const id = jkMatch[1]

    let titleMatch = chunk.match(/id="jobTitle-[a-f0-9]+"[^>]*title="([^"]*)"/i)
    if (!titleMatch) {
      const alt = chunk.match(/aria-label="full details of\s+([^"]*)"/i)
      titleMatch = alt ? [alt[0], alt[1]] as RegExpMatchArray : null
    }
    const title = titleMatch ? clean(titleMatch[1]) : null
    if (!title) continue

    const company = testidText(chunk, "company-name")
    const location = testidText(chunk, "text-location")
    let salary: string | null = null
    const salMatch = sansStyleScript(chunk).match(/data-testid="attribute_snippet_testid salary-snippet-container"[^>]*>([\s\S]*?)<\/div>/i)
    if (salMatch) {
      const inner = salMatch[1].match(/<span[^>]*>([\s\S]*?)<\/span>/i)
      salary = inner ? clean(inner[1]) || null : null
    }

    let teaser: string | null = null
    const teaserMatch = chunk.match(/class="job-snippet"[^>]*>([\s\S]*?)<\/ul>/i)
    if (teaserMatch) teaser = clean(teaserMatch[1]) || null

    results.push({
      id,
      title,
      company,
      location,
      salary,
      date: null, // dates are client-rendered; not present in the SSR page
      dateLabel: null,
      teaser,
      url: `${DETAIL_URL}?jk=${id}`,
    })
  }
  return results
}

/** Parse a single job detail page. */
export function parseJobDetail(html: string, id: string): JobDetail {
  let title = idText(html, "jobTitle")
  if (!title) {
    const h1 = html.match(/<h1[^>]*jobsearch-JobInfoHeader-title[^>]*>([\s\S]*?)<\/h1>/i)
    title = h1 ? clean(h1[1]) : null
  }
  const company = testidText(html, "inlineHeader-companyName") ?? idText(html, "companyName")
  const location = testidText(html, "inlineHeader-companyLocation")
  let salary: string | null = null
  const salMatch = sansStyleScript(html).match(/data-testid="jobsearch-JobMetadataHeader-item salary-snippet-container"[^>]*>([\s\S]*?)<\/div>/i)
  if (salMatch) {
    const inner = salMatch[1].match(/<span[^>]*>([\s\S]*?)<\/span>/i)
    salary = inner ? clean(inner[1]) || null : null
  }

  let description: string | null = null
  const descHtml = extractDivById(html, "jobDescriptionText")
  if (descHtml) {
    const withBreaks = descHtml
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
    description = decodeHtmlEntities(stripTags(withBreaks)).replace(/\n{3,}/g, "\n\n").trim() || null
  }

  let applyUrl: string | null = null
  const applyMatch = html.match(/id="applyButtonLinkContainer"[^>]*href="([^"]+)"/i)
  if (applyMatch) {
    const href = decodeHtmlEntities(applyMatch[1])
    applyUrl = href.startsWith("http") ? href : `https://ph.indeed.com${href}`
  }

  return {
    id,
    title: title ?? "(untitled)",
    company,
    location,
    salary,
    date: null,
    dateLabel: null,
    teaser: null,
    url: `${DETAIL_URL}?jk=${id}`,
    description,
    classifications: null,
    workType: null,
    applyUrl,
  }
}
