import { describe, expect, test } from "bun:test"
import { parseJobCards, relativeDaysAgo, isoDaysAgo } from "../src/helpers.js"

function cardHtml(id: string, overrides: Record<string, string> = {}): string {
  const title = overrides.title ?? "IT STAFF"
  const company = overrides.company ?? "Example Co."
  const location = overrides.location ?? "Makati City, Metro Manila"
  const salary = overrides.salary ?? "₱30,000 per month"
  const listed = overrides.listed ?? "Listed 3 days ago"
  return `<article class="x" data-automation="normalJob" data-job-id="${id}" data-testid="job-card">
    <div class="_10ul7zx0 li3w9m5h li3w9m0 _1ug9k9k0">${listed}</div>
    <a href="/job/${id}?type=standard" data-automation="job-list-view-job-link"></a>
    <a id="job-title-${id}" data-automation="jobTitle">${title}</a>
    <a data-automation="jobCompany">${company}</a>
    <span data-automation="jobCardLocation"><a>${location}</a></span>
    <span data-automation="jobSalary"><span>${salary}</span></span>
    <span data-automation="jobShortDescription">To the qualified candidate...</span>
  </article>`
}

describe("parseJobCards", () => {
  test("parses a single card", () => {
    const cards = parseJobCards(cardHtml("93878544"))
    expect(cards).toHaveLength(1)
    expect(cards[0].id).toBe("93878544")
    expect(cards[0].title).toBe("IT STAFF")
    expect(cards[0].company).toBe("Example Co.")
    expect(cards[0].location).toBe("Makati City, Metro Manila")
    expect(cards[0].salary).toBe("₱30,000 per month")
    expect(cards[0].teaser).toBe("To the qualified candidate...")
    expect(cards[0].url).toBe("https://ph.jobstreet.com/job/93878544")
  })

  test("parses multiple cards and skips malformed chunks", () => {
    const html = cardHtml("1") + "<div>broken chunk with no id</div>" + cardHtml("2", { title: "NOC Engineer" })
    const cards = parseJobCards(html)
    expect(cards).toHaveLength(2)
    expect(cards[1].title).toBe("NOC Engineer")
  })

  test("cards without a title are dropped", () => {
    const html = cardHtml("1", { title: "" })
    expect(parseJobCards(html)).toHaveLength(0)
  })

  test("date is derived from the relative listing label", () => {
    const cards = parseJobCards(cardHtml("1", { listed: "Listed 5 days ago" }))
    expect(cards[0].date).toBe(isoDaysAgo(5))
    expect(cards[0].dateLabel).toBe("Listed 5 days ago")
  })

  test("unparseable date label yields null date but keeps the card", () => {
    const cards = parseJobCards(cardHtml("1", { listed: "Listed just now" }))
    expect(cards[0].date).toBeNull()
  })
})

describe("relativeDaysAgo", () => {
  test.each([
    ["Listed today", 0],
    ["Listed yesterday", 1],
    ["Listed 3 days ago", 3],
    ["Listed 30+ days ago", 30],
    ["Listed 2 weeks ago", 14],
    ["Listed 1 month ago", 30],
    ["Listed twelve hours ago", 1],
    ["Listed five minutes ago", 1],
    ["Listed an hour ago", 1],
    [null, null],
    ["something unrelated", null],
  ])("%s → %s", (label, expected) => {
    expect(relativeDaysAgo(label)).toBe(expected)
  })
})
