import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test/testUtils';
import type { PublicApplicationRecord } from '../api/types';

const api = vi.hoisted(() => ({
  publicApplicationsList: vi.fn(),
  privateApplicationsList: vi.fn(),
  privateSavedList: vi.fn(),
  privatePipelineStatus: vi.fn(),
  privatePipelineRetention: vi.fn(),
}));

vi.mock('../api/endpoints', () => ({
  publicApplicationsApi: { list: api.publicApplicationsList },
  publicJobsApi: { list: vi.fn() },
  applicationsApi: { list: api.privateApplicationsList },
  savedJobsApi: { list: api.privateSavedList },
  pipelineApi: { status: api.privatePipelineStatus, retention: api.privatePipelineRetention },
}));

import { PublicPipeline } from './PublicPipeline';

const apps: PublicApplicationRecord[] = [
  { stable_id: 'job-001', date: '2026-08-25', company: 'Acme', role: 'Support', status: 'draft', channel: 'jobstreet', fit_rating: 80 },
  { stable_id: 'job-002', date: '2026-08-20', company: 'Beta', role: 'SysAdmin', status: 'submitted', channel: 'jobstreet', fit_rating: 85 },
  { stable_id: 'job-003', date: '2026-08-15', company: 'Gamma', role: 'Net Admin', status: 'interview', channel: 'indeed', fit_rating: 70 },
  { stable_id: 'job-004', date: '2026-08-10', company: 'Delta', role: 'Helpdesk', status: 'offer', channel: 'linkedin', fit_rating: 90 },
  { stable_id: 'job-005', date: '2026-08-05', company: 'Epsilon', role: 'EUC Tech', status: 'accepted', channel: 'jobstreet', fit_rating: 95 },
  { stable_id: 'job-006', date: '2026-08-01', company: 'Zeta', role: 'Support L2', status: 'rejected', channel: 'bossjob', fit_rating: 55 },
];

function renderPipeline() {
  return renderWithProviders(<PublicPipeline />, { route: '/demo/pipeline', path: '/demo/pipeline' });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.publicApplicationsList.mockResolvedValue(apps);
});

describe('PublicPipeline', () => {
  it('computes the funnel from public demo applications and never calls private APIs', async () => {
    renderPipeline();
    expect(await screen.findByText('Total Applications')).toBeInTheDocument();
    // 6 total → Total card shows "6"; In Progress (submitted+interview)=2 and Offers+Accepted (offer+accepted)=2.
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getAllByText('2')).toHaveLength(2);
    expect(screen.getByText('jobstreet')).toBeInTheDocument();
    expect(screen.getByText('linkedin')).toBeInTheDocument();
    // Stage + outcome labels render in the funnel and the status table.
    for (const label of [
      'Draft',
      'Submitted',
      'Under Review',
      'Interview',
      'Offer',
      'Accepted',
      'Rejected',
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(api.publicApplicationsList).toHaveBeenCalled();
    expect(api.privateApplicationsList).not.toHaveBeenCalled();
    expect(api.privatePipelineStatus).not.toHaveBeenCalled();
    expect(api.privatePipelineRetention).not.toHaveBeenCalled();
  });

  it('renders a loading skeleton, then read-only status breakdown', async () => {
    const { container } = renderPipeline();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(await screen.findByText('Status Breakdown')).toBeInTheDocument();
    expect(await screen.findByText('Channel Breakdown')).toBeInTheDocument();
  });
});