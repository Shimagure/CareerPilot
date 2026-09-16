#!/usr/bin/env python3
"""
Hard filter for consolidated jobs per MASTER_JOB_SEARCH_BASELINE.md Section 1
"""

import json
import re
from typing import Dict, List, Tuple

# Load consolidated jobs
with open(r'C:\Users\Soladm\Downloads\Pilot\ai-job-search\.scrape_out\consolidated_jobs.json', 'r', encoding='utf-8') as f:
    jobs = json.load(f)

print(f"Total jobs loaded: {len(jobs)}")

# ============================================================
# HARD FILTERS from MASTER_JOB_SEARCH_BASELINE.md Section 1
# ============================================================

# Target role keywords (must match at least one)
TARGET_ROLE_KEYWORDS = [
    'end user computing', 'euc', 'it support', 'desktop support',
    'technical support', 'service desk', 'helpdesk', 'help desk',
    'tier 2', 'tier2', 'l2 support', 'l2 ', 'level 2',
    'systems administrator', 'systems admin', 'sysadmin',
    'cloud support', 'cloud engineer', 'infrastructure',
    'endpoint security', 'endpoint engineer', 'endpoint management',
    'it security', 'security operations', 'soc analyst',
    'iam', 'identity', 'access management',
    'it operations', 'noc engineer',
    'it specialist', 'it administrator',
    'network support', 'network engineer',
    'solutions engineer', 'presales engineer',
    'application support', 'asset lifecycle'
]

# Excluded role patterns (non-IT, sales, accounting, etc.)
EXCLUDED_ROLE_KEYWORDS = [
    'accountant', 'cashier', 'sales', 'marketing', 'receptionist',
    'customer service representative', 'csr ', 'customer support representative',
    'call center', 'branch supervisor', 'branch manager',
    'operations manager', 'sales representative', 'sales associate',
    'it sales', 'business development', 'club manager',
    'community manager', 'front desk', 'medical coder',
    'ecommerce', 'hr', 'human resources', 'hrss',
    'receptionist', 'office', 'admin assistant', 'executive assistant'
]

# NCR/Metro Manila locations
NCR_LOCATIONS = [
    'metro manila', 'ncr', 'makati', 'taguig', 'bgc', 'bonifacio',
    'ortigas', 'pasig', 'mandaluyong', 'quezon city', 'qc ',
    'manila city', 'malate', 'san juan', 'greenhills',
    'alabang', ' muntinlupa', 'las pinas', 'paranaque', 'paranaque',
    'valenzuela', 'navotas', 'caloocan', 'marikina', 'pasay',
    'pateros', 'taguig city', 'makati city', 'mandaluyong city',
    'quezon city', 'manila', 'fort bonifacio', 'eastwood',
    'libis', 'bagumbayan', 'cainta', 'taytay', 'san mateo',
    'bulacan', 'muzon', 'san jose del monte', 'sjm', 'cavite',
    'bacoor', 'dasmarinas', 'imuz', 'laguna', 'sta rosa', 'binan',
    'calamba', 'cabuyao', 'pampanga', 'clark', 'angeles',
    'rizal', 'antipolo', 'cainta', 'rodriguez'
]

# Remote indicators
REMOTE_KEYWORDS = ['remote', 'work from home', 'wfh', 'work-from-home', 'fully remote']

# Hybrid indicators
HYBRID_KEYWORDS = ['hybrid', 'hybrid work', 'hybrid setup']

def parse_salary(salary_str: str) -> Tuple[float, float, bool]:
    """Parse salary string and return (min_monthly, max_monthly, is_annual)"""
    if not salary_str:
        return (0, 0, False)

    salary_str = salary_str.lower().replace('â‚±', '').replace('php', '').replace('₱', '').replace(',', '')

    # Check for annual
    is_annual = 'year' in salary_str or 'annual' in salary_str

    # Extract numbers
    numbers = re.findall(r'[\d.]+', salary_str)
    if not numbers:
        return (0, 0, is_annual)

    nums = [float(n) for n in numbers]
    if len(nums) == 1:
        return (nums[0], nums[0], is_annual)
    return (min(nums), max(nums), is_annual)

def salary_to_monthly(min_sal, max_sal, is_annual):
    """Convert to monthly PHP"""
    if is_annual:
        return (min_sal / 12, max_sal / 12)
    return (min_sal, max_sal)

def check_role_match(title: str) -> Tuple[bool, str]:
    """Check if title matches target roles and not excluded roles"""
    title_lower = title.lower()

    # Check excluded first
    for excl in EXCLUDED_ROLE_KEYWORDS:
        if excl in title_lower:
            return (False, f"Excluded role: {excl}")

    # Check target
    for target in TARGET_ROLE_KEYWORDS:
        if target in title_lower:
            return (True, f"Target role: {target}")

    return (False, "No target role match")

def check_location_arrangement(title: str, location: str) -> Tuple[str, str]:
    """Determine work arrangement and location quality"""
    loc_lower = location.lower()
    title_lower = title.lower()
    combined = f"{title_lower} {loc_lower}"

    # Check remote
    for rk in REMOTE_KEYWORDS:
        if rk in combined:
            return ('remote', 'Remote')

    # Check hybrid
    for hk in HYBRID_KEYWORDS:
        if hk in combined:
            return ('hybrid', 'Hybrid')

    # Check NCR locations
    for ncr in NCR_LOCATIONS:
        if ncr in loc_lower:
            return ('onsite_ncr', f'Onsite NCR ({ncr})')

    # Check if location mentions Philippines but not NCR
    if 'philippines' in loc_lower or 'metro manila' in loc_lower:
        return ('onsite_ncr', 'Onsite NCR (general)')

    return ('other', 'Other/Unknown')

def apply_hard_filters(jobs: List[Dict]) -> List[Dict]:
    """Apply all hard filters and return filtered jobs with metadata"""
    results = []

    for job in jobs:
        title = job.get('title', '')
        company = job.get('company', '')
        location = job.get('location', '')
        salary = job.get('salary', '')
        url = job.get('url', '')
        job_id = job.get('id', '')
        source = job.get('source_file', '')

        # 1. Role filter
        role_match, role_reason = check_role_match(title)
        if not role_match:
            results.append({
                **job,
                'filter_status': 'DEPRIORITIZE',
                'filter_reason': role_reason,
                'role_match': False
            })
            continue

        # 2. Location/Arrangement
        arrangement, loc_detail = check_location_arrangement(title, location)

        # 3. Salary
        min_sal, max_sal, is_annual = parse_salary(salary)
        min_monthly, max_monthly = salary_to_monthly(min_sal, max_sal, is_annual)

        salary_status = 'unknown'
        if min_monthly > 0:
            if max_monthly >= 30000:
                salary_status = 'acceptable'
            elif max_monthly >= 25000:
                salary_status = 'borderline'
            else:
                salary_status = 'below_target'
        else:
            salary_status = 'undisclosed'

        # 4. Language gate - will be done in next phase
        # 5. Eligibility - will be done in next phase

        # Determine initial filter status
        if arrangement == 'other':
            filter_status = 'DEPRIORITIZE'
            filter_reason = f'Location outside target area: {loc_detail}'
        elif salary_status == 'below_target':
            filter_status = 'DEPRIORITIZE'
            filter_reason = f'Salary below target: {salary}'
        elif salary_status == 'undisclosed':
            filter_status = 'NEEDS_CLARIFICATION'
            filter_reason = 'Salary undisclosed'
        else:
            filter_status = 'PASSED_HARD_FILTER'
            filter_reason = f'Role match: {role_reason}, Arrangement: {arrangement}, Salary: {salary_status}'

        results.append({
            **job,
            'filter_status': filter_status,
            'filter_reason': filter_reason,
            'role_match': True,
            'arrangement': arrangement,
            'location_detail': loc_detail,
            'salary_monthly_min': min_monthly,
            'salary_monthly_max': max_monthly,
            'salary_status': salary_status,
            'salary_original': salary
        })

    return results

# Apply filters
filtered = apply_hard_filters(jobs)

# Count by status
status_counts = {}
for job in filtered:
    status = job['filter_status']
    status_counts[status] = status_counts.get(status, 0) + 1

print("\n=== HARD FILTER RESULTS ===")
for status, count in sorted(status_counts.items()):
    print(f"  {status}: {count}")

# Save filtered results
with open(r'C:\Users\Soladm\Downloads\Pilot\ai-job-search\.scrape_out\hard_filtered_jobs.json', 'w', encoding='utf-8') as f:
    json.dump(filtered, f, indent=2, ensure_ascii=False)

print(f"\nSaved {len(filtered)} filtered jobs to hard_filtered_jobs.json")

# Show PASSED_HARD_FILTER jobs
passed = [j for j in filtered if j['filter_status'] == 'PASSED_HARD_FILTER']
print(f"\n=== {len(passed)} JOBS PASSED HARD FILTER ===")
for i, job in enumerate(passed, 1):
    print(f"\n{i}. {job['title']} @ {job['company']}")
    print(f"   Location: {job['location']} ({job['arrangement']})")
    print(f"   Salary: {job['salary_original']} -> Monthly: ₱{job['salary_monthly_min']:,.0f}-₱{job['salary_monthly_max']:,.0f} ({job['salary_status']})")
    print(f"   URL: {job['url']}")

# Show NEEDS_CLARIFICATION
needs_clar = [j for j in filtered if j['filter_status'] == 'NEEDS_CLARIFICATION']
print(f"\n=== {len(needs_clar)} JOBS NEED CLARIFICATION ===")
for i, job in enumerate(needs_clar, 1):
    print(f"\n{i}. {job['title']} @ {job['company']}")
    print(f"   Location: {job['location']} ({job['arrangement']})")
    print(f"   Salary: {job['salary_original']} ({job['salary_status']})")
    print(f"   Reason: {job['filter_reason']}")
    print(f"   URL: {job['url']}")