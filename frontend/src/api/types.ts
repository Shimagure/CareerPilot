/** TypeScript types matching backend Pydantic schemas from backend/app/models/schemas.py */

// Auth types
export interface User {
  id: string;
  email: string;
  status: string;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface AuthResponse {
  user: User;
}

export interface MessageResponse {
  message: string;
}

// Dashboard (authenticated User Workspace) types
export interface DashboardUser {
  id: string;
  email: string;
  created_at: string;
}

export interface ProfileReadiness {
  resume_uploaded: boolean;
  candidate_profile_configured: boolean;
  search_preferences_configured: boolean;
  completed_steps: number;
  total_steps: number;
  ready: boolean;
}

export interface UserActivity {
  search_run_count: number;
  saved_job_count: number;
  application_count: number;
  has_activity: boolean;
}

export interface SystemOverview {
  status: string;
  pipeline_stage: string | null;
  pipeline_status: string | null;
  active_jobs: number | null;
  stale_jobs: number | null;
  blocked_jobs: number | null;
}

export interface NextStep {
  id: string;
  label: string;
  description: string;
  href: string | null;
  coming_soon: boolean;
}

export interface LastSearchRun {
  id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  pipeline_stage: string | null;
  result_summary: Record<string, unknown> | null;
  created_at: string;
}

export interface DashboardResponse {
  user: DashboardUser;
  profile_readiness: ProfileReadiness;
  user_activity: UserActivity;
  system_overview: SystemOverview;
  next_steps: NextStep[];
  last_search_run: LastSearchRun | null;
  timestamp: string;
}

// Resume (authenticated) types
export interface ResumeRecord {
  id: string;
  filename: string;
  content_type: string;
  file_size: number;
  status: string;
  uploaded_at: string;
}

export type ProcessingState =
  | 'NEW'
  | 'NEEDS_VERIFICATION'
  | 'ACTIVE_VERIFIED'
  | 'ACTIVE_UNVERIFIED'
  | 'STALE'
  | 'CHANGED'
  | 'CLOSED_OR_EXPIRED'
  | 'POSTING_CHANGED'
  | 'DUPLICATE_OR_INVALID'
  | 'DEPRIORITIZE'
  | 'UNKNOWN';

export type WorkArrangement =
  | 'remote'
  | 'hybrid'
  | 'onsite'
  | 'unspecified';

export type FitLevel =
  | 'high'
  | 'medium'
  | 'low'
  | 'unknown';

export type PipelineStage =
  | 'discovery'
  | 'canonicalization'
  | 'hard_filter'
  | 'priority_queue'
  | 'verification'
  | 'scoring'
  | 'ranking_report';

export type StageStatus =
  | 'in_progress'
  | 'complete'
  | 'failed';

export interface Evaluation {
  technical?: number | null;
  experience?: number | null;
  behavioral?: number | null;
  location?: string | null;
  location_note?: string | null;
  career?: number | null;
  overall?: number | null;
  verdict?: string | null;
  key_strengths: string[];
  gaps: string[];
  recommendation?: string | null;
  evaluated_at?: string | null;
}

export interface JobRecord {
  stable_id: string;
  title: string;
  company: string;
  location?: string | null;
  salary?: string | null;
  url: string;
  portal?: string | null;
  arrangement: WorkArrangement;
  work_mode?: string | null;
  description?: string | null;
  processing_state: ProcessingState;
  first_seen?: string | null;
  last_verified?: string | null;
  blocked_at?: string | null;
  blocked_reason?: string | null;
  changed_at?: string | null;
  changed_fields: string[];
  closed_at?: string | null;
  fingerprint?: string | null;
  previous_fingerprint?: string | null;
  rank_score?: number | null;
  rank_verdict?: string | null;
  rank_date?: string | null;
  strengths: string[];
  gaps: string[];
  fit: FitLevel;
  status?: string | null;
  priority_tier?: number | null;
  last_active_at?: string | null;
  is_active_pool?: boolean | null;
  is_application_protected?: boolean | null;
  evaluation?: Evaluation | null;
}

export interface JobSummary {
  stable_id: string;
  title: string;
  company: string;
  location?: string | null;
  arrangement: WorkArrangement;
  salary?: string | null;
  portal?: string | null;
  processing_state: ProcessingState;
  rank_score?: number | null;
  rank_verdict?: string | null;
  fit: FitLevel;
  is_active_pool: boolean;
  is_application_protected: boolean;
}

/** One saved job for the authenticated user (Checkpoint 11).
 * ``available`` is false when the job no longer exists in the global dataset;
 * in that case ``job`` is null and no field is fabricated. */
export interface SavedJobItem {
  stable_id: string;
  saved_at: string;
  available: boolean;
  job: JobRecord | null;
}

/** Application tracking statuses (backend ApplicationStatus enum). */
export const APPLICATION_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
  'accepted',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export interface ApplicationRecord {
  id: string;
  job_stable_id: string;
  status: ApplicationStatus;
  company: string;
  role: string;
  role_type?: string | null;
  sector?: string | null;
  channel?: string | null;
  contact_person?: string | null;
  fit_rating?: number | null;
  notes?: string | null;
  cv_file?: string | null;
  cover_letter_file?: string | null;
  source?: string | null;
  applied_at?: string | null;
  responded_at?: string | null;
  interview_at?: string | null;
  decided_at?: string | null;
  created_at: string;
  updated_at: string;
  available: boolean;
  job: JobRecord | null;
}

/**
 * Public demo application record — the canonical payload shape served by
 * GET /api/public/applications (fictional records from DemoDataStore).
 * Deliberately separate from the authenticated ApplicationRecord: the public
 * contract uses `stable_id` for the job link and `date` for the application
 * date, and never carries real candidate data.
 */
export interface PublicApplicationRecord {
  stable_id: string;
  date: string;
  company: string;
  sector?: string | null;
  role: string;
  role_type?: string | null;
  channel?: string | null;
  status: ApplicationStatus;
  contact_person?: string | null;
  fit_rating?: number | null;
  notes?: string | null;
  cv_file?: string | null;
  cover_letter_file?: string | null;
  source?: string | null;
}

export interface ApplicationCreate {
  stable_id: string;
  status?: ApplicationStatus;
  fit_rating?: number;
  sector?: string;
  role_type?: string;
  channel?: string;
  source?: string;
  notes?: string;
}

export interface ApplicationUpdate {
  status?: ApplicationStatus;
  fit_rating?: number;
  sector?: string;
  role_type?: string;
  channel?: string;
  contact_person?: string;
  source?: string;
  notes?: string;
}

export interface PipelineCheckpoint {
  run_id: string;
  started_at: string;
  mode?: string | null;
  stage: PipelineStage;
  stage_status: StageStatus;
  jobs_processed_in_stage: number;
  total_jobs_in_stage: number;
  batch_index?: number | null;
  total_batches?: number | null;
  last_updated: string;
  error?: string | null;
  passed?: number | null;
  deprioritized?: number | null;
  queue_length?: number | null;
  tier_breakdown?: Record<string, number> | null;
  verified?: number | null;
  blocked?: number | null;
  changed?: number | null;
  closed?: number | null;
  top5_count?: number | null;
  top10_count?: number | null;
}

export interface PipelineStatus {
  current_checkpoint?: PipelineCheckpoint | null;
  run_history: PipelineCheckpoint[];
  data_files: Record<string, boolean>;
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  data_files: Record<string, boolean>;
  pipeline_stage?: string | null;
  pipeline_status?: string | null;
  active_jobs_count?: number | null;
  stale_jobs_count?: number | null;
  blocked_jobs_count?: number | null;
  state_distribution?: Record<string, number>;
}

export interface PortalHealth {
  total: number;
  active: number;
  blocked: number;
  stale: number;
  closed: number;
}

export interface PublicPortalHealth {
  status: string;
  timestamp: string;
  active_jobs_count: number;
  stale_jobs_count: number;
  blocked_jobs_count: number;
  state_distribution: Record<string, number>;
  is_demo_mode: boolean;
}

export interface PipelineHealth {
  overall_health: 'healthy' | 'warning' | 'error';
  health_issues: string[];
  timestamp: string;
  data_files: Record<string, boolean>;
  pipeline_stage: string | null;
  pipeline_status: string | null;
  active_jobs_count: number | null;
  stale_jobs_count: number | null;
  blocked_jobs_count: number | null;
  state_distribution: Record<string, number>;
  stage_counts: Record<string, number>;
  portal_health: Record<string, PortalHealth>;
  current_checkpoint: PipelineCheckpoint | null;
  run_history: PipelineCheckpoint[];
  latest_complete_stages: string[];
}

export interface JobListResponse {
  jobs: JobSummary[];
  total: number;
  page: number;
  page_size: number;
  filters: Record<string, unknown>;
}

export interface ErrorResponse {
  detail: string;
  status_code: number;
}

export interface RetentionPolicy {
  stale_job_days: number;
  active_pool_states: string[];
  description: string;
  last_activity_fallback_chain: string[];
  application_protection: string;
}

export interface RetentionSummary {
  total_jobs_analyzed: number;
  total_in_active_states: number;
  active_pool_count: number;
  stale_count: number;
  protected_count: number;
  active_percentage: number;
  stale_percentage: number;
  protected_percentage: number;
}

export interface StateBreakdown {
  total: number;
  in_active_pool: number;
  stale: number;
  protected: number;
  has_date: number;
  no_date: number;
}

export interface PortalBreakdown {
  total: number;
  in_active_pool: number;
  stale: number;
  protected: number;
}

export interface RetentionCheckpoint {
  run_id: string;
  stage: string;
  stage_status: string;
  jobs_processed: number;
  total_jobs: number;
  started_at: string;
  last_updated: string;
  verified?: number | null;
  blocked?: number | null;
  changed?: number | null;
  closed?: number | null;
}

export interface RetentionResponse {
  retention_policy: RetentionPolicy;
  summary: RetentionSummary;
  state_breakdown: Record<string, StateBreakdown>;
  portal_breakdown: Record<string, PortalBreakdown>;
  retention_checkpoints: RetentionCheckpoint[];
  timestamp: string;
}

export interface DemoStatus {
  status: string;
  timestamp: string;
  data_files: Record<string, boolean>;
  pipeline_stage?: string | null;
  pipeline_status?: string | null;
  active_jobs_count?: number | null;
  stale_jobs_count?: number | null;
  blocked_jobs_count?: number | null;
  state_distribution?: Record<string, number>;
  is_demo_mode?: boolean;
}

export interface DemoActionResponse {
  status: string;
  message: string;
  active_jobs_count?: number;
  health?: DemoStatus;
  pipeline?: {
    current_stage?: string | null;
    run_history_count?: number;
  };
}

export interface DemoRetentionStats {
  retention_policy_days: number;
  active_pool_states: string[];
  total_seen: number;
  active_pool_count: number;
  stale_count: number;
  application_protected_count: number;
  blocked_count: number;
  state_breakdown: Array<{ state: string; count: number }>;
  portal_breakdown: Array<{
    portal: string;
    total: number;
    active: number;
    stale: number;
  }>;
  checkpoints: {
    total_runs: number;
    last_run: Record<string, unknown> | null;
  };
}

// Profile (Checkpoint 5) types
export type ProfileSource = 'resume_extracted' | 'user_verified';

export interface SkillItem {
  name: string;
  source: ProfileSource;
}

export interface ExperienceItem {
  employer?: string | null;
  title?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  description?: string | null;
  source: ProfileSource;
}

export interface EducationItem {
  institution?: string | null;
  degree?: string | null;
  field?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  source: ProfileSource;
}

export interface CertificationItem {
  name: string;
  issuer?: string | null;
  year?: string | null;
  source: ProfileSource;
}

export interface LanguageItem {
  name: string;
  level?: string | null;
  source: ProfileSource;
}

export interface ProjectItem {
  name: string;
  description?: string | null;
  url?: string | null;
  source: ProfileSource;
}

export interface ProfileUpdateRequest {
  full_name?: string | null;
  headline?: string | null;
  location?: string | null;
  phone?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  portfolio_url?: string | null;
  professional_summary?: string | null;
  skills?: SkillItem[] | null;
  experience?: ExperienceItem[] | null;
  education?: EducationItem[] | null;
  certifications?: CertificationItem[] | null;
  languages?: LanguageItem[] | null;
  projects?: ProjectItem[] | null;
  source_resume_id?: string | null;
}

export interface CandidateProfileResponse {
  id?: string | null;
  full_name?: string | null;
  headline?: string | null;
  location?: string | null;
  phone?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  portfolio_url?: string | null;
  professional_summary?: string | null;
  skills: SkillItem[];
  experience: ExperienceItem[];
  education: EducationItem[];
  certifications: CertificationItem[];
  languages: LanguageItem[];
  projects: ProjectItem[];
  source_resume_id?: string | null;
  source_resume_filename?: string | null;
  manually_edited: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ProfileGetResponse {
  profile: CandidateProfileResponse | null;
  has_active_resume: boolean;
}

export interface ProfileExtractResponse {
  resume_id: string;
  resume_filename: string;
  has_text: boolean;
  warning: string | null;
  draft: CandidateProfileResponse;
}

// Search Preferences (Checkpoint 6) types
export type SalaryPeriod = 'monthly' | 'annual';

export type PreferenceWorkArrangement = 'remote' | 'hybrid' | 'onsite';

export interface SearchPreferencesResponse {
  id: string;
  target_roles: string[];
  excluded_keywords: string[];
  preferred_locations: string[];
  ncr_only: boolean;
  work_arrangements: PreferenceWorkArrangement[];
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  salary_period: SalaryPeriod;
  day_shift_ok: boolean;
  night_shift_ok: boolean;
  rotational_ok: boolean;
  career_direction: string | null;
  configured: boolean;
  created_at: string;
  updated_at: string;
}

export interface SearchPreferencesUpdateRequest {
  target_roles?: string[];
  excluded_keywords?: string[];
  preferred_locations?: string[];
  ncr_only?: boolean;
  work_arrangements?: PreferenceWorkArrangement[];
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string;
  salary_period?: SalaryPeriod;
  day_shift_ok?: boolean;
  night_shift_ok?: boolean;
  rotational_ok?: boolean;
  career_direction?: string | null;
}

export interface PreferencesGetResponse {
  preferences: SearchPreferencesResponse | null;
}

// Search (Checkpoint 7) types
export type SearchRunStatus = 'queued' | 'running' | 'completed' | 'failed';

export type SearchPipelineStage = 'preparing' | 'discovery' | 'completed' | 'failed';

export interface StartSearchRequest {
  dry_run?: boolean;
  search_keywords?: string;
  search_location?: string;
}

export interface SearchRunResponse {
  id: string;
  status: SearchRunStatus;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  pipeline_stage: SearchPipelineStage | null;
  preference_snapshot: Record<string, unknown> | null;
  execution_options: Record<string, unknown> | null;
  result_summary: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface SearchRunListResponse {
  runs: SearchRunResponse[];
  total: number;
  limit: number;
  offset: number;
}