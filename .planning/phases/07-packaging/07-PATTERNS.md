# Phase 7: Packaging - Pattern Map

**Mapped:** 2026-04-23
**Files analyzed:** 8 (7 new, 1 modified)
**Analogs found:** 1 / 8 (codebase has no systemd, shell-deploy, or journald precedents)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `deploy/bootstrap.sh` | utility/script | batch | `.claude/hooks/gsd-validate-commit.sh` | structure-only |
| `deploy/update.sh` | utility/script | batch | `.claude/hooks/gsd-validate-commit.sh` | structure-only |
| `deploy/start-timer.sh` | utility/script | request-response | none | no analog |
| `deploy/systemd/reputation-oracle@.service` | config | event-driven | none | no analog |
| `deploy/systemd/reputation-oracle@.timer` | config | event-driven | none | no analog |
| `deploy/journald.conf.d/reputation-oracle.conf` | config | n/a | none | no analog |
| `deploy/RUNBOOK.md` | documentation | n/a | none | no analog |
| `bot/package.json` | config | n/a | `bot/package.json` (self) | exact — modify in place |

---

## Pattern Assignments

### `deploy/bootstrap.sh` (utility/script, batch)

**Analog:** `.claude/hooks/gsd-validate-commit.sh` — only for shell header and error-guard conventions. The functional content comes entirely from CONTEXT.md D-22/D-23 and STACK.md §1/§2.

**Shell header pattern** (from `.claude/hooks/gsd-validate-commit.sh` lines 1, 24):
```bash
#!/usr/bin/env bash
# description comment
set -euo pipefail
```

**No codebase analog for:** NodeSource install, useradd, chown, npm ci, systemctl daemon-reload, install -m 0600. Use research refs below.

**Canonical refs for implementation:**
- CONTEXT.md D-22 — shebang, strict mode, trap-on-ERR, step banners to stderr
- CONTEXT.md D-23 — exact 11-step order (load-bearing; oracle user must be created before any step referencing it)
- CONTEXT.md D-20 — idempotency guards per step
- STACK.md §1 — NodeSource Node 22 install commands (idempotent pattern)
- STACK.md §2 — `useradd --system --no-create-home --shell /usr/sbin/nologin oracle`

**Key patterns from CONTEXT.md to copy verbatim:**

Step banner pattern (D-22):
```bash
>&2 echo "[bootstrap] Step N: ..."
```

Trap-on-ERR pattern (D-22):
```bash
trap 'echo "[bootstrap] ERROR at step $CURRENT_STEP (line $LINENO): $BASH_COMMAND" >&2; exit 1' ERR
```

User-creation idempotency guard (D-08/D-23 step 3):
```bash
id oracle &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin oracle
```

Env file creation — create-if-missing only, never clobber (D-19):
```bash
if [ ! -f /etc/reputation-oracle/sepolia.env ]; then
  install -m 0600 -o oracle -g oracle /dev/null /etc/reputation-oracle/sepolia.env
  # append commented stub template
fi
```

Permissions assertion (D-17):
```bash
stat -c '%a %U %G' /etc/reputation-oracle/sepolia.env | grep -q '^600 oracle oracle' \
  || { echo "[bootstrap] ERROR: sepolia.env permissions check failed" >&2; exit 1; }
```

NodeSource Node 22 idempotency (D-02, STACK.md §1):
```bash
if ! node --version 2>/dev/null | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
```

Stub template keys (D-36) — mirror `bot/.env.example` exactly, add Phase 8 placeholders commented out:
```
CHAIN_ID=11155111
RPC_URL=
ROUTER_ADDRESS=
PGTCR_ADDRESS=0x3162df9669affa8b6b6ff2147afa052249f00447
SUBGRAPH_URL=
BOT_PRIVATE_KEY=
# TX_RECEIPT_TIMEOUT_MS=120000
# MIN_BALANCE_WEI=5000000000000000
# PINATA_JWT=
# PINATA_TIMEOUT_MS=30000
# LOG_LEVEL=info
# BETTERSTACK_SOURCE_TOKEN=      # Phase 8
# BETTERSTACK_HEARTBEAT_TOKEN=   # Phase 8
```

---

### `deploy/update.sh` (utility/script, batch)

**Analog:** structure-only from gsd-validate-commit.sh. Functional content from CONTEXT.md D-27.

**Shell header:** same as bootstrap.sh (`#!/usr/bin/env bash`, `set -euo pipefail`)

**Canonical ref:** CONTEXT.md D-27 — four-step sequence, trap pattern, instance argument, banner format.

**Instance-argument pattern (D-27):**
```bash
INSTANCE="${1:-sepolia}"
case "$INSTANCE" in
  sepolia|mainnet) ;;
  *) echo "[update] ERROR: unknown instance '$INSTANCE'. Use: sepolia | mainnet" >&2; exit 1 ;;
esac
```

**Step banner pattern (D-27):**
```bash
>&2 echo "[update:1/4] Stopping timer..."
systemctl stop "reputation-oracle@${INSTANCE}.timer"

>&2 echo "[update:2/4] git pull..."
sudo -u oracle git -C /opt/reputation-oracle pull --ff-only

>&2 echo "[update:3/4] npm ci..."
sudo -u oracle npm --prefix /opt/reputation-oracle/bot ci --omit=dev

>&2 echo "[update:4/4] Starting timer..."
systemctl start "reputation-oracle@${INSTANCE}.timer"
```

**Trap-on-ERR with recovery hint (D-27):**
```bash
on_error() {
  local exit_code=$1 line=$2 cmd=$3
  local timer_state
  timer_state=$(systemctl is-active "reputation-oracle@${INSTANCE}.timer" 2>/dev/null || echo "unknown")
  >&2 echo "[update] FAILED at line $line: $cmd (exit $exit_code)"
  >&2 echo "[update] Timer state: $timer_state"
  >&2 echo "[update] Recovery: rerun 'sudo ./deploy/update.sh $INSTANCE' or 'sudo systemctl start reputation-oracle@${INSTANCE}.timer'"
}
trap 'on_error $? $LINENO "$BASH_COMMAND"' ERR
```

**Success confirmation (D-27):**
```bash
>&2 echo "[update] Done. Timer state: $(systemctl is-active "reputation-oracle@${INSTANCE}.timer")"
```

---

### `deploy/start-timer.sh` (utility/script, request-response)

**Analog:** none in codebase.

**Canonical ref:** CONTEXT.md D-24, D-38.

**Pattern:** Accept instance arg (D-38 — instance-arg form preferred for Phase 9 reuse):
```bash
#!/usr/bin/env bash
set -euo pipefail
INSTANCE="${1:-sepolia}"
systemctl enable --now "reputation-oracle@${INSTANCE}.timer"
>&2 echo "[start-timer] Enabled and started reputation-oracle@${INSTANCE}.timer"
systemctl status "reputation-oracle@${INSTANCE}.timer" --no-pager
```

---

### `deploy/systemd/reputation-oracle@.service` (config, event-driven)

**Analog:** none in codebase. Pattern comes entirely from research.

**Canonical refs:**
- CONTEXT.md D-11/D-12/D-15 — authoritative directive list for Phase 7
- STACK.md §2 — full template with directive explanations
- ARCHITECTURE.md "systemd Unit Files" section — ExecStart pattern, EnvironmentFile placement

**Template per CONTEXT.md decisions (D-12, D-15):**
```ini
[Unit]
Description=Kleros Reputation Oracle (%i)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=no
User=oracle
Group=oracle
WorkingDirectory=/opt/reputation-oracle/bot
EnvironmentFile=/etc/reputation-oracle/%i.env
ExecStart=/usr/bin/node --import tsx /opt/reputation-oracle/bot/src/index.ts
StandardOutput=journal
StandardError=journal
SyslogIdentifier=reputation-oracle-%i
TimeoutStartSec=300
ProtectSystem=strict
PrivateTmp=true
NoNewPrivileges=true
```

**Critical notes:**
- `%i` is the systemd instance specifier — selects env file and syslog tag by instance name
- NO `Restart=` directive (D-14) — would thrash on 429s/systemic failures
- NO `ProtectHome=`, `MemoryMax=`, `CPUQuota=`, `ReadWritePaths=` (D-15) — PKG-05 minimum only
- NO `--env-file=` in ExecStart (STACK.md §3) — `EnvironmentFile=` makes it redundant
- `ExecStart=` uses absolute path `/usr/bin/node` not `node` — systemd does not use PATH

---

### `deploy/systemd/reputation-oracle@.timer` (config, event-driven)

**Analog:** none in codebase.

**Canonical refs:** CONTEXT.md D-13; STACK.md §2 timer template.

**Template per CONTEXT.md decisions (D-13):**
```ini
[Unit]
Description=Kleros Reputation Oracle timer (%i)

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
RandomizedDelaySec=60
Persistent=true
AccuracySec=30s
Unit=reputation-oracle@%i.service

[Install]
WantedBy=timers.target
```

**Critical notes:**
- `Persistent=true` — fires immediately on boot if a run was missed during VPS downtime
- `OnUnitActiveSec=` over `OnCalendar=` — monotonic, immune to DST/NTP jumps (STACK.md §2)
- `AccuracySec=30s` per CONTEXT.md D-13; STACK.md uses `1s` — use `30s` per CONTEXT.md (authoritative)

---

### `deploy/journald.conf.d/reputation-oracle.conf` (config)

**Analog:** none in codebase.

**Canonical ref:** CONTEXT.md D-25; STACK.md §4 "journald retention config".

**Template:**
```ini
[Journal]
SystemMaxUse=500M
SystemMaxFileSize=50M
```

**Note:** Drop-in location is `/etc/systemd/journald.conf.d/` — bootstrap copies it there (D-23 step 9) and runs `systemctl restart systemd-journald` (D-23 step 11).

---

### `deploy/RUNBOOK.md` (documentation)

**Analog:** no operator runbook exists in the codebase. `contracts/README.md` is the closest structural analog (operator-facing doc with commands).

**Canonical ref:** CONTEXT.md D-31 — explicit section list.

**Required sections (D-31):**
1. Fresh-VPS install (invoking bootstrap)
2. Secret fill procedure (nano `/etc/reputation-oracle/sepolia.env`, warn about bash history — P1-12)
3. First-run verification — the `--dry-run` acceptance test (D-29/D-30)
4. Enabling the timer (`start-timer.sh` or `systemctl enable --now`)
5. Update flow (points to `update.sh`)
6. Rollback sketch (`git reset --hard <prev> && npm ci --omit=dev && systemctl restart timer`)
7. Time-sync check (`timedatectl`)
8. Troubleshooting table: P1-02 (tsx missing), P1-05 (wrong perms), P1-07 (wrong Node path), P1-08 (journald silent drop)

**Acceptance test command (D-29):**
```bash
sudo -u oracle --preserve-env=HOME \
  env $(cat /etc/reputation-oracle/sepolia.env | xargs) \
  /usr/bin/node --import tsx /opt/reputation-oracle/bot/src/index.ts --dry-run
```

**Acceptance criteria (D-30):** exit 0, stdout contains `RunSummary` JSON with `itemsFetched > 0` and `chainId == 11155111`, stderr NDJSON has no `level:error` or `level:fatal`, no files written to disk.

---

### `bot/package.json` (config — modification only)

**Analog:** `bot/package.json` itself (exact current state shown below).

**Current state** (lines 17-31):
```json
"dependencies": {
    "graphql-request": "^7.4.0",
    "pino": "^10.3.1",
    "viem": "^2.47.0",
    "zod": "^4.3.6"
},
"devDependencies": {
    "@biomejs/biome": "^2.4.9",
    "@types/node": "^22.0.0",
    "pino-pretty": "^13.1.3",
    "tsx": "^4.21.0",
    "typescript": "^5.7.0",
    "vitest": "^4.1.2"
}
```

**Required change (D-04):** Move `tsx` from `devDependencies` to `dependencies`.

**Target state:**
```json
"dependencies": {
    "graphql-request": "^7.4.0",
    "pino": "^10.3.1",
    "tsx": "^4.21.0",
    "viem": "^2.47.0",
    "zod": "^4.3.6"
},
"devDependencies": {
    "@biomejs/biome": "^2.4.9",
    "@types/node": "^22.0.0",
    "pino-pretty": "^13.1.3",
    "typescript": "^5.7.0",
    "vitest": "^4.1.2"
}
```

No other `package.json` changes in Phase 7. `@logtail/pino` is Phase 8.

---

## Shared Patterns

### Bash Script Header (apply to all .sh files)

**Source:** CONTEXT.md D-22, D-27; confirmed by `.claude/hooks/gsd-validate-commit.sh` line 1
```bash
#!/usr/bin/env bash
set -euo pipefail
```

### Step Banners to stderr (apply to bootstrap.sh, update.sh)

**Source:** CONTEXT.md D-22
```bash
>&2 echo "[script-name] Step N: ..."
```
Not to stdout — stdout is reserved for machine-readable output.

### Trap-on-ERR (apply to bootstrap.sh, update.sh)

**Source:** CONTEXT.md D-22, D-27 — each script has a trap with human-readable failure message + exit 1.

### systemd Instance Specifier `%i` (apply to .service, .timer)

**Source:** CONTEXT.md D-11 — all paths and identifiers that vary by chain use `%i`. This is what makes the template reusable for Phase 9 Mainnet without any unit file changes.

---

## No Analog Found

All new files except `bot/package.json` have no close match in the codebase.

| File | Role | Reason |
|------|------|--------|
| `deploy/bootstrap.sh` | utility/script | No deploy or provisioning scripts exist in repo |
| `deploy/update.sh` | utility/script | No atomic-update scripts exist in repo |
| `deploy/start-timer.sh` | utility/script | No systemd helpers exist in repo |
| `deploy/systemd/reputation-oracle@.service` | config | No systemd units exist in repo |
| `deploy/systemd/reputation-oracle@.timer` | config | No systemd timers exist in repo |
| `deploy/journald.conf.d/reputation-oracle.conf` | config | No journald config exists in repo |
| `deploy/RUNBOOK.md` | documentation | No operator runbooks exist in repo |

**Planner action:** use research file patterns directly (CONTEXT.md decisions + STACK.md §1/§2/§4 templates). The templates in CONTEXT.md D-12, D-13, D-25 are authoritative over STACK.md where they differ (CONTEXT.md was written after and supersedes research defaults).

---

## Metadata

**Analog search scope:** all `.sh`, `.service`, `.timer`, `.conf` files in repo (excluding `node_modules/`, `contracts/lib/`)
**Files scanned:** 8 project files (3 GSD hook scripts, `bot/package.json`, `bot/.env.example`, 3 research docs)
**CONTEXT.md decisions:** D-01 through D-40 reviewed; D-04, D-08, D-11 through D-29, D-36 are directly load-bearing for implementation
**Pattern extraction date:** 2026-04-23
