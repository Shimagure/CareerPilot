import { DETAIL_URL, textFetch, parseJobDetail, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** Accept a numeric Kalibrr job ID, a search-result URL, or a jobs/<slug> URL. */
function normalizeId(input: string): string | null {
  const byId = input.match(/jobs\/(\d+)/)
  if (byId) return byId[1]
  const bare = input.match(/^\d+$/)
  if (bare) return input
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a job ID from "${opts.id}" (pass a numeric id or a /c/<company>/jobs/<id> URL)`, "BAD_ID")
    return 1
  }
  try {
    const jsonText = await textFetch(`${DETAIL_URL}/${id}`, "application/json")
    if (!jsonText) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job = parseJobDetail(jsonText, id)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        job.salary ? `Salary: ${job.salary}` : "",
        job.tenure ? `Tenure: ${job.tenure}` : "",
        job.function ? `Function: ${job.function}` : "",
        job.deadline ? `Application deadline: ${job.deadline}` : "",
        job.isRemote ? "Remote: yes" : "",
        "",
        job.description || "(no description)",
        job.qualifications ? `\nQUALIFICATIONS\n${job.qualifications}` : "",
        "",
        `URL: ${job.url}`,
        job.applyUrl ? `Apply: ${job.applyUrl}` : "",
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
