# Kleros Reputation Oracle — Operator Runbook

**Target:** Ubuntu 24.04 VPS, Node 22 via NodeSource, systemd timer scheduling
**Managed via:** `deploy/bootstrap.sh` (install), `deploy/update.sh` (updates), `deploy/start-timer.sh` (enable)

---

## Table of Contents

1. [Fresh VPS Install](#1-fresh-vps-install)
2. [Secret Fill Procedure](#2-secret-fill-procedure)
3. [First-Run Verification (Dry Run)](#3-first-run-verification-dry-run)
4. [Enabling the Timer](#4-enabling-the-timer)
5. [Update Flow](#5-update-flow)
6. [Rollback](#6-rollback)
7. [Time Sync Check](#7-time-sync-check)
8. [Troubleshooting](#8-troubleshooting)
9. [Betterstack Setup](#9-betterstack-setup)
10. [Burn-in Gate Procedure](#10-burn-in-gate-procedure)

---

## 1. Fresh VPS Install

**Prerequisites:** Ubuntu 24.04 VPS, SSH access as root or sudo user.

**Two commands to a running-ready oracle:**

```bash
# Clone repo to standard location (root owns /opt/reputation-oracle initially)
sudo git clone https://github.com/kleros/reputation-oracle /opt/reputation-oracle

# Run bootstrap (creates oracle user, installs Node 22, sets up systemd, creates env stub)
cd /opt/reputation-oracle && sudo ./deploy/bootstrap.sh
```

Bootstrap is idempotent — safe to re-run if it fails partway through.

**What bootstrap does** (in order):
1. `apt update` + installs prerequisites (git, curl, ca-certificates)
2. Installs Node 22 LTS via NodeSource apt — skips if already v22 (uses `/usr/bin/node`, never nvm)
3. Creates `oracle` system user with no shell, no home — `useradd --system --no-create-home --shell /usr/sbin/nologin oracle`
4. Creates `/etc/reputation-oracle/` directory (mode 0755, root-owned)
5. Transfers repo ownership: `chown -R oracle:oracle /opt/reputation-oracle` (requires step 3)
6. Runs `npm ci --omit=dev` as oracle (installs production deps including `tsx` into `bot/node_modules/`)
7. Creates `/etc/reputation-oracle/sepolia.env` stub at mode 0600 owned oracle:oracle — skips if already exists (never clobbers)
8. Installs systemd unit files to `/etc/systemd/system/`
9. Installs journald retention drop-in to `/etc/systemd/journald.conf.d/`
10. Runs `systemctl daemon-reload`
11. Runs `systemctl restart systemd-journald` to apply retention caps (500 MB max)

**What bootstrap does NOT do:** Enable or start the timer. You explicitly enable it after dry-run validation (see §3 then §4).

---

## 2. Secret Fill Procedure

After bootstrap completes, fill the secrets stub with real values.

```bash
sudo -u oracle nano /etc/reputation-oracle/sepolia.env
```

**Required values to fill:**

| Key | Description |
|-----|-------------|
| `RPC_URL` | Sepolia RPC endpoint (e.g. Alchemy: `https://eth-sepolia.g.alchemy.com/v2/<your-api-key>`) |
| `ROUTER_ADDRESS` | Deployed KlerosReputationRouter proxy address on Sepolia — `0xc770c4F43f84c9e010aE0Ade51be914372B7Cc02` |
| `BOT_PRIVATE_KEY` | 0x-prefixed private key of the authorized bot signer |
| `SUBGRAPH_URL` | Goldsky subgraph endpoint — pre-filled stub default is correct for Sepolia |

**Leave unchanged:** `CHAIN_ID=11155111` and `PGTCR_ADDRESS=0x3162df9669affa8b6b6ff2147afa052249f00447` (pre-filled with correct Sepolia values).

**Phase 8 keys** (`BETTERSTACK_SOURCE_TOKEN`, `BETTERSTACK_HEARTBEAT_URL`, `HEARTBEAT_TIMEOUT_MS`) — leave commented out until Phase 8 Observability is set up (Betterstack account required).

**Values must be filled without surrounding quotes.** Correct: `RPC_URL=https://...`. Wrong: `RPC_URL="https://..."`.

> **WARNING: Never use `echo`, `cat`, or shell redirection to populate secret values.**
> Bash history captures every command — a `echo "BOT_PRIVATE_KEY=0x..."` entry in `~/.bash_history`
> is a permanent plaintext record of your private key (P1-12). Always edit directly via `nano` or `vim`.

Verify permissions after editing:

```bash
stat -c '%a %U %G' /etc/reputation-oracle/sepolia.env
# Expected output: 600 oracle oracle
```

If permissions are wrong, fix them:

```bash
sudo chmod 0600 /etc/reputation-oracle/sepolia.env
sudo chown oracle:oracle /etc/reputation-oracle/sepolia.env
```

---

## 3. First-Run Verification (Dry Run)

After filling secrets, run the bot in dry-run mode as the `oracle` user to confirm everything works before enabling the live timer.

```bash
sudo -u oracle /usr/bin/node \
  --env-file /etc/reputation-oracle/sepolia.env \
  --import tsx /opt/reputation-oracle/bot/src/index.ts --dry-run
```

**Acceptance criteria (all must hold):**

| Check | How to verify |
|-------|---------------|
| Exit code 0 | `echo $?` immediately after the command |
| `RunSummary` in stdout | Look for a JSON line with `"type":"RunSummary"` |
| `itemsFetched > 0` | Check `itemsFetched` field in the RunSummary JSON |
| `chainId == 11155111` | Check `chainId` field in the RunSummary JSON |
| No `level:50` or `level:60` in stderr | Level 50 = error, 60 = fatal in pino NDJSON |
| No files written to disk | Bot is stateless; verify `/tmp` is unchanged |

**Parsing the RunSummary:**

```bash
sudo -u oracle /usr/bin/node \
  --env-file /etc/reputation-oracle/sepolia.env \
  --import tsx /opt/reputation-oracle/bot/src/index.ts --dry-run \
  | grep '"type":"RunSummary"' | python3 -m json.tool
```

**If the dry run fails:** Check §8 Troubleshooting. Common causes: missing env var (config validation fails at startup), tsx not found (wrong Node path), permissions error (env file not readable by oracle).

---

## 4. Enabling the Timer

Once the dry run passes, enable the Sepolia timer:

```bash
sudo /opt/reputation-oracle/deploy/start-timer.sh sepolia
```

This calls `systemctl enable --now reputation-oracle@sepolia.timer`, which:
- Enables the timer to survive reboots (`WantedBy=timers.target`)
- Starts the first 15-minute countdown immediately (first run fires after `OnBootSec=2min`)

The script prints the timer status after enabling — verify the output shows `active (waiting)`.

**Verify the timer is active:**

```bash
systemctl status reputation-oracle@sepolia.timer
systemctl list-timers reputation-oracle@sepolia.timer
```

**Verify the first run completes (wait up to 2 minutes after enable):**

```bash
journalctl -u reputation-oracle@sepolia -f
# Wait for the first run to appear. Ctrl-C to stop following.
```

---

## 5. Update Flow

To deploy a new version:

```bash
sudo /opt/reputation-oracle/deploy/update.sh sepolia
```

This script atomically: stops the timer → `git pull --ff-only` → `npm ci --omit=dev` → starts the timer.

At most one scheduled run is skipped (less than 5 min gap). The stateless bot catches up fully on the next run — no action is missed because the bot recomputes the full diff on every run.

**If update.sh fails mid-sequence:** The script prints the timer state and a recovery hint. Re-run the same command — it is safe to retry:

```bash
sudo /opt/reputation-oracle/deploy/update.sh sepolia
```

If you only need to restore the timer after a partial failure:

```bash
sudo systemctl start reputation-oracle@sepolia.timer
```

---

## 6. Rollback

If a new version causes failures, roll back to the previous commit:

```bash
# Stop the timer first
sudo systemctl stop reputation-oracle@sepolia.timer

# Find the previous working commit
sudo -u oracle git -C /opt/reputation-oracle log --oneline -10

# Reset to it (replace <commit-hash> with the actual hash from the log above)
sudo -u oracle git -C /opt/reputation-oracle reset --hard <commit-hash>

# Reinstall deps for that version
sudo -u oracle npm --prefix /opt/reputation-oracle/bot ci --omit=dev

# Restart timer
sudo systemctl start reputation-oracle@sepolia.timer
```

Validate the rollback with a dry run (see §3) before relying on it for production.

---

## 7. Time Sync Check

The bot uses `Date.now()` for IPFS evidence timestamps. If the VPS clock drifts, evidence timestamps will be inaccurate.

```bash
timedatectl status
```

Expected output must show:
- `System clock synchronized: yes`
- `NTP service: active`

If NTP is not active:

```bash
sudo systemctl enable --now systemd-timesyncd
```

Verify again with `timedatectl status`.

---

## 8. Troubleshooting

### Common Failures

| Symptom | Likely cause | Diagnosis | Fix |
|---------|-------------|-----------|-----|
| `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'tsx'` | `tsx` was in devDependencies instead of dependencies — `npm ci --omit=dev` silently omitted it (P1-02) | `node -e "const p=JSON.parse(require('fs').readFileSync('/opt/reputation-oracle/bot/package.json','utf8')); console.log('tsx in deps:', 'tsx' in (p.dependencies\|\|{}))"` | `sudo -u oracle npm --prefix /opt/reputation-oracle/bot install tsx` then redeploy via `update.sh` |
| `stat /etc/reputation-oracle/sepolia.env` shows `644` or world-readable | Wrong permissions on env file (P1-05) | `stat -c '%a %U %G' /etc/reputation-oracle/sepolia.env` | `sudo chmod 0600 /etc/reputation-oracle/sepolia.env && sudo chown oracle:oracle /etc/reputation-oracle/sepolia.env` |
| Service fails with `No such file or directory: /home/oracle/.nvm/...` or nvm path | nvm Node used instead of system Node (P1-07) — nvm is invisible to systemd | `systemctl show reputation-oracle@sepolia.service \| grep ExecStart` — should show `/usr/bin/node` | Reinstall Node via NodeSource apt; ensure `ExecStart=/usr/bin/node` in unit file |
| `journalctl -u reputation-oracle@sepolia` returns empty or logs are truncated | journald retention cap not applied (P1-08) | `journalctl --disk-usage` and `cat /etc/systemd/journald.conf.d/reputation-oracle.conf` | Re-run bootstrap (steps 9-11 are idempotent): `sudo /opt/reputation-oracle/deploy/bootstrap.sh`, then `sudo systemctl restart systemd-journald` |
| Bot exits with `level:fatal` config error | Missing or malformed env var — zod schema validation fails | `sudo journalctl -u reputation-oracle@sepolia -n 30 -o cat` — look for the zod validation error message | Check `/etc/reputation-oracle/sepolia.env` — all required keys must be filled; values must have no surrounding quotes |
| Timer shows `inactive (dead)` instead of `active (waiting)` | Timer was never enabled | `systemctl is-enabled reputation-oracle@sepolia.timer` | `sudo /opt/reputation-oracle/deploy/start-timer.sh sepolia` |
| `permission denied` when running bootstrap.sh or update.sh | Script not run as root | `whoami` | Prefix the command with `sudo` |
| Dry-run exits non-zero with `ETIMEDOUT` or `ECONNREFUSED` | RPC_URL unreachable or rate-limited | Check `RPC_URL` value in env file; test with `curl -s -o /dev/null -w "%{http_code}" $RPC_URL` | Replace with a working RPC endpoint in `/etc/reputation-oracle/sepolia.env` |

### Useful Commands

```bash
# View recent runs (last 50 log lines)
journalctl -u reputation-oracle@sepolia -n 50

# Follow live output (current run or next scheduled run)
journalctl -u reputation-oracle@sepolia -f

# Structured JSON output (for Phase 8 log parsing)
journalctl -u reputation-oracle@sepolia -o json | head -5

# Check timer next scheduled fire time
systemctl list-timers reputation-oracle@sepolia.timer

# Check last run exit code (0 = success, 1 = systemic failure)
systemctl show reputation-oracle@sepolia.service | grep ExecMainStatus

# Check journald disk usage
journalctl --disk-usage

# Verify oracle user exists
id oracle

# Verify env file permissions (expected: 600 oracle oracle)
stat -c '%a %U %G' /etc/reputation-oracle/sepolia.env

# Check which Node binary systemd will use
systemctl show reputation-oracle@sepolia.service | grep ExecStart
```

---

## 9. Betterstack Setup

**Prerequisites:** Betterstack account (free tier sufficient for v1.2). Betterstack tokens must be filled in `/etc/reputation-oracle/sepolia.env` before the bot can forward logs or send heartbeats.

### 9.1 Telemetry Source (Log Forwarding)

1. Log in to [https://logs.betterstack.com](https://logs.betterstack.com)
2. Go to **Sources** → **Connect source** → Select **Node.js** (uses pino transport)
3. Copy the **Source token** shown on the configuration page
4. On the VPS: `sudo -u oracle nano /etc/reputation-oracle/sepolia.env`
   - Set `BETTERSTACK_SOURCE_TOKEN=<paste token here>`
   - Uncomment the line (remove leading `#`)
5. Restart the timer to apply: `sudo systemctl restart reputation-oracle@sepolia.timer`
6. Wait for the next scheduled run (within 5 minutes), then verify in Betterstack Logs that entries appear with `runId` and `chainId` fields.

**Filter by run:** In Betterstack Telemetry search bar, enter the `runId` UUID from a specific run (e.g. `a1b2c3d4-e5f6-7890-abcd-ef1234567890`).

**itemsFetched === 0 alert (OBS-08):**

Create an alert in Betterstack Telemetry to detect silent list-misconfiguration (5 consecutive empty runs):

1. In Betterstack Logs → **Alerts** → **New alert**
2. Alert type: **Threshold**
3. ClickHouse SQL query:
   ```sql
   SELECT count()
   FROM remote(t<source_id>_your_source_logs)
   WHERE JSONExtract(raw, 'summary.itemsFetched', 'Nullable(Int64)') = 0
     AND {{time}}
   ```
   Replace `<source_id>` with your source ID (visible in Betterstack → Sources → [source name] → Settings).
   > **Note:** If the query returns no results after live runs, the field path may differ. Try `raw LIKE '%itemsFetched%'` to confirm field is present, then adjust the JSONExtract path.
4. Threshold: >= **5** (five runs with 0 items fetched — D-24 revised threshold at 5-min cadence)
5. Confirmation period: **25 minutes** (5 runs x 5 min cadence)
6. Alert channel: email (PagerDuty/Slack deferred to v1.3)
7. Mute during burn-in (see §10)

### 9.2 Uptime Monitor (Heartbeat)

1. Log in to [https://uptime.betterstack.com](https://uptime.betterstack.com)
2. Go to **Monitors** → **New monitor** → Select **Heartbeat**
3. Configure:
   - **Name:** `reputation-oracle-sepolia`
   - **Expected heartbeat every:** `5` minutes (matches PKG-03 systemd timer cadence)
   - **Grace period:** `600` seconds (10 minutes = D-04; approximately 2 missed runs before alert)
4. Betterstack generates a heartbeat URL in the form: `https://uptime.betterstack.com/api/v1/heartbeat/<TOKEN>`
5. Copy the full URL
6. On the VPS: `sudo -u oracle nano /etc/reputation-oracle/sepolia.env`
   - Set `BETTERSTACK_HEARTBEAT_URL=<paste full URL here>`
   - Uncomment the line (remove leading `#`)
7. Restart the timer: `sudo systemctl restart reputation-oracle@sepolia.timer`
8. After the next run, verify in Betterstack Uptime that the monitor shows **Up** and the last heartbeat timestamp matches the run time.

**Alert channel:** Configure email alerts for the heartbeat monitor in Betterstack → Monitor → Edit → Escalation.

**Mute during burn-in:** In Betterstack Uptime, use the **Maintenance window** feature to suppress alerts during the 7-day burn-in period (§10). Remove the maintenance window after burn-in completes.

---

## 10. Burn-in Gate Procedure

**Purpose:** Validate that Phases 4+5+6+7+8 operate correctly end-to-end in production conditions before enabling the Mainnet timer (Phase 9). The gate is manual — an operator reviews the Betterstack dashboard and signs off.

**Duration:** 7 calendar days from the first successful heartbeat.

### 10.1 Gate Criteria

All of the following must be TRUE before enabling the Mainnet timer:

| # | Criterion | How to verify |
|---|-----------|---------------|
| B-01 | 7+ consecutive successful heartbeats (no `/fail` pings) | Betterstack Uptime → Monitor → History: 7+ green rows in a row |
| B-02 | Every log entry in Betterstack Telemetry has `runId` and `chainId` fields | Betterstack Logs → search `runId:*` — all runs should match |
| B-03 | No `systemicFailure` in any RunSummary during the burn-in period | Betterstack Logs → `systemicFailure:*` — should return empty |
| B-04 | `itemsFetched > 0` on all non-empty runs (subgraph reachable) | Betterstack Logs → `summary.itemsFetched:0` — zero matching entries outside intentionally empty runs |
| B-05 | No Betterstack Telemetry alert fired during the burn-in period | Betterstack Alerts → History — zero alerts |

### 10.2 Gate Sign-off

When all 5 criteria are met, document in the project state:

```
Phase 8 Sepolia burn-in complete.
Date: <YYYY-MM-DD>
First heartbeat: <runId of first successful run>
7-day window: <start date> -> <end date>
B-01: ✓ (N consecutive clean heartbeats)
B-02: ✓
B-03: ✓
B-04: ✓
B-05: ✓
Gate OPEN — Phase 9 Mainnet Cutover may proceed.
```

Paste this into `.planning/STATE.md` under **Decisions** or create a dedicated `.planning/phases/08-observability/08-BURN-IN.md` file.

### 10.3 If Gate Fails

If any criterion fails during the 7-day window:

1. Identify the failure from Betterstack logs (filter by `runId` of the failed run)
2. Fix the root cause in the code
3. Deploy the fix via `sudo /opt/reputation-oracle/deploy/update.sh sepolia`
4. **Restart the 7-day window** from the first clean heartbeat after the fix
5. Document the failure and fix in `.planning/STATE.md`

The Mainnet timer MUST NOT be enabled until 7 consecutive clean heartbeats are observed after the most recent fix.
