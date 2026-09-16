import { SEARCH_URL, textFetch, parseJobCards, writeError, type JobCard } from "../helpers.js"

export interface SearchOpts {
  query: string
  location?: string
  jobage: number
  limit?: number
  format: "json" | "table" | "plain"
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86400000)
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 42).padEnd(42)
    const company = (c.company || "—").slice(0, 26).padEnd(26)
    const loc = (c.location || "—").slice(0, 26).padEnd(26)
    const date = c.date || "—"
    return `${c.id.padEnd(7)} ${title} ${company} ${loc} ${date}`
  })
  const header =
    "ID".padEnd(7) + " " + "TITLE".padEnd(42) + " " + "COMPANY".padEnd(26) + " " + "LOCATION".padEnd(26) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const url = `${SEARCH_URL}/${encodeURIComponent(opts.query)}`
    const html = await textFetch(url, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
    let cards = parseJobCards(html)
    if (opts.jobage > 0) {
      cards = cards.filter((c) => {
        const days = daysSince(c.date)
        return days === null || days <= opts.jobage
      })
    }
    if (opts.location) {
      const needle = opts.location.toLowerCase()
      cards = cards.filter((c) => (c.location || "").toLowerCase().includes(needle))
    }
    if (opts.limit !== undefined && opts.limit >= 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: cards.length }, results: cards }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
