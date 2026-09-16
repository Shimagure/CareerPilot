import { describe, expect, test } from "bun:test"
import { parseJobCards, parseJobDetail } from "../src/helpers.js"

function nextDataHtml(jobs: unknown[]): string {
  const blob = JSON.stringify({ props: { pageProps: { count: jobs.length, jobs } } })
  return `<html><script id="__NEXT_DATA__" type="application/json">${blob}</script></html>`
}

const sampleJob = {
  id: 269864,
  name: "IT Service Desk and Deskside Support Assistant",
  slug: "it-service-desk-and-deskside-support-assistant",
  companyName: "Ateneo de Manila University",
  company: { code: "ateneo-de-manila-university-1" },
  googleLocation: {
    addressComponents: { city: "Quezon City", region: "Metro Manila", country: "Philippines" },
  },
  activationDate: "2026-07-15T03:32:52.834490+00:00",
  applicationEndDate: "2026-09-12T16:00:00+00:00",
  salaryShown: true,
  baseSalary: 30000,
  maximumSalary: 45000,
  salaryCurrency: "₱",
  salaryInterval: "month",
}

describe("parseJobCards", () => {
  test("parses a card from __NEXT_DATA__", () => {
    const cards = parseJobCards(nextDataHtml([sampleJob]))
    expect(cards).toHaveLength(1)
    expect(cards[0].id).toBe("269864")
    expect(cards[0].title).toBe("IT Service Desk and Deskside Support Assistant")
    expect(cards[0].company).toBe("Ateneo de Manila University")
    expect(cards[0].location).toBe("Quezon City, Metro Manila, Philippines")
    expect(cards[0].salary).toBe("₱30000 - ₱45000 / month")
    expect(cards[0].date).toBe("2026-07-15")
    expect(cards[0].deadline).toBe("2026-09-12")
    expect(cards[0].url).toBe(
      "https://www.kalibrr.com/c/ateneo-de-manila-university-1/jobs/269864/it-service-desk-and-deskside-support-assistant",
    )
  })

  test("drops jobs without id or name", () => {
    const cards = parseJobCards(nextDataHtml([sampleJob, { id: 1 }, { name: "No id" }]))
    expect(cards).toHaveLength(1)
  })

  test("handles a missing __NEXT_DATA__ blob as empty", () => {
    expect(parseJobCards("<html>no data here</html>")).toEqual([])
  })

  test("salary null when salaryShown is false or values missing", () => {
    const cards = parseJobCards(
      nextDataHtml([
        { ...sampleJob, salaryShown: false },
        { ...sampleJob, baseSalary: null, maximumSalary: null },
      ]),
    )
    expect(cards[0].salary).toBeNull()
    expect(cards[1].salary).toBeNull()
  })
})

describe("parseJobDetail", () => {
  const detailJson = JSON.stringify({
    id: 269864,
    name: "IT Service Desk and Deskside Support Assistant",
    company_name: "Ateneo de Manila University",
    google_location: { formatted_address: "Quezon City, Metro Manila, Philippines" },
    description: "<p>First point of contact.</p><p>Second para.</p>",
    qualifications: "<ul><li>3 years IT service</li></ul>",
    base_salary: 30000,
    maximum_salary: 45000,
    salary_currency: "₱",
    salary_interval: "month",
    salary_shown: true,
    activation_date: "2026-07-15T03:32:52Z",
    application_end_date: "2026-09-12T16:00:00Z",
    tenure: "Full time",
    function: "IT and Software",
    is_work_from_home: false,
    apply_redirect_url: "https://example.com/apply",
    slug: "it-service-desk-and-deskside-support-assistant",
  })

  test("parses the detail JSON", () => {
    const job = parseJobDetail(detailJson, "269864")
    expect(job.title).toBe("IT Service Desk and Deskside Support Assistant")
    expect(job.company).toBe("Ateneo de Manila University")
    expect(job.location).toBe("Quezon City, Metro Manila, Philippines")
    expect(job.salary).toBe("₱30000 - ₱45000 / month")
    expect(job.deadline).toBe("2026-09-12")
    expect(job.tenure).toBe("Full time")
    expect(job.isRemote).toBe(false)
    expect(job.applyUrl).toBe("https://example.com/apply")
    expect(job.description).toContain("First point of contact.")
    expect(job.qualifications).toContain("3 years IT service")
  })

  test("rejects non-JSON detail responses", () => {
    expect(() => parseJobDetail("<html>oops</html>", "1")).toThrow("valid JSON")
  })
})
