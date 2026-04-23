---
phase: 07-packaging
reviewed: 2026-04-23T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - bot/package.json
  - deploy/ACCEPTANCE.md
  - deploy/bootstrap.sh
  - deploy/journald.conf.d/reputation-oracle.conf
  - deploy/RUNBOOK.md
  - deploy/start-timer.sh
  - deploy/systemd/reputation-oracle@.service
  - deploy/systemd/reputation-oracle@.timer
  - deploy/update.sh
  - README.md
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 07: Code Review Report

**Reviewed:** 2026-04-23T00:00:00Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Reviewed all Phase 7 packaging artifacts: shell provisioner scripts, systemd unit templates, journald config, and operator docs. No critical issues. The shell scripts are well-structured with `set -euo pipefail`, idempotent guards, and ERR trap error handlers. The systemd unit is correctly typed (oneshot), uses `EnvironmentFile=` to keep secrets out of `systemctl show`, and the hardening directives are appropriate. The `tsx` move to `dependencies` is confirmed correct.

Three warnings found: `update.sh` silently ignores unit file changes from `git pull` (no re-copy or daemon-reload); RUNBOOK §2 incorrectly states `SUBGRAPH_URL` is pre-filled in the env stub when it is actually blank (operator trap); and the dry-run diagnostic commands use `env $(cat | xargs)` which word-splits on whitespace and is fragile for non-trivial values.

---

## Warnings

### WR-01: `update.sh` silently ignores systemd unit file changes

**File:** `deploy/update.sh:41-48`

**Issue:** The update flow (`stop → git pull → npm ci → start`) does not re-copy the `.service` or `.timer` files from the repo to `/etc/systemd/system/`, nor does it run `systemctl daemon-reload`. If a `git pull` includes changes to either unit file, the running systemd instance continues using the stale versions loaded at last bootstrap. The operator has no indication that the units are out of sync — the timer restarts successfully using old configuration.

**Fix:** Add unit file re-installation and a daemon-reload between steps 2 and 3:

```bash
# ── Step 2b: Re-install unit files if changed ──────────────────────────────
>&2 echo ""
>&2 echo "[update:2b] Installing updated systemd unit files"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "${SCRIPT_DIR}/systemd/reputation-oracle@.service" /etc/systemd/system/
cp "${SCRIPT_DIR}/systemd/reputation-oracle@.timer"   /etc/systemd/system/
chmod 0644 /etc/systemd/system/reputation-oracle@.service
chmod 0644 /etc/systemd/system/reputation-oracle@.timer
systemctl daemon-reload
>&2 echo "[update:2b] Unit files updated and daemon-reload complete"
```

Also update the banner in RUNBOOK.md §5 to read: `stop timer → git pull → install unit files + daemon-reload → npm ci → start timer`.

---

### WR-02: RUNBOOK §2 incorrectly states `SUBGRAPH_URL` is pre-filled in the env stub

**File:** `deploy/RUNBOOK.md:69` / `deploy/bootstrap.sh:113`

**Issue:** RUNBOOK §2 Secret Fill table says:

> `SUBGRAPH_URL` — Goldsky subgraph endpoint — **pre-filled stub default is correct for Sepolia**

However, `bootstrap.sh` line 113 writes `SUBGRAPH_URL=` (blank) into the env stub. An operator who reads the RUNBOOK and concludes they can leave `SUBGRAPH_URL` unchanged will have a blank value, and the bot will fail config validation at startup.

**Fix (two options — apply both):**

Option A — Pre-fill the value in the bootstrap stub (preferred):
```bash
# bootstrap.sh line 113
SUBGRAPH_URL=https://api.goldsky.com/api/public/project_cmgx9all3003atlp2bqha1zif/subgraphs/pgtcr-sepolia/v0.0.2/gn
```

Option B — Correct the RUNBOOK §2 table entry to mark `SUBGRAPH_URL` as required:
```markdown
| `SUBGRAPH_URL` | Goldsky subgraph endpoint — **required; see CLAUDE.md §Subgraph endpoints for current URL** |
```

Pre-filling (Option A) is better UX and matches the spirit of RUNBOOK's claim. Option B alone leaves the operator guessing the URL.

---

### WR-03: Dry-run diagnostic commands use `env $(cat | xargs)` — fragile for values with spaces

**File:** `deploy/ACCEPTANCE.md:189,198` / `deploy/RUNBOOK.md:103,122`

**Issue:** The dry-run command pattern used in ACCEPTANCE.md §PKG-08 and RUNBOOK §3 is:

```bash
env $(cat /etc/reputation-oracle/sepolia.env | grep -v '^#' | grep -v '^$' | xargs) \
  /usr/bin/node --import tsx ...
```

`xargs` with no `-d` option splits on all unquoted whitespace. A value like `RPC_URL=https://rpc.example.com/v2/key with spaces` would be split into `RPC_URL=https://...` + `with` + `spaces`, the latter two treated as additional env args and silently ignored or causing an error. While current RPC URL patterns don't include spaces, this is fragile and also briefly exposes all env values (including `BOT_PRIVATE_KEY`) in `/proc/self/cmdline` visible to any local process during invocation.

This pattern is used only for acceptance-test diagnostics (production uses `EnvironmentFile=` securely), but an operator copy-pasting it could be confused when a value breaks.

**Fix:** Use `--env-file` directly instead of the `env $()` pattern. The bot already supports `node --env-file`:

```bash
sudo -u oracle /usr/bin/node \
  --env-file /etc/reputation-oracle/sepolia.env \
  --import tsx /opt/reputation-oracle/bot/src/index.ts --dry-run
```

This avoids xargs word-splitting and does not expose values in the process argument list.

---

## Info

### IN-01: Unit file `PrivateTmp=true` vs ACCEPTANCE.md expected `PrivateTmp=yes`

**File:** `deploy/systemd/reputation-oracle@.service:19` / `deploy/ACCEPTANCE.md:125,135`

**Issue:** The unit file specifies `PrivateTmp=true`; ACCEPTANCE.md PKG-05 expects `PrivateTmp=yes` in the `systemctl show` output and in the checklist checkbox. systemd accepts both `true` and `yes` as equivalent booleans and normalizes to `yes` in `systemctl show` output, so the acceptance check will pass in practice. But a developer reading the unit file and comparing to the checklist would see an apparent mismatch.

**Fix:** Align the unit file to use `yes` for consistency with the ACCEPTANCE.md expectation and with `NoNewPrivileges=true` vs `yes` — pick one form and apply it uniformly. Since `NoNewPrivileges=true` is already in the file, changing `PrivateTmp=true` to `PrivateTmp=yes` (or vice-versa) is optional style cleanup.

---

### IN-02: RUNBOOK §4 timer first-fire description is slightly misleading

**File:** `deploy/RUNBOOK.md:141`

**Issue:** Line 141 says "Starts the first 15-minute countdown immediately (first run fires after `OnBootSec=2min`)". With `Persistent=true` and `enable --now` on a system that has been running for >2 minutes since boot, the timer fires immediately rather than waiting for `OnBootSec=2min` — because the OnBootSec threshold has already elapsed. RUNBOOK line 152 correctly says "wait up to 2 minutes", which is the accurate upper bound.

**Fix:** Change the parenthetical on line 141 to clarify the actual behavior:

```markdown
- Starts the first 15-minute countdown immediately (first run fires within ~2 minutes — sooner if the VPS has been up for a while, due to `Persistent=true`)
```

---

_Reviewed: 2026-04-23T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
