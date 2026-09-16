// Data source: Kalibrr Philippines public job board (Next.js SSR). No authentication.
// Search returns the top-N job objects embedded in the page's __NEXT_DATA__ JSON
// blob; detail reads Kalibrr's public JSON detail endpoint. Both are parsed as
// JSON — no HTML scraping beyond extracting the __NEXT_DATA__ script.

export const SEARCH_URL = "https://www.kalibrr.com/job-board/te"
export const DETAIL_URL = "https://www.kalibrr.com/api/jobs"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

/** Fetch text with exponential backoff on 429/5xx. Returns "" on a 404. */
export async function textFetch(url: string, accept: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: accept,
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
  date: string | null // activation date (ISO)
  deadline: string | null // application deadline (ISO)
  url: string
}

export interface JobDetail extends JobCard {
  description: string | null
  qualifications: string | null
  tenure: string | null
  function: string | null
  workExperience: string | null
  applyUrl: string | null
  isRemote: boolean | null
}

interface SearchJob {
  id: number
  name: string
  slug: string
  companyName: string
  company?: { code?: string }
  googleLocation?: {
    addressComponents?: { addressLine_1?: string; city?: string; region?: string; country?: string }
  }
  activationDate?: string | null
  applicationEndDate?: string | null
  salaryShown?: boolean
  baseSalary?: number | null
  maximumSalary?: number | null
  salaryCurrency?: string | null
  salaryInterval?: string | null
}

/** Extract the __NEXT_DATA__ JSON blob's pageProps.jobs array from a search page. */
export function extractJobsFromNextData(html: string): SearchJob[] {
  const m = html.match(/__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
  if (!m) return []
  try {
    const parsed = JSON.parse(m[1])
    const jobs: SearchJob[] = parsed?.props?.pageProps?.jobs
    return Array.isArray(jobs) ? jobs : []
  } catch {
    return []
  }
}

function formatLocation(gl: SearchJob["googleLocation"]): string | null {
  if (!gl?.addressComponents) return null
  const c = gl.addressComponents
  const parts = [c.city, c.region, c.country].filter(Boolean)
  return parts.join(", ") || null
}

function formatSalary(job: SearchJob): string | null {
  if (job.salaryShown === false) return null
  const min = job.baseSalary
  const max = job.maximumSalary
  if (min == null && max == null) return null
  const cur = job.salaryCurrency || ""
  const interval = job.salaryInterval ? ` / ${job.salaryInterval}` : ""
  if (min != null && max != null && min !== max) return `${cur}${min} - ${cur}${max}${interval}`
  const val = min ?? max
  return `${cur}${val}${interval}`
}

/** Parse the search page's embedded job objects into uniform job cards. */
export function parseJobCards(html: string): JobCard[] {
  const jobs = extractJobsFromNextData(html)
  const cards: JobCard[] = []
  for (const j of jobs) {
    if (!j.id || !j.name) continue
    const code = j.company?.code
    const slug = j.slug
    const base = `https://www.kalibrr.com/c/${encodeURIComponent(code ?? "")}/jobs/${j.id}/${encodeURIComponent(slug ?? "")}`
    cards.push({
      id: String(j.id),
      title: j.name,
      company: j.companyName || null,
      location: formatLocation(j.googleLocation),
      salary: formatSalary(j),
      date: j.activationDate ? j.activationDate.slice(0, 10) : null,
      deadline: j.applicationEndDate ? j.applicationEndDate.slice(0, 10) : null,
      url: code && slug ? base : `https://www.kalibrr.com/jobs/${j.id}`,
    })
  }
  return cards
}

/** Parse the detail API response into a uniform job detail object. */
export function parseJobDetail(jsonText: string, id: string): JobDetail {
  let j: any
  try {
    j = JSON.parse(jsonText)
  } catch {
    throw new Error("Detail response was not valid JSON")
  }

  const min = j.base_salary
  const max = j.maximum_salary
  let salary: string | null = null
  if (j.salary_shown !== false && (min != null || max != null)) {
    const cur = j.salary_currency || ""
    const interval = j.salary_interval ? ` / ${j.salary_interval}` : ""
    if (min != null && max != null && min !== max) salary = `${cur}${min} - ${cur}${max}${interval}`
    else salary = `${cur}${min ?? max}${interval}`
  }

  const loc = j.google_location?.formatted_address || j.google_location?.raw_string || null

  let description: string | null = j.description || null
  if (description) {
    description = description
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  }
  let qualifications: string | null = j.qualifications || null
  if (qualifications) {
    qualifications = qualifications
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  }

  return {
    id,
    title: j.name || "(untitled)",
    company: j.company_name || null,
    location: loc,
    salary,
    date: j.activation_date ? j.activation_date.slice(0, 10) : null,
    deadline: j.application_end_date ? j.application_end_date.slice(0, 10) : null,
    url: `https://www.kalibrr.com/jobs/${j.slug ?? id}`,
    description,
    qualifications,
    tenure: j.tenure || null,
    function: j.function || null,
    workExperience: j.work_experience != null ? String(j.work_experience) : null,
    applyUrl: j.apply_redirect_url || null,
    isRemote: j.is_work_from_home == null ? null : Boolean(j.is_work_from_home),
  }
}
