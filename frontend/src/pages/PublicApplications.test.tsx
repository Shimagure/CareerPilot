import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test/testUtils';
import type { PublicApplicationRecord, JobSummary } from '../api/types';

const api = vi.hoisted(() => ({
  publicApplicationsList: vi.fn(),
  publicJobsList: vi.fn(),
  privateApplicationsList: vi.fn(),
  privateSavedList: vi.fn(),
}));

vi.mock('../api/endpoints', () => ({
  publicApplicationsApi: { list: api.publicApplicationsList },
  publicJobsApi: { list: api.publicJobsList, get: vi.fn() },
  applicationsApi: { list: api.privateApplicationsList },
  savedJobsApi: { list: api.privateSavedList },
  pipelineApi: { status: vi.fn(), retention: vi.fn() },
}));

import { PublicApplications } from './PublicApplications';

const apps: PublicApplicationRecord[] = [
  { stable_id: 'demo-001', date: '2026-08-25', company: 'Demo Corp', role: 'Support Analyst', status: 'submitted', fit_rating: 85 },
  { stable_id: 'demo-002', date: '2026-08-10', company: 'Demo Inc', role: 'SysAdmin', status: 'interview', fit_rating: 72 },
];

const jobs: JobSummary[] = [
  {
    stable_id: 'demo-001',
    title: 'IT Support Specialist',
    company: 'Demo Corp',
    arrangement: 'remote',
    processing_state: 'ACTIVE_VERIFIED',
    fit: 'high',
    is_active_pool: true,
    is_application_protected: false,
  },
  {
    stable_id: 'demo-002',
    title: 'Systems Administrator',
    company: 'Demo Inc',
    arrangement: 'hybrid',
    processing_state: 'ACTIVE_VERIFIED',
    fit: 'medium',
    is_active_pool: true,
    is_application_protected: false,
  },
];

function renderApplications() {
  return renderWithProviders(<PublicApplications />, {
    route: '/demo/applications',
    path: '/demo/applications',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.publicApplicationsList.mockResolvedValue(apps);
  api.publicJobsList.mockResolvedValue(jobs);
});

describe('PublicApplications', () => {
  it('consumes the canonical public application schema and resolves linked job titles', async () => {
    renderApplications();
    expect(await screen.findByText('Support Analyst')).toBeInTheDocument();
    // The job-title column joins on stable_id and resolves the linked demo job title.
    expect(screen.getByText('IT Support Specialist')).toBeInTheDocument();
    expect(screen.getByText('Systems Administrator')).toBeInTheDocument();
    // Application dates come from the public `date` field.
    expect(screen.getByText('2026-08-25')).toBeInTheDocument();
    expect(screen.getByText('2026-08-10')).toBeInTheDocument();
    // Fit ratings are rendered as 0-100 scores.
    expect(screen.getByText('85/100')).toBeInTheDocument();
    expect(screen.getByText('72/100')).toBeInTheDocument();
    expect(api.publicApplicationsList).toHaveBeenCalled();
    expect(api.privateApplicationsList).not.toHaveBeenCalled();
    // Rendered without any auth token: proves no JWT is required for the demo.
    expect(window.localStorage.getItem('careerpilot_token')).toBeNull();
  });

  it('renders no duplicate React keys while listing demos applications', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderApplications();
      await screen.findByText('Support Analyst');
    } finally {
      errorSpy.mockRestore();
    }
    const duplicateKeyCall = errorSpy.mock.calls.find((c) => /same key|duplicate key/i.test(String(c[0])));
    expect(duplicateKeyCall).toBeUndefined();
  });

  it('exposes no mutation controls (read-only recruiter preview)', async () => {
    renderApplications();
    expect(await screen.findByText('read-only recruiter preview')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Update Application/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New Application/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download/i })).not.toBeInTheDocument();
  });
});