---
status: complete
phase: 07-packaging
source: [07-VERIFICATION.md]
started: 2026-04-23T00:00:00Z
updated: 2026-04-23T23:20:00Z
deferred: 2026-04-23T00:00:00Z
resumed: 2026-04-23T23:00:00Z
completed: 2026-04-23T23:20:00Z
resolution: "All 5 live-VPS UAT items passed after operator deployed Phase 7 to Sepolia VPS. Quick task 260423-wzl addressed 4 deploy issues (nodejs purge, --no-create-home, dry-run cwd, sudo prefixes) discovered during deployment."
---

## Current Test

[testing complete]

## Tests

### 1. Bootstrap end-to-end on fresh Ubuntu 24.04 VPS
expected: Clone to `/opt/reputation-oracle`, run `sudo ./deploy/bootstrap.sh` — all 11 step banners print, exit 0. Re-run same command, exit 0 again (idempotency). `node_modules` populated; systemd units present at `/etc/systemd/system/`; journald restarted.
result: pass

### 2. systemd timer fires on schedule
expected: After `sudo ./deploy/start-timer.sh sepolia`, `sudo systemctl list-timers reputation-oracle@sepolia.timer` shows active (waiting); first run appears in `sudo journalctl -u reputation-oracle@sepolia -n 20` within 2 minutes (OnBootSec=2min); subsequent runs every 5 min.
result: pass

### 3. Secrets not exposed by `systemctl show`
expected: `sudo systemctl show reputation-oracle@sepolia.service | grep -i BOT_PRIVATE_KEY` returns nothing — secrets come in via `EnvironmentFile=` and are not in the `show` output.
result: pass

### 4. PKG-08 dry-run on live Sepolia VPS
expected: With `/etc/reputation-oracle/sepolia.env` populated, `sudo -u oracle bash -c 'cd /opt/reputation-oracle/bot && /usr/bin/node --env-file=/etc/reputation-oracle/sepolia.env --import tsx src/index.ts --dry-run'` exits 0; stdout/stderr contains a RunSummary JSON with `itemsFetched > 0` and `chainId == 11155111`; no `level:50` or `level:60` lines in stderr.
result: pass

### 5. journald retention confirmed active
expected: `sudo cat /etc/systemd/journald.conf.d/reputation-oracle.conf` shows `SystemMaxUse=500M` + `SystemMaxFileSize=50M`; `sudo journalctl --disk-usage` succeeds (journald running with new config).
result: pass

## Summary

total: 5
passed: 5
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

_(none — all 5 items passed. Quick task 260423-wzl captured the 4 deploy-time fixes discovered during VPS provisioning.)_
