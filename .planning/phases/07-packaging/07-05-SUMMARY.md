---
phase: 07-packaging
plan: "05"
subsystem: deploy
tags: [packaging, runbook, documentation, operator-lifecycle]
dependency_graph:
  requires:
    - phase: 07-03
      provides: bootstrap-sh
    - phase: 07-04
      provides: update-sh, start-timer-sh
  provides:
    - runbook
    - readme-deployment-pointer
  affects: []
tech_stack:
  added: []
  patterns: [operator-runbook, dry-run-acceptance-gate, idempotent-install-docs]
key_files:
  created:
    - deploy/RUNBOOK.md
  modified:
    - README.md
decisions:
  - "Single RUNBOOK.md file (not split) per D-39 — one document operator can bookmark and reference during incidents"
  - "Dry-run command uses --preserve-env=HOME + env $(cat ... | xargs) pattern per D-29 — inline command, no separate verify.sh wrapper"
  - "RunSummary acceptance criteria table lists itemsFetched, chainId, and pino level codes (50=error, 60=fatal) for NDJSON inspection"
  - "README Deployment section appended at end (after Design principles) — no existing content removed or reordered"
metrics:
  duration: "2min"
  completed: "2026-04-23"
  tasks_completed: 2
  files_changed: 2
---

# Phase 7 Plan 5: Operator Runbook Summary

**One-liner:** Complete operator lifecycle guide in `deploy/RUNBOOK.md` covering fresh-VPS install through rollback, with the exact dry-run acceptance command and troubleshooting table keyed on P1-02/P1-05/P1-07/P1-08 pitfalls — plus a two-command README quick-start pointing to it.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write deploy/RUNBOOK.md with all 8 operator lifecycle sections | 8b66441 | deploy/RUNBOOK.md |
| 2 | Update root README.md with deployment pointer | f4412c8 | README.md |

## Verification Results

- `deploy/RUNBOOK.md` exists, 278 lines
- Section count: 9 `##` headings (Table of Contents + 8 numbered sections)
- Dry-run acceptance command present: `sudo -u oracle --preserve-env=HOME env $(cat ... | grep -v '^#' | grep -v '^$' | xargs) /usr/bin/node --import tsx /opt/reputation-oracle/bot/src/index.ts --dry-run`
- WARNING block for bash history key capture (P1-12) present in §2
- Troubleshooting table covers: P1-02 (ERR_MODULE_NOT_FOUND / tsx), P1-05 (wrong env file perms), P1-07 (nvm path / system Node), P1-08 (journald empty/truncated)
- All script references verified against disk: `deploy/bootstrap.sh` (195 lines), `deploy/update.sh`, `deploy/start-timer.sh`
- `README.md` has `## Deployment` section with `[deploy/RUNBOOK.md](deploy/RUNBOOK.md)` link and two-command quick start
- All automated verification checks from plan PASSED

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

No new network endpoints, auth paths, or schema changes. Files are documentation only.

Accepted threat dispositions per plan threat model:
- T-07-05-01: `env $(cat ... | xargs)` exposes env vars in ps briefly — accepted; single-shot local command
- T-07-05-02: RUNBOOK.md in public git — accepted; contains no secret values
- T-07-05-03: Stale cached RUNBOOK — accepted; RUNBOOK co-located with scripts in git, `git pull` keeps it current

## Self-Check: PASSED

- [x] `deploy/RUNBOOK.md` exists — commit 8b66441
- [x] `README.md` updated — commit f4412c8
- [x] Both commits exist in git log
- [x] All 8 D-31 sections present (install, secret-fill, dry-run, timer-enable, update, rollback, time-sync, troubleshoot)
- [x] Dry-run command matches D-29 (--preserve-env=HOME + env xargs pattern)
- [x] Bash history WARNING in §2 Secret Fill
- [x] Troubleshooting table: P1-02, P1-05, P1-07, P1-08 with diagnosis commands
- [x] README Deployment section links to deploy/RUNBOOK.md
- [x] PKG-07 (atomic-update runbook) satisfied by §5 Update Flow pointing to update.sh
- [x] PKG-08 (acceptance dry-run documented) satisfied by §3 First-Run Verification with full acceptance criteria table

---
*Phase: 07-packaging*
*Completed: 2026-04-23*
