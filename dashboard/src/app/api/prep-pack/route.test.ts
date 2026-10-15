// @vitest-environment node
// dashboard/src/app/api/prep-pack/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrepPackJobRequest } from '@/lib/prep-pack/types';
import { NextResponse } from 'next/server';

const { mockSpawn, mockWriteFile, mockMkdir } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockWriteFile: vi.fn(),
  mockMkdir: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockReturnValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
    },
  }),
}));

vi.mock('node:path', () => {
  const actualPath = require('path');
  return {
    ...actualPath,
    default: actualPath,
    __esModule: true,
  };
});

vi.mock('child_process', () => {
  const spawnMock = vi.fn((...args: any[]) => {
    mockSpawn(...args);
    return {
      unref: vi.fn(),
      on: vi.fn(),
      pid: 42,
    };
  });
  return {
    spawn: spawnMock,
    default: { spawn: spawnMock },
  };
});

vi.mock('fs/promises', () => ({
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  default: { writeFile: mockWriteFile, mkdir: mockMkdir },
}));

import { POST } from './route';

const minimalReq: PrepPackJobRequest = {
  intelligence: {
    company: 'Irving Materials',
    jobTitle: 'IT Network and Sys Admin',
    applicationId: 'abc-123',
  },
  config: {
    voice: 'Steffan',
    depth: 'Standard',
    mode: 'Single',
    produceKindle: true,
    kindleFormat: 'KFX',
    customFocus: '',
  },
  // Must contain at least one `## ` heading and 200+ chars of stripped
  // content to pass the route's source-content validation.
  sourceText:
    '# Test source — Test Title\n\n' +
    '## Career Narrative Angle\n' +
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' +
    'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ' +
    'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.\n\n' +
    '## Why This Role Fits\n' +
    'Duis aute irure dolor in reprehenderit in voluptate velit esse ' +
    'cillum dolore eu fugiat nulla pariatur.\n',
};

beforeEach(() => {
  mockSpawn.mockClear();
  mockWriteFile.mockClear();
  mockMkdir.mockClear();
});

describe('POST /api/prep-pack', () => {
  it('returns 202 with the planned job stem and expected output paths', async () => {
    const req = new Request('http://localhost/api/prep-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(minimalReq),
    });

    const res = await POST(req);
    if (res.status !== 202) {
      console.log(await res.json());
    }
    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body.status).toBe('started');
    expect(body.jobStem).toMatch(/^irving_materials_it_network_and_sys_admin_prep_\d{4}-\d{2}-\d{2}-\d{4}$/);
    expect(body.inputPath).toContain('Inbox');
    expect(body.expectedOutputs.mp3).toContain('audiobooks');
    expect(body.expectedOutputs.vaultNote).toContain('Audiobooks');
    expect(body.expectedOutputs.kindle).toBeDefined();
  });

  it('writes the source text to the Inbox path', async () => {
    const req = new Request('http://localhost/api/prep-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(minimalReq),
    });
    await POST(req);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [path, content] = mockWriteFile.mock.calls[0];
    expect(path).toMatch(/Inbox.*\.txt$/);
    // Schema applies .trim() on parse; assert against the trimmed value.
    expect(content).toBe(minimalReq.sourceText.trim());
  });

  it('spawns pwsh with the wrapper script and the wizard arguments', async () => {
    const req = new Request('http://localhost/api/prep-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(minimalReq),
    });
    await POST(req);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = mockSpawn.mock.calls[0];
    // cmd is the resolved pwsh path (absolute, or 'pwsh' fallback via PWSH_BIN env)
    expect(cmd).toMatch(/pwsh(\.exe)?$/i);
    expect(args).toContain('-NoProfile');
    expect(args).toContain('-File');
    expect(args.find((a: string) => a.endsWith('run-prep-pack.ps1'))).toBeDefined();
    expect(args).toContain('-Voice'); expect(args).toContain('Steffan');
    expect(args).toContain('-Depth'); expect(args).toContain('Standard');
    expect(args).toContain('-Mode');  expect(args).toContain('Single');
    expect(args).toContain('-ProduceKindle');
    expect(args).toContain('-KindleFormat'); expect(args).toContain('KFX');
    // stdio: ['ignore', 'inherit', 'inherit'] — stdin closed, stdout/stderr
    // forwarded to dev server terminal so pwsh's host binds correctly and the
    // user sees live wrapper output. detached:false ties the wrapper's lifetime
    // to the dev server. See route.ts for the rationale.
    expect(opts.detached).toBe(false);
    expect(opts.stdio).toEqual(['ignore', 'inherit', 'inherit']);
  });

  it('omits -ProduceKindle and -KindleFormat when produceKindle=false', async () => {
    const r: PrepPackJobRequest = {
      ...minimalReq,
      config: { ...minimalReq.config, produceKindle: false },
    };
    const req = new Request('http://localhost/api/prep-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(r),
    });
    await POST(req);
    const [, args] = mockSpawn.mock.calls[0];
    expect(args).not.toContain('-ProduceKindle');
    expect(args).not.toContain('-KindleFormat');
  });

  it('passes -Mode Series when config.mode === "Series"', async () => {
    const r: PrepPackJobRequest = {
      ...minimalReq,
      config: { ...minimalReq.config, mode: 'Series' },
    };
    const req = new Request('http://localhost/api/prep-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(r),
    });
    await POST(req);
    const [, args] = mockSpawn.mock.calls[0];
    const modeIdx = args.indexOf('-Mode');
    expect(modeIdx).toBeGreaterThan(-1);
    expect(args[modeIdx + 1]).toBe('Series');
  });

  it('returns 400 when intelligence.company is missing', async () => {
    const r = { ...minimalReq, intelligence: { ...minimalReq.intelligence, company: '' } };
    const req = new Request('http://localhost/api/prep-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(r),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('returns 400 when sourceText is empty', async () => {
    const r: PrepPackJobRequest = { ...minimalReq, sourceText: '' };
    const req = new Request('http://localhost/api/prep-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(r),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('returns 400 when config.voice is invalid', async () => {
    const r = { ...minimalReq, config: { ...minimalReq.config, voice: 'Banana' } };
    const req = new Request('http://localhost/api/prep-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(r),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('returns 400 when sourceText has only an instruction block (no ## headings)', async () => {
    const r: PrepPackJobRequest = {
      ...minimalReq,
      sourceText:
        '### Instructions\n' +
        'Merge into one continuous document. Lean heavy on PowerShell.\n' +
        'Make it sound like a study guide.\n',
    };
    const req = new Request('http://localhost/api/prep-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(r),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason).toMatch(/no `## ` section headings/i);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('returns 400 when sourceText is too short after instruction-block stripping', async () => {
    const r: PrepPackJobRequest = {
      ...minimalReq,
      sourceText:
        '### Instructions\nMerge.\n' +
        '# Title\n## Tiny\nshort.\n', // < 200 chars after stripping instructions
    };
    const req = new Request('http://localhost/api/prep-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(r),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('returns 401 when user is unauthenticated', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error('Not authenticated') }),
      },
    } as never);

    const req = new Request('http://localhost/api/prep-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(minimalReq),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
