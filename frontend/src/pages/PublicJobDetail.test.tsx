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

import { PublicJobDetail } from './PublicJobDetail';

const job: JobRecord = {
  stable_id: 'demo-001',
  title: 'IT Support Specialist',
  company: 'Demo Corp',
  location: 'Makati',
  salary: 'PHP 30,000 - 45,000',
  url: 'https://example.com/posting',
  portal: 'jobstreet',
  arrangement: 'remote',
  description: 'Provide Tier 2 support for a large enterprise environment.',
  processing_state: 'ACTIVE_VERIFIED',
  changed_fields: [],
  strengths: [],
  gaps: [],
  fit: 'high',
  rank_score: 88,
  rank_verdict: 'Strong match',
  rank_date: '2026-08-01T00:00:00Z',
  priority_tier: 1,
  is_active_pool: true,
  is_application_protected: false,
  evaluation: {
    technical: 90,
    experience: 85,
    behavioral: 80,
    career: 75,
    overall: 88,
    verdict: 'Strong match',
    key_strengths: ['Enterprise Tier 2 support at scale'],
    gaps: ['Formal cloud certification'],
  },
};

function renderDetail() {
  return renderWithProviders(<PublicJobDetail />, {
    route: '/demo/jobs/demo-001',
    path: '/demo/jobs/:stable_id',
    extra: <Route path="/demo/jobs/demo-001/fit" element={<div>FIT PAGE</div>} />,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.publicJobsGet.mockResolvedValue(job);
});

describe('PublicJobDetail', () => {
  it('loads the job from the public jobs endpoint and never calls private APIs', async () => {
    renderDetail();
    expect(await screen.findByRole('heading', { name: 'IT Support Specialist' })).toBeInTheDocument();
    // Rendered without any auth token: proves no JWT is required for the demo.
    expect(window.localStorage.getItem('careerpilot_token')).toBeNull();
    expect(api.publicJobsGet).toHaveBeenCalledWith('demo-001');
    expect(api.privateJobsGet).not.toHaveBeenCalled();
    expect(api.privateApplicationsList).not.toHaveBeenCalled();
    expect(api.privateSavedList).not.toHaveBeenCalled();
    expect(api.privatePipelineStatus).not.toHaveBeenCalled();
    expect(api.privatePipelineRetention).not.toHaveBeenCalled();
  });

  it('exposes no mutation controls', async () => {
    renderDetail();
    await screen.findByText('Public Demo — Read Only');
    expect(screen.getByText(/no Apply Now, Save, or Track feature here/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Generate Application/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Track Application/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save Job/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Apply/i })).not.toBeInTheDocument();
  });

  it('links the full fit analysis to the demo fit route', async () => {
    renderDetail();
    const link = await screen.findByRole('link', { name: /View full fit analysis/i });
    expect(link).toHaveAttribute('href', '/demo/jobs/demo-001/fit');
  });

  it('renders the original posting as a safe http/https href', async () => {
    renderDetail();
    const link = await screen.findByRole('link', { name: /View Original Posting/i });
    expect(link).toHaveAttribute('href', 'https://example.com/posting');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('does not render a clickable link for an unsafe scraped URL', async () => {
    api.publicJobsGet.mockResolvedValue({ ...job, url: 'javascript:alert(1)' });
    renderDetail();
    await screen.findByRole('heading', { name: 'IT Support Specialist' });
    expect(screen.queryByRole('link', { name: /View Original Posting/i })).not.toBeInTheDocument();
  });

  it('renders a loading skeleton while fetching', () => {
    api.publicJobsGet.mockReturnValue(new Promise(() => {}));
    const { container } = renderDetail();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('shows a not-found state when the demo job is missing (404)', async () => {
    api.publicJobsGet.mockRejectedValue({ response: { status: 404 } });
    renderDetail();
    // usePublicJob retries once before settling as an error, so allow extra time.
    expect(await screen.findByText('Demo job not found', {}, { timeout: 4000 })).toBeInTheDocument();
  });
});