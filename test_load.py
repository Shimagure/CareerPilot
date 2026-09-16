import json
import csv
import re
from pathlib import Path

TRACKER_FILE = Path('C:/Users/Soladm/Downloads/Pilot/ai-job-search/job_search_tracker.csv')
SEEN_JOBS_FILE = Path('C:/Users/Soladm/Downloads/Pilot/ai-job-search/job_scraper/seen_jobs.json')

def _normalize_company(company: str) -> str:
    return re.sub(r'[^\w\s]', '', (company or '').lower()).strip()

def _normalize_title(title: str) -> str:
    return re.sub(r'[^\w\s]', '', (title or '').lower()).strip()

def _read_csv(path: Path):
    if not path.exists():
        return []
    with open(path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f, skipinitialspace=True)
        fieldnames = [fn.strip() for fn in reader.fieldnames] if reader.fieldnames else []
        rows = []
        for row in reader:
            normalized_row = {k.strip(): v for k, v in row.items()}
            rows.append(normalized_row)
        return rows

def load_seen_jobs():
    if not SEEN_JOBS_FILE.exists():
        return {}
    with open(SEEN_JOBS_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    if data and isinstance(data, dict):
        return data.get('seen', data) if 'seen' in data else data
    return {}

rows = _read_csv(TRACKER_FILE)
seen_jobs = load_seen_jobs()

# Build lookup: normalized company|title -> stable_id
stable_id_lookup = {}
for job in seen_jobs.values():
    key = f'{_normalize_company(job.get("company", ""))}|{_normalize_title(job.get("title", ""))}'
    if key not in stable_id_lookup:
        stable_id_lookup[key] = job.get('stable_id')

print('stable_id_lookup size:', len(stable_id_lookup))
print()

# Check first few tracker rows
for i, row in enumerate(rows[:3]):
    company = row.get('company', '').strip()
    role = row.get('role', '').strip()
    key = f'{_normalize_company(company)}|{_normalize_title(role)}'
    stable_id = stable_id_lookup.get(key)
    print(f'Tracker Row {i}: company={company!r} role={role!r}')
    print(f'  key={key!r}')
    print(f'  stable_id={stable_id!r}')
    print()