/**
 * Canonical Fingerprint Implementation
 *
 * This is the SINGLE authoritative implementation of fingerprint computation.
 * All other code MUST import and use this module.
 *
 * Formula: SHA256(JSON.stringify({
 *   title: normalize_title(title),
 *   company: normalize_company(company),
 *   location: normalize_location(location),
 *   arrangement: normalize_arrangement(arrangement),
 *   salary: normalize_salary(salary),
 *   description: truncate(extract_key_requirements(description), 2000)
 * }))
 */

import { createHash } from 'crypto';
import { normalizeCompany, normalizeTitle } from './canonical_id.js';

/**
 * Normalize location: lowercase, remove punctuation, collapse whitespace, trim
 */
export function normalizeLocation(location: string): string {
  return location
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize arrangement: map to canonical values (remote, hybrid, onsite, unknown)
 */
export function normalizeArrangement(arrangement: string): string {
  const normalized = arrangement
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Map to canonical values
  if (normalized.includes('remote') || normalized.includes('work from home') || normalized.includes('wfh')) {
    return 'remote';
  }
  if (normalized.includes('hybrid')) {
    return 'hybrid';
  }
  if (normalized.includes('onsite') || normalized.includes('on site') || normalized.includes('office')) {
    return 'onsite';
  }
  return 'unknown';
}

/**
 * Normalize salary: normalize into currency:min:max or "undisclosed"
 */
export function normalizeSalary(salary: string): string {
  if (!salary || salary.trim() === '') {
    return 'undisclosed';
  }

  // Extract numbers and currency
  const normalized = salary
    .toLowerCase()
    .replace(/[^\w\s\.\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Try to extract min/max
  const numbers = normalized.match(/\d+(?:\.\d+)?/g);
  if (numbers && numbers.length >= 2) {
    const min = parseInt(numbers[0], 10);
    const max = parseInt(numbers[1], 10);
    const currencyMatch = normalized.match(/(php|usd|eur|gbp|aud|cad)/);
    const currency = currencyMatch ? currencyMatch[1] : 'php';
    return `${currency}:${min}:${max}`;
  } else if (numbers && numbers.length === 1) {
    const min = parseInt(numbers[0], 10);
    const currencyMatch = normalized.match(/(php|usd|eur|gbp|aud|cad)/);
    const currency = currencyMatch ? currencyMatch[1] : 'php';
    return `${currency}:${min}:${min}`;
  }

  return 'undisclosed';
}

/**
 * Extract key requirements from description (first 2000 chars)
 */
export function extractKeyRequirements(description: string): string {
  if (!description) return '';
  return description.substring(0, 2000);
}

/**
 * Canonical fingerprint material fields
 */
export interface FingerprintMaterial {
  title: string;
  company: string;
  location: string;
  arrangement: string;
  salary: string;
  description: string;
}

/**
 * Build canonical material object from job data
 */
export function buildFingerprintMaterial(job: {
  title?: string;
  company?: string;
  location?: string;
  work_mode?: string;
  arrangement?: string;
  salary?: string;
  salary_text?: string;
  description?: string;
}): FingerprintMaterial {
  return {
    title: normalizeTitle(job.title || ''),
    company: normalizeCompany(job.company || ''),
    location: normalizeLocation(job.location || ''),
    arrangement: normalizeArrangement(job.work_mode || job.arrangement || ''),
    salary: normalizeSalary(job.salary || job.salary_text || ''),
    description: extractKeyRequirements(job.description || '')
  };
}

/**
 * Compute fingerprint = SHA256(JSON.stringify(material))
 */
export function computeFingerprint(material: FingerprintMaterial): string {
  const data = JSON.stringify(material);
  return createHash('sha256').update(data, 'utf-8').digest('hex');
}

/**
 * Compute fingerprint directly from job object
 */
export function computeFingerprintFromJob(job: {
  title?: string;
  company?: string;
  location?: string;
  work_mode?: string;
  arrangement?: string;
  salary?: string;
  salary_text?: string;
  description?: string;
}): string {
  const material = buildFingerprintMaterial(job);
  return computeFingerprint(material);
}

/**
 * Compare two fingerprints and return changed fields
 */
export function getChangedFields(oldMaterial: FingerprintMaterial, newMaterial: FingerprintMaterial): string[] {
  const changed: string[] = [];
  const fields: (keyof FingerprintMaterial)[] = ['title', 'company', 'location', 'arrangement', 'salary', 'description'];

  for (const field of fields) {
    if (oldMaterial[field] !== newMaterial[field]) {
      changed.push(field);
    }
  }

  return changed;
}