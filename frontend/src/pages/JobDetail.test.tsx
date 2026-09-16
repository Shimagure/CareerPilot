import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route } from 'react-router-dom';
import { renderWithProviders } from '../test/testUtils';
import type { JobRecord, ApplicationRecord } from '../api/types';

const hooks = vi.hoisted(() => ({
  useJob: vi.fn(),
  useApplications: vi.fn(),
  useCreateApplication: vi.fn(),
}));

vi.mock('../hooks/useJob', () => ({ useJob: hooks.useJob }));
vi.mock('../hooks/useApplications', () => ({
  useApplications: hooks.useApplications,
  useCreateApplication: hooks.useCreateApplication,
}));
vi.mock('../components/common/SavedToggleButton', () => ({ SavedToggleButton: () => null }));

import { JobDetail } from './JobDetail';

const job: JobRecord = {
  stable_id: 'job-123',
  title: 'IT Support Specialist',
  company: 'Acme Corp',
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
};

const linkedApp: ApplicationRecord = {
  id: 'app-9',
  job_stable_id: 'job-123',
  status: 'submitted',
  company: 'Acme Corp',
  role: 'IT Support Specialist',
  channel: 'jobstreet',
  cv_file: 'storage/applications/cv_wilson_acme.pdf',
  cover_letter_file: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  available: true,
  job: null,
};

const createMutation = { isPending: false, isError: false, error: null, mutate: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  hooks.useJob.mockReturnValue({ data: job, isLoading: false, isError: false, error: null, refetch: vi.fn() });
  hooks.useApplications.mockReturnValue({ data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() });
  hooks.useCreateApplication.mockReturnValue(createMutation);
  createMutation.mutate.mockClear();
});

function renderDetail() {
  return renderWithProviders(<JobDetail />, {
    route: '/jobs/job-123',
    path: '/jobs/:stable_id',
    extra: <Route path="/assistant" element={<div>ASSISTANT PAGE</div>} />,
  });
}

describe('JobDetail', () => {
  it('renders the job title, company, and key attributes', () => {
    renderDetail();
    expect(screen.getByRole('heading', { name: 'IT Support Specialist' })).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getAllByText('jobstreet').length).toBeGreaterThan(0);
  });

  it('shows the Generate Application CTA and navigates to the assistant', async () => {
    const user = userEvent.setup();
    renderDetail();
    const cta = screen.getByRole('button', { name: /Generate Application/i });
    expect(cta).toBeInTheDocument();
    await user.click(cta);
    expect(screen.getByText('ASSISTANT PAGE')).toBeInTheDocument();
  });

  it('lets an untracked job be tracked with the correct payload', async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole('button', { name: /Track Application/i }));
    expect(createMutation.mutate).toHaveBeenCalledWith({
      stable_id: 'job-123',
      channel: 'jobstreet',
      status: 'draft',
    });
  });

  it('hides Track Application and shows doc indicators for a linked application', () => {
    hooks.useApplications.mockReturnValue({
      data: [linkedApp],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderDetail();
    expect(screen.queryByRole('button', { name: /Track Application/i })).not.toBeInTheDocument();
    expect(screen.getByText('submitted')).toBeInTheDocument();
    expect(screen.getByText('CV generated')).toBeInTheDocument();
    // Only the basename is shown — never the raw server path.
    expect(screen.getByText('cv_wilson_acme.pdf')).toBeInTheDocument();
    expect(screen.queryByText(/storage\/applications/)).not.toBeInTheDocument();
  });

  it('renders a loading skeleton while fetching', () => {
    hooks.useJob.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() });
    const { container } = renderDetail();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('shows a not-found state when the job is missing (404)', () => {
    hooks.useJob.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { response: { status: 404 } },
      refetch: vi.fn(),
    });
    renderDetail();
    expect(screen.getByText('Job not found')).toBeInTheDocument();
  });

  it('renders the job link as a safe http/https href', () => {
    hooks.useJob.mockReturnValue({
      data: { ...job, url: 'https://example.com/posting?apply=1' },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderDetail();
    const link = screen.getByRole('link', { name: /View Original Posting/i });
    expect(link).toHaveAttribute('href', 'https://example.com/posting?apply=1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('does not render a clickable link for an unsafe scraped URL', () => {
    hooks.useJob.mockReturnValue({
      data: { ...job, url: 'javascript:alert(1)' },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderDetail();
    expect(screen.queryByRole('link', { name: /View Original Posting/i })).not.toBeInTheDocument();
  });
});