---
phase: 07-packaging
plan: "03"
subsystem: deploy
tags: [packaging, bootstrap, systemd, ubuntu, bash, idempotent]
dependency_graph:
  requires:
    - phase: 07-01
      provides: tsx-in-prod-deps
    - phase: 07-02
      provides: systemd-service-template, systemd-timer-template, journald-drop-in
  provides:
    - bootstrap-sh
    - vps-provisioner
  affects: [deploy/RUNBOOK.md, deploy/start-timer.sh, deploy/update.sh]
tech_stack:
  added: []
  patterns: [idempotent-bash-provisioner, install-then-edit-secrets, step-ordered-chown-before-npm]
key_files:
  created:
    - deploy/bootstrap.sh
  modified: []
key_decisions:
  - "sepolia.env stub created via 'install -m 0600 -o oracle -g oracle /dev/null' then heredoc — never echo/redirect (bash history capture prevention, D-16)"
  - "step 3 (useradd) MUST precede steps 5/6/7 — operator cannot chown to a user that doesn't exist yet (D-23, circular-dependency fix from D-21)"
  - "bootstrap does NOT enable or start the timer — operator enables after dry-run validation (D-24)"
  - "permissions asserted via stat -c before script exits — pre-existing file with wrong perms triggers explicit error with fix instructions"
patterns-established:
  - "Idempotent guard pattern: check-before-act on user (id oracle), Node (node --version | grep v22), directory (test -d), env file (test -f)"
  - "Error trap pattern: trap 'on_error $? $LINENO BASH_COMMAND' ERR with CURRENT_STEP tracking for human-readable failure messages"
  - "All step banners to stderr (>&2 echo) — stdout reserved for machine-parseable output"
requirements-completed: [PKG-01, PKG-04, PKG-06]
duration: 2min
completed: "2026-04-23"
---

# Phase 7 Plan 3: Bootstrap Script Summary

**Idempotent 11-step VPS provisioner that turns a fresh Ubuntu 24.04 clone into a running-ready oracle instance — creates oracle user, installs Node 22, chowns repo, installs prod deps, creates 0600 secrets stub, installs systemd units, and reloads journald.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-23T17:14:43Z
- **Completed:** 2026-04-23T17:15:53Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- `deploy/bootstrap.sh` written with strict bash (`set -euo pipefail`) and trap-on-ERR error reporting
- All 11 provisioning steps in load-bearing order per D-23 (useradd at step 3 before chown at step 5, npm ci at step 6, install -o oracle at step 7)
- Idempotency guards on: Node 22, oracle user, /etc/reputation-oracle/ directory, sepolia.env file
- Secrets stub created via `install -m 0600 -o oracle -g oracle /dev/null` then heredoc append — never `echo >>` (prevents bash history capture of real secrets)
- Permissions asserted via `stat -c '%a %U %G'` — pre-existing file with wrong perms surfaces explicit error with fix command
- Phase 8 BETTERSTACK_SOURCE_TOKEN and BETTERSTACK_HEARTBEAT_TOKEN placeholders in stub (commented)
- Does NOT call `systemctl enable` or `systemctl start` on the timer

## Task Commits

1. **Task 1: Write deploy/bootstrap.sh with 11-step ordered provisioning** - `53b696a` (feat)

## Files Created/Modified

- `deploy/bootstrap.sh` — Idempotent VPS provisioner; 195 lines; executable (`chmod +x`); references wave-2 artifacts in `deploy/systemd/` and `deploy/journald.conf.d/`

## Decisions Made

- Removed `✓` emoji from permissions-verified log line (kept plain ASCII per CLAUDE.md style)
- Followed plan verbatim — all content spec'd in task action block

## Deviations from Plan

None — plan executed exactly as written. Script content mirrors the verbatim template in the task action block, with one minor stylistic adjustment: removed emoji character from the permissions-verified log line to maintain ASCII-only output.

## Known Stubs

None.

## Threat Flags

No new network endpoints, auth paths, or schema changes introduced.

Threat mitigations confirmed applied:
- T-07-03-01: Bash history warning in stub header; `install` + heredoc pattern (no real secret values in script)
- T-07-03-02: `install -m 0600 -o oracle -g oracle /dev/null` sets perms atomically; `stat -c` assertion before exit
- T-07-03-03: `curl -fsSL` (fail-on-error); idempotency guard skips re-download if v22 present
- T-07-03-04: `sudo -u oracle npm ci` — node_modules written by oracle, not root; chown (step 5) precedes npm (step 6)
- T-07-03-06: `if [ ! -f /etc/reputation-oracle/sepolia.env ]` guard — clobber never happens

## Self-Check: PASSED

- [x] `deploy/bootstrap.sh` exists — commit 53b696a
- [x] `bash -n deploy/bootstrap.sh` passes (syntax valid)
- [x] `set -euo pipefail` present
- [x] `useradd --system --no-create-home` present (line 57)
- [x] `chown -R oracle:oracle` present (line 81) — after useradd (line 57)
- [x] `npm ci --omit=dev` present
- [x] `install -m 0600 -o oracle -g oracle /dev/null` secure stub pattern present
- [x] `stat -c '%a %U %G'` permissions assertion present
- [x] No `systemctl enable` in script
- [x] `daemon-reload` present
- [x] `BETTERSTACK_SOURCE_TOKEN` and `BETTERSTACK_HEARTBEAT_TOKEN` Phase 8 placeholders present
- [x] Script is executable (`chmod +x`)
- [x] All 11 automated verification checks PASSED

---
*Phase: 07-packaging*
*Completed: 2026-04-23*
