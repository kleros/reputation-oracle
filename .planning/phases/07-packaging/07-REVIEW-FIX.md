---
phase: 07-packaging
fixed_at: 2026-04-23T00:00:00Z
review_path: .planning/phases/07-packaging/07-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 07: Code Review Fix Report

**Fixed at:** 2026-04-23T00:00:00Z
**Source review:** .planning/phases/07-packaging/07-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3
- Fixed: 3
- Skipped: 0

## Fixed Issues

### WR-02: RUNBOOK §2 incorrectly states `SUBGRAPH_URL` is pre-filled in the env stub

**Files modified:** `deploy/bootstrap.sh`
**Commit:** 2b687bc
**Applied fix:** Changed `SUBGRAPH_URL=` (blank) to `SUBGRAPH_URL=https://api.goldsky.com/api/public/project_cmgx9all3003atlp2bqha1zif/subgraphs/pgtcr-sepolia/v0.0.2/gn` in the sepolia.env heredoc template (line 113). The RUNBOOK §2 claim that the stub is pre-filled is now accurate.

### WR-01: `update.sh` silently ignores systemd unit file changes

**Files modified:** `deploy/update.sh`
**Commit:** ec5bebd
**Applied fix:** Added step 2b block between git pull (step 2) and npm ci (step 3): resolves `SCRIPT_DIR`, copies both `reputation-oracle@.service` and `reputation-oracle@.timer` to `/etc/systemd/system/`, sets `chmod 0644` on each, runs `systemctl daemon-reload`. Also updated the header comment on line 4 to reflect the expanded sequence: `stop timer → git pull → install unit files + daemon-reload → npm ci → start timer`.

### WR-03: Dry-run diagnostic commands use `env $(cat | xargs)` — fragile for values with spaces

**Files modified:** `deploy/ACCEPTANCE.md`, `deploy/RUNBOOK.md`
**Commit:** 0b08913
**Applied fix:** Replaced all four occurrences of the `env $(cat /etc/reputation-oracle/sepolia.env | grep -v '^#' | grep -v '^$' | xargs)` pattern with `--env-file /etc/reputation-oracle/sepolia.env` passed directly to the node invocation. The `sudo -u oracle --preserve-env=HOME` prefix was simplified to `sudo -u oracle` (the `--preserve-env=HOME` is no longer needed since `--env-file` loads the file directly without inheriting the calling shell environment). Both ACCEPTANCE.md (PKG-08, two code blocks) and RUNBOOK.md (§3, two code blocks) were updated.

---

_Fixed: 2026-04-23T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
