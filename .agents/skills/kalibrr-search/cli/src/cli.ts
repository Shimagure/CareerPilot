#!/usr/bin/env bun
// Self-contained CLI for searching jobs on Kalibrr Philippines' public job board.
// No external CLI framework, so it runs anywhere `bun` is available with zero
// install beyond the repo clone.
//
// Personal use only. This reads Kalibrr's public job pages; keep volume low and
// do not use it commercially or for bulk data collection. Run it on your own
// responsibility.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--") || a.startsWith("-")) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("-")) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const HELP = `kalibrr-cli — search jobs on Kalibrr Philippines

USAGE
  bun run src/cli.ts search -q "<keywords>" [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>    Keywords. REQUIRED. e.g. "IT Support", "service desk".
  --location, -l <text> Client-side location filter (substring on city/region).
  --jobage <days>       Only postings activated within N days (client-side).
  --limit, -n <n>       Cap results emitted (client-side). Default 15.
  --format <fmt>        json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "IT Support" --jobage 14 --format table
  bun run src/cli.ts search -q "service desk" -l "Quezon City" --format table
  bun run src/cli.ts detail 269864 --format plain

NOTES
  Kalibrr's job-board page server-renders only the top ~15 matches for a query
  (pagination is client-side), so search returns those top results; use varied
  queries to cover different roles. Filtering (jobage/location/limit) is applied
  client-side.

Personal use only — uses Kalibrr's public pages; keep volume low.
`

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  if (cmd === "search") {
    const query = typeof flags.query === "string" ? flags.query : undefined
    if (!query) {
      process.stderr.write(
        JSON.stringify({ error: 'the --query/-q flag is required (e.g. -q "IT Support")', code: "NO_QUERY" }) + "\n",
      )
      return 1
    }

    const parseIntFlag = (name: string, raw: string | boolean | string[]): number | null => {
      const val = parseInt(raw as string, 10)
      if (isNaN(val)) {
        process.stderr.write(JSON.stringify({ error: `--${name} must be a number, got "${raw}"`, code: "BAD_ARG" }) + "\n")
        return null
      }
      return val
    }

    let jobage = 0
    if (flags.jobage !== undefined) {
      const v = parseIntFlag("jobage", flags.jobage)
      if (v === null) return 1
      jobage = v
    }
    let limit: number | undefined = 15
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      limit = v
    }

    const fmt = (flags.format as string) || "json"
    const opts: SearchOpts = {
      query,
      location: typeof flags.location === "string" ? flags.location : undefined,
      jobage,
      limit,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(JSON.stringify({ error: "detail requires an <id|url>", code: "NO_ID" }) + "\n")
      return 1
    }
    const fmt = (flags.format as string) || "json"
    const opts: DetailOpts = { id, format: (fmt === "plain" ? "plain" : "json") as DetailOpts["format"] }
    return runDetail(opts)
  }

  process.stderr.write(JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n")
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: "INTERNAL_ERROR" }) + "\n",
    )
    process.exit(1)
  })
