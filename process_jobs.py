#!/usr/bin/env python3
"""
Process all job search results: canonicalize, deduplicate, apply hard filters
"""

import json
import hashlib
import re
from datetime import datetime
from typing import Dict, List, Any, Optional

# Load seen_jobs
with open('job_scraper/seen_jobs.json', 'r') as f:
    seen_jobs = json.load(f)['seen']

# Load tracker
tracker_rows = []
with open('job_search_tracker.csv', 'r') as f:
    lines = f.readlines()
    if len(lines) > 1:
        headers = lines[0].strip().split(',')
        for line in lines[1:]:
            vals = line.strip().split(',')
            if len(vals) >= headers.__len__():
                tracker_rows.append(dict(zip(headers, vals)))

# Target role keywords (from baseline)
TARGET_ROLES = [
    'end user computing', 'euc', 'end user support',
    'it support', 'desktop support', 'technical support',
    'service desk', 'help desk', 'helpdesk',
    'it support engineer', 'technical support engineer', 'desktop engineer', 'support engineer',
    'tier 1', 'tier 1.5', 'tier 2', 'l1', 'l1.5', 'l2',
    'systems administrator', 'system administrator', 'sysadmin',
    'cloud support', 'infrastructure', 'endpoint security', 'iam'
]

# Location priorities
ACCEPTABLE_LOCATIONS = [
    'remote', 'work from home', 'wfh', 'philippines',
    'metro manila', 'ncr', 'makati', 'taguig', 'mandaluyong', 'pasig',
    'quezon city', 'manila city', 'ortigas', 'bgc', 'bonifacio',
    'alabang', 'muntilupa', 'greenhills', 'eastwood', 'cavite',
    'bulacan', 'laguna', 'rizal'
]

# Salary floor
SALARY_FLOOR = 30000

def normalize_url(url: str) -> str:
    """Normalize URL for stable_id computation"""
    # Remove query params, fragments, trailing slashes
    url = re.sub(r'[?#].*$', '', url)
    url = url.rstrip('/')
    # Keep only scheme+host+path
    return url.lower()

def normalize_company(company: str) -> str:
    """Normalize company name"""
    if not company:
        return ''
    return re.sub(r'\s+', ' ', company.lower().strip())

def normalize_title(title: str) -> str:
    """Normalize job title"""
    if not title:
        return ''
    return re.sub(r'\s+', ' ', title.lower().strip())

def compute_stable_id(url: str, company: str, title: str) -> str:
    """Compute stable_id from normalized fields"""
    norm_url = normalize_url(url)
    norm_company = normalize_company(company)
    norm_title = normalize_title(title)
    combined = f"{norm_url}|{norm_company}|{norm_title}"
    return hashlib.sha256(combined.encode()).hexdigest()[:12]

def check_role_match(title: str) -> bool:
    """Check if title matches target roles"""
    if not title:
        return False
    title_lower = title.lower()
    for role in TARGET_ROLES:
        if role in title_lower:
            return True
    return False

def check_location_match(location: str) -> bool:
    """Check if location is acceptable"""
    if not location:
        return False
    loc_lower = location.lower()
    for loc in ACCEPTABLE_LOCATIONS:
        if loc in loc_lower:
            return True
    return False

def parse_salary(salary_str: str) -> Optional[int]:
    """Parse salary string to monthly PHP amount"""
    if not salary_str:
        return None
    salary_lower = salary_str.lower()

    # Remove currency symbols and commas
    salary_lower = salary_lower.replace('₱', '').replace('php', '').replace(',', '').replace('$', '')

    # Look for monthly patterns
    # Pattern: X - Y per month / a month
    monthly_match = re.search(r'(\d[\d\s]*)\s*[-–]\s*(\d[\d\s]*)\s*(?:per month|a month|/month|monthly)', salary_lower)
    if monthly_match:
        low = int(re.sub(r'\s+', '', monthly_match.group(1)))
        high = int(re.sub(r'\s+', '', monthly_match.group(2)))
        return (low + high) // 2

    # Pattern: From X a month
    from_match = re.search(r'from\s+(\d[\d\s]*)\s*(?:a month|per month|monthly)', salary_lower)
    if from_match:
        return int(re.sub(r'\s+', '', from_match.group(1)))

    # Pattern: X - Y (no period specified, assume monthly for PH)
    range_match = re.search(r'(\d[\d\s]*)\s*[-–]\s*(\d[\d\s]*)', salary_lower)
    if range_match:
        low = int(re.sub(r'\s+', '', range_match.group(1)))
        high = int(re.sub(r'\s+', '', range_match.group(2)))
        # If numbers are small (like 18-25), might be in thousands
        if high < 1000:
            return ((low + high) // 2) * 1000
        return (low + high) // 2

    # Single number
    single_match = re.search(r'(\d[\d\s]*)', salary_lower)
    if single_match:
        val = int(re.sub(r'\s+', '', single_match.group(1)))
        if val < 1000:
            return val * 1000
        return val

    return None

def check_salary_meets_floor(salary_str: str) -> bool:
    """Check if salary meets floor"""
    parsed = parse_salary(salary_str)
    if parsed is None:
        return False  # Undisclosed - don't assume it meets target
    return parsed >= SALARY_FLOOR

def normalize_job(raw: Dict, portal: str) -> Dict:
    """Normalize a raw job result"""
    return {
        'title': raw.get('title', ''),
        'company': raw.get('company', ''),
        'location': raw.get('location', ''),
        'salary': raw.get('salary'),
        'url': raw.get('url', ''),
        'date': raw.get('date'),
        'dateLabel': raw.get('dateLabel'),
        'teaser': raw.get('teaser'),
        'id': raw.get('id'),
        'portal': portal
    }

# Collect all results
all_raw_results = []

# JobStreet results
jobstreet_queries = [
    ("End User Computing", "Philippines"),
    ("IT Support", "Metro Manila"),
    ("Desktop Support", "Philippines"),
]

# Already loaded results - I'll process them from the search outputs
# Let me load the raw data I collected

# Instead of hardcoding, I'll use the data I already have from the searches
# Let me manually compile the results from the search outputs

# This would be easier with a JSON file of all results
# For now, I'll process the key promising jobs from the searches

# Let me write the consolidated results to a file and then process
print("Writing consolidated raw results...")

# The results are already in the conversation. Let me process what we have.
# I'll create a comprehensive processing script