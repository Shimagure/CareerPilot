import { describe, it, expect } from 'vitest';
import { safeExternalUrl } from './urls';

describe('safeExternalUrl', () => {
  it('allows https URLs', () => {
    expect(safeExternalUrl('https://example.com/posting')).toBe('https://example.com/posting');
  });

  it('allows http URLs', () => {
    expect(safeExternalUrl('http://example.com/job/123')).toBe('http://example.com/job/123');
  });

  it('allows uppercase scheme and normalizes it', () => {
    expect(safeExternalUrl('HTTPS://Example.com/Job')).toBe('https://example.com/Job');
  });

  it('rejects executable javascript: URLs', () => {
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('JavaScript:alert(1)')).toBeNull();
  });

  it('rejects data: URLs', () => {
    expect(safeExternalUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('rejects vbscript and other non-web schemes', () => {
    expect(safeExternalUrl('vbscript:msgbox(1)')).toBeNull();
    expect(safeExternalUrl('file:///etc/passwd')).toBeNull();
    expect(safeExternalUrl('ftp://example.com')).toBeNull();
  });

  it('rejects scheme-less and malformed input gracefully', () => {
    expect(safeExternalUrl('example.com/posting')).toBeNull();
    expect(safeExternalUrl('not a url')).toBeNull();
    expect(safeExternalUrl('')).toBeNull();
  });

  it('rejects null and undefined', () => {
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
  });
});