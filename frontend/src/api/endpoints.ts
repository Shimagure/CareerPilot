import apiClient from './client';
import type {
  HealthResponse,
  JobListResponse,
  JobRecord,
  JobSummary,
  SavedJobItem,
  ApplicationRecord,
  PublicApplicationRecord,
  PipelineStatus,
  ApplicationCreate,
  ApplicationUpdate,
  PipelineHealth,
  RetentionResponse,
  DashboardResponse,
  ResumeRecord,
  ProfileGetResponse,
  ProfileUpdateRequest,
  ProfileExtractResponse,
  CandidateProfileResponse,
  PreferencesGetResponse,
  SearchPreferencesUpdateRequest,
  SearchPreferencesResponse,
  StartSearchRequest,
  SearchRunResponse,
  SearchRunListResponse,
} from './types';

/** Health check endpoint */
export const healthApi = {
  check: () => apiClient.healthCheck() as Promise<HealthResponse>,
};

/** Public Jobs endpoints (no auth) */
export const publicJobsApi = {
  list: (params?: {
    sort?: 'rank_score' | 'evaluated_at' | 'created_at';
    order?: 'asc' | 'desc';
    limit?: number;
  }) => apiClient.getPublicJobs(params) as Promise<JobSummary[]>,

  get: (stable_id: string) => apiClient.getPublicJob(stable_id) as Promise<JobRecord>,
};

/** Public Applications endpoints (no auth) */
export const publicApplicationsApi = {
  list: () => apiClient.getPublicApplications() as Promise<PublicApplicationRecord[]>,
};

/** Jobs endpoints */
export const jobsApi = {
  list: (params?: {
    state?: string;
    arrangement?: string;
    fit?: string;
    active_only?: boolean;
    page?: number;
    page_size?: number;
  }) => apiClient.getJobs(params) as Promise<JobListResponse>,

  get: (stable_id: string) => apiClient.getJob(stable_id) as Promise<JobRecord>,
};

/** Ranked jobs endpoints */
export const rankedApi = {
  top5: () => apiClient.getTop5() as Promise<JobSummary[]>,
  top10: () => apiClient.getTop10() as Promise<JobSummary[]>,
  all: () => apiClient.getAllRanked() as Promise<JobSummary[]>,
};

/** Saved Jobs endpoints (Checkpoint 11) — authenticated, user-scoped bookmarks */
export const savedJobsApi = {
  list: () => apiClient.getSavedJobs() as Promise<SavedJobItem[]>,
  save: (stableId: string) => apiClient.saveJob(stableId) as Promise<SavedJobItem>,
  unsave: (stableId: string) => apiClient.unsaveJob(stableId) as Promise<void>,
};

/** Applications endpoints (Checkpoint 12) — DB-backed, user-scoped, JWT-authenticated */
export type ApplicationDocumentKind = 'cv' | 'cover_letter';

export interface GenerateDocumentsOptions {
  generateCv?: boolean;
  generateCoverLetter?: boolean;
}

export const applicationsApi = {
  list: () => apiClient.getApplications() as Promise<ApplicationRecord[]>,
  get: (appId: string) => apiClient.getApplication(appId) as Promise<ApplicationRecord>,
  create: (payload: ApplicationCreate) => apiClient.createApplication(payload) as Promise<ApplicationRecord>,
  createWithDocuments: (payload: ApplicationCreate, options: GenerateDocumentsOptions = {}) =>
    apiClient.createApplicationWithDocuments(payload, options) as Promise<ApplicationRecord>,
  update: (appId: string, payload: ApplicationUpdate) => apiClient.updateApplication(appId, payload) as Promise<ApplicationRecord>,
  remove: (appId: string) => apiClient.deleteApplication(appId) as Promise<void>,
  downloadDocument: (appId: string, docKind: ApplicationDocumentKind) =>
    apiClient.downloadApplicationDocument(appId, docKind),
};

/** Pipeline endpoints */
export const pipelineApi = {
  status: () => apiClient.getPipelineStatus() as Promise<PipelineStatus>,
  health: () => apiClient.getPipelineHealth() as Promise<PipelineHealth>,
  retention: () => apiClient.getRetentionStats() as Promise<RetentionResponse>,
};

/** Authenticated dashboard endpoints */
export const dashboardApi = {
  get: () => apiClient.getDashboard() as Promise<DashboardResponse>,
};

/** Authenticated resume endpoints */
export const resumeApi = {
  get: () => apiClient.getResumeMetadata() as Promise<ResumeRecord>,
  upload: (file: File) => apiClient.uploadResume(file) as Promise<ResumeRecord>,
  download: () => apiClient.downloadResume(),
};

/** Authenticated profile endpoints (Checkpoint 5) */
export const profileApi = {
  get: () => apiClient.getProfile() as Promise<ProfileGetResponse>,
  update: (payload: ProfileUpdateRequest) => apiClient.updateProfile(payload) as Promise<CandidateProfileResponse>,
  extract: () => apiClient.extractProfile() as Promise<ProfileExtractResponse>,
};

/** Authenticated search preferences endpoints (Checkpoint 6) */
export const preferencesApi = {
  get: () => apiClient.getPreferences() as Promise<PreferencesGetResponse>,
  update: (payload: SearchPreferencesUpdateRequest) => apiClient.updatePreferences(payload) as Promise<SearchPreferencesResponse>,
};

/** Authenticated job search endpoints (Checkpoint 7) */
export const searchApi = {
  start: (payload: StartSearchRequest) => apiClient.startSearch(payload) as Promise<SearchRunResponse>,
  get: (runId: string) => apiClient.getSearchRun(runId) as Promise<SearchRunResponse>,
  list: (params?: { limit?: number; offset?: number }) => apiClient.listSearchRuns(params) as Promise<SearchRunListResponse>,
};