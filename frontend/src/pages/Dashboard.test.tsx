import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test/testUtils';
import type { DashboardResponse, JobSummary, ApplicationRecord, PipelineHealth } from '../api/types';

const hooks = vi.hoisted(() => ({
  useDashboard: vi.fn(),
  useTop5Jobs: vi.fn(),
  useApplications: vi.fn(),
  usePipelineHealth: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock('../hooks/useDashboard', () => ({ useDashboard: hooks.useDashboard }));
vi.mock('../hooks/useRankedJobs', () => ({ useTop5Jobs: hooks.useTop5Jobs }));
vi.mock('../hooks/useApplications', () => ({ useApplications: hooks.useApplications }));
vi.mock('../hooks/usePipelineHealth', () => ({ usePipelineHealth: hooks.usePipelineHealth }));
vi.mock('../context/AuthContext', () => ({ useAuth: hooks.useAuth }));

import { Dashboard } from './Dashboard';

const topJobs: JobSummary[] = [
  {
    stable_id: 'job-aaa',
    title: 'IT Support Specialist',
    company: 'Acme Corp',
    location: 'Makati',
    arrangement: 'remote',
    processing_state: 'ACTIVE_VERIFIED',
    fit: 'high',
    rank_score: 92,
    is_active_pool: true,
    is_application_protected: false,
  },
  {
    stable_id: 'job-bbb',
    title: 'Systems Administrator',
    company: 'Beta Inc',
    location: 'Manila',
    arrangement: 'hybrid',
    processing_state: 'ACTIVE_UNVERIFIED',
    fit: 'medium',
    rank_score: 67,
    is_active_pool: true,
    is_application_protected: false,
  },
];

const apps: ApplicationRecord[] = [
  {
    id: 'app-1',
    job_stable_id: 'job-aaa',
    status: 'draft',
    company: 'Acme Corp',
    role: 'IT Support Specialist',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    available: true,
    job: null,
  },
];

const health: PipelineHealth = {
  overall_health: 'healthy',
  health_issues: [],
  timestamp: '2026-09-01T00:00:00Z',
  data_files: {},
  pipeline_stage: null,
  pipeline_status: null,
  active_jobs_count: 12,
  stale_jobs_count: 2,
  blocked_jobs_count: 0,
  state_distribution: { ACTIVE_VERIFIED: 10, STALE: 2 },
  stage_counts: {},
  portal_health: {},
  current_checkpoint: null,
  run_history: [],
  latest_complete_stages: [],
};

const dashboard: DashboardResponse = {
  user: { id: 'u1', email: 'wilson@example.com', created_at: '2026-01-01T00:00:00Z' },
  profile_readiness: {
    resume_uploaded: true,
    candidate_profile_configured: true,
    search_preferences_configured: false,
    completed_steps: 2,
    total_steps: 3,
    ready: false,
  },
  user_activity: { search_run_count: 1, saved_job_count: 2, application_count: 3, has_activity: true },
  system_overview: {
    status: 'ok',
    pipeline_stage: 'discovery',
    pipeline_status: 'running',
    active_jobs: 12,
    stale_jobs: 2,
    blocked_jobs: 0,
  },
  next_steps: [{ id: 'prefs', label: 'Configure search preferences', description: 'Complete this step.', href: '/preferences', coming_soon: false }],
  last_search_run: null,
  timestamp: '2026-09-01T00:00:00Z',
};

function setOkMocks() {
  hooks.useDashboard.mockReturnValue({ data: dashboard, isLoading: false, isError: false, error: null, refetch: vi.fn() });
  hooks.useTop5Jobs.mockReturnValue({ data: topJobs, isLoading: false, isError: false, error: null, refetch: vi.fn() });
  hooks.useApplications.mockReturnValue({ data: apps, isLoading: false, isError: false, error: null, refetch: vi.fn() });
  hooks.usePipelineHealth.mockReturnValue({ data: health, isLoading: false, isError: false, error: null, refetch: vi.fn() });
  hooks.useAuth.mockReturnValue({ user: { id: 'u1', email: 'wilson@example.com', status: 'active', created_at: '' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  setOkMocks();
});

describe('Dashboard', () => {
  it('renders a personalized welcome heading and page subtitle', () => {
    renderWithProviders(<Dashboard />);
    expect(screen.getByRole('heading', { name: /Welcome back, wilson/i })).toBeInTheDocument();
    expect(screen.getByText(/command center/i)).toBeInTheDocument();
  });

  it('shows real KPI values from dashboard (not fabricated)', () => {
    renderWithProviders(<Dashboard />);
    expect(screen.getByRole('link', { name: /^Active Jobs/i })).toHaveTextContent('12');
    expect(screen.getByRole('link', { name: /^Applications/i })).toHaveTextContent('3');
    expect(screen.getByRole('link', { name: /^Saved Jobs/i })).toHaveTextContent('2');
    expect(screen.getByRole('link', { name: /^Search Runs/i })).toHaveTextContent('1');
  });

  it('renders the pipeline stage banner', () => {
    renderWithProviders(<Dashboard />);
    expect(screen.getByText(/Pipeline stage:/i)).toBeInTheDocument();
    expect(screen.getByText(/discovery/i)).toBeInTheDocument();
  });

  it('lists top ranked opportunities as links to job details', () => {
    renderWithProviders(<Dashboard />);
    const jobDetailLink = (title: string) =>
      screen.getAllByRole('link', { name: new RegExp(title, 'i') }).find((el) =>
        el.getAttribute('href')?.startsWith('/jobs/')
      );
    expect(jobDetailLink('IT Support Specialist')).toBeDefined();
    expect(jobDetailLink('IT Support Specialist')).toHaveAttribute('href', '/jobs/job-aaa');
    expect(jobDetailLink('Systems Administrator')).toHaveAttribute('href', '/jobs/job-bbb');
  });

  it('shows recent application activity with role, company, and status', () => {
    renderWithProviders(<Dashboard />);
    expect(screen.getByRole('heading', { name: 'Application Activity' })).toBeInTheDocument();
    expect(screen.getAllByText('Acme Corp').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
  });

  it('shows profile-readiness rows and next steps', () => {
    renderWithProviders(<Dashboard />);
    expect(screen.getByText('Resume uploaded')).toBeInTheDocument();
    expect(screen.getByText('Configure search preferences')).toBeInTheDocument();
  });

  it('renders a loading skeleton while fetching', () => {
    hooks.useDashboard.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() });
    const { container } = renderWithProviders(<Dashboard />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByLabelText('Loading dashboard')).toBeInTheDocument();
  });

  it('shows a network error state when the dashboard request fails', () => {
    hooks.useDashboard.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Network Error'),
      refetch: vi.fn(),
    });
    renderWithProviders(<Dashboard />);
    expect(screen.getByText('Connection failed')).toBeInTheDocument();
  });
});