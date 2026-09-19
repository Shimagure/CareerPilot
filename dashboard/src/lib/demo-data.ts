import type { Application, ApplicationEvent, ApplicationStatus } from "@/types"
import type { JobSearchResultRow } from "@/types/supabase"
import type { SearchProfile } from "@/hooks/use-search-profiles"

const STATUSES: ApplicationStatus[] = [
  "found",
  "interested",
  "applied",
  "phone_screen",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
  "ghosted",
]

const SEARCH_SOURCES = ["indeed", "dice", "linkedin"] as const
const SEARCH_STATUSES = ["new", "viewed", "tracked", "dismissed", "stale"] as const

function makeDate(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(10, 0, 0, 0)
  return d.toISOString()
}

function makeApp(
  id: string,
  title: string,
  company: string,
  status: ApplicationStatus,
  daysAgo: number,
  overrides: Partial<Application> = {}
): Application {
  const dateFound = makeDate(daysAgo)
  const base: Application = {
    id,
    user_id: "demo-user",
    title,
    company,
    location: "Remote",
    url: `https://example.com/jobs/${id}`,
    source: "manual",
    salary_range: "$120,000 - $150,000",
    status,
    job_type: "Full-time",
    posted_date: dateFound.split("T")[0],
    date_found: dateFound,
    date_applied: status === "applied" || ["phone_screen", "interview", "offer", "rejected", "withdrawn"].includes(status)
      ? makeDate(daysAgo - 2)
      : null,
    date_response: ["phone_screen", "interview", "offer", "rejected"].includes(status)
      ? makeDate(daysAgo - 1)
      : null,
    notes: `Demo application for ${title} at ${company}.`,
    profile_id: "demo-profile",
    updated_at: dateFound,
    tailored_resume: null,
    cover_letter: null,
    interview_date: status === "interview" ? makeDate(daysAgo + 2) : null,
    follow_up_date: status === "applied" ? makeDate(daysAgo + 7) : null,
    calendar_event_id: null,
    contact_name: "Alex Recruiter",
    contact_email: `alex.${company.toLowerCase().replace(/\s+/g, "")}@example.com`,
    contact_phone: null,
    contact_role: "recruiter",
    job_description: `We are looking for a ${title} to join our team at ${company}.`,
    interview_prep: undefined,
    ...overrides,
  }
  return base
}

function makeSearchResult(
  id: string,
  title: string,
  company: string,
  source: "indeed" | "dice" | "linkedin",
  status: string,
  daysAgo: number,
  overrides: Partial<JobSearchResultRow> = {}
): JobSearchResultRow {
  const discoveredAt = makeDate(daysAgo)
  const base: JobSearchResultRow = {
    id,
    user_id: "demo-user",
    source,
    source_id: `${source}-${id}`,
    url: `https://${source}.com/jobs/${id}`,
    title,
    company,
    location: "Remote",
    salary: "$130,000 - $160,000",
    job_type: "Full-time",
    posted_date: discoveredAt.split("T")[0],
    easy_apply: source !== "linkedin",
    profile_id: source === "linkedin" ? "profile-linkedin" : source === "dice" ? "profile-dice" : "profile-indeed",
    profile_label: source === "linkedin" ? "LinkedIn Profile" : source === "dice" ? "Dice Profile" : "Indeed Profile",
    description: `We are hiring a ${title} at ${company}. Join our growing team!`,
    requirements: ["Kubernetes", "AWS", "Terraform", "Python"],
    nice_to_haves: ["GCP", "Helm", "ArgoCD"],
    discovered_at: discoveredAt,
    last_seen_at: discoveredAt,
    last_enriched_at: null,
    status,
    application_id: status === "tracked" ? `app-${id}` : null,
    created_at: discoveredAt,
    updated_at: discoveredAt,
    ...overrides,
  }
  return base
}

function makeSearchProfile(
  id: string,
  name: string,
  keyword: string,
  location: string,
  source: "dice" | "indeed" | "linkedin" | "both",
  icon: string,
  sortOrder: number
): SearchProfile {
  return {
    id,
    name,
    keyword,
    location,
    source,
    icon,
    is_default: false,
    sort_order: sortOrder,
    contract_only: false,
  }
}

export const DEMO_APPLICATIONS: Application[] = [
  makeApp("app-1", "Senior Systems Engineer", "Apex Cloud Solutions", "applied", 10),
  makeApp("app-2", "DevOps Engineer", "BridgeTech Systems", "interview", 14, {
    interview_prep: {
      phone_screen: {
        generated_at: "2026-09-15T10:00:00.000Z",
        content: {
          company_quick_hits: ["Fast-growing fintech startup", "Remote-first culture"],
          elevator_pitch: "5 years in DevOps, focused on cloud infrastructure and automation",
          likely_questions: ["Describe your CI/CD experience", "How do you handle incidents?"],
          talking_points: ["Led migration to Kubernetes", "Reduced deployment time by 60%"],
          questions_to_ask: ["What does your current deployment pipeline look like?"],
          red_flags: ["None identified"],
          salary_prep: { low: 120000, mid: 140000, high: 160000, target: 145000, source: "Glassdoor" },
          skills_to_study: ["Docker", "Kubernetes"],
        },
      },
    },
  }),
  makeApp("app-3", "Cloud Infrastructure Engineer", "Cedar Networks", "phone_screen", 7),
  makeApp("app-4", "Platform Engineer", "Delta Digital", "offer", 21),
  makeApp("app-5", "Site Reliability Engineer", "Echo Systems", "rejected", 30),
  makeApp("app-6", "Backend Engineer", "Forge Technologies", "interested", 5),
  makeApp("app-7", "Full Stack Developer", "Grid Labs", "found", 2),
  makeApp("app-8", "Software Engineer", "Horizon Inc", "ghosted", 45),
]

export const DEMO_EVENTS: ApplicationEvent[] = [
  {
    id: "evt-1",
    application_id: "app-1",
    user_id: "demo-user",
    event_type: "status_change",
    previous_value: "interested",
    new_value: "applied",
    description: "Applied to Senior Systems Engineer at Apex Cloud Solutions",
    created_at: makeDate(8),
  },
  {
    id: "evt-2",
    application_id: "app-2",
    user_id: "demo-user",
    event_type: "status_change",
    previous_value: "applied",
    new_value: "phone_screen",
    description: "Phone screen scheduled for DevOps Engineer at BridgeTech Systems",
    created_at: makeDate(12),
  },
  {
    id: "evt-3",
    application_id: "app-2",
    user_id: "demo-user",
    event_type: "status_change",
    previous_value: "phone_screen",
    new_value: "interview",
    description: "Onsite interview scheduled for DevOps Engineer at BridgeTech Systems",
    created_at: makeDate(10),
  },
  {
    id: "evt-4",
    application_id: "app-3",
    user_id: "demo-user",
    event_type: "note_added",
    previous_value: null,
    new_value: "Recruiter mentioned team uses Kubernetes and Terraform heavily",
    description: "Added note to Cloud Infrastructure Engineer at Cedar Networks",
    created_at: makeDate(5),
  },
  {
    id: "evt-5",
    application_id: "app-4",
    user_id: "demo-user",
    event_type: "status_change",
    previous_value: "interview",
    new_value: "offer",
    description: "Received offer for Platform Engineer at Delta Digital",
    created_at: makeDate(18),
  },
  {
    id: "evt-6",
    application_id: "app-5",
    user_id: "demo-user",
    event_type: "status_change",
    previous_value: "interview",
    new_value: "rejected",
    description: "Rejected for Site Reliability Engineer at Echo Systems",
    created_at: makeDate(28),
  },
]

export const DEMO_NEW_MATCH_COUNT = 3

export const DEMO_SEARCH_RESULTS: JobSearchResultRow[] = [
  makeSearchResult("sr-1", "Senior Systems Engineer", "Apex Cloud Solutions", "indeed", "new", 2),
  makeSearchResult("sr-2", "DevOps Engineer", "BridgeTech Systems", "dice", "new", 5),
  makeSearchResult("sr-3", "Cloud Infrastructure Engineer", "Cedar Networks", "linkedin", "viewed", 7),
  makeSearchResult("sr-4", "Platform Engineer", "Delta Digital", "indeed", "tracked", 10),
  makeSearchResult("sr-5", "Site Reliability Engineer", "Echo Systems", "dice", "new", 12),
  makeSearchResult("sr-6", "Backend Engineer", "Forge Technologies", "linkedin", "new", 3),
  makeSearchResult("sr-7", "Full Stack Developer", "Grid Labs", "indeed", "viewed", 1),
  makeSearchResult("sr-8", "Software Engineer", "Horizon Inc", "dice", "new", 15),
  makeSearchResult("sr-9", "Kubernetes Engineer", "Ivy Cloud", "linkedin", "dismissed", 20),
  makeSearchResult("sr-10", "Infrastructure Engineer", "Juno Systems", "indeed", "new", 4),
  makeSearchResult("sr-11", "Automation Engineer", "Kepler Tech", "dice", "tracked", 8),
  makeSearchResult("sr-12", "Cloud Architect", "Lunar Labs", "linkedin", "new", 6),
  makeSearchResult("sr-13", "Systems Administrator", "Meridian Inc", "indeed", "stale", 25),
  makeSearchResult("sr-14", "Release Engineer", "Nebula Networks", "dice", "new", 9),
  makeSearchResult("sr-15", "Security Engineer", "Orbit Systems", "linkedin", "viewed", 11),
]

export const DEMO_SEARCH_PROFILES: SearchProfile[] = [
  makeSearchProfile("profile-indeed", "indeed_profile", "Systems Engineer", "Remote", "indeed", "🔍", 1),
  makeSearchProfile("profile-dice", "dice_profile", "DevOps Engineer", "Remote", "dice", "🎲", 2),
  makeSearchProfile("profile-linkedin", "linkedin_profile", "Cloud Engineer", "Remote", "linkedin", "🔗", 3),
  makeSearchProfile("profile-local", "indy_profile", "Systems Administrator", "Indianapolis, IN", "both", "📍", 4),
]