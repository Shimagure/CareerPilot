# CareerPilot Prompts Index

Navigation aid for checkpoint-related prompts, contracts, and handoff documentation. All files remain in their current locations; this index only improves discoverability.

---

## Checkpoint Protocol v1 (CAR-138–153)

Formal contracts with `STATUS=AWAITING_CHECKPOINT_REVIEW`. Part of the CAR-181 swarm pilot with shared-interface freezes and coordinator checkpoint reviews.

| File | CAR | Status | Notes |
|---|---|---|---|
| [contracts/CAR-138-contract.md](contracts/CAR-138-contract.md) | 138 | ✅ Completed | Serial baseline; no parallel peers |
| [contracts/CAR-140-contract.md](contracts/CAR-140-contract.md) | 140 | ✅ Completed | Stream C — owns `auto-create/route.ts` freeze |
| [contracts/CAR-141-contract.md](contracts/CAR-141-contract.md) | 141 | ✅ Completed | Stream D — Phase A freeze on shared interface |
| [contracts/CAR-143-contract.md](contracts/CAR-143-contract.md) | 143 | ✅ Completed | Bullet character fix |
| [contracts/CAR-153-contract.md](contracts/CAR-153-contract.md) | 153 | ✅ Completed | Mock WorkOne tests |

**Process authority:** [../docs/plans/2026-04-25-001-car-pilot-parallelization-map.md](../docs/plans/2026-04-25-001-car-pilot-parallelization-map.md) — checkpoint protocol, stream definitions, merge order, coordinator review steps.

---

## Transition Handoffs (CAR-145–157)

Handoff prompts from the transition era. Some reference checkpoint language; most reference CE plans/specs. All completed.

| File | CAR | Status | Notes |
|---|---|---|---|
| [CAR-145-consolidate-transcripts-kind.md](CAR-145-consolidate-transcripts-kind.md) | 145 | ✅ Completed | References plan + `ce:compound` for solution doc |
| [CAR-148-stream-coaching-analyze.md](CAR-148-stream-coaching-analyze.md) | 148 | ✅ Completed | Streaming coach analysis |
| [CAR-151-infra-187-adapter-fix.md](CAR-151-infra-187-adapter-fix.md) | 151 | ✅ Completed | Adapter fix |
| [CAR-154-qwen3-extra-body-gate.md](CAR-154-qwen3-extra-body-gate.md) | 154 | ✅ Completed | Qwen gate; references local-LLM-router baseline |
| [CAR-157-tracker-add-wizard.md](CAR-157-tracker-add-wizard.md) | 157 | ✅ Completed | References superpowers spec/plan |

---

## Modern Handoffs (CAR-160+)

Post-checkpoint handoff prompts. No explicit checkpoint discipline (serial-tail or completed work). CAR-181 is the active coordinator prompt; CAR-208 is the **current active work**.

| File | CAR | Status | Notes |
|---|---|---|---|
| [CAR-160-dashboard-create-application-parity.md](CAR-160-dashboard-create-application-parity.md) | 160 | ✅ Completed | References plan |
| [CAR-171-contacts-port.md](CAR-171-contacts-port.md) | 171 | ✅ Completed | References CAR-168 plan |
| [CAR-172-migrate-contacts.md](CAR-172-migrate-contacts.md) | 172 | ✅ Completed | References CAR-168 plan Tasks 11–15 |
| [CAR-181-pilot-coordinator.md](CAR-181-pilot-coordinator.md) | 181 | 🟢 **Active coordinator** | Authoritative for CAR-181 swarm; reads parallelization map |
| [CAR-208-mobile-responsive-continued.md](CAR-208-mobile-responsive-continued.md) | 208 | 🔴 **CURRENT ACTIVE WORK** | Audit snapshot + working conventions for mobile responsive |

---

## Dashboard Contacts-Hub Workers (CAR-116–118)

Older epoch (pre-checkpoint protocol). Dashboard-specific worker prompts for contacts-hub feature. Located in `dashboard/prompts/`.

| File | CAR | Status | Notes |
|---|---|---|---|
| [../dashboard/prompts/CAR-116-worker-G-verification.md](../dashboard/prompts/CAR-116-worker-G-verification.md) | 116 | ⚠️ Legacy | Worker G — verification |
| [../dashboard/prompts/CAR-117-worker-A-schema-migration.md](../dashboard/prompts/CAR-117-worker-A-schema-migration.md) | 117 | ⚠️ Legacy | Worker A — schema migration |
| [../dashboard/prompts/CAR-117-worker-C-types-api-hook.md](../dashboard/prompts/CAR-117-worker-C-types-api-hook.md) | 117 | ⚠️ Legacy | Worker C — types + API hook |
| [../dashboard/prompts/CAR-118-worker-B-convform-patch.md](../dashboard/prompts/CAR-118-worker-B-convform-patch.md) | 118 | ⚠️ Legacy | Worker B — conversation form patch |
| [../dashboard/prompts/CAR-118-worker-D-list-page.md](../dashboard/prompts/CAR-118-worker-D-list-page.md) | 118 | ⚠️ Legacy | Worker D — list page |
| [../dashboard/prompts/CAR-118-worker-E-detail-page.md](../dashboard/prompts/CAR-118-worker-E-detail-page.md) | 118 | ⚠️ Legacy | Worker E — detail page |
| [../dashboard/prompts/CAR-118-worker-F-merge-gmail.md](../dashboard/prompts/CAR-118-worker-F-merge-gmail.md) | 118 | ⚠️ Legacy | Worker F — merge Gmail |

**Plan reference:** [../dashboard/docs/plans/2026-04-11-001-feat-contacts-communications-hub-plan.md](../dashboard/docs/plans/2026-04-11-001-feat-contacts-communications-hub-plan.md)

---

## Authoritative CAR-181 Process Documents

Cross-cutting process documentation for the checkpoint protocol and swarm pilot.

| File | Location | Role |
|---|---|---|
| [2026-04-25-001-car-pilot-parallelization-map.md](../docs/plans/2026-04-25-001-car-pilot-parallelization-map.md) | `docs/plans/` | **Process authority** — stream definitions, file scopes, shared interfaces, merge order, checkpoint commit definitions, coordinator review protocol |
| [car-pilot-subagent-swarm-learnings.md](../docs/solutions/car-pilot-subagent-swarm-learnings.md) | `docs/solutions/` | **Retrospective** — CAR-181 lessons, timing data, friction points, v1.1 proposals |
| [.car-pilot-friction-log.md](../docs/solutions/.car-pilot-friction-log.md) | `docs/solutions/` | **Active scratch file** — coordinator friction log (gitignored in practice) |

---

## Status Legend

| Badge | Meaning |
|---|---|
| ✅ Completed | Work finished, merged, no further action |
| 🟢 Active coordinator | Currently used to coordinate work (CAR-181) |
| 🔴 Current active work | Work in progress right now (CAR-208) |
| ⚠️ Legacy | Older epoch, pre-dates checkpoint protocol, reference only |

---

## Quick Links by CAR Number

| CAR | File |
|---|---|
| 116 | [../dashboard/prompts/CAR-116-worker-G-verification.md](../dashboard/prompts/CAR-116-worker-G-verification.md) |
| 117 | [../dashboard/prompts/CAR-117-worker-A-schema-migration.md](../dashboard/prompts/CAR-117-worker-A-schema-migration.md), [../dashboard/prompts/CAR-117-worker-C-types-api-hook.md](../dashboard/prompts/CAR-117-worker-C-types-api-hook.md) |
| 118 | [../dashboard/prompts/CAR-118-worker-B-convform-patch.md](../dashboard/prompts/CAR-118-worker-B-convform-patch.md), [../dashboard/prompts/CAR-118-worker-D-list-page.md](../dashboard/prompts/CAR-118-worker-D-list-page.md), [../dashboard/prompts/CAR-118-worker-E-detail-page.md](../dashboard/prompts/CAR-118-worker-E-detail-page.md), [../dashboard/prompts/CAR-118-worker-F-merge-gmail.md](../dashboard/prompts/CAR-118-worker-F-merge-gmail.md) |
| 138 | [contracts/CAR-138-contract.md](contracts/CAR-138-contract.md) |
| 140 | [contracts/CAR-140-contract.md](contracts/CAR-140-contract.md) |
| 141 | [contracts/CAR-141-contract.md](contracts/CAR-141-contract.md) |
| 143 | [contracts/CAR-143-contract.md](contracts/CAR-143-contract.md) |
| 145 | [CAR-145-consolidate-transcripts-kind.md](CAR-145-consolidate-transcripts-kind.md) |
| 148 | [CAR-148-stream-coaching-analyze.md](CAR-148-stream-coaching-analyze.md) |
| 151 | [CAR-151-infra-187-adapter-fix.md](CAR-151-infra-187-adapter-fix.md) |
| 153 | [contracts/CAR-153-contract.md](contracts/CAR-153-contract.md) |
| 154 | [CAR-154-qwen3-extra-body-gate.md](CAR-154-qwen3-extra-body-gate.md) |
| 157 | [CAR-157-tracker-add-wizard.md](CAR-157-tracker-add-wizard.md) |
| 160 | [CAR-160-dashboard-create-application-parity.md](CAR-160-dashboard-create-application-parity.md) |
| 171 | [CAR-171-contacts-port.md](CAR-171-contacts-port.md) |
| 172 | [CAR-172-migrate-contacts.md](CAR-172-migrate-contacts.md) |
| 181 | [CAR-181-pilot-coordinator.md](CAR-181-pilot-coordinator.md) |
| 208 | [CAR-208-mobile-responsive-continued.md](CAR-208-mobile-responsive-continued.md) |

---

*Generated from checkpoint-organization audit. No files were moved or modified.*