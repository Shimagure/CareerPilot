import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/testUtils';
import type { JobSummary } from '../api/types';

const hooks = vi.hoisted(() => ({
  useJobs: vi.fn(),
}));

vi.mock('../hooks/useJobs', () => ({ useJobs: hooks.useJobs }));

import { Jobs } from './Jobs';

const baseJobs: JobSummary[] = [
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
    arrangement: 'onsite',
    processing_state: 'STALE',
    fit: 'medium',
    rank_score: 45,
    is_active_pool: false,
    is_application_protected: false,
  },
  {
    stable_id: 'job-ccc',
    title: 'Endpoint Security Analyst',
    company: 'Gamma Ltd',
    location: 'Quezon City',
    arrangement: 'hybrid',
    processing_state: 'NEW',
    fit: 'high',
    rank_score: 71,
    is_active_pool: true,
    is_application_protected: false,
  },
];

const refetch = vi.fn();

/** Mock useJobs such that filtering/paging is applied client-side to baseJobs. */
function installMock(list = baseJobs) {
  hooks.useJobs.mockImplementation((params = {}) => {
    let result = [...list];
    if (params.state) result = result.filter((j) => j.processing_state === params.state);
    if (params.arrangement) result = result.filter((j) => j.arrangement === params.arrangement);
    if (params.fit) result = result.filter((j) => j.fit === params.fit);
    const page = params.page ?? 1;
    const pageSize = params.page_size ?? 20;
    const paged = result.slice((page - 1) * pageSize, page * pageSize);
    return {
      data: { jobs: paged, total: result.length, page, page_size: pageSize, filters: {} },
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  refetch.mockClear();
  installMock();
});

describe('Jobs', () => {
  it('renders all jobs with their companies in the table', () => {
    renderWithProviders(<Jobs />);
    expect(screen.getByText(/Showing 3 of 3 jobs/i)).toBeInTheDocument();
    expect(screen.getByText('IT Support Specialist')).toBeInTheDocument();
    expect(screen.getByText('Systems Administrator')).toBeInTheDocument();
    expect(screen.getByText('Endpoint Security Analyst')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });

  it('filters by arrangement and updates the visible set', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Jobs />);
    await user.selectOptions(screen.getByLabelText('Arrangement'), 'remote');
    expect(screen.getByText(/Showing 1 of 1 jobs/i)).toBeInTheDocument();
    expect(screen.getByText('IT Support Specialist')).toBeInTheDocument();
    expect(screen.queryByText('Endpoint Security Analyst')).not.toBeInTheDocument();
  });

  it('filters by fit level', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Jobs />);
    await user.selectOptions(screen.getByLabelText('Fit'), 'medium');
    expect(screen.getByText(/Showing 1 of 1 jobs/i)).toBeInTheDocument();
    expect(screen.getByText('Systems Administrator')).toBeInTheDocument();
    expect(screen.queryByText('IT Support Specialist')).not.toBeInTheDocument();
  });

  it('clears active filters and restores the full list', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Jobs />);
    await user.selectOptions(screen.getByLabelText('Fit'), 'medium');
    expect(screen.getByText(/Showing 1 of 1 jobs/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Clear Filters/i }));
    expect(screen.getByText(/Showing 3 of 3 jobs/i)).toBeInTheDocument();
  });

  it('paginates a long list and pages through it', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 25 }, (_, i): JobSummary => ({
      stable_id: `job-x${i}`,
      title: `Job ${i + 1}`,
      company: 'Multi Corp',
      location: 'Manila',
      arrangement: 'remote',
      processing_state: 'ACTIVE_VERIFIED',
      fit: 'high',
      rank_score: 50,
      is_active_pool: true,
      is_application_protected: false,
    }));
    installMock(many);
    renderWithProviders(<Jobs />);

    expect(pageIndicator('1', '2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Previous/i })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /Next/i }));
    expect(screen.getByText(/Showing 5 of 25 jobs/i)).toBeInTheDocument();
    expect(pageIndicator('2', '2')).toBeInTheDocument();
    expect(screen.getByText('Job 21')).toBeInTheDocument();
    expect(screen.queryByText('Job 1')).not.toBeInTheDocument();
  });

  it('shows a no-jobs empty state when the filtered list is empty', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Jobs />);
    await user.selectOptions(screen.getByLabelText('Fit'), 'low');
    expect(screen.getAllByText('No jobs found').length).toBeGreaterThan(0);
  });

  it('refetches when the Refresh button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Jobs />);
    await user.click(screen.getByRole('button', { name: /Refresh/i }));
    expect(refetch).toHaveBeenCalled();
  });
});

/** The pagination footer renders "Page <span>N</span> of M · T total" — match the <p> by textContent. */
function pageIndicator(page: string, total: string) {
  const needle = `Page ${page} of ${total}`;
  return screen.getByText(
    (_content, el) => el?.tagName === 'P' && (el.textContent ?? '').includes(needle)
  );
}