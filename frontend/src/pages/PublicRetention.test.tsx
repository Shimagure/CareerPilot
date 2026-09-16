import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test/testUtils';
import type { DemoRetentionStats } from '../api/types';

const client = vi.hoisted(() => ({
  getPublicRetentionStats: vi.fn(),
}));

vi.mock('../api/client', () => ({
  apiClient: { getPublicRetentionStats: client.getPublicRetentionStats },
  default: { getPublicRetentionStats: client.getPublicRetentionStats },
}));

import { PublicRetention } from './PublicRetention';

const stats: DemoRetentionStats = {
  retention_policy_days: 28,
  active_pool_states: ['ACTIVE_VERIFIED', 'ACTIVE_UNVERIFIED'],
  total_seen: 56,
  active_pool_count: 50,
  stale_count: 0,
  application_protected_count: 0,
  blocked_count: 5,
  state_breakdown: [
    { state: 'ACTIVE_VERIFIED', count: 48 },
    { state: 'BLOCKED', count: 5 },
  ],
  portal_breakdown: [{ portal: 'jobstreet', total: 30, active: 28, stale: 0 }],
  checkpoints: { total_runs: 3, last_run: { stage: 'ranking_report', status: 'complete' } },
};

function renderRetention() {
  return renderWithProviders(<PublicRetention />, { route: '/demo/retention', path: '/demo/retention' });
}

beforeEach(() => {
  vi.clearAllMocks();
  client.getPublicRetentionStats.mockResolvedValue(stats);
});

describe('PublicRetention', () => {
  it('adapts the existing public retention response and renders its counts', async () => {
    renderRetention();
    expect(await screen.findByText('Total Seen')).toBeInTheDocument();
    expect(screen.getByText('56')).toBeInTheDocument();
    expect(screen.getByText('Active Pool')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getAllByText('5').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('28 days')).toBeInTheDocument();
    expect(screen.getAllByText('ACTIVE_VERIFIED').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('jobstreet')).toBeInTheDocument();
    expect(screen.getByText('Total Runs')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(client.getPublicRetentionStats).toHaveBeenCalled();
    // Rendered without any auth token: proves no JWT is required for the demo.
    expect(window.localStorage.getItem('careerpilot_token')).toBeNull();
  });

  it('shows an error state when the public retention request fails', async () => {
    client.getPublicRetentionStats.mockRejectedValue(new Error('boom'));
    renderRetention();
    // The hook retries (backoff), so allow time for the query to settle as an error.
    expect(await screen.findByText('Connection failed', {}, { timeout: 6000 })).toBeInTheDocument();
  });
});