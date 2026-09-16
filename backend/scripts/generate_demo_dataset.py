#!/usr/bin/env python3
"""Generate the deterministic CareerPilot demo dataset (P4).

The demo dataset is the PUBLIC, unauthenticated API surface's only data plane
(/api/public/*). It must never contain real job-search data, real applications,
real user PII, private scraper artifacts, or private configuration. Every byte
below is hand-authored fiction or derived from it by a seeded, reproducible
process.

Guarantees
----------
- Python standard library only; no network access; no external dependencies.
- Deterministic: a fixed GENERATOR_VERSION + corpus date + fixed seed produce
  byte-identical output. No random.choice() without a seeded RNG.
- Idempotent: running again produces identical bytes.
- Self-validating: validations run BEFORE anything is written; any failure
  raises and writes nothing.
- Safe: the generator reads NO real data. The entire corpus derives from the
  fictional SEED table in this file. It never opens careerpilot.db, never reads
  job_scraper/ artifacts, never reads the real tracker, profile, resumes,
  cover letters, portal health, credentials, or environment secrets.

Usage
-----
    python scripts/generate_demo_dataset.py                 # write default demo data
    python scripts/generate_demo_dataset.py --check         # validate only, no write
    python scripts/generate_demo_dataset.py \
        --corpus-date 2026-09-12 --out-dir backend/demo_data

Bytes written:
    <out-dir>/demo_seen_jobs.json
    <out-dir>/demo_tracker.csv
    <out-dir>/demo_checkpoints.json
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import random
import re
from datetime import datetime, timedelta
from pathlib import Path

GENERATOR_VERSION = "2.0"
DEFAULT_CORPUS_DATE = "2026-09-12"  # reference date all relative timestamps derive from

# Corpus targets (validated before writing)
MIN_ACTIVE_TOTAL = 50          # ACTIVE_VERIFIED+ACTIVE_UNVERIFIED+CHANGED+POSTING_CHANGED
MIN_PERIPHERAL_TOTAL = 6       # STALE/CLOSED_OR_EXPIRED/NEEDS_VERIFICATION/DUPLICATE_OR_INVALID
MIN_ACTIVE_VERIFIED = 35
MIN_ACTIVE_UNVERIFIED = 4
MIN_CHANGED = 3
MIN_POSTING_CHANGED = 3
MIN_COMPLETE_EVALUATIONS = 30
MIN_APPLICATIONS = 15
MIN_APP_STATUSES = 6
MIN_APP_WITH_NOTES = 8
MIN_APP_WITH_DOCS = 8

# Valid processing states (must exactly match app.models.schemas.ProcessingState).
VALID_STATES = {
    "NEW", "NEEDS_VERIFICATION", "ACTIVE_VERIFIED", "ACTIVE_UNVERIFIED",
    "STALE", "CHANGED", "CLOSED_OR_EXPIRED", "POSTING_CHANGED",
    "DUPLICATE_OR_INVALID", "DEPRIORITIZE", "UNKNOWN",
}
VALID_ARRANGEMENTS = {"remote", "hybrid", "onsite", "unspecified"}
VALID_FITS = {"high", "medium", "low", "unknown"}
VALID_APP_STATUSES = {"draft", "submitted", "under_review", "interview", "offer", "accepted", "rejected", "withdrawn"}
VALID_PORTALS = {"linkedin", "jobstreet", "indeed", "kalibrr"}

# Markers that must NEVER appear in demo output (real-world leakage guard).
_FORBIDDEN_MARKERS = [
    "solaire", "bulacan", "san ildefonso", "light.jukes", "@gmail", "@outlook",
    "careerpilot.db", "job_scraper/", "canonical_jobs", "ranked_jobs",
    "seen_jobs.json", "checkpoints.json", "job_search_tracker", "/users/",
    "c:/", "c:\\", "eyj0", "sk-", "api_key", "secret", "password",
]


def _fictional_md5(text: str) -> str:
    """Stable, deterministic fingerprint."

    Mirrors the pipeline's SHA-256 content-fingerprint concept without reading
    anything external: it hashes the material fields of the (fictional) record.
    """
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()[:32]


def _norm(s: str) -> str:
    return re.sub(r"[^\w\s]", "", (s or "").lower()).strip()


def _material(job: dict, variant: str = "") -> str:
    """Canonical material fields used for the content fingerprint."""
    desc = job.get("description", "")
    fields = {
        "title": _norm(job["title"]),
        "company": _norm(job["company"]),
        "location": _norm(job.get("location", "")),
        "arrangement": _norm(job.get("arrangement", "")),
        "salary": _norm(job.get("salary", "")),
        "description": _norm(desc)[:2000],
        "variant": variant,
    }
    return json.dumps(fields, sort_keys=True)


# ---------------------------------------------------------------------------
# SEED —— small hand-authored fictional table. THIS IS THE ONLY DATA SOURCE.
# ---------------------------------------------------------------------------
# Each archetype expands into `variants` concrete records (roles/locations/
# portals/salaries) so a small seed produces the full 56-record corpus.
# Archetypes 0-7 must stay first and in order: they carry the pre-existing
# demo records (demo-001..demo-008) whose identity the repo already exposes.
SEED = [
    # 0 - preserved demo-001
    {"company": "TechCorp Philippines", "role": "Senior End User Computing Engineer", "sector": "IT Services",
     "locations": ["Taguig, Metro Manila"], "arrangement": "hybrid", "work_modes": ["Hybrid (3 days onsite)"],
     "salaries": ["PHP 55,000 - 75,000"], "portals": ["linkedin"], "tiers": [1],
     "desc": "We are looking for a Senior EUC Engineer to manage our endpoint fleet of 2000+ devices. Responsibilities include Intune management, application packaging, Windows 11 migration, and automation with PowerShell.",
     "strengths": ["Intune/Endpoint Management", "PowerShell Automation", "Windows 11 Migration", "Large Fleet Experience"],
     "gaps": ["CrowdStrike specific experience"], "fit_target": "high", "priority": 50},
    # 1 - preserved demo-002
    {"company": "Global BPO Solutions", "role": "IT Service Desk Lead", "sector": "BPO/Shared Services",
     "locations": ["Makati, Metro Manila"], "arrangement": "onsite", "work_modes": ["Onsite (Rotational shifts)"],
     "salaries": ["PHP 45,000 - 60,000"], "portals": ["jobstreet"], "tiers": [1],
     "desc": "Lead a team of 15 service desk analysts supporting 5000+ end users across multiple accounts. Manage escalations, improve FCR, implement ITIL processes, and mentor junior staff. Experience with ServiceNow and Active Directory required.",
     "strengths": ["Team Leadership", "ServiceNow", "Active Directory", "ITIL Processes", "Escalation Management"],
     "gaps": ["Intune/Endpoint Management", "PowerShell"], "fit_target": "high", "priority": 48},
    # 2 - preserved demo-003
    {"company": "CloudFirst Inc", "role": "Junior Systems Administrator", "sector": "Cloud Services",
     "locations": ["Remote (Philippines)"], "arrangement": "remote", "work_modes": ["Fully Remote"],
     "salaries": ["PHP 35,000 - 50,000"], "portals": ["indeed"], "tiers": [2],
     "desc": "Entry-level Systems Administrator role with growth path to Cloud Engineering. Manage Linux/Windows servers, assist with AWS/Azure deployments, monitor infrastructure with Datadog, and automate routine tasks with Python/Bash. Mentorship provided.",
     "strengths": ["Linux Administration", "Python Scripting", "AWS/Azure Exposure", "Monitoring (Datadog)"],
     "gaps": ["Windows Server/AD", "Intune", "Enterprise scale"], "fit_target": "high", "priority": 42},
    # 3 - preserved demo-004
    {"company": "SecureNet Philippines", "role": "Endpoint Security Analyst", "sector": "Cybersecurity",
     "locations": ["Ortigas, Metro Manila"], "arrangement": "hybrid", "work_modes": ["Hybrid (2 days onsite)"],
     "salaries": ["PHP 50,000 - 70,000"], "portals": ["linkedin"], "tiers": [2],
     "desc": "Monitor and respond to endpoint security alerts from CrowdStrike Falcon and Microsoft Defender for Endpoint. Investigate incidents, tune detection rules, and collaborate with SOC team. Certifications (Security+, CySA+) preferred.",
     "strengths": ["CrowdStrike Falcon", "Microsoft Defender", "Incident Response", "Detection Tuning"],
     "gaps": ["SOC experience", "SIEM"], "fit_target": "medium", "priority": 37},
    # 4 - preserved demo-005 (ACTIVE_UNVERIFIED, blocked http_403)
    {"company": "FinanceHub Corp", "role": "IT Support Specialist (Tier 2)", "sector": "Financial Services",
     "locations": ["Pasig, Metro Manila"], "arrangement": "onsite", "work_modes": ["Onsite (Night shift available)"],
     "salaries": ["PHP 30,000 - 42,000"], "portals": ["kalibrr"], "tiers": [3],
     "desc": "Provide Tier 2 support for 1000+ employees in financial services. Troubleshoot Windows/macOS, manage AD/O365, deploy software via SCCM/Intune, and document solutions. Banking/finance experience a plus.",
     "strengths": ["Tier 2 Support", "Active Directory", "O365/Intune", "SCCM", "Financial Services"],
     "gaps": ["PowerShell automation", "CrowdStrike"], "fit_target": "medium", "priority": 30},
    # 5 - preserved demo-006 (CHANGED)
    {"company": "AWS Partner Network", "role": "Cloud Support Engineer", "sector": "Cloud Services",
     "locations": ["Remote (Philippines)"], "arrangement": "remote", "work_modes": ["Fully Remote"],
     "salaries": ["PHP 60,000 - 85,000"], "portals": ["indeed"], "tiers": [3],
     "desc": "Support AWS customers with infrastructure issues. Troubleshoot EC2, RDS, VPC, IAM, CloudFormation. Requires AWS certification and Linux/Windows administration experience. Rotation includes weekend on-call.",
     "strengths": ["AWS", "Linux/Windows Admin", "Infrastructure Troubleshooting"],
     "gaps": ["AWS Certification", "Enterprise EUC experience"], "fit_target": "medium", "priority": 28},
    # 6 - preserved demo-007 (NEEDS_VERIFICATION, peripheral)
    {"company": "TelcoManila", "role": "NOC Technician", "sector": "Telecommunications",
     "locations": ["Quezon City, Metro Manila"], "arrangement": "onsite", "work_modes": ["Onsite (Rotating 12hr shifts)"],
     "salaries": ["PHP 28,000 - 38,000"], "portals": ["jobstreet"], "tiers": [5],
     "desc": "Monitor network infrastructure, respond to alerts, escalate to senior engineers. Basic Cisco, Linux, and ticketing experience required. Good entry point for network operations career.",
     "strengths": ["Network Monitoring", "Cisco Basics", "Ticketing"],
     "gaps": ["EUC/Endpoint experience", "Remote preference mismatch", "Below salary target"], "fit_target": "low", "priority": 20},
    # 7 - preserved demo-008 (POSTING_CHANGED)
    {"company": "StartupHub", "role": "DevOps Engineer (Junior)", "sector": "Software / Internet",
     "locations": ["Remote (Philippines)"], "arrangement": "remote", "work_modes": ["Fully Remote"],
     "salaries": ["PHP 40,000 - 55,000"], "portals": ["linkedin"], "tiers": [4],
     "desc": "Build and maintain CI/CD pipelines, manage Kubernetes clusters, automate infrastructure with Terraform. Requires Docker, GitLab CI, basic Kubernetes. Great learning opportunity.",
     "strengths": ["CI/CD", "Docker", "Terraform", "Kubernetes Basics"],
     "gaps": ["EUC/Endpoint focus", "Windows/AD experience"], "fit_target": "medium", "priority": 30},
    # 8
    {"company": "NimbusPay Solutions", "role": "IT Helpdesk Analyst", "sector": "FinTech",
     "locations": ["Manila, Metro Manila", "Remote (Philippines)"], "arrangement": "onsite",
     "work_modes": ["Onsite", "Hybrid (2 days onsite)"], "salaries": ["PHP 30,000 - 40,000"],
     "portals": ["linkedin", "jobstreet"], "tiers": [2, 3],
     "desc": "Provide front-line IT support for a growing digital payments team. Manage tickets in Freshdesk, provision O365/Microsoft accounts, image laptops, and support video conferencing. Entry-to-mid level role with a clear path to specialized EUC work.",
     "strengths": ["Helpdesk Support", "O365 Administration", "Laptop Imaging", "Ticket Management"],
     "gaps": ["Enterprise Intune scale", "PowerShell automation"], "fit_target": "medium", "priority": 32},
    # 9
    {"company": "VantagePoint Support Services", "role": "Senior Service Desk Analyst", "sector": "BPO/Shared Services",
     "locations": ["Alabang, Metro Manila", "Remote (Philippines)"], "arrangement": "hybrid",
     "work_modes": ["Hybrid (3 days onsite)", "Fully Remote"], "salaries": ["PHP 38,000 - 52,000"],
     "portals": ["jobstreet", "linkedin"], "tiers": [2],
     "desc": "Senior service desk role supporting enterprise clients. Resolve complex Windows, O365, and VPN issues, own incident triage, and contribute to the knowledge base. Requires strong customer focus and Microsoft 365 administration.",
     "strengths": ["Windows 10/11", "O365 Administration", "VPN/Remote Access", "Incident Triage"],
     "gaps": ["SCCM packaging", "Scripting"], "fit_target": "high", "priority": 38},
    # 10
    {"company": "HaloRoute Logistics IT", "role": "Desktop Support Engineer", "sector": "Logistics",
     "locations": ["Paranaque, Metro Manila"], "arrangement": "onsite",
     "work_modes": ["Onsite (Rotational shifts)"], "salaries": ["PHP 32,000 - 45,000"],
     "portals": ["indeed", "kalibrr"], "tiers": [2, 3],
     "desc": "Support warehouse and office end users across multiple sites. Deploy and maintain desktops, barcode scanners, and network printers, manage AD accounts, and provide Tier 2 escalation support for the logistics platform.",
     "strengths": ["Desktop Deployment", "Active Directory", "Hardware Diagnostics", "Multi-site Support"],
     "gaps": ["Intune", "Automation/scripting"], "fit_target": "medium", "priority": 30},
    # 11
    {"company": "BluePeak Data Center", "role": "Systems Analyst (Windows Server)", "sector": "Data Center / Hosting",
     "locations": ["Laguna"], "arrangement": "onsite",
     "work_modes": ["Onsite"], "salaries": ["PHP 40,000 - 58,000"],
     "portals": ["jobstreet", "linkedin"], "tiers": [3],
     "desc": "Administer Windows Server environments in a 24/7 data center. Maintain AD, DNS, DHCP, file shares and patch management; support server builds and decommissions; coordinate with the cloud team on hybrid infrastructure.",
     "strengths": ["Windows Server", "Active Directory", "Patch Management", "VMware basics"],
     "gaps": ["Cloud depth", "Automation at scale"], "fit_target": "medium", "priority": 26},
    # 12
    {"company": "FortifyGate Security", "role": "Endpoint Security Associate", "sector": "Cybersecurity",
     "locations": ["Makati, Metro Manila", "Remote (Philippines)"], "arrangement": "hybrid",
     "work_modes": ["Hybrid (2 days onsite)", "Fully Remote"], "salaries": ["PHP 45,000 - 65,000"],
     "portals": ["linkedin", "indeed"], "tiers": [2],
     "desc": "Deploy and tune endpoint detection and response (EDR) across client environments. Investigate alerts, support phishing containment, and assist with device hardening. Fortinet and Cisco security certifications valued.",
     "strengths": ["EDR Deployment", "Incident Investigation", "Device Hardening", "Security Monitoring"],
     "gaps": ["Deep SOC/SIEM experience", "Scripting"], "fit_target": "high", "priority": 36},
    # 13
    {"company": "SkylineNetworks PH", "role": "Network Support Engineer", "sector": "Telecommunications",
     "locations": ["Quezon City, Metro Manila", "BGC, Metro Manila"], "arrangement": "hybrid",
     "work_modes": ["Hybrid (2 days onsite)", "Onsite"], "salaries": ["PHP 35,000 - 50,000"],
     "portals": ["kalibrr", "jobstreet"], "tiers": [3, 4],
     "desc": "Support enterprise LAN/WAN connectivity, configure switches and firewalls, and troubleshoot routing issues. Grow toward network operations with mentorship from senior engineers. Cisco basics and good diagnostic habits required.",
     "strengths": ["LAN/WAN Troubleshooting", "Cisco Basics", "Firewall Config", "Documentation"],
     "gaps": ["No EUC/endpoint focus", "CCNA not yet attained"], "fit_target": "medium", "priority": 24},
    # 14
    {"company": "Promedia Digital", "role": "IT Support / Microsoft 365 Administrator", "sector": "Media / Digital Services",
     "locations": ["Remote (Philippines)", "Manila, Metro Manila"], "arrangement": "remote",
     "work_modes": ["Fully Remote", "Hybrid (1 day onsite)"], "salaries": ["PHP 36,000 - 50,000"],
     "portals": ["indeed", "linkedin"], "tiers": [1, 2],
     "desc": "Manage Microsoft 365 tenant administration, identity, and endpoint access for a distributed media team. Support Windows/macOS users, manage device compliance, and automate repetitive admin tasks with PowerShell.",
     "strengths": ["Microsoft 365", "Identity Management", "PowerShell", "Remote Support"],
     "gaps": ["Endpoint security depth", "Enterprise MDM scale"], "fit_target": "high", "priority": 40},
    # 15
    {"company": "Keystone Cloud Ops", "role": "Junior Cloud Support Engineer", "sector": "Cloud Services",
     "locations": ["Remote (Philippines)", "Makati, Metro Manila"], "arrangement": "remote",
     "work_modes": ["Fully Remote", "Hybrid (2 days onsite)"], "salaries": ["PHP 38,000 - 55,000"],
     "portals": ["linkedin", "jobstreet"], "tiers": [1, 2],
     "desc": "Entry-level cloud operations role: monitor cloud workloads, triage alerts, perform routine patching, and learn IaC (Terraform/CloudFormation). Windows/Linux fundamentals and a drive toward cloud certification required.",
     "strengths": ["Cloud Monitoring", "Linux/Windows Basics", "Alert Triage", "IaC exposure"],
     "gaps": ["Production cloud experience", "Container orchestration"], "fit_target": "medium", "priority": 30},
    # 16
    {"company": "TypeSafe Enterprises", "role": "EUC Technician (Intune)", "sector": "IT Services",
     "locations": ["BGC, Metro Manila", "Remote (Philippines)"], "arrangement": "hybrid",
     "work_modes": ["Hybrid (3 days onsite)", "Fully Remote"], "salaries": ["PHP 42,000 - 58,000"],
     "portals": ["jobstreet", "indeed"], "tiers": [1, 2],
     "desc": "Endpoint technician focused on Microsoft Intune: device enrollment, configuration profiles, application packaging, and compliance policies. Secure Windows endpoints and support Autopilot provisioning at scale.",
     "strengths": ["Microsoft Intune", "Autopilot", "Application Packaging", "Device Compliance"],
     "gaps": ["Deep automation", "Security tooling"], "fit_target": "high", "priority": 44},
    # 17
    {"company": "LumenReach Telecom", "role": "Field / Technical Support Specialist", "sector": "Telecommunications",
     "locations": ["Paranaque, Metro Manila", "Cavite"], "arrangement": "onsite",
     "work_modes": ["Onsite (Field + office)", "Onsite"], "salaries": ["PHP 28,000 - 38,000"],
     "portals": ["kalibrr", "indeed"], "tiers": [4, 5],
     "desc": "Hybrid field/desk support role: install and troubleshoot broadband and enterprise circuits, support office IT, and assist the NOC with dispatch. Requires driving capability and willingness to travel within assigned coverage area.",
     "strengths": ["Field Support", "Network Maintenance", "Hardware Troubleshooting", "Dispatch Coordination"],
     "gaps": ["Remote preference mismatch", "Limited EUC depth"], "fit_target": "low", "priority": 18},
    # 18
    {"company": "OrbitDesk Inc", "role": "Remote IT Service Desk Analyst", "sector": "IT Services",
     "locations": ["Remote (Philippines)"], "arrangement": "remote",
     "work_modes": ["Fully Remote (Night shift)"], "salaries": ["PHP 34,000 - 46,000"],
     "portals": ["indeed", "jobstreet"], "tiers": [1, 2],
     "desc": "Fully remote service desk supporting international clients during Manila night hours. Handle Windows/Mac incidents, manage access requests, and maintain a high-quality resolution culture. Strong written English is essential.",
     "strengths": ["Remote Support", "Windows/macOS", "Access Management", "English Communication"],
     "gaps": ["No enterprise MDM", "Limited on-site exposure"], "fit_target": "high", "priority": 36},
    # 19
    {"company": "PrismHealth IT Services", "role": "IT Support Specialist (Healthcare)", "sector": "Healthcare IT",
     "locations": ["Manila, Metro Manila", "Taguig, Metro Manila"], "arrangement": "hybrid",
     "work_modes": ["Hybrid (2 days onsite)", "Onsite"], "salaries": ["PHP 32,000 - 44,000"],
     "portals": ["linkedin", "kalibrr"], "tiers": [3],
     "desc": "Support clinical and administration endpoints in a healthcare shared-services environment. Manage Windows devices, EHR-related access, and compliance-oriented tickets with an emphasis on privacy and documentation.",
     "strengths": ["Windows Support", "Access Management", "Documentation", "Compliance Awareness"],
     "gaps": ["Healthcare domain experience", "Scripting"], "fit_target": "low", "priority": 22},
]

# Slot -> processing_state for the 50 active + 6 peripheral records.
# Preserved slots 0-7 carry demo-001..008; their states match history.
PRESERVED_SLOTS = [
    "ACTIVE_VERIFIED", "ACTIVE_VERIFIED", "ACTIVE_VERIFIED", "ACTIVE_VERIFIED",
    "ACTIVE_UNVERIFIED", "CHANGED", "NEEDS_VERIFICATION", "POSTING_CHANGED",
]
# The 48 newly-created slots spread active states and put peripheral states last.
NEW_SLOTS = (
    ["ACTIVE_VERIFIED"] * 30
    + ["ACTIVE_UNVERIFIED"] * 2 + ["ACTIVE_VERIFIED"] * 3
    + ["CHANGED"] * 2 + ["ACTIVE_VERIFIED"] * 1 + ["POSTING_CHANGED"] * 2
    + ["ACTIVE_UNVERIFIED"] * 2
    + ["CHANGED"] * 1
    + ["STALE"] * 2 + ["CLOSED_OR_EXPIRED"] * 2 + ["DUPLICATE_OR_INVALID"] * 1
)
STATE_SLOTS_FINAL = PRESERVED_SLOTS + NEW_SLOTS


def _verify_slot_counts():
    assert len(STATE_SLOTS_FINAL) == 56
    counts = {}
    for s in STATE_SLOTS_FINAL:
        counts[s] = counts.get(s, 0) + 1
    assert counts.get("ACTIVE_VERIFIED", 0) == 38, counts
    assert counts.get("ACTIVE_UNVERIFIED", 0) == 5, counts
    assert counts.get("CHANGED", 0) == 4, counts
    assert counts.get("POSTING_CHANGED", 0) == 3, counts
    assert counts.get("NEEDS_VERIFICATION", 0) == 1, counts
    assert counts.get("STALE", 0) == 2, counts
    assert counts.get("CLOSED_OR_EXPIRED", 0) == 2, counts
    assert counts.get("DUPLICATE_OR_INVALID", 0) == 1, counts
    assert sum(counts.values()) == 56, counts


_verify_slot_counts()

# Portal/fit/eval dimension palette used to derive evaluation blocks.
_VERDICT_HIGH = "Strong match - strong alignment with the candidate's enterprise IT support profile"
_VERDICT_MEDIUM = "Moderate match - good technical overlap with meaningful gaps to address"
_VERDICT_LOW = "Weak match - limited overlap with the candidate's core profile or preferences"
_RECOMMEND_HIGH = "Apply: strong profile fit; tailoring to the role's stack will close small gaps."
_RECOMMEND_MEDIUM = "Consider: apply if the growth path outweighs the gaps; tailor CV around strengths."
_RECOMMEND_LOW = "Deprioritize: weak fit unless the opportunity is exceptional or a stretch growth role."
_RECOMMEND_UNKNOWN = "Re-verify: posting data is unavailable; requeue for live verification before deciding."


def _eval_overall(tech, exp, beh, career):
    return int(round(tech * 0.35 + exp * 0.25 + beh * 0.20 + career * 0.20))


def _pick(rng: random.Random, items):
    return items[rng.randrange(len(items))]


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _build_jobs(corpus_date: str) -> list:
    """Build the 56 fictional records (list of dicts, index == record order)."""
    seed = hashlib.sha256(f"{GENERATOR_VERSION}|{corpus_date}|demo-seed".encode()).digest()
    rng = random.Random(seed)

    ref = datetime.strptime(corpus_date, "%Y-%m-%d")
    first_seen_lb = ref - timedelta(days=24)
    first_seen_ub = ref - timedelta(days=2)

    records = []
    # Variant counts per archetype; sum must equal 56 (8 preserved + 48 new).
    variant_counts = [1] * 8 + [4] * 12

    idx = 0
    sid = 0
    for arch_i, arch in enumerate(SEED):
        n = variant_counts[arch_i]
        roles = _expand_roles(arch["role"], n)
        for v in range(n):
            state = STATE_SLOTS_FINAL[idx]
            sid += 1
            stable_id = f"demo-{sid:03d}"
            first_seen = first_seen_lb + timedelta(days=int(rng.randrange(0, (first_seen_ub - first_seen_lb).days + 1)))
            location = _pick(rng, arch["locations"])
            work_mode = _pick(rng, arch["work_modes"])
            salary = _pick(rng, arch["salaries"])
            portal = _pick(rng, arch["portals"])
            tier = _pick(rng, arch["tiers"])
            title = roles[v]

            rec = {
                "stable_id": stable_id,
                "title": title,
                "company": arch["company"],
                "location": location,
                "salary": salary,
                "url": f"https://example.com/jobs/{stable_id}",
                "portal": portal,
                "arrangement": arch["arrangement"],
                "work_mode": work_mode,
                "description": arch["desc"],
                "processing_state": state,
                "first_seen": _iso(first_seen),
                "last_verified": None,
                "last_active_at": _iso(first_seen),
                "blocked_at": None,
                "blocked_reason": None,
                "changed_at": None,
                "changed_fields": [],
                "closed_at": None,
                "fingerprint": None,
                "previous_fingerprint": None,
                "rank_score": None,
                "rank_verdict": None,
                "rank_date": None,
                "strengths": list(arch["strengths"]),
                "gaps": list(arch["gaps"]),
                "fit": "unknown",
                "status": "active",
                "priority_tier": tier,
                "evaluation": None,
            }
            records.append(rec)
            idx += 1

    assert idx == 56, f"slot count mismatch: {idx}"

    _apply_states_and_dates(records, rng, ref, corpus_date)
    _assign_evaluations(records, rng, ref)
    _assign_ranks(records, rng)
    _apply_fingerprints(records)
    return records


def _expand_roles(base_role: str, n: int) -> list:
    """Return n variant titles for an archetype. Deterministic (no RNG)."""
    if n <= 1:
        return [base_role]
    prefixes = ["Junior ", "Senior ", "Lead ", ""]
    roles = [base_role]
    for i in range(1, n):
        roles.append(f"{prefixes[(i - 1) % len(prefixes)]}{base_role}".strip())
    return roles


def _apply_states_and_dates(records, rng, ref, corpus_date):
    """Assign state-specific timestamps, block/change metadata and fit levels.

    All timestamps are pinned relative to the corpus reference date so output
    is reproducible. Change/close events are capped at or before the reference
    date (the fictional 'now' the dataset is a snapshot of).
    """
    horizon = ref - timedelta(days=1)  # latest timestamp a record may carry
    for r in records:
        seen = datetime.strptime(r["first_seen"], "%Y-%m-%dT%H:%M:%SZ")
        state = r["processing_state"]
        if state == "ACTIVE_VERIFIED":
            last_v = seen + timedelta(days=rng.randrange(1, 4))
            last_v = min(last_v, horizon)
            r["last_verified"] = _iso(last_v)
            r["last_active_at"] = _iso(last_v)
            r["fit"] = rng.choices(["high", "medium", "low"], weights=[4, 4, 2])[0]
        elif state == "ACTIVE_UNVERIFIED":
            blocked = seen + timedelta(hours=rng.randrange(1, 12))
            r["blocked_at"] = _iso(blocked)
            r["blocked_reason"] = "http_403"
            r["last_active_at"] = _iso(seen + timedelta(days=1))
            r["last_verified"] = None
            r["fit"] = "unknown"
        elif state == "STALE":
            last_v = min(seen + timedelta(days=rng.randrange(1, 3)), horizon)
            r["last_verified"] = _iso(last_v)
            r["last_active_at"] = _iso(last_v)
            r["fit"] = "medium"
        elif state == "CLOSED_OR_EXPIRED":
            last_v = min(seen + timedelta(days=rng.randrange(1, 3)), horizon)
            r["last_verified"] = _iso(last_v)
            r["last_active_at"] = _iso(last_v)
            r["closed_at"] = _iso(min(seen + timedelta(days=rng.randrange(8, 14)), horizon))
            r["fit"] = "low"
        elif state == "NEEDS_VERIFICATION":
            r["last_verified"] = None
            r["last_active_at"] = _iso(seen + timedelta(days=1))
            r["fit"] = "unknown"
        elif state == "CHANGED":
            last_v = seen + timedelta(days=rng.randrange(1, 3))
            r["last_verified"] = _iso(last_v)
            changed_at = seen + timedelta(days=rng.randrange(5, 9))
            r["changed_at"] = _iso(changed_at)
            r["changed_fields"] = ["description", "salary"]
            r["last_active_at"] = _iso(changed_at)
            r["fit"] = "medium"
        elif state == "POSTING_CHANGED":
            last_v = seen + timedelta(days=rng.randrange(1, 3))
            r["last_verified"] = _iso(last_v)
            changed_at = seen + timedelta(days=rng.randrange(5, 9))
            r["changed_at"] = _iso(changed_at)
            r["changed_fields"] = ["salary", "arrangement"]
            r["last_active_at"] = _iso(changed_at)
            r["fit"] = "medium"
        elif state == "DUPLICATE_OR_INVALID":
            r["last_active_at"] = _iso(seen + timedelta(days=1))
            r["fit"] = "low"

    # Ensure the preserved demo-005 (AU) block fields match its identity, etc.
    # The above loop already covers AU records generically.


def _assign_evaluations(records, rng, ref):
    """Scoring-stage evaluation blocks for every active-pool record."""
    fit_overall_bands = {
        "high": (74, 94),
        "medium": (62, 78),
        "low": (40, 58),
        "unknown": (40, 55),
    }
    for r in records:
        if r["processing_state"] not in ("ACTIVE_VERIFIED", "ACTIVE_UNVERIFIED", "CHANGED", "POSTING_CHANGED"):
            continue
        lower, upper = fit_overall_bands[r["fit"]]
        target = lower + rng.randrange(0, upper - lower + 1)
        tech = max(35, min(98, target + rng.randrange(-8, 9)))
        exp = max(30, min(95, target + rng.randrange(-8, 9)))
        beh = max(40, min(98, tech)) if r["fit"] in ("high", "medium") else max(30, min(92, target - rng.randrange(0, 10)))
        career = max(35, min(95, target + rng.randrange(-6, 7)))
        overall = min(max(_eval_overall(tech, exp, beh, career), lower), upper)

        if r["fit"] == "high":
            verdict, recommendation = _VERDICT_HIGH, _RECOMMEND_HIGH
        elif r["fit"] == "medium":
            verdict, recommendation = _VERDICT_MEDIUM, _RECOMMEND_MEDIUM
        elif r["fit"] == "unknown":
            verdict, recommendation = "Fit undetermined - blocked source, canonical data only", _RECOMMEND_UNKNOWN
        else:
            verdict, recommendation = _VERDICT_LOW, _RECOMMEND_LOW

        location_note = "Preference: remote or hybrid NCR." if r["arrangement"] in ("remote", "hybrid") else \
            "Arrangement: onsite outside candidate's preferred model; evaluate compensation."
        evaluated_at = ref - timedelta(days=rng.randrange(0, 3))

        r["evaluation"] = {
            "technical": tech,
            "experience": exp,
            "behavioral": beh,
            "location": r["location"],
            "location_note": location_note,
            "career": career,
            "overall": overall,
            "verdict": verdict,
            "key_strengths": list(r["strengths"]),
            "gaps": list(r["gaps"]),
            "recommendation": recommendation,
            "evaluated_at": _iso(evaluated_at),
        }
        # Blocked (ACTIVE_UNVERIFIED) records were never live-verified; their
        # `last_verified` must remain unset even though scoring produced an
        # evaluation timestamp.
        if r["processing_state"] != "ACTIVE_UNVERIFIED" and not r.get("last_verified"):
            r["last_verified"] = _iso(evaluated_at)


def _assign_ranks(records, rng):
    """Rank active-pool records by evaluation overall (higher fit ranks higher).

    rank_score is a distinct, monotone-ish numeric score derived from the
    evaluation overall, so the ranking surface demonstrates fit ordering while
    keeping realistic spread.
    """
    active = [r for r in records if r["processing_state"] in
              ("ACTIVE_VERIFIED", "ACTIVE_UNVERIFIED", "CHANGED", "POSTING_CHANGED")]
    active.sort(key=lambda r: ((r["evaluation"] or {}).get("overall") or 0), reverse=True)
    rank = 92
    for r in active:
        r["rank_score"] = rank
        # Reuse the evaluation verdict so blocked/unknown-fit records don't
        # read as a "weak match" purely because their overall is low.
        r["rank_verdict"] = (r["evaluation"] or {}).get("verdict") or "Ranked"
        r["rank_date"] = (r["evaluation"] or {}).get("evaluated_at")
        rank -= 1


def _apply_fingerprints(records):
    """Content fingerprints for every record; CHANGED/POSTING_CHANGED differ from previous."""
    changed_list = ("CHANGED", "POSTING_CHANGED")
    for r in records:
        f = _fictional_md5(_material(r, variant="v2"))
        if r["processing_state"] in changed_list:
            r["fingerprint"] = f
            r["previous_fingerprint"] = _fictional_md5(_material(r, variant="v1"))
        else:
            r["fingerprint"] = f
            r["previous_fingerprint"] = None


# ---------------------------------------------------------------------------
# Applications / tracker
# ---------------------------------------------------------------------------
def _build_applications(records, corpus_date: str) -> list:
    """16 fictional application-tracker entries. Metadata only (no real files)."""
    seed = hashlib.sha256(f"{GENERATOR_VERSION}|{corpus_date}|apps".encode()).digest()
    rng = random.Random(seed)
    active = [r for r in records if r["processing_state"] in
              ("ACTIVE_VERIFIED", "ACTIVE_UNVERIFIED", "CHANGED", "POSTING_CHANGED")]
    # deterministic pick of 16 distinct active records
    chosen = [active[i] for i in [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]]
    statuses = ["draft", "submitted", "under_review", "interview", "interview",
                "offer", "accepted", "rejected", "withdrawn", "submitted",
                "under_review", "interview", "rejected", "submitted", "under_review", "draft"]
    ref = datetime.strptime(corpus_date, "%Y-%m-%d")
    rows = []
    for i, rec in enumerate(chosen):
        status = statuses[i]
        date = ref - timedelta(days=18 - i)
        company = rec["company"]
        if status in ("draft", "submitted"):
            fit_rating = 60 + rng.randrange(0, 26)
        elif status == "accepted":
            fit_rating = 85 + rng.randrange(0, 11)
        elif status in ("interview", "offer", "under_review"):
            fit_rating = 70 + rng.randrange(0, 16)
        else:
            fit_rating = 35 + rng.randrange(0, 25)
        has_docs = status not in ("draft", "withdrawn")
        notes = {
            "draft": "Draft application; CV tailoring pending.",
            "submitted": "Submitted via portal; awaiting acknowledgement.",
            "under_review": "Application received; recruiter screening in progress.",
            "interview": "Interview scheduled; preparing technical talking points.",
            "offer": "Offer under discussion; evaluating compensation and growth.",
            "accepted": "Offer accepted; onboarding documentation in progress.",
            "rejected": "Not proceeding; role filled.",
            "withdrawn": "Withdrawn by sender; focus shifted to higher-fit roles.",
        }[status]
        cv = f"cv_{_slug(company)}_{_slug(rec['title'])}.pdf" if has_docs else ""
        cl = f"cl_{_slug(company)}_{_slug(rec['title'])}.pdf" if has_docs else ""
        rows.append({
            "date": date.strftime("%Y-%m-%d"),
            "company": company,
            "sector": _sector_for(rec),
            "role": rec["title"],
            "role_type": "Full-time",
            "channel": rec["portal"].title(),
            "status": status,
            "contact_person": "",
            "fit_rating": fit_rating,
            "notes": notes,
            "cv_file": cv,
            "cover_letter_file": cl,
            "source": rec["portal"].title(),
            "stable_id": rec["stable_id"],
        })
    # Keep deterministic order and stable counts.
    rows.sort(key=lambda r: r["stable_id"])
    return rows


def _slug(s: str) -> str:
    s = _norm(s).replace(" ", "_")
    s = re.sub(r"[^a-z0-9_]", "", s)
    return s or "x"


SECTOR_MAP = {
    "TechCorp Philippines": "IT Services",
    "Global BPO Solutions": "BPO/Shared Services",
    "CloudFirst Inc": "Cloud Services",
    "SecureNet Philippines": "Cybersecurity",
    "FinanceHub Corp": "Financial Services",
    "AWS Partner Network": "Cloud Services",
    "TelcoManila": "Telecommunications",
    "StartupHub": "Software / Internet",
}
def _sector_for(rec):
    return SEED_SECTOR_BY_COMPANY.get(rec["company"]) or "IT Services"


SEED_SECTOR_BY_COMPANY = {
    "NimbusPay Solutions": "FinTech",
    "VantagePoint Support Services": "BPO/Shared Services",
    "HaloRoute Logistics IT": "Logistics",
    "BluePeak Data Center": "Data Center / Hosting",
    "FortifyGate Security": "Cybersecurity",
    "SkylineNetworks PH": "Telecommunications",
    "Promedia Digital": "Media / Digital Services",
    "Keystone Cloud Ops": "Cloud Services",
    "TypeSafe Enterprises": "IT Services",
    "LumenReach Telecom": "Telecommunications",
    "OrbitDesk Inc": "IT Services",
    "PrismHealth IT Services": "Healthcare IT",
}
SEED_SECTOR_BY_COMPANY.update(SECTOR_MAP)


# ---------------------------------------------------------------------------
# Checkpoints
# ---------------------------------------------------------------------------
def _build_checkpoints(records, corpus_date: str) -> dict:
    ref = datetime.strptime(corpus_date, "%Y-%m-%d")
    states = [r["processing_state"] for r in records]
    active_count = sum(1 for s in states if s in
                       ("ACTIVE_VERIFIED", "ACTIVE_UNVERIFIED", "CHANGED", "POSTING_CHANGED"))
    verified = states.count("ACTIVE_VERIFIED")
    blocked = states.count("ACTIVE_UNVERIFIED")
    changed = states.count("CHANGED") + states.count("POSTING_CHANGED")
    closed = states.count("CLOSED_OR_EXPIRED")

    tier_counts = {}
    for r in records:
        if r["processing_state"] in ("ACTIVE_VERIFIED", "ACTIVE_UNVERIFIED", "CHANGED", "POSTING_CHANGED"):
            t = f"tier{r['priority_tier']}"
            tier_counts[t] = tier_counts.get(t, 0) + 1
    tier_breakdown = dict(sorted(tier_counts.items()))

    current = {
        "run_id": corpus_date.replace("-", "") + "-000000",
        "started_at": _iso(ref),
        "mode": "incremental",
        "stage": "ranking_report",
        "stage_status": "complete",
        "jobs_processed_in_stage": len(records),
        "total_jobs_in_stage": len(records),
        "batch_index": (len(records) + 4) // 5,
        "total_batches": (len(records) + 4) // 5,
        "last_updated": _iso(ref + timedelta(hours=2)),
        "passed": active_count + closed,
        "deprioritized": 1,
        "queue_length": active_count,
        "tier_breakdown": tier_breakdown,
        "verified": verified,
        "blocked": blocked,
        "changed": changed,
        "closed": closed,
        "top5_count": 5,
        "top10_count": 10,
    }
    history = [
        {
            "run_id": (ref - timedelta(days=1)).strftime("%Y%m%d") + "-180000",
            "started_at": _iso(ref - timedelta(days=1, hours=6)),
            "mode": "incremental",
            "stage": "ranking_report",
            "stage_status": "complete",
            "jobs_processed_in_stage": 40,
            "total_jobs_in_stage": 40,
            "batch_index": 8,
            "total_batches": 8,
            "last_updated": _iso(ref - timedelta(days=1, hours=4)),
        },
        {
            "run_id": (ref - timedelta(days=2)).strftime("%Y%m%d") + "-120000",
            "started_at": _iso(ref - timedelta(days=2, hours=6)),
            "mode": "incremental",
            "stage": "ranking_report",
            "stage_status": "complete",
            "jobs_processed_in_stage": 8,
            "total_jobs_in_stage": 8,
            "batch_index": 2,
            "total_batches": 2,
            "last_updated": _iso(ref - timedelta(days=2, hours=4)),
        },
    ]
    return {"current_checkpoint": current, "run_history": history}


# ---------------------------------------------------------------------------
# Validation (runs BEFORE writing; raises on any failure)
# ---------------------------------------------------------------------------
def _validate(records, apps) -> None:
    errors = []
    seen_ids = [r["stable_id"] for r in records]
    if len(seen_ids) != len(set(seen_ids)):
        errors.append("duplicate stable_ids")

    state_counts = {}
    for r in records:
        state_counts[r["processing_state"]] = state_counts.get(r["processing_state"], 0) + 1

    active_total = state_counts.get("ACTIVE_VERIFIED", 0) + state_counts.get("ACTIVE_UNVERIFIED", 0) + \
        state_counts.get("CHANGED", 0) + state_counts.get("POSTING_CHANGED", 0)
    if active_total < MIN_ACTIVE_TOTAL: errors.append(f"active total {active_total} < {MIN_ACTIVE_TOTAL}")
    if state_counts.get("ACTIVE_VERIFIED", 0) < MIN_ACTIVE_VERIFIED: errors.append("ACTIVE_VERIFIED below min")
    if state_counts.get("ACTIVE_UNVERIFIED", 0) < MIN_ACTIVE_UNVERIFIED: errors.append("ACTIVE_UNVERIFIED below min")
    if state_counts.get("CHANGED", 0) < MIN_CHANGED: errors.append("CHANGED below min")
    if state_counts.get("POSTING_CHANGED", 0) < MIN_POSTING_CHANGED: errors.append("POSTING_CHANGED below min")
    peripheral_total = sum(state_counts.get(s, 0) for s in
                           ("STALE", "CLOSED_OR_EXPIRED", "NEEDS_VERIFICATION", "DUPLICATE_OR_INVALID"))
    if peripheral_total < MIN_PERIPHERAL_TOTAL: errors.append(f"peripheral {peripheral_total} < {MIN_PERIPHERAL_TOTAL}")

    for r in records:
        if r["processing_state"] not in VALID_STATES:
            errors.append(f"{r['stable_id']} invalid state {r['processing_state']}")
        if r["arrangement"] not in VALID_ARRANGEMENTS:
            errors.append(f"{r['stable_id']} invalid arrangement")
        if r["fit"] not in VALID_FITS:
            errors.append(f"{r['stable_id']} invalid fit")
        if not r["title"] or not r["company"] or not r["url"]:
            errors.append(f"{r['stable_id']} missing required field")

    # Evaluation coverage and consistency
    complete = 0
    for r in records:
        e = r["evaluation"]
        if e is not None:
            required = ("technical", "experience", "behavioral", "career", "overall",
                        "verdict", "key_strengths", "gaps", "recommendation", "evaluated_at")
            if all(e.get(k) not in (None, "", []) for k in required):
                complete += 1
            overall = e.get("overall")
            if overall is None:
                errors.append(f"{r['stable_id']} evaluation.overall missing")
            else:
                if r["fit"] == "high" and not (74 <= overall <= 100):
                    errors.append(f"{r['stable_id']} high fit overall out of band")
                if r["fit"] == "medium" and not (58 <= overall):
                    errors.append(f"{r['stable_id']} medium fit overall too low")
    if complete < MIN_COMPLETE_EVALUATIONS:
        errors.append(f"complete evaluations {complete} < {MIN_COMPLETE_EVALUATIONS}")

    # Applications
    if len(apps) < MIN_APPLICATIONS:
        errors.append(f"applications {len(apps)} < {MIN_APPLICATIONS}")
    app_ids = {a["stable_id"] for a in apps}
    if any(sid not in seen_ids for sid in app_ids):
        errors.append("application reference does not resolve")
    if len({a["status"] for a in apps}) < MIN_APP_STATUSES:
        errors.append("too few application statuses")
    if any(a["status"] not in VALID_APP_STATUSES for a in apps):
        errors.append("invalid application status value")
    notes = sum(1 for a in apps if (a.get("notes") or "").strip())
    if notes < MIN_APP_WITH_NOTES:
        errors.append(f"apps with notes {notes} < {MIN_APP_WITH_NOTES}")
    docs = sum(1 for a in apps if a.get("cv_file") and a.get("cover_letter_file"))
    if docs < MIN_APP_WITH_DOCS:
        errors.append(f"apps with docs {docs} < {MIN_APP_WITH_DOCS}")

    # Leakage guard: scan serialized output for forbidden real-world markers.
    blob = json.dumps(records, ensure_ascii=False).lower() + json.dumps(apps, ensure_ascii=False).lower()
    for marker in _FORBIDDEN_MARKERS:
        if marker in blob:
            errors.append(f"forbidden marker present: {marker}")

    if errors:
        raise SystemExit(f"VALIDATION FAILED (nothing written):\n  " + "\n  ".join(errors))


# ---------------------------------------------------------------------------
# Writers
# ---------------------------------------------------------------------------
def _write_jobs(records, corpus_date: str, out_dir: Path) -> None:
    doc = {
        "demo_meta": {
            "created_at": corpus_date + "T00:00:00Z",
            "description": "Deterministic fictional demo dataset for CareerPilot public API showcase",
            "version": GENERATOR_VERSION,
        },
        "seen": {r["stable_id"]: r for r in records},
    }
    (out_dir / "demo_seen_jobs.json").write_text(
        json.dumps(doc, indent=2, sort_keys=False, ensure_ascii=False) + "\n", encoding="utf-8")


def _write_tracker(apps, out_dir: Path) -> None:
    fieldnames = ["date", "company", "sector", "role", "role_type", "channel", "status",
                  "contact_person", "fit_rating", "notes", "cv_file", "cover_letter_file", "source", "stable_id"]
    rows = []
    for a in apps:
        rows.append({k: (a.get(k, "") if a.get(k) is not None else "") for k in fieldnames})
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames, lineterminator="\n")
    writer.writeheader()
    for r in rows:
        writer.writerow(r)
    (out_dir / "demo_tracker.csv").write_text(buf.getvalue(), encoding="utf-8")


def _write_checkpoints(checkpoints, out_dir: Path) -> None:
    (out_dir / "demo_checkpoints.json").write_text(
        json.dumps(checkpoints, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")


def _print_summary(records, apps, checkpoints):
    state_counts = {}
    for r in records:
        state_counts[r["processing_state"]] = state_counts.get(r["processing_state"], 0) + 1
    evals = sum(1 for r in records if r["evaluation"] is not None)
    print(f"Generated {len(records)} records:")
    for s in sorted(state_counts):
        print(f"  {s}: {state_counts[s]}")
    print(f"Active pool: {sum(state_counts.get(s,0) for s in ('ACTIVE_VERIFIED','ACTIVE_UNVERIFIED','CHANGED','POSTING_CHANGED'))}")
    print(f"Complete evaluations: {evals}")
    print(f"Applications: {len(apps)} across {len({a['status'] for a in apps})} statuses")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--corpus-date", default=DEFAULT_CORPUS_DATE,
                        help=f"reference date (default {DEFAULT_CORPUS_DATE})")
    parser.add_argument("--out-dir", default=None, help="output dir (default backend/demo_data)")
    parser.add_argument("--check", action="store_true", help="validate only; write nothing")
    args = parser.parse_args(argv)

    if not re.match(r"^\d{4}-\d{2}-\d{2}$", args.corpus_date):
        raise SystemExit("corpus-date must be YYYY-MM-DD")

    records = _build_jobs(args.corpus_date)
    apps = _build_applications(records, args.corpus_date)
    checkpoints = _build_checkpoints(records, args.corpus_date)

    _validate(records, apps)

    if args.check:
        print("Validation OK - no files written.")
        _print_summary(records, apps, checkpoints)
        return

    out_dir = Path(args.out_dir) if args.out_dir else (Path(__file__).resolve().parents[1] / "demo_data")
    out_dir.mkdir(parents=True, exist_ok=True)

    _write_jobs(records, args.corpus_date, out_dir)
    _write_tracker(apps, out_dir)
    _write_checkpoints(checkpoints, out_dir)
    _print_summary(records, apps, checkpoints)
    print(f"\nWrote:\n  {out_dir / 'demo_seen_jobs.json'}\n  {out_dir / 'demo_tracker.csv'}\n  {out_dir / 'demo_checkpoints.json'}")


if __name__ == "__main__":
    main()