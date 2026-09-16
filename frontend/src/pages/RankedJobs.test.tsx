import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/testUtils';
import type { JobSummary, ApplicationRecord } from '../api/types';

const hooks = vi.hoisted(() => ({
  useTop5Jobs: vi.fn(),
  useTop10Jobs: vi.fn(),
  useAllRankedJobs: vi.fn(),
  useApplications: vi.fn(),
}));

vi.mock('../hooks/useRankedJobs', () => ({
  useTop5Jobs: hooks.useTop5Jobs,
  useTop10Jobs: hooks.useTop10Jobs,
  useAllRankedJobs: hooks.useAllRankedJobs,
}));
vi.mock('../hooks/useApplications', () => ({ useApplications: hooks.useApplications }));
vi.mock('../components/common/SavedToggleButton', () => ({ SavedToggleButton: () => null }));

import { RankedJobs } from './RankedJobs';

function summary(overrides: Partial<JobSummary>): JobSummary {
  return {
    stable_id: 'job-x',
    title: 'Job X',
    company: 'Company X',
    location: 'Manila',
    arrangement: 'remote',
    processing_state: 'ACTIVE_VERIFIED',
    fit: 'high',
    rank_score: 80,
    is_active_pool: true,
    is_application_protected: false,
    ...overrides,
  };
}

const top5: JobSummary[] = [
  summary({ stable_id: 'job-hi', title: 'IT Support Lead', company: 'Acme', fit: 'high', rank_score: 95 }),
  summary({ stable_id: 'job-md', title: 'Desktop Support II', company: 'Beta', fit: 'medium', rank_score: 60 }),
];

const allRanked: JobSummary[] = [
  ...top5,
  summary({ stable_id: 'job-lo', title: 'Helpdesk Assistant', company: 'Gamma', fit: 'low', rank_score: 30 }),
];

const trackedApp: ApplicationRecord = {
  id: 'app-tracked',
  job_stable_id: 'job-hi',
  status: 'submitted',
  company: 'Acme',
  role: 'IT Support Lead',
  fit_rating: 85,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  available: true,
  job: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  hooks.useTop5Jobs.mockReturnValue({ data: top5, isLoading: false, isError: false, error: null, refetch: vi.fn() });
  hooks.useTop10Jobs.mockReturnValue({ data: top5, isLoading: false, isError: false, error: null, refetch: vi.fn() });
  hooks.useAllRankedJobs.mockReturnValue({ data: allRanked, isLoading: false, isError: false, error: null, refetch: vi.fn() });
  hooks.useApplications.mockReturnValue({ data: [trackedApp], isLoading: false, isError: false, error: null, refetch: vi.fn() });
});

describe('RankedJobs', () => {
  it('renders the honest global-pipeline disclosure', () => {
    renderWithProviders(<RankedJobs />);
    expect(screen.getByText(/Global pipeline data/i)).toBeInTheDocument();
  });

  it('shows the Top 5 by default and two jobs in view', () => {
    renderWithProviders(<RankedJobs />);
    expect(screen.getAllByText('IT Support Lead').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Desktop Support II').length).toBeGreaterThan(0);
    // Subtitle text is split across separate text nodes, so match on the <p> itself.
    expect(jobsInView(2)).toBeInTheDocument();
  });

  it('switches to All Ranked and shows the wider set', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RankedJobs />);
    await user.click(screen.getByRole('tab', { name: 'All Ranked' }));
    expect(screen.getAllByText('Helpdesk Assistant').length).toBeGreaterThan(0);
    expect(jobsInView(3)).toBeInTheDocument();
  });

  it('filters by fit level within the current view', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RankedJobs />);
    await user.selectOptions(screen.getByLabelText('Filter by fit level'), 'medium');
    expect(screen.getAllByText('Desktop Support II').length).toBeGreaterThan(0);
    expect(screen.queryByText('IT Support Lead')).not.toBeInTheDocument();
    expect(jobsInView(1)).toBeInTheDocument();
  });

  it('shows tracked vs untracked application state per job', () => {
    renderWithProviders(<RankedJobs />);
    // job-hi is tracked with a fit rating → status + score shown (desktop + mobile both render)
    expect(screen.getAllByText('submitted').length).toBeGreaterThan(0);
    expect(screen.getAllByText('85/100').length).toBeGreaterThan(0);
    // job-md is untracked
    expect(screen.getAllByText('Not yet tracked').length).toBeGreaterThan(0);
  });

  it('renders both desktop table and mobile cards (responsive markup)', () => {
    const { container } = renderWithProviders(<RankedJobs />);
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('.lg\\:hidden')).not.toBeNull();
  });
});

/** The page subtitle renders "… · N job(s) in view" across several text nodes — match the <p> by textContent. */
function jobsInView(count: number) {
  const needle = `${count} job${count === 1 ? '' : 's'} in view`;
  return screen.getByText(
    (_content, el) => el?.tagName === 'P' && (el.textContent ?? '').includes(needle)
  );
}