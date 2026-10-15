import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import JobSourcesPage from "@/app/(main)/admin/job-sources/page"

const adminApi = vi.hoisted(() => ({
  isAdmin: true,
  loading: false,
  error: null,
  checkAdmin: vi.fn(),
  listJobSources: vi.fn(),
  createJobSource: vi.fn(),
  updateJobSource: vi.fn(),
  deleteJobSource: vi.fn(),
}))

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock("@/hooks/use-admin-api", () => ({
  useAdminApi: () => adminApi,
}))

vi.mock("sonner", () => ({
  toast,
}))

const source = {
  id: 1,
  name: "Indeed",
  source_type: "job_board",
  active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
}

function renderPage() {
  render(<JobSourcesPage />)
}

describe("Job Sources admin page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adminApi.isAdmin = true
    adminApi.loading = false
    adminApi.error = null
    adminApi.listJobSources.mockResolvedValue([source])
    adminApi.createJobSource.mockResolvedValue({
      ...source,
      id: 2,
      name: "LinkedIn",
    })
    adminApi.updateJobSource.mockResolvedValue(source)
    adminApi.deleteJobSource.mockResolvedValue(true)
  })

  it("lists job sources", async () => {
    renderPage()

    expect(await screen.findByText("Indeed")).toBeInTheDocument()
    expect(screen.getByText("Job board")).toBeInTheDocument()
    expect(screen.getByText("Active")).toBeInTheDocument()
    expect(screen.getByText("Jan 2, 2026")).toBeInTheDocument()
    expect(adminApi.listJobSources).toHaveBeenCalledWith(false)
  })

  it("shows an empty state", async () => {
    adminApi.listJobSources.mockResolvedValue([])

    renderPage()

    expect(
      await screen.findByText("No job sources configured")
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Add a job board or API connection to make it available to job search tools."
      )
    ).toBeInTheDocument()
  })

  it("shows an API error with a retry action", async () => {
    adminApi.listJobSources.mockRejectedValue(new Error("Failed to load sources"))

    renderPage()

    expect(
      await screen.findByText("Unable to load job sources")
    ).toBeInTheDocument()
    expect(screen.getByText("Failed to load sources")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    await waitFor(() => expect(adminApi.listJobSources).toHaveBeenCalledTimes(2))
  })

  it("creates a job source", async () => {
    renderPage()

    expect(await screen.findByText("Indeed")).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: "Add Job Source" })
    )

    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "LinkedIn" },
    })
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Add Job Source" })
    )

    await waitFor(() => {
      expect(adminApi.createJobSource).toHaveBeenCalledWith({
        name: "LinkedIn",
        source_type: "job_board",
        active: true,
      })
      expect(adminApi.listJobSources).toHaveBeenCalledTimes(2)
    })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith("Job source created.")
  })

  it("updates a job source", async () => {
    renderPage()

    expect(await screen.findByText("Indeed")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Edit Indeed" }))

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Indeed")
    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "Indeed Pro" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }))

    await waitFor(() => {
      expect(adminApi.updateJobSource).toHaveBeenCalledWith(1, {
        name: "Indeed Pro",
        source_type: "job_board",
        active: true,
      })
      expect(adminApi.listJobSources).toHaveBeenCalledTimes(2)
    })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith("Job source updated.")
  })

  it("deletes a job source", async () => {
    renderPage()

    expect(await screen.findByText("Indeed")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Delete Indeed" }))

    const dialog = await screen.findByRole("dialog")
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete Job Source" })
    )

    await waitFor(() => {
      expect(adminApi.deleteJobSource).toHaveBeenCalledWith(1)
      expect(adminApi.listJobSources).toHaveBeenCalledTimes(2)
    })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith("Job source deleted.")
  })

  it("shows access denied for a non-admin", async () => {
    adminApi.isAdmin = false

    renderPage()

    expect(await screen.findByText("Access denied")).toBeInTheDocument()
    expect(
      screen.getByText("Administrator access is required to manage job sources.")
    ).toBeInTheDocument()
    expect(adminApi.listJobSources).not.toHaveBeenCalled()
  })
})
