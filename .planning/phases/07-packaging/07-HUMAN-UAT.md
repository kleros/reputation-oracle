---
status: deferred
phase: 07-packaging
source: [07-VERIFICATION.md]
started: 2026-04-23T00:00:00Z
updated: 2026-04-23T00:00:00Z
deferred: 2026-04-23T00:00:00Z
deferred_reason: "Live-VPS acceptance tracked in STATE.md Deferred Items; executed at VPS provisioning time. Phase 7 codebase deliverables (10/10 must-haves) are verified and do not block Phase 8 (Observability)."
---

## Current Test

[deferred — live-VPS acceptance to be executed by operator at VPS provisioning time; use `deploy/ACCEPTANCE.md` as the checklist]

## Tests

### 1. Bootstrap end-to-end on fresh Ubuntu 24.04 VPS
expected: Clone to `/opt/reputation-oracle`, run `sudo ./deploy/bootstrap.sh` — all 11 step banners print, exit 0. Re-run same command, exit 0 again (idempotency). `node_modules` populated; systemd units present at `/etc/systemd/system/`; journald restarted.
result: [deferred — execute at VPS provisioning time]

### 2. systemd timer fires on schedule
expected: After `sudo ./deploy/start-timer.sh sepolia`, `systemctl list-timers reputation-oracle@sepolia.timer` shows active (waiting); first run appears in `journalctl -u reputation-oracle@sepolia -n 20` within 2 minutes (OnBootSec=2min); subsequent runs every 15 min.
result: [deferred — execute at VPS provisioning time]

### 3. Secrets not exposed by `systemctl show`
expected: `systemctl show reputation-oracle@sepolia.service | grep -i BOT_PRIVATE_KEY` returns nothing — secrets come in via `EnvironmentFile=` and are not in the `show` output.
result: [deferred — execute at VPS provisioning time]

### 4. PKG-08 dry-run on live Sepolia VPS
expected: With `/etc/reputation-oracle/sepolia.env` populated, `sudo -u oracle /usr/bin/node --env-file /etc/reputation-oracle/sepolia.env --import tsx /opt/reputation-oracle/bot/src/index.ts --dry-run` exits 0; stdout contains a RunSummary JSON with `itemsFetched > 0` and `chainId == 11155111`; no `level:50` or `level:60` lines in stderr.
result: [deferred — execute at VPS provisioning time]

### 5. journald retention confirmed active
expected: `cat /etc/systemd/journald.conf.d/reputation-oracle.conf` shows `SystemMaxUse=500M` + `SystemMaxFileSize=50M`; `journalctl --disk-usage` succeeds (journald running with new config).
result: [deferred — execute at VPS provisioning time]

## Summary

total: 5
passed: 0
issues: 0
pending: 0
skipped: 0
blocked: 0
deferred: 5

## Gaps

_(none identified; all 5 items deferred to operator at VPS provisioning — tracked in `.planning/STATE.md` Deferred Items)_
