---
phase: 07-packaging
plan: "04"
subsystem: deploy
tags: [packaging, update, systemd, bash, atomic-update]
dependency_graph:
  requires:
    - phase: 07-03
      provides: bootstrap-sh
  provides:
    - update-sh
    - start-timer-sh
  affects: [deploy/RUNBOOK.md]
tech_stack:
  added: []
  patterns: [atomic-stop-pull-install-start, trap-on-ERR-recovery-hint, instance-arg-allowlist]
key_files:
  created:
    - deploy/update.sh
    - deploy/start-timer.sh
  modified: []
decisions:
  - "Four-step order stop→pull→ci→start is load-bearing (P1-09 prevention) — no extra git steps added"
  - "on_error trap captures timer state at failure time — operator sees if timer is running or stopped before recovery"
  - "start-timer.sh uses instance-arg form (not Sepolia-hardcoded) — Phase 9 Mainnet reuse with zero changes"
metrics:
  duration: "48s"
  completed: "2026-04-23"
  tasks_completed: 2
  files_changed: 2
---

# Phase 7 Plan 4: Update Scripts Summary

**One-liner:** Atomic 4-step update script (stop→pull→ci→start) with trap-on-ERR recovery hints, plus a minimal timer-enable helper — both instance-parameterised for Phase 9 Mainnet reuse.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write deploy/update.sh — atomic 4-step update | 2675f43 | deploy/update.sh |
| 2 | Write deploy/start-timer.sh — timer enable helper | 7bed087 | deploy/start-timer.sh |

## Verification Results

- `bash -n deploy/update.sh` passes (syntax valid)
- `bash -n deploy/start-timer.sh` passes (syntax valid)
- Both scripts have `set -euo pipefail`
- `update.sh`: `systemctl stop` at line 36, `systemctl start` at line 54 — stop before start confirmed
- `update.sh`: `pull --ff-only` present (T-07-04-01 mitigation)
- `update.sh`: `trap 'on_error $? $LINENO "$BASH_COMMAND"' ERR` with timer state + recovery hint
- `update.sh`: `sudo -u oracle` for git and npm steps (T-07-04-04 mitigation)
- `start-timer.sh`: `systemctl enable --now` present
- `start-timer.sh`: `systemctl status --no-pager` printed after enable
- Both scripts accept `[sepolia|mainnet]` argument with explicit allowlist (T-07-05-01 mitigation)
- Both scripts are executable (`chmod +x`)

## Deviations from Plan

None — plan executed exactly as written. Script content mirrors the verbatim templates in the task action blocks.

## Known Stubs

None.

## Threat Flags

No new network endpoints, auth paths, or schema changes introduced. Both scripts are local system-management utilities.

Threat mitigations confirmed applied:
- T-07-04-01: `pull --ff-only` prevents non-fast-forward merges from remote
- T-07-04-02: trap-on-ERR in update.sh prints timer state and recovery hint; script is re-runnable
- T-07-04-04: `sudo -u oracle npm ci` — node_modules written by oracle, not root
- T-07-04-05: instance argument validated with explicit case allowlist in both scripts

## Self-Check: PASSED

- [x] `deploy/update.sh` exists — commit 2675f43
- [x] `deploy/start-timer.sh` exists — commit 7bed087
- [x] Both commits exist in git log
- [x] `bash -n` passes for both scripts
- [x] `set -euo pipefail` in both scripts
- [x] stop (line 36) before start (line 54) in update.sh
- [x] `pull --ff-only` in update.sh
- [x] `trap` with `on_error` function in update.sh
- [x] `systemctl is-active` in on_error handler
- [x] `sudo -u oracle` for git and npm
- [x] `systemctl enable --now` in start-timer.sh
- [x] `systemctl status --no-pager` in start-timer.sh
- [x] Both scripts executable
- [x] PKG-07 requirement satisfied by update.sh
