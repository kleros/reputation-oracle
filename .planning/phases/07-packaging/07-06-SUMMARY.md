---
phase: 07-packaging
plan: "06"
subsystem: deploy
tags: [packaging, acceptance, checklist, vps, dry-run, pki]
dependency_graph:
  requires:
    - phase: 07-01
      provides: tsx-in-prod-deps
    - phase: 07-02
      provides: systemd-service-template, systemd-timer-template, journald-drop-in
    - phase: 07-03
      provides: bootstrap-sh
    - phase: 07-04
      provides: update-sh, start-timer-sh
    - phase: 07-05
      provides: runbook
  provides:
    - vps-acceptance-checklist
  affects: [phase-08-observability]
tech_stack:
  added: []
  patterns: [operator-checklist, acceptance-gate, requirement-traceability]
key_files:
  created:
    - deploy/ACCEPTANCE.md
  modified: []
key_decisions:
  - "Acceptance checklist maps 1:1 to PKG-01..PKG-08 with exact shell commands and expected output patterns — not vague prose"
  - "Dry-run command in PKG-08 uses --preserve-env=HOME + grep filters matching RUNBOOK.md §3 exactly (no divergence)"
  - "update.sh path uses /opt/reputation-oracle/deploy/update.sh (absolute path for VPS context, matching RUNBOOK.md §5)"
requirements-completed: [PKG-08]
duration: 2min
completed: "2026-04-23"
---

# Phase 7 Plan 6: VPS Acceptance Checklist Summary

**Step-by-step PKG-01..PKG-08 acceptance checklist in `deploy/ACCEPTANCE.md` with exact shell commands, expected output patterns, and 33 checkboxes — the formal gate an operator runs once on the live Sepolia VPS before enabling the timer.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-23T17:04:02Z
- **Completed:** 2026-04-23T17:05:27Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- `deploy/ACCEPTANCE.md` written with a dedicated section for each of PKG-01 through PKG-08
- Each section contains concrete bash commands with inline expected-output comments
- PKG-08 section includes the full dry-run acceptance gate per D-29/D-30 (itemsFetched, chainId, pino level checks, stateless assertion)
- 33 checkboxes total — operator marks each `[x]` as they confirm it on a live VPS
- Acceptance Sign-off section documents what must be true before Phase 8 begins
- Cross-references `deploy/RUNBOOK.md` for detailed operator procedures

## Task Commits

1. **Task 1: Write deploy/ACCEPTANCE.md — PKG-01..PKG-08 verification checklist** - `48ceb4d` (docs)

## Files Created/Modified

- `deploy/ACCEPTANCE.md` — 233-line operator checklist; 8 PKG sections; 33 checkboxes; exact commands matching deployed artifacts

## Decisions Made

- Dry-run command includes `| grep -v '^#' | grep -v '^$'` filter to strip comment/blank lines from sepolia.env — consistent with RUNBOOK.md §3 (D-29 pattern)
- `update.sh` and `bootstrap.sh` references use absolute `/opt/reputation-oracle/deploy/` paths — operator runs these from the VPS, not from a local clone
- Acceptance Sign-off references `deploy/RUNBOOK.md` for detailed steps rather than duplicating them

## Deviations from Plan

None — plan executed exactly as written. Minor diff from plan template: pre-flight commands use absolute paths (`/opt/reputation-oracle/deploy/bootstrap.sh`) consistent with the VPS operator context, and dry-run command includes the comment/blank-line filter (`grep -v '^#' | grep -v '^$'`) present in RUNBOOK.md §3 but missing from the plan template. Both are correctness improvements.

## Known Stubs

None.

## Threat Flags

None — ACCEPTANCE.md is operator documentation only. No new network endpoints, auth paths, or schema changes.

Accepted threat dispositions per plan threat model:
- T-07-06-01: `env $(cat ... | xargs)` briefly exposes env vars in ps — accepted; local VPS, single-user, millisecond window
- T-07-06-02: Operator skipping checklist — accepted; checklist is documentation discipline, not code enforcement

## Self-Check: PASSED

- [x] `deploy/ACCEPTANCE.md` exists — commit 48ceb4d
- [x] All 8 PKG-0x sections present (PKG-01 through PKG-08)
- [x] 33 checkboxes (> 20 required by plan verification)
- [x] Dry-run command matches D-29: `--preserve-env=HOME env $(cat ... | grep -v '^#' | grep -v '^$' | xargs) /usr/bin/node --import tsx ... --dry-run`
- [x] `itemsFetched` checked in PKG-08
- [x] `chainId == 11155111` checked in PKG-08
- [x] `600 oracle oracle` permissions check in PKG-04
- [x] All automated verification checks PASSED

---
*Phase: 07-packaging*
*Completed: 2026-04-23*
