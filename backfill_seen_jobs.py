#!/usr/bin/env python3
"""
Backfill seen_jobs.json with new incremental architecture fields:
- stable_id: SHA256(normalized_url + "|" + normalized_company + "|" + normalized_title)
- fingerprint: SHA256 of material fields
- processing_state: NEW|NEEDS_VERIFICATION|ACTIVE_VERIFIED|ACTIVE_UNVERIFIED|STALE|CHANGED|CLOSED_OR_EXPIRED|POSTING_CHANGED|DUPLICATE_OR_INVALID
- last_verified: ISO date
- blocked_at: ISO timestamp
- blocked_reason: string
- changed_at: ISO timestamp
- changed_fields: array
- closed_at: ISO timestamp
- rank_score: number
- rank_verdict: string
- rank_date: ISO date
- strengths: array
- gaps: array
"""

import json
import hashlib
import re
from datetime import datetime

def normalize_url(url):
    """Strip query params, fragments, trailing slashes; keep only scheme+host+path"""
    from urllib.parse import urlparse
    parsed = urlparse(url)
    path = parsed.path.rstrip('/')
    return f"{parsed.scheme}://{parsed.netloc}{path}"

def normalize_company(company):
    """lowercase, remove punctuation, collapse whitespace"""
    return re.sub(r'\s+', ' ', re.sub(r'[^\w\s]', '', company.lower())).strip()

def normalize_title(title):
    """lowercase, remove punctuation, collapse whitespace"""
    return re.sub(r'\s+', ' ', re.sub(r'[^\w\s]', '', title.lower())).strip()

def normalize_location(location):
    """lowercase, remove punctuation, collapse whitespace"""
    return re.sub(r'\s+', ' ', re.sub(r'[^\w\s]', '', location.lower())).strip()

def normalize_arrangement(arrangement):
    """lowercase, remove punctuation, collapse whitespace"""
    return re.sub(r'\s+', ' ', re.sub(r'[^\w\s]', '', arrangement.lower())).strip()

def normalize_salary(salary):
    """lowercase, remove punctuation, collapse whitespace"""
    return re.sub(r'\s+', ' ', re.sub(r'[^\w\s]', '', salary.lower())).strip()

def extract_key_requirements(description):
    """Extract key requirements from description (first 2000 chars)"""
    if not description:
        return ""
    # Take first 2000 chars of description
    return description[:2000]

def compute_stable_id(url, company, title):
    """Compute stable_id = SHA256(normalize_url + "|" + normalize_company + "|" + normalize_title)"""
    parts = [
        normalize_url(url),
        normalize_company(company),
        normalize_title(title)
    ]
    data = "|".join(parts)
    return hashlib.sha256(data.encode('utf-8')).hexdigest()

def compute_fingerprint(job):
    """Compute fingerprint from material fields"""
    material = {
        "title": normalize_title(job.get("title", "")),
        "company": normalize_company(job.get("company", "")),
        "location": normalize_location(job.get("location", "")),
        "arrangement": normalize_arrangement(job.get("work_mode", "") or job.get("arrangement", "")),
        "salary": normalize_salary(job.get("salary", "") or job.get("salary_text", "")),
        "description": extract_key_requirements(job.get("description", ""))
    }
    data = json.dumps(material, sort_keys=True)
    return hashlib.sha256(data.encode('utf-8')).hexdigest()

def determine_processing_state(job, existing_state=None):
    """Determine processing_state based on existing data"""
    # If already has a processing_state, keep it
    if existing_state and existing_state in [
        "NEW", "NEEDS_VERIFICATION", "ACTIVE_VERIFIED", "ACTIVE_UNVERIFIED",
        "STALE", "CHANGED", "CLOSED_OR_EXPIRED", "POSTING_CHANGED", "DUPLICATE_OR_INVALID"
    ]:
        return existing_state

    # If has rank_score and rank_date, it's been verified
    if job.get("rank_score") is not None and job.get("rank_date"):
        return "ACTIVE_VERIFIED"

    # If status is "ranked" or "evaluated", it's verified
    if job.get("status") in ["ranked", "evaluated"]:
        return "ACTIVE_VERIFIED"

    # If status is "skipped", it was deprioritized
    if job.get("status") == "skipped":
        return "DEPRIORITIZE"

    # If status is "new" and no rank_score, needs verification
    if job.get("status") == "new":
        return "NEEDS_VERIFICATION"

    # Default
    return "NEEDS_VERIFICATION"

# Load the existing seen_jobs.json
with open("C:\\Users\\Soladm\\Downloads\\Pilot\\ai-job-search\\job_scraper\\seen_jobs.json", "r", encoding="utf-8") as f:
    data = json.load(f)

seen = data.get("seen", {})
print(f"Total records: {len(seen)}")

# Process each record
updated = 0
for key, job in seen.items():
    # Compute stable_id
    url = job.get("url", "")
    company = job.get("company", "")
    title = job.get("title", "")
    stable_id = compute_stable_id(url, company, title)

    # Compute fingerprint
    fingerprint = compute_fingerprint(job)

    # Determine processing_state
    existing_state = job.get("processing_state")
    processing_state = determine_processing_state(job, existing_state)

    # Update the record
    job["stable_id"] = stable_id
    job["fingerprint"] = fingerprint
    job["processing_state"] = processing_state

    # Add missing fields with defaults if not present
    if "last_verified" not in job:
        if processing_state == "ACTIVE_VERIFIED" and job.get("rank_date"):
            job["last_verified"] = job["rank_date"]
        else:
            job["last_verified"] = None

    if "blocked_at" not in job:
        job["blocked_at"] = None
    if "blocked_reason" not in job:
        job["blocked_reason"] = None
    if "changed_at" not in job:
        job["changed_at"] = None
    if "changed_fields" not in job:
        job["changed_fields"] = []
    if "closed_at" not in job:
        job["closed_at"] = None
    if "rank_score" not in job:
        job["rank_score"] = job.get("rank_score")
    if "rank_verdict" not in job:
        job["rank_verdict"] = job.get("rank_verdict")
    if "rank_date" not in job:
        job["rank_date"] = job.get("rank_date")
    if "strengths" not in job:
        job["strengths"] = job.get("strengths", [])
    if "gaps" not in job:
        job["gaps"] = job.get("gaps", [])

    updated += 1

print(f"Updated {updated} records")

# Write back
with open("C:\\Users\\Soladm\\Downloads\\Pilot\\ai-job-search\\job_scraper\\seen_jobs.json", "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print("Done!")