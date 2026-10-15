export type AdminApiRequestOptions = Omit<RequestInit, "body" | "headers"> & {
  body?: unknown
  headers?: HeadersInit
}

export class AdminApiError extends Error {
  status: number
  statusText: string
  data: unknown

  constructor(response: Response, data: unknown) {
    const detail = getErrorDetail(data)
    super(detail || `Admin API request failed with status ${response.status}`)
    this.name = "AdminApiError"
    this.status = response.status
    this.statusText = response.statusText
    this.data = data
  }
}

function getErrorDetail(data: unknown): string | null {
  if (!data || typeof data !== "object") return null

  const record = data as Record<string, unknown>
  if (typeof record.detail === "string") return record.detail
  if (typeof record.error === "string") return record.error
  return null
}

function getAdminApiUrl(path: string): string {
  const suppliedPath = path.startsWith("/") ? path : `/${path}`
  const adminPrefix = "/api/admin"
  const hasAdminPrefix =
    suppliedPath === adminPrefix || suppliedPath.startsWith(`${adminPrefix}/`)
  const hasOtherApiPrefix =
    suppliedPath === "/api" || suppliedPath.startsWith("/api/")
  const normalizedPath = hasAdminPrefix
    ? suppliedPath
    : `${adminPrefix}${suppliedPath}`
  const pathWithoutQuery = normalizedPath.split(/[?#]/, 1)[0]
  const outsideAdminPrefix =
    normalizedPath !== adminPrefix &&
    !normalizedPath.startsWith(`${adminPrefix}/`)

  if (
    normalizedPath.startsWith("//") ||
    normalizedPath.includes("://") ||
    pathWithoutQuery.split("/").includes("..") ||
    (!hasAdminPrefix && hasOtherApiPrefix) ||
    outsideAdminPrefix
  ) {
    throw new Error("Admin API paths must be relative /api/admin URLs")
  }

  return normalizedPath
}

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return null

  const text = await response.text()
  if (!text) return null

  const contentType = response.headers.get("content-type") || ""
  if (contentType.includes("application/json") || contentType.includes("+json")) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  return text
}

export async function adminApiRequest<T>(
  path: string,
  options: AdminApiRequestOptions = {}
): Promise<T | null> {
  const headers = new Headers(options.headers)
  let body: BodyInit | undefined

  if (options.body !== undefined) {
    if (
      typeof options.body === "string" ||
      options.body instanceof FormData ||
      options.body instanceof URLSearchParams ||
      options.body instanceof Blob ||
      options.body instanceof ArrayBuffer
    ) {
      body = options.body as BodyInit
    } else {
      headers.set("content-type", "application/json")
      body = JSON.stringify(options.body)
    }
  }

  const response = await fetch(getAdminApiUrl(path), {
    ...options,
    body,
    headers,
    cache: options.cache ?? "no-store",
  })
  const data = await parseResponse(response)

  if (!response.ok) {
    throw new AdminApiError(response, data)
  }

  return data as T | null
}
