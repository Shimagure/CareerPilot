import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/testUtils';
import type { ApplicationRecord } from '../../api/types';
import { DocumentGenerator } from './DocumentGenerator';

const hooks = vi.hoisted(() => ({
  useGenerateApplicationDocuments: vi.fn(),
  downloadDoc: vi.fn(),
}));

vi.mock('../../hooks/useApplicationAssistant', () => ({
  useGenerateApplicationDocuments: hooks.useGenerateApplicationDocuments,
  downloadApplicationDocument: hooks.downloadDoc,
}));

const createdApp: ApplicationRecord = {
  id: 'app-new',
  job_stable_id: 'job-1',
  status: 'draft',
  company: 'Acme Corp',
  role: 'IT Support Specialist',
  cv_file: 'storage/applications/cv_generated.pdf',
  cover_letter_file: 'storage/applications/cover_generated.pdf',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  available: true,
  job: null,
};

const openApplication: ApplicationRecord = {
  id: 'app-existing',
  job_stable_id: 'job-1',
  status: 'submitted',
  company: 'Acme Corp',
  role: 'IT Support Specialist',
  cv_file: 'storage/applications/cv_existing.pdf',
  cover_letter_file: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  available: true,
  job: null,
};

interface MockMutation {
  data?: ApplicationRecord;
  isPending?: boolean;
  isError?: boolean;
  error?: unknown;
  variables?: { stable_id: string; generate_cv?: boolean; generate_cover_letter?: boolean; status?: string };
  reset?: ReturnType<typeof vi.fn>;
  mutate?: ReturnType<typeof vi.fn>;
}

function makeMutation(overrides: MockMutation = {}) {
  return {
    data: undefined,
    isPending: false,
    isError: false,
    error: null,
    variables: undefined,
    reset: vi.fn(),
    mutate: vi.fn(),
    ...overrides,
  };
}

const mutateSpy = vi.fn();
const resetSpy = vi.fn();
let current: ReturnType<typeof makeMutation>;

beforeEach(() => {
  vi.clearAllMocks();
  current = makeMutation({ mutate: mutateSpy, reset: resetSpy });
  hooks.useGenerateApplicationDocuments.mockReturnValue(current);
});

describe('DocumentGenerator', () => {
  it('renders the idle card with all three generation options', () => {
    renderWithProviders(<DocumentGenerator stableId="job-1" jobTitle="IT Support Specialist" company="Acme Corp" />);
    expect(screen.getByText('Generate Application Documents')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate CV/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate Cover Letter/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate Both/i })).toBeInTheDocument();
  });

  it('starts generation with the right flags when Generate CV is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DocumentGenerator stableId="job-1" channel="jobstreet" />);
    await user.click(screen.getByRole('button', { name: /Generate CV/i }));
    expect(mutateSpy).toHaveBeenCalledWith({
      stable_id: 'job-1',
      status: 'draft',
      channel: 'jobstreet',
      generate_cv: true,
      generate_cover_letter: false,
    });
  });

  it('shows a progress card while generation is pending', () => {
    current.isPending = true;
    current.variables = { stable_id: 'job-1', generate_cv: true, generate_cover_letter: false };
    const ui = <DocumentGenerator stableId="job-1" jobTitle="IT Support Specialist" company="Acme" />;
    const { rerender } = renderWithProviders(ui);
    rerender(ui);
    expect(screen.getByText(/Generating CV/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Generating application documents')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Generate Both/i })).not.toBeInTheDocument();
  });

  it('shows ready documents with basename-only filenames after success', () => {
    current.data = createdApp;
    current.variables = { stable_id: 'job-1', generate_cv: true, generate_cover_letter: true };
    const ui = <DocumentGenerator stableId="job-1" />;
    const { rerender } = renderWithProviders(ui);
    rerender(ui);
    expect(screen.getByText(/Application created — documents are ready/i)).toBeInTheDocument();
    expect(screen.getByText('cv_generated.pdf')).toBeInTheDocument();
    expect(screen.getByText('cover_generated.pdf')).toBeInTheDocument();
    expect(screen.queryByText(/storage\/applications/)).not.toBeInTheDocument();
  });

  it('shows a useful error and can dismiss it', async () => {
    const user = userEvent.setup();
    current.isError = true;
    current.error = new Error('Over quota');
    const ui = <DocumentGenerator stableId="job-1" />;
    const { rerender } = renderWithProviders(ui);
    rerender(ui);
    expect(screen.getByRole('alert')).toHaveTextContent('Over quota');
    await user.click(screen.getByRole('button', { name: /Dismiss/i }));
    expect(resetSpy).toHaveBeenCalled();
  });

  it('blocks regeneration but allows downloads for an open existing application', () => {
    const ui = (
      <DocumentGenerator
        stableId="job-1"
        application={openApplication}
      />
    );
    renderWithProviders(ui);
    expect(screen.getByText('This job is already tracked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Generate CV/i })).not.toBeInTheDocument();
    expect(screen.getByText('cv_existing.pdf')).toBeInTheDocument();
    // No cover letter generated → marked as not generated, no download for it.
    expect(screen.getByText('Not generated')).toBeInTheDocument();
  });

  it('downloads a generated document through the shared helper', async () => {
    const user = userEvent.setup();
    current.data = createdApp;
    const ui = <DocumentGenerator stableId="job-1" />;
    const { rerender } = renderWithProviders(ui);
    rerender(ui);
    const buttons = screen.getAllByRole('button', { name: /Download/ });
    await user.click(buttons[0]);
    expect(hooks.downloadDoc).toHaveBeenCalledWith('app-new', 'cv');
  });
});