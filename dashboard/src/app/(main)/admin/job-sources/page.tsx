"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  AlertCircle,
  Briefcase,
  Loader2,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react"
import { useAdminApi, type JobSource } from "@/hooks/use-admin-api"
import { EmptyState } from "@/components/shared/empty-state"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const SOURCE_TYPE_OPTIONS = [
  { value: "job_board", label: "Job board" },
  { value: "api", label: "API connection" },
]

const EMPTY_FORM = {
  name: "",
  source_type: "job_board",
  active: true,
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Request failed")
}

function formatSourceType(value: string): string {
  const knownType = SOURCE_TYPE_OPTIONS.find((option) => option.value === value)
  if (knownType) return knownType.label
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date)
}

function AccessDenied() {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-red-50 text-red-600">
        <LockKeyhole size={24} />
      </div>
      <h1 className="text-lg font-bold text-zinc-900">Access denied</h1>
      <p className="mt-2 max-w-sm text-sm text-zinc-500">
        Administrator access is required to manage job sources.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
      >
        Return to dashboard
      </Link>
    </div>
  )
}

function formatFormError(error: Error): string {
  return error.message || "The request could not be completed."
}

export default function JobSourcesPage() {
  const {
    isAdmin,
    loading: adminLoading,
    error: adminError,
    checkAdmin,
    listJobSources,
    createJobSource,
    updateJobSource,
    deleteJobSource,
  } = useAdminApi()

  const [sources, setSources] = useState<JobSource[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<Error | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSource, setEditingSource] = useState<JobSource | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState("")
  const [saving, setSaving] = useState(false)
  const [deleteSource, setDeleteSource] = useState<JobSource | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [busySourceId, setBusySourceId] = useState<number | null>(null)

  const loadSources = useCallback(async () => {
    if (isAdmin !== true) return

    setListLoading(true)
    setListError(null)

    try {
      const nextSources = await listJobSources(false)
      setSources(nextSources)
    } catch (caught) {
      setListError(toError(caught))
    } finally {
      setListLoading(false)
    }
  }, [isAdmin, listJobSources])

  useEffect(() => {
    if (isAdmin === true) {
      void loadSources()
    }
  }, [isAdmin, loadSources])

  function openCreateDialog() {
    setEditingSource(null)
    setForm(EMPTY_FORM)
    setFormError("")
    setDialogOpen(true)
  }

  function openEditDialog(source: JobSource) {
    setEditingSource(source)
    setForm({
      name: source.name,
      source_type: source.source_type,
      active: source.active,
    })
    setFormError("")
    setDialogOpen(true)
  }

  function handleDialogOpenChange(open: boolean) {
    if (!open && !saving) {
      setEditingSource(null)
      setForm(EMPTY_FORM)
      setFormError("")
    }
    setDialogOpen(open)
  }

  function updateForm(field: "name" | "source_type", value: string) {
    setForm((current) => ({ ...current, [field]: value }))
    setFormError("")
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const name = form.name.trim()
    const sourceType = form.source_type.trim()
    if (!name || !sourceType) {
      setFormError("Name and source type are required.")
      return
    }

    setSaving(true)
    setFormError("")

    try {
      const payload = {
        name,
        source_type: sourceType,
        active: form.active,
      }
      const result = editingSource
        ? await updateJobSource(editingSource.id, payload)
        : await createJobSource(payload)

      if (!result) {
        throw new Error("The job source could not be saved.")
      }

      setDialogOpen(false)
      setEditingSource(null)
      setForm(EMPTY_FORM)
      toast.success(
        editingSource ? "Job source updated." : "Job source created."
      )
      await loadSources()
    } catch (caught) {
      setFormError(formatFormError(toError(caught)))
      toast.error("Job source could not be saved.")
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(source: JobSource, active: boolean) {
    if (busySourceId !== null) return

    setBusySourceId(source.id)
    try {
      const result = await updateJobSource(source.id, { active })
      if (!result) {
        throw new Error("The job source status could not be updated.")
      }

      setSources((current) =>
        current.map((item) => (item.id === source.id ? { ...item, ...result } : item))
      )
      toast.success(
        `${source.name} ${active ? "activated" : "deactivated"}.`
      )
      await loadSources()
    } catch (caught) {
      setListError(toError(caught))
      toast.error("Job source status could not be updated.")
    } finally {
      setBusySourceId(null)
    }
  }

  async function handleDelete() {
    if (!deleteSource) return

    setDeleting(true)
    try {
      const deleted = await deleteJobSource(deleteSource.id)
      if (!deleted) {
        throw new Error("The job source could not be deleted.")
      }

      setSources((current) =>
        current.filter((item) => item.id !== deleteSource.id)
      )
      setDeleteSource(null)
      toast.success("Job source deleted.")
      await loadSources()
    } catch (caught) {
      setListError(toError(caught))
      toast.error("Job source could not be deleted.")
    } finally {
      setDeleting(false)
    }
  }

  if (adminLoading) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
        <Loader2 size={24} className="animate-spin text-amber-600" />
        <p className="mt-4 text-sm font-medium text-zinc-700">
          Checking admin access...
        </p>
      </div>
    )
  }

  if (isAdmin === false) {
    return <AccessDenied />
  }

  if (adminError || isAdmin !== true) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
        <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-red-50 text-red-600">
          <ShieldAlert size={24} />
        </div>
        <h1 className="text-lg font-bold text-zinc-900">
          Admin access could not be verified
        </h1>
        <p className="mt-2 max-w-sm text-sm text-zinc-500">
          {adminError?.message ||
            "Administrative access is unavailable. Try the check again."}
        </p>
        <button
          type="button"
          onClick={() => void checkAdmin()}
          className="mt-6 inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
        >
          <RefreshCw size={14} />
          Retry check
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <Briefcase size={22} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-zinc-900">Job Sources</h1>
            <p className="mt-0.5 text-xs text-zinc-500">
              Manage job boards and API connections used by CareerPilot.
            </p>
          </div>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus size={16} className="mr-1.5" />
          Add Job Source
        </Button>
      </div>

      {listError && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800"
        >
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Unable to load job sources</p>
            <p className="mt-0.5 text-xs text-red-700">{listError.message}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadSources()}
            className="shrink-0 border-red-200 bg-white text-red-800 hover:bg-red-50"
          >
            <RefreshCw size={14} className="mr-1" />
            Retry
          </Button>
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Configured sources</CardTitle>
            <CardDescription>
              {sources.length} {sources.length === 1 ? "source" : "sources"}{" "}
              available to the job search tools.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void loadSources()}
            disabled={listLoading}
            className="text-zinc-600"
          >
            <RefreshCw
              size={14}
              className={listLoading ? "mr-1 animate-spin" : "mr-1"}
            />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {listLoading ? (
            <div className="space-y-3 p-4" aria-live="polite">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="h-12 animate-pulse rounded-lg bg-zinc-100"
                />
              ))}
            </div>
          ) : sources.length === 0 ? (
            <EmptyState
              icon={Briefcase}
              title="No job sources configured"
              description="Add a job board or API connection to make it available to job search tools."
              actions={[{ label: "Add Job Source", onClick: openCreateDialog }]}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-32">Updated</TableHead>
                    <TableHead className="w-36 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sources.map((source) => (
                    <TableRow key={source.id}>
                      <TableCell className="font-medium text-zinc-900">
                        <div className="flex items-center gap-2">
                          <span className="max-w-[180px] truncate sm:max-w-none">
                            {source.name}
                          </span>
                          {!source.active && (
                            <span className="text-[10px] font-medium text-zinc-400">
                              Inactive
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-zinc-600">
                        {formatSourceType(source.source_type)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={
                            source.active
                              ? "inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700"
                              : "inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600"
                          }
                        >
                          <span
                            className={
                              source.active ? "size-1.5 rounded-full bg-emerald-500" : "size-1.5 rounded-full bg-zinc-400"
                            }
                          />
                          {source.active ? "Active" : "Inactive"}
                        </span>
                      </TableCell>
                      <TableCell
                        className="text-sm text-zinc-500"
                        title={`Created ${source.created_at}; updated ${source.updated_at}`}
                      >
                        {formatTimestamp(source.updated_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Switch
                            size="sm"
                            checked={source.active}
                            disabled={busySourceId === source.id}
                            aria-label={`${source.active ? "Deactivate" : "Activate"} ${source.name}`}
                            onCheckedChange={(checked) =>
                              void handleToggle(source, checked)
                            }
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Edit ${source.name}`}
                            onClick={() => openEditDialog(source)}
                            className="text-zinc-500 hover:text-zinc-900"
                          >
                            <Pencil size={14} />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Delete ${source.name}`}
                            onClick={() => setDeleteSource(source)}
                            className="text-red-600 hover:bg-red-50 hover:text-red-700"
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingSource ? "Edit Job Source" : "Add Job Source"}
            </DialogTitle>
            <DialogDescription>
              {editingSource
                ? "Update the name, type, or availability of this source."
                : "Add a job board or API connection for job search tools."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="job-source-name">Name</Label>
              <Input
                id="job-source-name"
                value={form.name}
                onChange={(event) =>
                  updateForm("name", event.target.value)
                }
                placeholder="Indeed"
                maxLength={255}
                autoFocus
                aria-invalid={Boolean(formError && !form.name.trim())}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="job-source-type">Source type</Label>
              <Select
                value={form.source_type}
                onValueChange={(value) => {
                  if (value) updateForm("source_type", value)
                }}
              >
                <SelectTrigger id="job-source-type" className="w-full" aria-label="Source type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                  {form.source_type &&
                    !SOURCE_TYPE_OPTIONS.some(
                      (option) => option.value === form.source_type
                    ) && (
                      <SelectItem value={form.source_type}>
                        {formatSourceType(form.source_type)}
                      </SelectItem>
                    )}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5">
              <div>
                <Label htmlFor="job-source-active">Active</Label>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  Make this source available to job search tools.
                </p>
              </div>
              <Switch
                id="job-source-active"
                checked={form.active}
                onCheckedChange={(checked) =>
                  setForm((current) => ({ ...current, active: checked }))
                }
              />
            </div>

            {formError && (
              <p role="alert" className="text-xs font-medium text-red-700">
                {formError}
              </p>
            )}

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleDialogOpenChange(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 size={14} className="mr-1.5 animate-spin" />}
                {editingSource ? "Save changes" : "Add Job Source"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteSource !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteSource(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Job Source</DialogTitle>
            <DialogDescription>
              Delete{" "}
              <span className="font-semibold text-zinc-900">
                {deleteSource?.name}
              </span>
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {listError && deleteSource && (
            <p role="alert" className="text-xs font-medium text-red-700">
              {listError.message}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteSource(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={deleting}
            >
              {deleting && (
                <Loader2 size={14} className="mr-1.5 animate-spin" />
              )}
              Delete Job Source
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
