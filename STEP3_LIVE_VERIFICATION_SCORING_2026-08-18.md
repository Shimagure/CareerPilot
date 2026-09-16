# Step 3 — Live Verification & Scoring Report — 2026-08-18

**Objective:** Live verify and score the 34 canonical PASSED_HARD_FILTER jobs, then rank all 34, produce Top 10 and Top 5.

**Baseline:** 34 canonical jobs (7 remote, 4 hybrid, 23 onsite_ncr) per `CANONICAL_COUNT_RECONCILIATION_2026-08-18.md`.

**Processing:** Batches of 5 jobs (Batch 7 = 4 jobs). Checkpoint after each batch.

**Live Verification Method & Caveat (2026-08-18):**
- **Indeed jobs (Batches 1–2, Job 16 source):** Live-verified via WebFetch — all returned active listings with full details.
- **JobStreet jobs (Batches 4–7, all):** WebFetch returned **HTTP 403 Forbidden** (anti-bot protection) on every attempt. Live re-fetch was **blocked**. These are marked `ACTIVE_UNVERIFIED` — verified from the canonical scrape cycle (dated 2026-08-13 to 2026-08-16, ≤5 days before today) which captured full teaser, salary, arrangement, and dates. Status reflects "captured recently, not live-reconfirmed."
- No expired/closed markers were present in any captured data. No `CLOSED_OR_EXPIRED` or `POSTING_CHANGED` classifications were triggered.

---

## Batch 1 (Jobs 1–5)

| # | Job ID | Title | Company | Arrangement | Salary | Verification Status | Score | Notes |
|---|--------|-------|---------|-------------|--------|---------------------|-------|-------|
| 1 | 0934ca2326b03e16 | Service Desk Analyst | Starshot Software | remote | Up to PHP 57,000/mo | ACTIVE_VERIFIED | 83 | Live: L1 Service Desk, 3yr M365/AD/Networking req, remote, no lang/citizenship gate |
| 2 | a1bbc00b47bcd326 | IT Technical Support Specialist | Citadel Pacific Ltd.- ROHQ | onsite_ncr | PHP 36,000–42,000/mo | ACTIVE_VERIFIED | 60 | Live: network-focused role (VLAN/routing/firewalls), candidate EUC-strong/network-moderate, CCNA preferred |
| 3 | ec5f1bb34103e97e | L1 Helpdesk Technician (L2 Caliber) | ScalableOS | remote | From PHP 70,000/mo | ACTIVE_VERIFIED | 87 | Live: remote permanent night shift, 1+yr help desk, MSP, M365, on-call; excellent salary |
| 4 | 7b4db7a09d26ce29 | IT Support Specialist — Mac & Google Workspace, WFH, US Shift | Optimum Source Inc. | remote | From PHP 45,000/mo | ACTIVE_VERIFIED | 70 | Live: Mac/GWS admin gap (Level 3 unverified), Windows/AD strong, US shift remote |
| 5 | bebc71c436c7ed8a | Service Desk Support | Support Services Group Philippines | onsite_ncr | PHP 22,000–32,000/mo | ACTIVE_VERIFIED | 67 | Live: labeled "Remote" but 100% onsite Pasig; salary below target; skills match strong |

**Batch 1 Status:** COMPLETE (5/5 verified, 5/5 scored)

---

### Batch 1 — Detailed Scoring

#### Job 1: Starshot Software — Service Desk Analyst (0934ca2326b03e16)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 85/100 | Service Desk, M365, AD are primary skills; networking moderate |
| Experience Match | 85/100 | 3yr Tier2 EUC enterprise support, AD & M365 admin directly relevant |
| Behavioral Fit | 80/100 | Remote, clear processes, enterprise infra — matches reliable executor |
| Location | PASS | Remote (confirmed live) |
| Career Alignment | 80/100 | Service desk + M365/AD/networking; growth toward sysadmin |

**Overall: 83/100** | Verdict: **Strong Fit** | Recommendation: **TOP PRIORITY**
Key strengths: Remote, salary above target (₱57K), direct Service Desk/AD/M365 match.
Gaps: Networking depth (moderate, learnable).

#### Job 2: Citadel Pacific — IT Technical Support Specialist (a1bbc00b47bcd326)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 55/100 | Network-ops focused; candidate has Fortinet NSE3 + Cisco Basics certs but EUC/desktop is primary exp |
| Experience Match | 50/100 | Adjacent (EUC tech w/ network troubleshooting) but role is network specialist |
| Behavioral Fit | 75/100 | Enterprise, structured, compatible |
| Location | PASS | Onsite Taguig (NCR) |
| Career Alignment | 65/100 | Network/security tooling aligns with growth, but more network-ops than EUC |

**Overall: 60/100** | Verdict: **Good Fit (borderline)** | Recommendation: **CONSIDER**
Key strengths: Fortinet NSE3 cert, Cisco Networking Basics cert, enterprise env.
Gaps: Day-to-day VLAN/routing/switching/firewall ops not verified experience.

#### Job 3: ScalableOS — L1 Helpdesk Technician (L2 Caliber) (ec5f1bb34103e97e)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 88/100 | Help desk, M365, AD all primary; L2 caliber matches Tier2 background |
| Experience Match | 90/100 | Direct help desk/Tier2, 3yr enterprise support |
| Behavioral Fit | 82/100 | Remote MSP, structured, matches profile |
| Location | PASS | Remote (confirmed live) |
| Career Alignment | 85/100 | High salary + remote + growth path |

**Overall: 87/100** | Verdict: **Strong Fit** | Recommendation: **TOP PRIORITY**
Key strengths: Remote, ₱70K salary (well above target), night shift OK (prior exp), on-call OK.
Gaps: None significant.

#### Job 4: Optimum Source — IT Support Specialist Mac & GWS (7b4db7a09d26ce29)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 65/100 | Windows/AD strong; Mac & Google Workspace admin is Level 3 gap (unverified) |
| Experience Match | 70/100 | Desktop support transferable; Mac/GWS env different |
| Behavioral Fit | 78/100 | Remote US-shift, creative agency, structured |
| Location | PASS | Remote (confirmed live) |
| Career Alignment | 70/100 | Desktop + cloud admin growth, Mac/GWS gap |

**Overall: 70/100** | Verdict: **Good Fit** | Recommendation: **STRONG MATCH**
Key strengths: Remote, ₱45K meets target, Windows/AD/M365 transferable.
Gaps: Mac hardware & Google Workspace admin not verified (address honestly in CL).

#### Job 5: Support Services Group — Service Desk Support (bebc71c436c7ed8a)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 80/100 | Service Desk, AD, O365, Windows all primary |
| Experience Match | 80/100 | Direct service desk experience |
| Behavioral Fit | 65/100 | Onsite (despite "Remote" label), night/shifting/weekend — less ideal |
| Location | PASS | Onsite Pasig (NCR), but posting label discrepancy noted |
| Career Alignment | 45/100 | Salary ₱22–32K below target; onsite; weaker growth signal |

**Overall: 67/100** | Verdict: **Good Fit (skills) / comp concern** | Recommendation: **CONSIDER / LOWER PRIORITY**
Key strengths: Strong skills match, NCR location.
Gaps: Salary below target; "Remote" label misleading (actually 100% onsite Pasig).

---

## Batch 2 (Jobs 6–10)

| # | Job ID | Title | Company | Arrangement | Salary | Verification Status | Score | Notes |
|---|--------|-------|---------|-------------|--------|---------------------|-------|-------|
| 6 | 7731b2e1bfc3d68a | IT Support Specialist | Microbiz One Inc. | onsite_ncr | PHP 20,000–25,000/mo | ACTIVE_VERIFIED | 48 | Live: salary below target, LAN/WAN/firewall focus, field travel req |
| 7 | a859ef69900c7c3d | Service Desk Engineer L2 (After Hours) | ScalableOS | remote | From PHP 90,000/mo | ACTIVE_VERIFIED | 89 | Live: remote night shift, L2 M365/Hyper-V/AD, MSP, excellent salary |
| 8 | 2ec7d669e06ff034 | NOC Engineer | Starshot Software | remote | Up to PHP 54,000/mo | ACTIVE_VERIFIED | 75 | Live: Service Desk L1 duties despite NOC title, 2yr M365/AD, remote |
| 9 | 31177f4e8a02a463 | IT Service Desk Analyst L1.5 (ASAP) | IT by Design | onsite_ncr | PHP 30,000–40,000/mo | ACTIVE_VERIFIED | 72 | Live: onsite Taguig night shift, 2yr exp, MSP favored, English fluency required |
| 10 | 048e2a1d7784998b | Technical Support Engineer | NIU PROFFESIONALS INC. | onsite_ncr | PHP 30,000–40,000/mo | ACTIVE_VERIFIED | 45 | Live: Hikvision security product focus, English fluency required, onsite Pasig |

**Batch 2 Status:** COMPLETE (5/5 verified, 5/5 scored)

---

### Batch 2 — Detailed Scoring

#### Job 6: Microbiz One — IT Support Specialist (7731b2e1bfc3d68a)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 55/100 | Windows/Linux server, LAN/WAN, firewall, router/switch; pfSense/Ubiquiti — moderate match |
| Experience Match | 50/100 | 1yr office IT support req; network/field work is adjacent to EUC |
| Behavioral Fit | 60/100 | Field travel, night shift, vendor coordination — mixed |
| Location | PASS | Onsite Makati (NCR) |
| Career Alignment | 30/100 | Network/field ops not core EUC; salary ₱20–25K below target |

**Overall: 48/100** | Verdict: **Weak Fit** | Recommendation: **LOWER PRIORITY / DO NOT APPLY**
Key strengths: Windows/Linux server, AD adjacent.
Gaps: Salary well below target; field work/travel not aligned; network-ops focus.

#### Job 7: ScalableOS — Service Desk Engineer L2 (After Hours) (a859ef69900c7c3d)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 90/100 | M365 L2, Hyper-V, Citrix, backend app servers, AD, networking — all primary/strong |
| Experience Match | 85/100 | Tier2 EUC with AD/M365 aligns; Hyper-V/Citrix is growth area |
| Behavioral Fit | 85/100 | Remote MSP, night shift OK, on-call OK, structured |
| Location | PASS | Remote (confirmed live) |
| Career Alignment | 95/100 | ₱90K+ remote, L2, MSP, clear sysadmin/cloud growth path |

**Overall: 89/100** | Verdict: **Strong Fit** | Recommendation: **TOP PRIORITY**
Key strengths: Highest salary (₱90K+), remote, L2, M365/AD/Hyper-V, night shift experience matches.
Gaps: Hyper-V/Citrix/VDI learning curve (acknowledged growth area).

#### Job 8: Starshot Software — NOC Engineer (2ec7d669e06ff034)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 80/100 | M365, AD, networking, ticketing, VPN/DNS/DHCP — all primary/strong |
| Experience Match | 75/100 | Service Desk L1 duties (despite NOC title); Tier2 EUC aligns well |
| Behavioral Fit | 75/100 | Remote, shifting schedule, enterprise, structured |
| Location | PASS | Remote (confirmed live) |
| Career Alignment | 70/100 | NOC exposure = networking/security growth; ₱54K above target |

**Overall: 75/100** | Verdict: **Strong Fit** | Recommendation: **TOP PRIORITY**
Key strengths: Remote, ₱54K, M365/AD/networking match, shifting schedule OK.
Gaps: NOC title may imply more network monitoring than EUC.

#### Job 9: IT by Design — IT Service Desk Analyst L1.5 (31177f4e8a02a463)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 80/100 | Windows, O365, AD, networking, troubleshooting — all primary |
| Experience Match | 80/100 | 2yr support exp, MSP exposure favored; Tier2 background strong |
| Behavioral Fit | 70/100 | Onsite night shift (BGC), "ASAP" urgency, MSP — compatible but onsite |
| Location | PASS | Onsite Taguig (NCR) |
| Career Alignment | 60/100 | MSP exposure good; onsite commute from Bulacan; salary meets target floor |

**Overall: 72/100** | Verdict: **Good Fit** | Recommendation: **STRONG MATCH**
Key strengths: M365/AD match, MSP exposure, salary meets target.
Gaps: Onsite night shift BGC commute from Bulacan; English fluency flagged.

#### Job 10: NIU PROFESSIONALS — Technical Support Engineer (048e2a1d7784998b)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 40/100 | Hikvision security products, demos, training, project delivery — specialized, not EUC |
| Experience Match | 40/100 | 2yr tech support req; security product specialization is adjacent |
| Behavioral Fit | 50/100 | Project delivery, training, demos — different from support focus |
| Location | PASS | Onsite Pasig (NCR) |
| Career Alignment | 50/100 | Security product exposure tangential; English fluency required; salary acceptable |

**Overall: 45/100** | Verdict: **Weak Fit** | Recommendation: **LOWER PRIORITY / DO NOT APPLY**
Key strengths: Onsite NCR, salary meets target.
Gaps: Hikvision/IP camera product focus; sales/demo/project role not EUC support; English fluency gate.

---

## Batch 3 (Jobs 11–15)

| # | Job ID | Title | Company | Arrangement | Salary | Verification Status | Score | Notes |
|---|--------|-------|---------|-------------|--------|---------------------|-------|-------|
| 11 | cc66e5faf6bba636 | Service Desk Manager | AUMTREND PH INC | onsite_ncr | PHP 180,000–200,000/mo | ACTIVE_VERIFIED | 35 | Live: requires 15+yr mgmt of 100+ staff; candidate has 0 direct reports — overqualified gap |
| 12 | 7a02dd192609a558 | Non-Voice Technical Support | Sapient Careers North | onsite_ncr | PHP 19,000–26,000/mo | ACTIVE_VERIFIED | 58 | Live: non-voice tech support, onsite shifting, salary below target, no BPO exp req |
| 13 | b254e03aa5732dcf | Chat and Email Technical Support | Sapient BPO - Inc. Manila | onsite_ncr | PHP 19,000–26,000/mo | ACTIVE_VERIFIED | 58 | Live: chat/email tech support, onsite, salary below target, fresh grads welcome |
| 14 | c4d31c338f6cfbde | Technical Support Associate | SolarWinds | hybrid | From PHP 45,000/mo | ACTIVE_VERIFIED | 65 | Live: hybrid Taguig, ₱45K, network tool support, 2yr sysadmin pref, commute required |
| 15 | 0961e55cfbc45f12 | Technical Support Representative | Ancar Motors | onsite_ncr | PHP 23,000–25,000/mo | ACTIVE_VERIFIED | 62 | Live: Q.C. onsite, AD/firewall/VPN/backup, fresh grads welcome, salary below target |

**Batch 3 Status:** COMPLETE (5/5 verified, 5/5 scored)

---

### Batch 3 — Detailed Scoring

#### Job 11: AUMTREND — Service Desk Manager (cc66e5faf6bba636)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 60/100 | GSD domain knowledge relevant; but role is management of 100+ staff |
| Experience Match | 25/100 | 0 direct reports; 3yr enterprise support ≠ 15yr managing 100+ people |
| Behavioral Fit | 40/100 | Management-heavy, metrics/stakeholder focus — not execution role |
| Location | PASS | Onsite BGC (NCR) night shift |
| Career Alignment | 30/100 | Not a growth step from EUC; management track different from technical path |

**Overall: 35/100** | Verdict: **Poor Fit** | Recommendation: **DO NOT APPLY**
Key strengths: Salary exceptionally high (₱180–200K); GSD domain familiarity.
Gaps: Requires 15+ years leading 100+ global staff; candidate has individual-contributor background only.

#### Job 12: Sapient Careers North — Non-Voice Technical Support (7a02dd192609a558)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 65/100 | Technical support, troubleshooting, tickets — primary EUC skills |
| Experience Match | 60/100 | Tier2 support transferable; no BPO exp required (inclusive) |
| Behavioral Fit | 65/100 | Onsite shifting, structured, non-voice — compatible |
| Location | PASS | Onsite Manila (NCR) |
| Career Alignment | 40/100 | Salary ₱19–26K below target; onsite; limited growth signal |

**Overall: 58/100** | Verdict: **Moderate Fit** | Recommendation: **CONSIDER**
Key strengths: Skills match, NCR location, no BPO barrier.
Gaps: Salary below target; onsite; non-voice BPO model.

#### Job 13: Sapient BPO — Chat and Email Technical Support (b254e03aa5732dcf)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 65/100 | Chat/email tech support, troubleshooting — primary EUC skills |
| Experience Match | 60/100 | Tier2 support transferable; fresh grads welcome |
| Behavioral Fit | 65/100 | Onsite, paid training, structured — compatible |
| Location | PASS | Onsite Mandaluyong (NCR) |
| Career Alignment | 40/100 | Salary ₱19–26K below target; onsite; limited growth signal |

**Overall: 58/100** | Verdict: **Moderate Fit** | Recommendation: **CONSIDER**
Key strengths: Skills match, NCR location, paid training.
Gaps: Salary below target; onsite; chat/email BPO model.

#### Job 14: SolarWinds — Technical Support Associate (c4d31c338f6cfbde)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 70/100 | Windows Server, TCP/IP, network tools support — moderate/strong; SQL a plus |
| Experience Match | 65/100 | 2yr sysadmin preferred; EUC + AD/networking transferable |
| Behavioral Fit | 70/100 | Hybrid Taguig, global users, KB authoring — matches systematic profile |
| Location | PASS | Hybrid Taguig (NCR) — commute required |
| Career Alignment | 65/100 | Network tooling + hybrid + ₱45K; aligns with sysadmin/network growth |

**Overall: 65/100** | Verdict: **Good Fit** | Recommendation: **STRONG MATCH**
Key strengths: Hybrid, ₱45K meets target, network/enterprise tooling exposure.
Gaps: 2yr sysadmin preferred (candidate has EUC + moderate sysadmin); commute to Taguig.

#### Job 15: Ancar Motors — Technical Support Representative (0961e55cfbc45f12)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 75/100 | AD, firewall/VPN, backups, system installs, user support — all primary |
| Experience Match | 70/100 | Direct AD/support experience; fresh grads welcome |
| Behavioral Fit | 65/100 | Onsite Q.C., "start ASAP" — compatible |
| Location | PASS | Onsite Quezon City (NCR) |
| Career Alignment | 45/100 | Salary ₱23–25K below target; onsite; automotive context |

**Overall: 62/100** | Verdict: **Good Fit** | Recommendation: **CONSIDER**
Key strengths: AD/firewall/VPN/backup skills match; NCR location.
Gaps: Salary below target; onsite; automotive dealer context (not enterprise infra).

---

## Batch 4 (Jobs 16–20)

| # | Job ID | Title | Company | Arrangement | Salary | Verification Status | Score | Notes |
|---|--------|-------|---------|-------------|--------|---------------------|-------|-------|
| 16 | 8202ab6b5025cd0e | Application Support Engineer | Payreto | hybrid | PHP 25,000–60,000/mo | ACTIVE_UNVERIFIED | 68 | Scrape: hybrid Makati, ₱25–60K, app support, 403-blocked live |
| 17 | 94015346 | IT Specialist | Huey Financing Inc | onsite_ncr | ₱25,000–30,000/mo | ACTIVE_UNVERIFIED | 60 | Scrape: onsite Taguig, ₱25–30K, tech support/maintain equip, 403-blocked |
| 18 | 93959933 | IT Helpdesk (Perm WFH/Morning Shift) | HGS Offshore Staffing Solutions | remote | ₱40,000–60,000/mo | ACTIVE_UNVERIFIED | 82 | Scrape: remote, perm WFH morning shift, ₱40–60K, L1 helpdesk, 403-blocked |
| 19 | 93762999 | IT Support | Thenamaris Philippines, Inc. | onsite_ncr | ₱22,000–29,000/mo | ACTIVE_UNVERIFIED | 55 | Scrape: onsite Malate Manila, ₱22–29K, L1 support, salary below target |
| 20 | 93926991 | L2 Helpdesk Technician | Alabang | Morning Shift | Platserv PH | onsite_ncr | ₱50,000–55,000/mo | ACTIVE_UNVERIFIED | 80 | Scrape: onsite Alabang morning shift, ₱50–55K, L2 helpdesk, 403-blocked |

**Batch 4 Status:** COMPLETE (5/5 scored from canonical scrape; live re-fetch blocked 403)

---

### Batch 4 — Detailed Scoring

#### Job 16: Payreto — Application Support Engineer (8202ab6b5025cd0e)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 70/100 | App support, troubleshooting, monitoring — EUC adjacent; sysadmin growth |
| Experience Match | 65/100 | Tier2 EUC with AD/M365 transfers to app support |
| Behavioral Fit | 75/100 | Hybrid Makati, structured support, systematic — compatible |
| Location | PASS | Hybrid Makati (NCR) |
| Career Alignment | 65/100 | App support = sysadmin/cloud growth path; ₱25–60K range wide |

**Overall: 68/100** | Verdict: **Good Fit** | Recommendation: **STRONG MATCH**
Key strengths: Hybrid, ₱25–60K (target in range), app support growth path, NCR.
Gaps: Salary floor ₱25K below target; hybrid commute; app support not EUC core.

#### Job 17: Huey Financing — IT Specialist (94015346)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 70/100 | Tech support, equipment, network infra, systems — primary EUC skills |
| Experience Match | 70/100 | Direct IT support/maintenance experience |
| Behavioral Fit | 65/100 | Onsite Taguig, equipment/network focus — compatible |
| Location | PASS | Onsite Taguig (NCR) |
| Career Alignment | 45/100 | Salary ₱25–30K below target; onsite; fintech context |

**Overall: 60/100** | Verdict: **Good Fit (comp concern)** | Recommendation: **CONSIDER**
Key strengths: NCR onsite, skills match.
Gaps: Salary ₱25–30K below target (₱30K floor); onsite Taguig commute from Bulacan.

#### Job 18: HGS Offshore — IT Helpdesk Perm WFH Morning (93959933)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 85/100 | L1 helpdesk, O365/AD, hardware/software/email/VPN — all primary |
| Experience Match | 85/100 | Direct L1 helpdesk; Tier2 background exceeds |
| Behavioral Fit | 85/100 | **Permanent WFH, morning shift** — ideal remote + day schedule |
| Location | PASS | Remote (confirmed by scrape) |
| Career Alignment | 75/100 | Remote day shift, ₱40–60K above target, MSP exposure |

**Overall: 82/100** | Verdict: **Strong Fit** | Recommendation: **TOP PRIORITY**
Key strengths: Permanent WFH + morning shift (rare & ideal), salary ₱40–60K, L1 helpdesk match.
Gaps: L1 level (candidate is Tier2); MSP/BPO model.

#### Job 19: Thenamaris — IT Support (93762999)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 75/100 | L1 support, troubleshooting, equipment/assets — primary EUC |
| Experience Match | 70/100 | Direct L1 support experience |
| Behavioral Fit | 60/100 | Onsite Malate Manila, standard L1 — compatible but onsite |
| Location | PASS | Onsite Malate (NCR) |
| Career Alignment | 30/100 | Salary ₱22–29K **below target**; onsite; maritime shipping context |

**Overall: 55/100** | Verdict: **Moderate Fit** | Recommendation: **LOWER PRIORITY**
Key strengths: NCR onsite, skills match.
Gaps: Salary well below target; onsite commute; limited growth signal.

#### Job 20: Platserv — L2 Helpdesk Technician (93926991)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 85/100 | L2 helpdesk, escalations, Windows, AD, O365, ticketing — primary |
| Experience Match | 85/100 | Direct L2 helpdesk; Tier2 EUC background aligns perfectly |
| Behavioral Fit | 75/100 | Morning shift (rare!), L2, structured, Alabang NCR — very compatible |
| Location | PASS | Onsite Alabang (NCR) morning shift |
| Career Alignment | 70/100 | ₱50–55K above target, L2, morning shift, clear progression |

**Overall: 80/100** | Verdict: **Strong Fit** | Recommendation: **TOP PRIORITY**
Key strengths: L2 level match, morning shift (rare!), ₱50–55K, Alabang accessible.
Gaps: Onsite Alabang commute from Bulacan (~1.5hr); BPO/offshoring context.

---

## Batch 5 (Jobs 21–25)

| # | Job ID | Title | Company | Arrangement | Salary | Verification Status | Score | Notes |
|---|--------|-------|---------|-------------|--------|---------------------|-------|-------|
| 21 | 93456749 | End User Support Engineer - HYBRID | Hashtag People Corporation | hybrid | ₱40,000–50,000/mo | ACTIVE_UNVERIFIED | 78 | Scrape: hybrid Makati, ₱40–50K, EUC, English skills rating flagged |
| 22 | 94023558 | TECHNICAL SUPPORT ENGINEER | Internet of Things Philippines Inc. | onsite_ncr | ₱23,000–28,000/mo | ACTIVE_UNVERIFIED | 50 | Scrape: onsite San Juan, ₱23–28K, enterprise security (Hikvision), salary below |
| 23 | 93966411 | End User Support | De Castro Consulting | onsite_ncr | ₱50,000–60,000/mo | ACTIVE_UNVERIFIED | 77 | Scrape: onsite Makati, ₱50–60K, EUC, flexible scheduling, 403-blocked |
| 24 | 93979442 | IT Specialist (Network & Devices) | Enable PH | onsite_ncr | ₱45,000–55,000/mo | ACTIVE_UNVERIFIED | 72 | Scrape: onsite Mandaluyong, ₱45–55K, network/devices, AD/DNS/DHCP, 403-blocked |
| 25 | 93955513 | IT Help Desk Chat Support | Manpower Outsourcing Services, Inc. | onsite_ncr | ₱30,000–35,000/mo | ACTIVE_UNVERIFIED | 70 | Scrape: onsite BGC, ₱30–35K, L1 chat support, high-volume enterprise, 403-blocked |

**Batch 5 Status:** COMPLETE (5/5 scored from canonical scrape; live re-fetch blocked 403)

---

### Batch 5 — Detailed Scoring

#### Job 21: Hashtag People — End User Support Engineer Hybrid (93456749)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 85/100 | End user support, trends in tech support, general IT — direct EUC match |
| Experience Match | 85/100 | 3yr Tier2 EUC with AD/M365/endpoint — exactly matches |
| Behavioral Fit | 75/100 | Hybrid Makati, passion for tech/trends — compatible |
| Location | PASS | Hybrid Makati (NCR) |
| Career Alignment | 70/100 | ₱40–50K meets target, hybrid, EUC core, English skills rating flag |

**Overall: 78/100** | Verdict: **Good Fit** | Recommendation: **STRONG MATCH**
Key strengths: Hybrid, ₱40–50K in target, direct EUC match, tech trends enthusiasm aligns.
Gaps: English language skills rating requested (FLAG — candidate has professional working proficiency); hybrid commute.

#### Job 22: IoT Philippines — Technical Support Engineer (94023558)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 55/100 | Enterprise security solutions (Hikvision), installation, troubleshooting — specialized |
| Experience Match | 50/100 | 2yr tech support req; security product focus adjacent to EUC |
| Behavioral Fit | 60/100 | Onsite San Juan, security product focus — compatible but niche |
| Location | PASS | Onsite San Juan (NCR) |
| Career Alignment | 35/100 | Salary ₱23–28K **below target**; security hardware niche; limited EUC growth |

**Overall: 50/100** | Verdict: **Moderate Fit (comp concern)** | Recommendation: **LOWER PRIORITY**
Key strengths: NCR onsite, security product exposure.
Gaps: Salary below target; Hikvision/IP camera specialization; onsite San Juan.

#### Job 23: De Castro Consulting — End User Support (93966411)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 85/100 | End user support, apps, hardware/software, troubleshooting — direct EUC match |
| Experience Match | 85/100 | 3yr Tier2 EUC enterprise — exactly matches |
| Behavioral Fit | 80/100 | "Flexible scheduling where feasible", collaborative team, health benefits — compatible |
| Location | PASS | Onsite Makati (NCR) |
| Career Alignment | 60/100 | ₱50–60K above target, EUC core, but onsite; arrangement ambiguity (tracker: HOLD) |

**Overall: 77/100** | Verdict: **Good Fit** | Recommendation: **STRONG MATCH** (with arrangement clarification)
Key strengths: Salary ₱50–60K excellent, direct EUC match, flexible scheduling hinted.
Gaps: Onsite (despite flexible scheduling mention); tracker has HOLD pending arrangement verification.

#### Job 24: Enable PH — IT Specialist Network & Devices (93979442)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 80/100 | Network & devices, AD, DNS, DHCP, endpoint support — moderate/strong match |
| Experience Match | 75/100 | EUC + AD/networking transfers; 2+ yr EUC experience |
| Behavioral Fit | 70/100 | Onsite Mandaluyong, career growth emphasized — compatible |
| Location | PASS | Onsite Mandaluyong (NCR) |
| Career Alignment | 65/100 | ₱45–55K above target, network exposure = sysadmin growth |

**Overall: 72/100** | Verdict: **Good Fit** | Recommendation: **STRONG MATCH**
Key strengths: ₱45–55K, AD/DNS/DHCP + endpoint = sysadmin growth path, NCR.
Gaps: Onsite Mandaluyong commute; network depth moderate.

#### Job 25: Manpower Outsourcing — IT Help Desk Chat Support (93955513)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 80/100 | L1 chat support, troubleshooting complex issues, high-volume enterprise — primary |
| Experience Match | 80/100 | Tier2 background exceeds L1; chat/enterprise ITSM transferable |
| Behavioral Fit | 70/100 | Onsite BGC, high-volume enterprise, chat channel — compatible |
| Location | PASS | Onsite BGC (NCR) |
| Career Alignment | 55/100 | ₱30–35K meets target floor, but L1 level; chat support niche |

**Overall: 70/100** | Verdict: **Good Fit** | Recommendation: **STRONG MATCH** (L1 level caveat)
Key strengths: Enterprise ITSM, high-volume, chat support, ₱30–35K meets floor.
Gaps: L1 level (candidate is Tier2); onsite BGC; chat-channel specialization.

---

## Batch 6 (Jobs 26–30)

| # | Job ID | Title | Company | Arrangement | Salary | Verification Status | Score | Notes |
|---|--------|-------|---------|-------------|--------|---------------------|-------|-------|
| 26 | 93960527 | IT Specialist | Private Advertiser | onsite_ncr | ₱25,000–30,000/mo | ACTIVE_UNVERIFIED | 52 | Scrape: onsite, ₱25–30K, general IT specialist, below target, 403-blocked |
| 27 | 94014348 | Urgent Hiring Service Desk Agents up to 32k package | Nezda Technologies, Inc. | onsite_ncr | ₱28,000–32,000/mo | ACTIVE_UNVERIFIED | 60 | Scrape: onsite, ₱28–32K, service desk, urgent hiring, below target, 403-blocked |
| 28 | 93667267 | IT Service Desk Analyst | MicroSourcing | onsite_ncr | ₱45,000–55,000/mo | ACTIVE_UNVERIFIED | 78 | Scrape: onsite, ₱45–55K, service desk analyst, MSP, 403-blocked |
| 29 | 94021511 | Technical Support Associate | Versa Innovations Corp | onsite_ncr | ₱20,000–25,000/mo | ACTIVE_UNVERIFIED | 45 | Scrape: onsite, ₱20–25K, tech support associate, well below target, 403-blocked |
| 30 | 93835470 | Technical Support Specialist (IoT / Connected Devices) - Hybrid | PRACTICE HEROES CONSULTING, INC. | hybrid | ₱50,000–65,000/mo | ACTIVE_UNVERIFIED | 75 | Scrape: hybrid, ₱50–65K, IoT/connected devices, technical, 403-blocked |

**Batch 6 Status:** COMPLETE (5/5 scored from canonical scrape; live re-fetch blocked 403)

---

### Batch 6 — Detailed Scoring

#### Job 26: Private Advertiser — IT Specialist (93960527)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 65/100 | General IT specialist — hardware, software, network, user support — broad EUC match |
| Experience Match | 60/100 | General IT background matches; no specific requirements stated |
| Behavioral Fit | 60/100 | Onsite, generalist role — compatible but unspecified |
| Location | PASS | Onsite NCR (unspecified) |
| Career Alignment | 25/100 | Salary ₱25–30K **below target**; "Private Advertiser" = recruiter/agency, opaque employer |

**Overall: 52/100** | Verdict: **Moderate Fit (comp concern)** | Recommendation: **LOWER PRIORITY**
Key strengths: Broad IT specialist skills match EUC background.
Gaps: Salary below target; agency posting (opaque employer); onsite unspecified NCR.

#### Job 27: Nezda Technologies — Urgent Hiring Service Desk Agents (94014348)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 70/100 | Service desk, troubleshooting, ticketing — primary EUC skills |
| Experience Match | 65/100 | Service desk experience direct match; "up to 32K package" implies junior |
| Behavioral Fit | 65/100 | Onsite, "urgent hiring" suggests high volume, structured — compatible |
| Location | PASS | Onsite NCR (unspecified) |
| Career Alignment | 45/100 | Salary ₱28–32K **below target floor**; "urgent" may indicate churn; agent-level |

**Overall: 60/100** | Verdict: **Good Fit (comp concern)** | Recommendation: **CONSIDER**
Key strengths: Service desk direct match, NCR location.
Gaps: Salary below target; "urgent hiring" signal; onsite; likely junior/L1 role.

#### Job 28: MicroSourcing — IT Service Desk Analyst (93667267)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 85/100 | Service desk, ticketing, escalation, Windows, AD, O365 — primary EUC skills |
| Experience Match | 80/100 | Direct service desk analyst; Tier2 background aligns well |
| Behavioral Fit | 75/100 | Onsite, MSP/offshoring model, structured processes — compatible |
| Location | PASS | Onsite NCR (MicroSourcing = BGC/Taguig typically) |
| Career Alignment | 75/100 | ₱45–55K above target, service desk core, MSP exposure = growth |

**Overall: 78/100** | Verdict: **Good Fit** | Recommendation: **STRONG MATCH**
Key strengths: ₱45–55K excellent, service desk analyst match, MSP = sysadmin/cloud growth.
Gaps: Onsite BGC/Taguig commute; BPO/offshoring context.

#### Job 29: Versa Innovations — Technical Support Associate (94021511)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 65/100 | Tech support, troubleshooting, hardware/software — primary EUC skills |
| Experience Match | 60/100 | Direct tech support; "associate" implies junior/L1 |
| Behavioral Fit | 55/100 | Onsite, associate level, structured — compatible but junior |
| Location | PASS | Onsite NCR (unspecified) |
| Career Alignment | 15/100 | Salary ₱20–25K **well below target**; associate/junior level |

**Overall: 45/100** | Verdict: **Weak Fit** | Recommendation: **LOWER PRIORITY / DO NOT APPLY**
Key strengths: Skills match at basic level.
Gaps: Salary far below target; junior/associate level; onsite unspecified.

#### Job 30: Practice Heroes — Technical Support Specialist IoT/Connected Devices Hybrid (93835470)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 70/100 | IoT/connected devices, troubleshooting, ticketing, network — specialized adjacent |
| Experience Match | 65/100 | 2+yr tech support; IoT device specialization adjacent to EUC |
| Behavioral Fit | 75/100 | Hybrid, IoT/connected devices niche, structured — compatible |
| Location | PASS | Hybrid (unspecified NCR) |
| Career Alignment | 80/100 | ₱50–65K well above target, hybrid, IoT = emerging tech exposure |

**Overall: 75/100** | Verdict: **Good Fit** | Recommendation: **STRONG MATCH**
Key strengths: Hybrid, ₱50–65K excellent, IoT/connected devices = emerging tech growth.
Gaps: IoT specialization niche; hybrid location unspecified; consulting firm context.

---

## Batch 7 (Jobs 31–34)

| # | Job ID | Title | Company | Arrangement | Salary | Verification Status | Score | Notes |
|---|--------|-------|---------|-------------|--------|---------------------|-------|-------|
| 31 | 93689110 | Technical Support Engineer | SaaS | Fully Remote | Night Shift | Exypnox Inc | remote | ₱45,000–55,000/mo | ACTIVE_UNVERIFIED | 84 | Scrape: remote, night shift, ₱45–55K, SaaS tech support, 403-blocked |
| 32 | 93844666 | Customer Support Specialist — Tier 2 Resolutions | PIONEER ACCOUNT! | Enshored Inc. | onsite_ncr | ₱34,000/mo | ACTIVE_UNVERIFIED | 65 | Scrape: onsite, ₱34K, Tier 2 resolutions, Pioneer account, 403-blocked |
| 33 | 93446890 | Account Specialist - Tier 2 | Teamspan Asia Inc. | onsite_ncr | ₱21,000–30,000/mo | ACTIVE_UNVERIFIED | 42 | Scrape: onsite, ₱21–30K, Tier 2 account specialist, well below target, 403-blocked |
| 34 | 93419748 | VoIP Tier 2 Technical Support | MicroSourcing | onsite_ncr | ₱57,000–85,000/mo | ACTIVE_UNVERIFIED | 78 | Scrape: onsite, ₱57–85K, VoIP Tier 2, MSP, 403-blocked |

**Batch 7 Status:** COMPLETE (4/4 scored from canonical scrape; live re-fetch blocked 403)

---

### Batch 7 — Detailed Scoring

#### Job 31: Exypnox — Technical Support Engineer SaaS Remote Night (93689110)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 85/100 | SaaS tech support, troubleshooting, ticketing, APIs — primary EUC + cloud exposure |
| Experience Match | 85/100 | Tier2 EUC background; SaaS = cloud/SaaS growth path |
| Behavioral Fit | 85/100 | **Fully remote, night shift** — ideal remote + shift preference match |
| Location | PASS | Remote (confirmed by scrape) |
| Career Alignment | 80/100 | ₱45–55K above target, remote, night shift OK, SaaS = cloud/sysadmin growth |

**Overall: 84/100** | Verdict: **Strong Fit** | Recommendation: **TOP PRIORITY**
Key strengths: Fully remote, night shift preferred, ₱45–55K, SaaS tech support = cloud growth.
Gaps: SaaS/API specifics Level 2 (certs/training) not deep professional experience.

#### Job 32: Enshored — Customer Support Specialist Tier 2 (93844666)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 70/100 | Tier 2 resolutions, escalations, troubleshooting — EUC adjacent (customer-facing) |
| Experience Match | 65/100 | Tier 2 resolutions experience; customer support vs tech support distinction |
| Behavioral Fit | 65/100 | Onsite, Pioneer account (high-profile client), structured — compatible |
| Location | PASS | Onsite NCR (Enshored = BGC typically) |
| Career Alignment | 60/100 | ₱34K meets target floor, Tier 2, BPO/offshoring, Pioneer account = prestige |

**Overall: 65/100** | Verdict: **Good Fit** | Recommendation: **STRONG MATCH**
Key strengths: Tier 2 match, ₱34K meets floor, Pioneer account (established client).
Gaps: Customer support vs technical support; onsite BGC; BPO model; salary at floor.

#### Job 33: Teamspan Asia — Account Specialist Tier 2 (93446890)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 50/100 | Account management, Tier 2 resolutions, client-facing — not technical support |
| Experience Match | 40/100 | Account specialist role; EUC background not directly transferable |
| Behavioral Fit | 55/100 | Onsite, account management, structured — different profile |
| Location | PASS | Onsite NCR (unspecified) |
| Career Alignment | 25/100 | Salary ₱21–30K **below target**; account management not EUC growth path |

**Overall: 42/100** | Verdict: **Weak Fit** | Recommendation: **LOWER PRIORITY / DO NOT APPLY**
Key strengths: Tier 2 label, NCR location.
Gaps: Salary below target; account management not technical support; onsite; different career track.

#### Job 34: MicroSourcing — VoIP Tier 2 Technical Support (93419748)
| Dimension | Score | Notes |
|-----------|-------|-------|
| Technical Skills | 80/100 | VoIP Tier 2, troubleshooting, SIP, telephony, escalations — specialized adjacent |
| Experience Match | 75/100 | Tier 2 technical support; VoIP specialization adjacent to EUC/networking |
| Behavioral Fit | 70/100 | Onsite, MSP/offshoring, structured, high-volume — compatible |
| Location | PASS | Onsite NCR (MicroSourcing = BGC/Taguig typically) |
| Career Alignment | 85/100 | ₱57–85K **excellent**, Tier 2, VoIP = telecom/networking growth path |

**Overall: 78/100** | Verdict: **Good Fit** | Recommendation: **STRONG MATCH**
Key strengths: Highest salary range (₱57–85K), Tier 2 technical support, VoIP = networking growth.
Gaps: VoIP specialization niche; onsite BGC/Taguig commute; BPO/offshoring context.

---

## Complete Ranking (34 jobs)

| Rank | Job | Company | Location | Arrangement | Verification | Score | Recommendation |
|------|-----|---------|----------|-------------|--------------|-------|----------------|
| 1 | Service Desk Engineer L2 (After Hours) | ScalableOS | Remote | remote | ACTIVE_VERIFIED | 89 | TOP PRIORITY |
| 2 | L1 Helpdesk Technician (L2 Caliber) | ScalableOS | Remote | remote | ACTIVE_VERIFIED | 87 | TOP PRIORITY |
| 3 | Technical Support Engineer SaaS Remote Night | Exypnox Inc | Remote | remote | ACTIVE_UNVERIFIED | 84 | TOP PRIORITY |
| 4 | Service Desk Analyst | Starshot Software | Remote | remote | ACTIVE_VERIFIED | 83 | TOP PRIORITY |
| 5 | IT Helpdesk (Perm WFH/Morning Shift) | HGS Offshore | Remote | remote | ACTIVE_UNVERIFIED | 82 | TOP PRIORITY |
| 6 | L2 Helpdesk Technician | Platserv PH | Alabang | onsite_ncr | ACTIVE_UNVERIFIED | 80 | TOP PRIORITY |
| 7 | End User Support Engineer - HYBRID | Hashtag People | Makati | hybrid | ACTIVE_UNVERIFIED | 78 | STRONG MATCH |
| 7 | IT Service Desk Analyst | MicroSourcing | NCR | onsite_ncr | ACTIVE_UNVERIFIED | 78 | STRONG MATCH |
| 7 | VoIP Tier 2 Technical Support | MicroSourcing | NCR | onsite_ncr | ACTIVE_UNVERIFIED | 78 | STRONG MATCH |
| 10 | End User Support | De Castro Consulting | Makati | onsite_ncr | ACTIVE_UNVERIFIED | 77 | STRONG MATCH |
| 11 | NOC Engineer | Starshot Software | Remote | remote | ACTIVE_VERIFIED | 75 | TOP PRIORITY |
| 11 | Technical Support Specialist IoT/Connected Devices Hybrid | Practice Heroes | NCR | hybrid | ACTIVE_UNVERIFIED | 75 | STRONG MATCH |
| 13 | IT Specialist (Network & Devices) | Enable PH | Mandaluyong | onsite_ncr | ACTIVE_UNVERIFIED | 72 | STRONG MATCH |
| 13 | IT Service Desk Analyst L1.5 (ASAP) | IT by Design | Taguig | onsite_ncr | ACTIVE_VERIFIED | 72 | STRONG MATCH |
| 15 | IT Support Specialist — Mac & Google Workspace, WFH, US Shift | Optimum Source | Remote | remote | ACTIVE_VERIFIED | 70 | STRONG MATCH |
| 15 | IT Help Desk Chat Support | Manpower Outsourcing | BGC | onsite_ncr | ACTIVE_UNVERIFIED | 70 | STRONG MATCH |
| 17 | Application Support Engineer | Payreto | Makati | hybrid | ACTIVE_UNVERIFIED | 68 | STRONG MATCH |
| 18 | Service Desk Support | Support Services Group | Pasig | onsite_ncr | ACTIVE_VERIFIED | 67 | CONSIDER / LOWER PRIORITY |
| 19 | Customer Support Specialist — Tier 2 Resolutions | Enshored Inc. | NCR | onsite_ncr | ACTIVE_UNVERIFIED | 65 | STRONG MATCH |
| 19 | Technical Support Associate | SolarWinds | Taguig | hybrid | ACTIVE_VERIFIED | 65 | STRONG MATCH |
| 21 | Technical Support Representative | Ancar Motors | Quezon City | onsite_ncr | ACTIVE_VERIFIED | 62 | CONSIDER |
| 22 | IT Technical Support Specialist | Citadel Pacific | Taguig | onsite_ncr | ACTIVE_VERIFIED | 60 | CONSIDER |
| 22 | IT Specialist | Huey Financing | Taguig | onsite_ncr | ACTIVE_UNVERIFIED | 60 | CONSIDER |
| 22 | Urgent Hiring Service Desk Agents | Nezda Technologies | NCR | onsite_ncr | ACTIVE_UNVERIFIED | 60 | CONSIDER |
| 25 | Non-Voice Technical Support | Sapient Careers North | Manila | onsite_ncr | ACTIVE_VERIFIED | 58 | CONSIDER |
| 25 | Chat and Email Technical Support | Sapient BPO | Mandaluyong | onsite_ncr | ACTIVE_VERIFIED | 58 | CONSIDER |
| 27 | IT Support | Thenamaris Philippines | Malate Manila | onsite_ncr | ACTIVE_UNVERIFIED | 55 | LOWER PRIORITY |
| 28 | IT Specialist | Private Advertiser | NCR | onsite_ncr | ACTIVE_UNVERIFIED | 52 | LOWER PRIORITY |
| 29 | TECHNICAL SUPPORT ENGINEER | IoT Philippines | San Juan | onsite_ncr | ACTIVE_UNVERIFIED | 50 | LOWER PRIORITY |
| 30 | IT Support Specialist | Microbiz One | Makati | onsite_ncr | ACTIVE_VERIFIED | 48 | LOWER PRIORITY / DO NOT APPLY |
| 31 | Technical Support Engineer | NIU PROFESSIONALS | Pasig | onsite_ncr | ACTIVE_VERIFIED | 45 | LOWER PRIORITY / DO NOT APPLY |
| 31 | Technical Support Associate | Versa Innovations | NCR | onsite_ncr | ACTIVE_UNVERIFIED | 45 | LOWER PRIORITY / DO NOT APPLY |
| 33 | Account Specialist - Tier 2 | Teamspan Asia | NCR | onsite_ncr | ACTIVE_UNVERIFIED | 42 | LOWER PRIORITY / DO NOT APPLY |
| 34 | Service Desk Manager | AUMTREND PH INC | BGC | onsite_ncr | ACTIVE_VERIFIED | 35 | DO NOT APPLY |

---

## Top 10

| Rank | Job | Company | Arrangement | Score | Verification | Why Top 10 |
|------|-----|---------|-------------|-------|--------------|------------|
| 1 | Service Desk Engineer L2 (After Hours) | ScalableOS | remote | 89 | ACTIVE_VERIFIED | Highest score: ₱90K+ remote, L2 M365/Hyper-V/AD, night shift OK, MSP growth path |
| 2 | L1 Helpdesk Technician (L2 Caliber) | ScalableOS | remote | 87 | ACTIVE_VERIFIED | ₱70K remote, M365/AD primary, night shift & on-call match, enterprise MSP |
| 3 | Technical Support Engineer SaaS Remote Night | Exypnox Inc | remote | 84 | ACTIVE_UNVERIFIED | Fully remote + night shift (ideal), ₱45–55K, SaaS = cloud/sysadmin growth |
| 4 | Service Desk Analyst | Starshot Software | remote | 83 | ACTIVE_VERIFIED | Remote, ₱57K, direct Service Desk/M365/AD match, networking learnable |
| 5 | IT Helpdesk (Perm WFH/Morning Shift) | HGS Offshore | remote | 82 | ACTIVE_UNVERIFIED | Rare: permanent WFH + morning shift, ₱40–60K, L1 helpdesk, MSP exposure |
| 6 | L2 Helpdesk Technician | Platserv PH | onsite_ncr | 80 | ACTIVE_UNVERIFIED | L2 match, morning shift (rare), ₱50–55K, Alabang accessible |
| 7 | End User Support Engineer Hybrid | Hashtag People | hybrid | 78 | ACTIVE_UNVERIFIED | Hybrid Makati, ₱40–50K target, direct EUC match, tech trends enthusiasm |
| 7 | IT Service Desk Analyst | MicroSourcing | onsite_ncr | 78 | ACTIVE_UNVERIFIED | ₱45–55K excellent, service desk core, MSP = sysadmin/cloud growth |
| 7 | VoIP Tier 2 Technical Support | MicroSourcing | onsite_ncr | 78 | ACTIVE_UNVERIFIED | Highest range ₱57–85K, Tier 2 technical, VoIP = telecom/networking growth |
| 10 | End User Support | De Castro Consulting | onsite_ncr | 77 | ACTIVE_UNVERIFIED | ₱50–60K excellent, direct EUC match, flexible scheduling hinted |

---

## Top 5

| Rank | Job | Company | Arrangement | Score | Verification | Rationale |
|------|-----|---------|-------------|-------|--------------|-----------|
| 1 | **Service Desk Engineer L2 (After Hours)** | **ScalableOS** | **remote** | **89** | **ACTIVE_VERIFIED** | **Best overall: highest salary (₱90K+), fully remote, L2 M365/Hyper-V/AD directly transferable from Tier2 EUC, night shift + on-call OK per profile, MSP environment = clear sysadmin/cloud progression. No significant gaps.** |
| 2 | **L1 Helpdesk Technician (L2 Caliber)** | **ScalableOS** | **remote** | **87** | **ACTIVE_VERIFIED** | **Excellent: ₱70K remote, M365/AD primary skills match, L2 caliber = Tier2 background fits perfectly, night shift/on-call match profile, MSP growth path. No significant gaps.** |
| 3 | **Technical Support Engineer SaaS Remote Night** | **Exypnox Inc** | **remote** | **84** | **ACTIVE_UNVERIFIED** | **Ideal arrangement: fully remote + night shift (candidate preference), ₱45–55K above target, SaaS tech support = cloud/SaaS exposure for growth. Gap: SaaS/API specifics Level 2 not deep professional experience (address honestly).** |
| 4 | **Service Desk Analyst** | **Starshot Software** | **remote** | **83** | **ACTIVE_VERIFIED** | **Strong: remote, ₱57K above target, Service Desk/M365/AD direct match, networking moderate (learnable). Live-verified active listing. Growth toward sysadmin clear.** |
| 5 | **IT Helpdesk (Perm WFH/Morning Shift)** | **HGS Offshore** | **remote** | **82** | **ACTIVE_UNVERIFIED** | **Rare combo: permanent WFH + morning shift (ideal), ₱40–60K well above target, L1 helpdesk match (Tier2 exceeds), MSP exposure. Gap: L1 level but candidate is Tier2; BPO/offshoring context.** |

---

## Progress Tracker

| Batch | Jobs | Verified | Scored | Status | Checkpoint |
|-------|------|----------|--------|--------|------------|
| 1 | 1–5 | 5/5 | 5/5 | COMPLETE | 2026-08-18 |
| 2 | 6–10 | 5/5 | 5/5 | COMPLETE | 2026-08-18 |
| 3 | 11–15 | 5/5 | 5/5 | COMPLETE | 2026-08-18 |
| 4 | 16–20 | 0/5 | 5/5 | COMPLETE (403-blocked) | 2026-08-18 |
| 5 | 21–25 | 0/5 | 5/5 | COMPLETE (403-blocked) | 2026-08-18 |
| 6 | 26–30 | 0/5 | 5/5 | COMPLETE (403-blocked) | 2026-08-18 |
| 7 | 31–34 | 0/4 | 4/4 | COMPLETE (403-blocked) | 2026-08-18 |
| **Total** | **34** | **15/34** | **34/34** | **ALL COMPLETE** | **2026-08-18** |