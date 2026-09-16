import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/testUtils';
import type { ApplicationRecord } from '../api/types';

const hooks = vi.hoisted(() => ({
  useApplications: vi.fn(),
  useUpdateApplication: vi.fn(),
  useRemoveApplication: vi.fn(),
  downloadDoc: vi.fn(),
}));

vi.mock('../hooks/useApplications', () => ({
  useApplications: hooks.useApplications,
  useUpdateApplication: hooks.useUpdateApplication,
  useRemoveApplication: hooks.useRemoveApplication,
}));
vi.mock('../hooks/useApplicationAssistant', () => ({ downloadApplicationDocument: hooks.downloadDoc }));

import { Applications } from './Applications';

const appWithCv: ApplicationRecord = {
  id: 'app-1',
  job_stable_id: 'job-aaa',
  status: 'draft',
  company: 'Acme Corp',
  role: 'IT Support Specialist',
  channel: 'jobstreet',
  fit_rating: 88,
  cv_file: 'storage/applications/cv_wilson_acme.pdf',
  cover_letter_file: null,
  applied_at: '2026-09-01T00:00:00Z',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  available: true,
  job: null,
};

const appNoDocs: ApplicationRecord = {
  id: 'app-2',
  job_stable_id: 'job-bbb',
  status: 'under_review',
  company: 'Beta Inc',
  role: 'Systems Administrator',
  cv_file: null,
  cover_letter_file: null,
  created_at: '2026-09-02T00:00:00Z',
  updated_at: '2026-09-02T00:00:00Z',
  available: true,
  job: null,
};

const updateMutation = { isPending: false, variables: null, mutate: vi.fn() };
const removeMutation = { isPending: false, variables: null, mutate: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  hooks.useApplications.mockReturnValue({ data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() });
  hooks.useUpdateApplication.mockReturnValue(updateMutation);
  hooks.useRemoveApplication.mockReturnValue(removeMutation);
  updateMutation.mutate.mockClear();
  removeMutation.mutate.mockClear();
  hooks.downloadDoc.mockClear();
});

describe('Applications', () => {
  it('shows an empty state with a link to the assistant when there are no applications', () => {
    renderWithProviders(<Applications />);
    expect(screen.getByText('No applications yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open Application Assistant/i })).toBeInTheDocument();
  });

  it('renders rows for both desktop and mobile markup', () => {
    hooks.useApplications.mockReturnValue({
      data: [appWithCv, appNoDocs],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    const { container } = renderWithProviders(<Applications />);
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('.lg\\:hidden')).not.toBeNull();
    expect(screen.getAllByText('IT Support Specialist').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Systems Administrator').length).toBeGreaterThan(0);
  });

  it('shows a generated-CV indicator with a basename-only label and no raw path', () => {
    hooks.useApplications.mockReturnValue({
      data: [appWithCv],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderWithProviders(<Applications />);
    expect(screen.getAllByLabelText('Download CV: cv_wilson_acme.pdf').length).toBeGreaterThan(0);
    expect(screen.queryByText(/storage\/applications/)).not.toBeInTheDocument();
    // No cover letter generated for this app → no download affordance for it.
    expect(screen.queryByLabelText(/Download cover letter/)).not.toBeInTheDocument();
  });

  it('updates an application status through the mutation', async () => {
    const user = userEvent.setup();
    hooks.useApplications.mockReturnValue({
      data: [appWithCv],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderWithProviders(<Applications />);
    const selects = screen.getAllByRole('combobox', { name: 'Application status' });
    await user.selectOptions(selects[0], 'interview');
    expect(updateMutation.mutate).toHaveBeenCalledWith({ appId: 'app-1', payload: { status: 'interview' } });
  });

  it('downloads a generated CV through the shared download helper', async () => {
    const user = userEvent.setup();
    hooks.useApplications.mockReturnValue({
      data: [appWithCv],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderWithProviders(<Applications />);
    const buttons = screen.getAllByLabelText('Download CV: cv_wilson_acme.pdf');
    await user.click(buttons[0]);
    expect(hooks.downloadDoc).toHaveBeenCalledWith('app-1', 'cv');
  });

  it('records a note on an application', async () => {
    const user = userEvent.setup();
    hooks.useApplications.mockReturnValue({
      data: [appNoDocs],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    renderWithProviders(<Applications />);
    const notes = screen.getAllByText(/Add note/);
    await user.click(notes[0]);
    const textarea = screen.getByRole('textbox', { name: 'Application notes' });
    await user.type(textarea, 'Scheduled interview prep');
    await user.tab();
    expect(updateMutation.mutate).toHaveBeenCalledWith({
      appId: 'app-2',
      payload: { notes: 'Scheduled interview prep' },
    });
  });
});