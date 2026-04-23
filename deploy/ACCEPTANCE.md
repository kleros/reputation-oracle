# Kleros Reputation Oracle — VPS Acceptance Checklist

**Run this on the live Sepolia VPS after bootstrap + secret fill.**
**All checks must pass before enabling the timer or proceeding to Phase 8.**

Mark each item `[x]` as you complete it. If any check fails, see the "Fix" column or `deploy/RUNBOOK.md §8 Troubleshooting`.

---

## Pre-flight

- [ ] Bootstrap completed without errors: `sudo /opt/reputation-oracle/deploy/bootstrap.sh` exited 0
- [ ] Secrets filled: `sudo -u oracle nano /etc/reputation-oracle/sepolia.env` (all required keys populated)

---

## PKG-01: Bootstrap idempotency + Node 22 + oracle user

```bash
# Re-run bootstrap — must complete without error (idempotency test)
sudo /opt/reputation-oracle/deploy/bootstrap.sh

# Verify Node 22 is installed at system-wide path
node --version
# Expected: v22.x.x

which node
# Expected: /usr/bin/node

# Verify oracle system user exists
id oracle
# Expected: uid=NNN(oracle) gid=NNN(oracle) groups=NNN(oracle)

# Verify /opt/reputation-oracle owned by oracle
stat -c '%U %G' /opt/reputation-oracle
# Expected: oracle oracle
```

- [ ] Bootstrap re-run exits 0
- [ ] `node --version` returns `v22.x.x`
- [ ] `which node` returns `/usr/bin/node`
- [ ] `id oracle` succeeds
- [ ] `/opt/reputation-oracle` owned by `oracle oracle`

---

## PKG-02: tsx in dependencies — npm ci --omit=dev does not break execution

```bash
# Verify tsx is in dependencies (not devDependencies)
node -e "const p=JSON.parse(require('fs').readFileSync('/opt/reputation-oracle/bot/package.json','utf8')); console.log('tsx in deps:', 'tsx' in p.dependencies, '| tsx in devDeps:', 'tsx' in (p.devDependencies||{}));"
# Expected: tsx in deps: true | tsx in devDeps: false

# Verify tsx is present after --omit=dev install
test -d /opt/reputation-oracle/bot/node_modules/tsx && echo "tsx present" || echo "tsx MISSING"
# Expected: tsx present

# Verify node --import tsx starts without ERR_MODULE_NOT_FOUND
# (will fail at config validation — that is expected; we check for module error specifically)
sudo -u oracle /usr/bin/node --import tsx /opt/reputation-oracle/bot/src/index.ts 2>&1 | head -3
# Expected: output does NOT contain "ERR_MODULE_NOT_FOUND" or "Cannot find package 'tsx'"
```

- [ ] tsx confirmed in `dependencies`, not `devDependencies`
- [ ] `node_modules/tsx` exists under production install
- [ ] No `ERR_MODULE_NOT_FOUND` for tsx in startup output

---

## PKG-03: systemd instance timer active and scheduled

```bash
# Verify unit files installed
test -f /etc/systemd/system/reputation-oracle@.service && echo "service unit present"
test -f /etc/systemd/system/reputation-oracle@.timer && echo "timer unit present"

# After start-timer.sh runs, verify timer is active
systemctl is-active reputation-oracle@sepolia.timer
# Expected: active

# Verify schedule
systemctl list-timers reputation-oracle@sepolia.timer
# Expected: shows next trigger in <= 5 min; RandomizedDelaySec visible

# Verify timer parameters
systemctl show reputation-oracle@sepolia.timer | grep -E "OnUnitActiveSec|Persistent|RandomizedDelaySec"
# Expected: OnUnitActiveSec=5min, Persistent=yes, RandomizedDelaySec=60s (values may show in microseconds)
```

- [ ] `/etc/systemd/system/reputation-oracle@.service` exists
- [ ] `/etc/systemd/system/reputation-oracle@.timer` exists
- [ ] Timer is `active` after `start-timer.sh sepolia`
- [ ] `list-timers` shows next trigger within 5 min

---

## PKG-04: Secrets in EnvironmentFile, not exposed via systemctl show

```bash
# Verify env file permissions
stat -c '%a %U %G' /etc/reputation-oracle/sepolia.env
# Expected: 600 oracle oracle

# Verify systemctl show does NOT expose secret values
systemctl show reputation-oracle@sepolia.service | grep -i "BOT_PRIVATE_KEY\|PINATA_JWT\|RPC_URL"
# Expected: NO output (secrets are not in Environment= directives)

# Verify EnvironmentFile directive points to the right path
systemctl show reputation-oracle@sepolia.service | grep EnvironmentFile
# Expected: EnvironmentFile=/etc/reputation-oracle/sepolia.env
```

- [ ] `stat` shows `600 oracle oracle` on sepolia.env
- [ ] `systemctl show` does NOT print `BOT_PRIVATE_KEY`, `PINATA_JWT`, or `RPC_URL` values
- [ ] `EnvironmentFile=/etc/reputation-oracle/sepolia.env` present in unit config

---

## PKG-05: Exactly 4 hardening directives in [Service]

```bash
systemctl show reputation-oracle@sepolia.service | grep -E "^(ProtectSystem|PrivateTmp|NoNewPrivileges|TimeoutStartSec)="
# Expected: all four lines present:
# ProtectSystem=strict
# PrivateTmp=yes
# NoNewPrivileges=yes
# TimeoutStartSec=5min (or 300s)

# Verify no explicit Restart= (Restart=no is the default — no Restart= in unit file)
systemctl show reputation-oracle@sepolia.service | grep "^Restart="
# Expected: Restart=no (default — no explicit Restart= in unit file means systemd reports no)
```

- [ ] ProtectSystem=strict present
- [ ] PrivateTmp=yes present
- [ ] NoNewPrivileges=yes present
- [ ] TimeoutStartSec=300 (5min) present
- [ ] Restart=no (not on-failure or always)

---

## PKG-06: journald retention caps applied

```bash
# Verify drop-in installed
cat /etc/systemd/journald.conf.d/reputation-oracle.conf
# Expected: [Journal] / SystemMaxUse=500M / SystemMaxFileSize=50M

# Verify journald has applied the caps
journalctl --disk-usage
# Expected: shows current usage; must not exceed 500M (on a fresh VPS, will be << 500M)
```

- [ ] `/etc/systemd/journald.conf.d/reputation-oracle.conf` contains SystemMaxUse=500M
- [ ] `journalctl --disk-usage` command succeeds (journald is running with new config)

---

## PKG-07: Update flow works without secret-file clobber

```bash
# Run update (requires network access to git remote)
sudo /opt/reputation-oracle/deploy/update.sh sepolia
# Expected: 4 step banners to stderr; timer returns to active; no errors

# Verify update.sh stopped then restarted the timer
# (If already running a live timer, the update itself is the test)
systemctl is-active reputation-oracle@sepolia.timer
# Expected: active

# Re-check env file was NOT touched by update
stat -c '%a %U %G' /etc/reputation-oracle/sepolia.env
# Expected: still 600 oracle oracle (update.sh never touches /etc/)
```

- [ ] `update.sh sepolia` exits 0
- [ ] Timer is `active` after update
- [ ] `/etc/reputation-oracle/sepolia.env` still has `600 oracle oracle` permissions after update

---

## PKG-08: Dry-run acceptance — valid RunSummary emitted

This is the primary acceptance gate for Phase 7.

```bash
# Run dry-run as oracle user
sudo -u oracle /usr/bin/node \
  --env-file /etc/reputation-oracle/sepolia.env \
  --import tsx /opt/reputation-oracle/bot/src/index.ts --dry-run
```

Capture and inspect the RunSummary:

```bash
# Extract and pretty-print RunSummary from stdout
sudo -u oracle /usr/bin/node \
  --env-file /etc/reputation-oracle/sepolia.env \
  --import tsx /opt/reputation-oracle/bot/src/index.ts --dry-run \
  | grep '"type":"RunSummary"' \
  | python3 -m json.tool
```

**Acceptance criteria:**

| Check | Command | Expected |
|-------|---------|----------|
| Exit code 0 | `echo $?` | `0` |
| RunSummary present | `grep '"type":"RunSummary"'` | at least one JSON line |
| itemsFetched > 0 | inspect RunSummary JSON | `itemsFetched` is a positive integer |
| chainId == 11155111 | inspect RunSummary JSON | `"chainId":11155111` |
| No fatal errors | `grep '"level":50\|"level":60' stderr output` | no output |
| No files written | `ls -la /tmp` before/after | no new files from the bot |

- [ ] Command exits with code 0
- [ ] RunSummary JSON line present in stdout
- [ ] `itemsFetched > 0` (Sepolia PGTCR list has items)
- [ ] `chainId == 11155111`
- [ ] No `level:50` (error) or `level:60` (fatal) in stderr NDJSON
- [ ] No files written to disk (bot remains stateless)

---

## Acceptance Sign-off

All items checked? The Sepolia VPS is ready for Phase 8 Observability.

**Before proceeding to Phase 8:**
- Timer is enabled and running: `systemctl is-active reputation-oracle@sepolia.timer` → `active`
- First live run logged: `journalctl -u reputation-oracle@sepolia -n 20`
- Dry-run RunSummary preserved for reference (optional: paste into Phase 8 kickoff notes)

For detailed operator procedures, see `deploy/RUNBOOK.md`.
