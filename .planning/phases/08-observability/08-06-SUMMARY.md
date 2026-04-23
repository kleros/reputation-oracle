---
phase: 08-observability
plan: "06"
subsystem: deploy
tags: [docs, deploy, betterstack, runbook, observability]
dependency_graph:
  requires: ["08-01"]
  provides: ["deploy/bootstrap.sh Phase 8 placeholders corrected", "deploy/RUNBOOK.md §9-§10 Betterstack onboarding + burn-in gate"]
  affects: ["deploy/bootstrap.sh", "deploy/RUNBOOK.md"]
tech_stack:
  added: []
  patterns: ["heredoc placeholder correction", "runbook append pattern"]
key_files:
  created: []
  modified:
    - deploy/bootstrap.sh
    - deploy/RUNBOOK.md
decisions:
  - "BETTERSTACK_HEARTBEAT_TOKEN typo corrected to BETTERSTACK_HEARTBEAT_URL (D-27 canonical name)"
  - "HEARTBEAT_TIMEOUT_MS=10000 added as commented placeholder in bootstrap.sh heredoc"
  - "Grace period documented as 600s (10 min = D-04) in §9.2"
  - "itemsFetched===0 alert threshold documented as 5 consecutive runs (D-24) in §9.1"
  - "Burn-in gate documented as 7 calendar days with 5 criteria B-01..B-05 (D-03)"
metrics:
  duration: "~8 minutes"
  completed: "2026-04-23"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 08 Plan 06: Deploy Docs — Betterstack Setup + Burn-in Gate Summary

**One-liner:** Corrected Phase 8 env var names in bootstrap.sh heredoc; appended full Betterstack onboarding (§9) and 7-day burn-in gate procedure (§10) to RUNBOOK.md.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fix bootstrap.sh heredoc Phase 8 placeholders | 5340b1b | deploy/bootstrap.sh |
| 2 | Append §9 Betterstack Setup + §10 Burn-in Gate to RUNBOOK.md; fix §2 typo | 20e2de5 | deploy/RUNBOOK.md |

## What Was Built

**Task 1 — bootstrap.sh heredoc fix:**
- Fixed `BETTERSTACK_HEARTBEAT_TOKEN=` → `BETTERSTACK_HEARTBEAT_URL=` (D-27 canonical name)
- Added `# HEARTBEAT_TIMEOUT_MS=10000` placeholder on next line
- Idempotency preserved: heredoc is inside `if [ ! -f /etc/reputation-oracle/sepolia.env ]` block; already-deployed VPSs keep existing file

**Task 2 — RUNBOOK.md three-change set:**
- §2 Secret Fill Procedure: replaced `BETTERSTACK_HEARTBEAT_TOKEN` with correct key names (`BETTERSTACK_HEARTBEAT_URL`, `HEARTBEAT_TIMEOUT_MS`)
- Table of Contents: added §9 and §10 entries
- §9 Betterstack Setup appended:
  - §9.1 Telemetry Source: step-by-step pino transport token creation, `itemsFetched===0` ClickHouse alert rule with SQL, threshold=5, confirmation=25min (D-24)
  - §9.2 Uptime Monitor: heartbeat URL setup, grace period 600s/10min (D-04), maintenance window for burn-in suppression
- §10 Burn-in Gate Procedure appended:
  - 7-day gate (D-03) with 5 criteria (B-01..B-05): consecutive heartbeats, runId/chainId fields, no systemicFailure, itemsFetched>0, no alerts
  - Sign-off format for STATE.md paste
  - Failure/reset procedure: restart 7-day window from first clean heartbeat after fix

## Deviations from Plan

None — plan executed exactly as written.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. Both files are documentation-only (deploy/bootstrap.sh is a shell script with commented placeholders; deploy/RUNBOOK.md is markdown). T-08-15, T-08-16, T-08-17 from plan threat model apply as documented.

## Self-Check

### Commits exist:
- 5340b1b: fix(08-06): correct BETTERSTACK_HEARTBEAT_URL typo + add HEARTBEAT_TIMEOUT_MS in bootstrap.sh
- 20e2de5: docs(08-06): append §9 Betterstack Setup + §10 Burn-in Gate to RUNBOOK.md; fix §2 key names

### Acceptance criteria verified:
- `grep "BETTERSTACK_HEARTBEAT_TOKEN" deploy/bootstrap.sh deploy/RUNBOOK.md` — EMPTY (pass)
- `grep "BETTERSTACK_HEARTBEAT_URL" deploy/bootstrap.sh` — present line 125 (pass)
- `grep "HEARTBEAT_TIMEOUT_MS" deploy/bootstrap.sh` — present line 126 (pass)
- `grep "## 9. Betterstack Setup" deploy/RUNBOOK.md` — present line 284 (pass)
- `grep "## 10. Burn-in Gate Procedure" deploy/RUNBOOK.md` — present line 343 (pass)
- `grep "600" deploy/RUNBOOK.md` — present §9.2 (pass)
- `grep "itemsFetched" deploy/RUNBOOK.md` — ClickHouse SQL in §9.1 (pass)
- `grep "B-01" deploy/RUNBOOK.md` — 5 gate criteria §10.1 (pass)
- `grep "7 calendar days" deploy/RUNBOOK.md` — present §10 (pass)
- `bash -n deploy/bootstrap.sh` — exits 0 (pass)

## Self-Check: PASSED
