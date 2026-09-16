import { describe, expect, test } from "bun:test"
import { parseJobCards, parseJobDetail, extractDivById } from "../src/helpers.js"

function cardHtml(jk: string, overrides: Record<string, string> = {}): string {
  const title = overrides.title ?? "IT Support Specialist"
  const company = overrides.company ?? "Example Corp"
  const location = overrides.location ?? "Makati City, Metro Manila"
  const salary = overrides.salary ?? "PHP18,000 - PHP20,000 a month"
  return `<div class="job_seen_beacon">
    <a data-jk="${jk}" href="/rc/clk?jk=${jk}&fccid=abc" aria-label="full details of ${title}">
      <div data-testid="company-name"><span>${company}</span></div>
      <div class="card0">
        <h2 class="jobTitle"><span id="jobTitle-${jk}" title="${title}"><span>${title}</span></span></h2>
      </div>
      <div class="metadata">
        <div data-testid="text-location"><span>${location}</span></div>
      </div>
      <div data-testid="attribute_snippet_testid salary-snippet-container"><span>${salary}</span></div>
    </a>
  </div>`
}

describe("parseJobCards", () => {
  test("parses a single card", () => {
    const cards = parseJobCards(cardHtml("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3"))
    expect(cards).toHaveLength(1)
    expect(cards[0].id).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3")
    expect(cards[0].title).toBe("IT Support Specialist")
    expect(cards[0].company).toBe("Example Corp")
    expect(cards[0].location).toBe("Makati City, Metro Manila")
    expect(cards[0].salary).toBe("PHP18,000 - PHP20,000 a month")
    expect(cards[0].url).toBe("https://ph.indeed.com/viewjob?jk=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3")
  })

  test("falls back to aria-label when the jobTitle span has no title attribute", () => {
    const html = cardHtml("abc123").replace(/ title="IT Support Specialist"/, "")
    const cards = parseJobCards(html)
    expect(cards).toHaveLength(1)
    expect(cards[0].title).toBe("IT Support Specialist")
  })

  test("parses multiple cards and skips malformed chunks", () => {
    const html = cardHtml("abc") + "<div>broken chunk with no data-jk</div>" + cardHtml("def", { title: "NOC Engineer" })
    const cards = parseJobCards(html)
    expect(cards).toHaveLength(2)
    expect(cards[1].title).toBe("NOC Engineer")
  })

  test("cards without a title are dropped", () => {
    const html = cardHtml("abc", { title: "" })
    expect(parseJobCards(html)).toHaveLength(0)
  })

  test("date is always null (client-rendered)", () => {
    const cards = parseJobCards(cardHtml("abc"))
    expect(cards[0].date).toBeNull()
    expect(cards[0].dateLabel).toBeNull()
  })
})

describe("parseJobDetail", () => {
  const detailHtml = `<html><body>
    <h1 id="jobTitle" title="IT Support Specialist"><span>IT Support Specialist</span></h1>
    <div data-testid="inlineHeader-companyName"><span>Example Corp</span></div>
    <div data-testid="inlineHeader-companyLocation"><span>Makati</span></div>
    <div id="jobDescriptionText">
      <ul><li>Support desktops</li><li>Manage AD</li></ul>
      <p>Some paragraph</p>
    </div>
    <a id="applyButtonLinkContainer" href="/rc/clk?jk=abc123">Apply</a>
  </body></html>`

  test("parses title, company, location, description, applyUrl", () => {
    const job = parseJobDetail(detailHtml, "abc123")
    expect(job.id).toBe("abc123")
    expect(job.title).toBe("IT Support Specialist")
    expect(job.company).toBe("Example Corp")
    expect(job.location).toBe("Makati")
    expect(job.description).toContain("Support desktops")
    expect(job.description).toContain("Some paragraph")
    expect(job.applyUrl).toBe("https://ph.indeed.com/rc/clk?jk=abc123")
  })

  test("falls back to the h1 jobsearch class for title", () => {
    const html = detailHtml.replace(/id="jobTitle"[^>]*>/, '<h1 class="jobsearch-JobInfoHeader-title">')
    const job = parseJobDetail(html, "abc123")
    expect(job.title).toBe("IT Support Specialist")
  })
})

describe("extractDivById", () => {
  test("tracks nesting depth correctly", () => {
    const html = '<div id="outer"><div><div>deep</div></div>end</div>'
    expect(extractDivById(html, "outer")).toBe("<div><div>deep</div></div>end")
  })

  test("returns null when the id is missing", () => {
    expect(extractDivById("<div>no id here</div>", "missing")).toBeNull()
  })
})
