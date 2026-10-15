"use client"

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/contexts/auth-context"
import {
  AdminApiError,
  adminApiRequest,
  type AdminApiRequestOptions,
} from "@/lib/api-client"

export interface AdminStatusResponse {
  isAdmin: boolean
}

export interface JobSource {
  id: number
  name: string
  source_type: string
  active: boolean
  created_at: string
  updated_at: string
}

export interface JobSourceCreate {
  name: string
  source_type?: string
  active?: boolean
}

export interface JobSourceUpdate {
  name?: string
  source_type?: string
  active?: boolean
}

export interface SystemUser {
  id: string
  name: string
  role: string
  created_at: string
  updated_at: string
}

export interface UseAdminApiResult {
  isAdmin: boolean | null
  loading: boolean
  error: Error | null
  checkAdmin: () => Promise<boolean>
  request: <T>(
    path: string,
    options?: AdminApiRequestOptions
  ) => Promise<T | null>
  listJobSources: (activeOnly?: boolean) => Promise<JobSource[]>
  getJobSource: (id: number) => Promise<JobSource | null>
  createJobSource: (payload: JobSourceCreate) => Promise<JobSource | null>
  updateJobSource: (id: number, payload: JobSourceUpdate) => Promise<JobSource | null>
  deleteJobSource: (id: number) => Promise<boolean>
  listUsers: (limit?: number, offset?: number) => Promise<SystemUser[]>
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export function useAdminApi(): UseAdminApiResult {
  const { user, loading: authLoading } = useAuth()
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const request = useCallback(async <T,>(
    path: string,
    options: AdminApiRequestOptions = {}
  ): Promise<T | null> => {
    const { data, error: sessionError } = await createClient().auth.getSession()
    if (sessionError) throw sessionError
    if (!data.session?.access_token) throw new Error("Authentication required")

    const headers = new Headers(options.headers)
    headers.set("Authorization", `Bearer ${data.session.access_token}`)

    return adminApiRequest<T>(path, { ...options, headers })
  }, [])

  const checkAdmin = useCallback(async (): Promise<boolean> => {
    setLoading(true)
    setError(null)

    try {
      const status = await request<AdminStatusResponse>("status")
      const admin = status?.isAdmin === true
      setIsAdmin(admin)
      return admin
    } catch (caught) {
      const apiError = caught instanceof AdminApiError ? caught : null
      if (apiError?.status === 403) {
        setIsAdmin(false)
        return false
      }

      const nextError = toError(caught)
      setError(nextError)
      setIsAdmin(null)
      return false
    } finally {
      setLoading(false)
    }
  }, [request])

  const listJobSources = useCallback(
    async (activeOnly = true): Promise<JobSource[]> => {
      const response = await request<JobSource[]>(`job-sources?active_only=${activeOnly}`)
      return response ?? []
    },
    [request]
  )

  const getJobSource = useCallback(
    async (id: number): Promise<JobSource | null> => {
      return request<JobSource>(`job-sources/${id}`)
    },
    [request]
  )

  const createJobSource = useCallback(
    async (payload: JobSourceCreate): Promise<JobSource | null> => {
      return request<JobSource>("job-sources", {
        method: "POST",
        body: payload,
      })
    },
    [request]
  )

  const updateJobSource = useCallback(
    async (id: number, payload: JobSourceUpdate): Promise<JobSource | null> => {
      return request<JobSource>(`job-sources/${id}`, {
        method: "PATCH",
        body: payload,
      })
    },
    [request]
  )

  const deleteJobSource = useCallback(
    async (id: number): Promise<boolean> => {
      await request<null>(`job-sources/${id}`, {
        method: "DELETE",
      })
      return true
    },
    [request]
  )

  const listUsers = useCallback(
    async (limit = 100, offset = 0): Promise<SystemUser[]> => {
      const response = await request<SystemUser[]>(
        `users?limit=${limit}&offset=${offset}`
      )
      return response ?? []
    },
    [request]
  )

  useEffect(() => {
    const userId = user?.id
    if (authLoading) return

    if (!userId) {
      setIsAdmin(null)
      setLoading(false)
      return
    }

    void checkAdmin().then(() => undefined)
  }, [authLoading, user?.id, checkAdmin])

  return {
    isAdmin,
    loading,
    error,
    checkAdmin,
    request,
    listJobSources,
    getJobSource,
    createJobSource,
    updateJobSource,
    deleteJobSource,
    listUsers,
  }
}
