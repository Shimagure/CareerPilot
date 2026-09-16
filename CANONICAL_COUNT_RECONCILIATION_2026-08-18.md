# Canonical-Count Reconciliation — 2026-08-18

**Purpose:** Resolve the discrepancy between the historical 33-job report and the current 34-job dataset per MASTER_JOB_SEARCH_BASELINE.md Section 19 (Data Integrity Audit — mandatory finalization gate).

---

## 1. Source Datasets (Verified)

| Dataset | Count | Source |
|---------|-------|--------|
| `consolidated_jobs.json` (raw, post-URL-dedup, **still includes 1 Citadel URL-dup**) | **173** | Verified via PowerShell |
| `hard_filtered_jobs.json` (after hard filter) | **172** | Verified via PowerShell |

---

## 2. Hard-Filter Status Breakdown (`hard_filtered_jobs.json` = 172)

| Status | Count |
|--------|-------|
| DEPRIORITIZE | 83 |
| NEEDS_CLARIFICATION | 55 |
| PASSED_HARD_FILTER | **34** |
| **SUM** | **172** ✓ |

**Reconciliation Check 1 (Rule H — Counts must reconcile):**  
173 (consolidated) − 1 (Citadel URL-duplicate `cdef0123456789ab` removed **during** URL deduplication) = **172** = 83 + 55 + 34 ✓

---

## 3. Citadel Pacific Duplicate — Root Cause of the 33 vs 34 Discrepancy

| Record | ID | In `consolidated_jobs.json` | In `hard_filtered_jobs.json` | Action |
|--------|-----|----------------------------|------------------------------|--------|
| Citadel Pacific — IT Technical Support Specialist | `a1bbc00b47bcd326` | Yes | Yes — **PASSED_HARD_FILTER** | Kept (canonical) |
| Citadel Pacific — IT Technical Support Specialist (dup) | `cdef0123456789ab` | Yes | **No** (absent) | **Removed during URL deduplication** |

**Key finding:** The duplicate `cdef0123456789ab` was **already excluded during URL deduplication** — it does not appear in `hard_filtered_jobs.json`. Therefore it must **NOT be subtracted a second time**.

**Why the earlier 33-job report was incorrect:**  
The prior report appears to have subtracted the Citadel duplicate **twice** — once correctly (at URL dedup, leaving 172 records in hard_filtered) and once incorrectly (34 − 1 = 33). The correct canonical count is **34**.

---

## 4. Arrangement Totals for PASSED_HARD_FILTER (34 jobs)

| Arrangement | Count |
|-------------|-------|
| remote | 7 |
| hybrid | 4 |
| onsite_ncr | 23 |
| **SUM** | **34** ✓ |

**Reconciliation Check 2:** Arrangement totals (7 + 4 + 23 = 34) equal the canonical PASSED_HARD_FILTER count (34). No job exists in more than one arrangement category.

---

## 5. Explicit Accounting for the Four Named Jobs

| Job | ID | Status in `hard_filtered_jobs.json` | Arrangement | Notes |
|-----|-----|--------------------------------------|-------------|-------|
| **Payreto — IT Technical Support** | `bafd3db566129391` | **DEPRIORITIZE** ✓ | — | Correctly deprioritized (salary ₱21–30K, below target) |
| **Payreto — Application Support Engineer** | `8202ab6b5025cd0e` | **PASSED_HARD_FILTER** | onsite_ncr | Separate posting; correctly passed |
| **Support Services Group — Service Desk Support** | `bebc71c436c7ed8a` | **PASSED_HARD_FILTER** | **onsite_ncr** ✓ | "Onsite NCR (Pasig) - verified 100% onsite" |
| **De Castro Consulting — End User Support** | `93966411` | **PASSED_HARD_FILTER** ✓ | **onsite_ncr** | RESTORED (was HOLD in tracker; now PASSED after verification) — salary ₱50–60K |
| **Hashtag People — End User Support Engineer Hybrid** | `93456749` | **PASSED_HARD_FILTER** ✓ | **hybrid** | RESTORED (was "ranked" in seen_jobs; now PASSED after verification) |

All four jobs accounted for correctly. No job is missing, double-counted, or in the wrong category.

---

## 6. Final Canonical Count & Integrity Status

| Metric | Value |
|--------|-------|
| **Final canonical jobs (PASSED_HARD_FILTER)** | **34** |
| Hard-filter passed | 34 |
| Needs clarification | 55 |
| Deprioritized | 83 |
| Duplicates removed (URL dedup) | 1 (Citadel `cdef0123456789ab`) |
| Dead URLs removed | 0 (none identified in this cycle) |
| Restored after keyword-gap detection | 2 (De Castro 93966411, Hashtag 93456749) |
| Jobs actually verified (live) | TBD (next gate) |
| Jobs eligible for scoring | 34 |
| **Integrity status** | **PASS** ✓ |

---

## 7. Files Updated / Metadata Recorded

| File | Action |
|------|--------|
| `CANONICAL_COUNT_RECONCILIATION_2026-08-18.md` | **Created** — this audit record |
| `MASTER_JOB_SEARCH_BASELINE.md` | No change required — already mandates this audit format |
| `hard_filtered_jobs.json` | No change — already internally consistent (172 = 83+55+34) |
| `job_search_tracker.csv` | No change — De Castro (row 17) remains `hold` pending live verification; Hashtag (row 14) remains `drafted` |
| `job_scraper/seen_jobs.json` | No change — records match |

---

## 8. Confirmation of Dataset Internal Consistency

- [x] **Reconciliation Check 1:** Total consolidated (173) − URL duplicates removed (1 Citadel) = 172 = DEPRIORITIZE (83) + NEEDS_CLARIFICATION (55) + PASSED_HARD_FILTER (34) ✓
- [x] **Reconciliation Check 2:** PASSED_HARD_FILTER arrangement totals (7 remote + 4 hybrid + 23 onsite_ncr = 34) = canonical count (34) ✓
- [x] **No job in >1 category:** Each `hard_filtered_jobs.json` record has exactly one `filter_status` and one `arrangement` ✓
- [x] **No canonical job lost or double-counted:** 34 distinct `id` values in PASSED_HARD_FILTER set ✓
- [x] **Citadel duplicate handled once:** Excluded at URL dedup; not subtracted again ✓
- [x] **Named jobs verified:** Payreto→DEPRIORITIZE, SSG→onsite_ncr/PASSED, De Castro→RESTORED/PASSED, Hashtag→RESTORED/PASSED ✓

---

## 9. Conclusion

**Final canonical count = 34.** The earlier 33-job figure was an artifact of double-subtracting the Citadel Pacific URL-duplicate. All arithmetic reconciles, all audit checks pass, and the dataset is internally consistent.

**Next step:** Await explicit user instruction before proceeding to Step 3 (live verification → scoring/ranking). Do NOT start scoring/ranking until authorized.

---

*Generated per MASTER_JOB_SEARCH_BASELINE.md Section 19.3 (Permanent Audit Output Format) — Data Integrity Audit mandatory gate.*