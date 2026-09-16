import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Route } from 'react-router-dom';
import { renderWithProviders } from '../test/testUtils';
import type { JobRecord } from '../api/types';

const api = vi.hoisted(() => ({
  publicJobsGet: vi.fn(),
  privateJobsGet: vi.fn(),
  privateApplicationsList: vi.fn(),
  privateSavedList: vi.fn(),
  privatePipelineStatus: vi.fn(),
  privatePipelineRetention: vi.fn(),
}));

vi.mock('../api/endpoints', () => ({
  publicJobsApi: { list: vi.fn(), get: api.publicJobsGet },
  publicApplicationsApi: { list: vi.fn() },
  jobsApi: { list: vi.fn(), get: api.privateJobsGet },
  applicationsApi: { list: api.privateApplicationsList },
  savedJobsApi: { list: api.privateSavedList },
  pipelineApi: { status: api.privatePipelineStatus, retention: api.privatePipelineRetention },
}));

vi.mock('../components/charts/RadarChart', () => ({ RadarChart: () => null }));

import { PublicFitAnalysis } from './PublicFitAnalysis';

const jobWithEvaluation: JobRecord = {
  stable_id: 'demo-001',
  title: 'IT Support Specialist',
  company: 'Demo Corp',
  location: 'Makati',
  salary: 'PHP 30,000 - 45,000',
  url: 'https://example.com/posting',
  portal: 'jobstreet',
  arrangement: 'remote',
  description: 'Provide Tier 2 support.',
  processing_state: 'ACTIVE_VERIFIED',
  changed_fields: [],
  strengths: [],
  gaps: [],
  fit: 'high',
  is_active_pool: true,
  is_application_protected: false,
  evaluation: {
    technical: 90,
    experience: 85,
    behavioral: 80,
    career: 75,
    location: 'Makati',
    location_note: 'Matches current base',
    overall: 88,
    verdict: 'Strong match',
    key_strengths: ['Enterprise Tier 2 support at scale'],
    gaps: ['Formal cloud certification'],
    recommendation: 'Proceed with application',
    evaluated_at: '2026-08-01T00:00:00Z',
  },
};

function renderFit(job?: JobRecord) {
  api.publicJobsGet.mockResolvedValue(job ?? jobWithEvaluation);
  return renderWithProviders(<PublicFitAnalysis />, {
    route: '/demo/jobs/demo-001/fit',
    path: '/demo/jobs/:stable_id/fit',
    extra: <Route path="/demo/jobs/demo-001" element={<div>JOB DETAIL PAGE</div>} />,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PublicFitAnalysis', () => {
  it('renders fit dimensions from the public job endpoint and never calls private APIs', async () => {
    renderFit();
    expect(await screen.findByRole('heading', { name: 'IT Support Specialist' })).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument();
    expect(screen.getByText('90', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Strong match')).toBeInTheDocument();
    expect(screen.getByText('Proceed with application')).toBeInTheDocument();
    expect(screen.getByText('Enterprise Tier 2 support at scale')).toBeInTheDocument();
    expect(screen.getByText('Formal cloud certification')).toBeInTheDocument();
    expect(api.publicJobsGet).toHaveBeenCalledWith('demo-001');
    expect(api.privateJobsGet).not.toHaveBeenCalled();
    expect(api.privateApplicationsList).not.toHaveBeenCalled();
    expect(api.privateSavedList).not.toHaveBeenCalled();
  });

  it('states the demo scope note and exposes no mutation controls', async () => {
    renderFit();
    await screen.findByRole('heading', { name: 'IT Support Specialist' });
    expect(screen.getByText(/Demo scope note/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Generate Application/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Track Application/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save Job/i })).not.toBeInTheDocument();
  });

  it('shows an empty state instead of inventing candidate data when no evaluation exists', async () => {
    renderFit({ ...jobWithEvaluation, evaluation: undefined });
    expect(
      await screen.findByText('No Fit Analysis Available')
    ).toBeInTheDocument();
    expect(screen.queryByText('Proceed with application')).not.toBeInTheDocument();
  });

  it('shows a not-found state for a missing demo job', async () => {
    api.publicJobsGet.mockRejectedValue({ response: { status: 404 } });
    renderWithProviders(<PublicFitAnalysis />, {
      route: '/demo/jobs/demo-999/fit',
      path: '/demo/jobs/:stable_id/fit',
    });
    expect(await screen.findByText('Demo job not found', {}, { timeout: 4000 })).toBeInTheDocument();
  });
});