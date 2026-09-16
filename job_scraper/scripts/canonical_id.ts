/**
 * Canonical Stable ID Implementation
 *
 * This is the SINGLE authoritative implementation of stable ID generation.
 * All other code MUST import and use this module.
 *
 * Formula: SHA256(normalize_url(url) + "|" + normalize_company(company) + "|" + normalize_title(title))
 */

import { createHash } from 'crypto';

/**
 * Normalize URL: strip query params, fragments, trailing slashes; keep only scheme+host+path; lowercase
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, ''); // remove trailing slash
    return `${parsed.protocol}//${parsed.host}${path}`.toLowerCase();
  } catch {
    // Fallback for invalid URLs
    return url.toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

/**
 * Normalize company: lowercase, remove punctuation, collapse whitespace, trim
 */
export function normalizeCompany(company: string): string {
  return company
    .toLowerCase()
    .replace(/[^\w\s]/g, '')  // remove punctuation
    .replace(/\s+/g, ' ')     // collapse whitespace
    .trim();
}

/**
 * Normalize title: lowercase, remove punctuation, collapse whitespace, trim
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, '')  // remove punctuation
    .replace(/\s+/g, ' ')     // collapse whitespace
    .trim();
}

/**
 * Compute stable_id = SHA256(normalize_url + "|" + normalize_company + "|" + normalize_title)
 */
export function computeStableId(url: string, company: string, title: string): string {
  const parts = [
    normalizeUrl(url),
    normalizeCompany(company),
    normalizeTitle(title)
  ];
  const data = parts.join('|');
  return createHash('sha256').update(data, 'utf-8').digest('hex');
}

/**
 * Compute stable_id from a job object
 */
export function computeStableIdFromJob(job: { url: string; company: string; title: string }): string {
  return computeStableId(job.url, job.company, job.title);
}