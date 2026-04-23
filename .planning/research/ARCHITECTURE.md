# Architecture Research

**Domain:** v1.2 Deploy-to-Mainnet — VPS packaging, Betterstack observability, Ethereum Mainnet
**Researched:** 2026-04-23
**Confidence:** HIGH (small codebase, direct code reading, verified external integration patterns)

---

## Existing Architecture (Fixed — Do Not Rearchitect)

```
┌─────────────────────────────────────────────────────────────────────┐
│  External Data Sources                                              │
│  ┌──────────────────────────────┐   ┌──────────────────────────┐   │
│  │ Goldsky Subgraph (GraphQL)   │   │ Pinata IPFS (REST)        │   │
│  └────────────────┬─────────────┘   └──────────────────────────┘   │
└───────────────────│──────────────────────────────────────────────── ┘
                    │
┌───────────────────▼──────────────────────────────────────────────── ┐
│  Bot (TypeScript, one-shot, Node 22)                                 │
│                                                                      │
│  index.ts ──► config.ts (zod v4)                                    │
│     │         logger.ts (pino v10 → stderr fd:2 NDJSON)             │
│     │                                                                │
│     ├──► subgraph.ts ──► fetchAllItems() [GraphQL, cursor pag.]     │
│     ├──► validation.ts ──► validateAndTransformItem()               │
│     ├──► chain.ts ──► readRouterStates() [Multicall3/viem v2]       │
│     ├──► diff.ts ──► computeActions() [pure function]               │
│     ├──► chain.ts ──► executeActions()                              │
│     │       ├──► ipfs.ts ──► uploadEvidenceToIPFS() [Pinata]        │
│     │       ├──► tx.ts ──► estimateGasWithRetry() / writeContract() │
│     │       └──► evidence.ts ──► buildPositiveEvidence/Negative     │
│     └──► flushAndExit(code) [pino callback flush → process.exit]    │
└──────────────────────────────────────────────────────────────────────┘
                    │
┌───────────────────▼──────────────────────────────────────────────── ┐
│  Router.sol (KlerosReputationRouter, UUPS proxy)                    │
│  submitPositiveFeedback / submitNegativeFeedback / revokeOnly        │
└───────────────────┬──────────────────────────────────────────────── ┘
                    │
┌───────────────────▼──────────────────────────────────────────────── ┐
│  8004 ReputationRegistry (external, on-chain)                       │
└──────────────────────────────────────────────────────────────────────┘
```

Key constraints that v1.2 must NOT break:
- stdout reserved for `--dry-run` JSON output; ALL logging goes to stderr
- `flushAndExit(code)` uses callback form `logger.flush(cb)` — pino v10 requirement
- Bot is one-shot: runs, diffs, executes, calls `flushAndExit`, exits
- No daemon, no state file, no DB
- Config is zod-parsed from `process.env` (injected by `--env-file` or systemd `EnvironmentFile`)

---

## Feature 1: VPS Packaging + systemd

### Bot Installation Layout

```
/opt/reputation-oracle/          # app root; owned by deploy user, not root
├── bot/
│   ├── src/                     # TypeScript source (deployed as-is)
│   ├── node_modules/            # npm ci --omit=dev output
│   └── package.json
├── contracts/                   # needed only for forge scripts; optional on runtime VPS
└── .git/                        # for git pull updates
```

Convention: `/opt/<name>/` is the standard path for self-managed services on Ubuntu. Not `/usr/local/` (OS-managed) or `/var/www/` (web convention). Bot runs as a dedicated system user (`reputation-oracle`), not root.

Secrets live separately from the app tree:

```
/etc/reputation-oracle/
└── sepolia.env     # mode 0600, owned by reputation-oracle user
```

Separation rationale: git pull never clobbers secrets; secrets never accidentally enter version control.

### Execution Model: tsx in Production (Recommended)

**Decision: Run from TypeScript source via `node --import tsx` in production.**

Rationale:
- `tsconfig.json` has `"noEmit": true` — tsc is type-check only, produces no JS output
- `package.json` start script already uses `node --env-file=.env --import tsx src/index.ts`
- tsx startup overhead is negligible for a one-shot bot (startup = compile + run, total ~200-400ms for this codebase)
- Adding a `dist/` build step requires changing tsconfig, adding build script, updating ExecStart — all for marginal gain
- One-shot semantics mean startup cost is amortized against total run time (typically 5-30s)
- Simpler update flow: `git pull` is the only artifact to update

If startup time becomes a concern in future (unlikely), switching to `node dist/index.js` requires only tsconfig `outDir` addition and a build step in the update runbook. UAML: keep tsx for v1.2.

**ExecStart pattern:**

```ini
ExecStart=/usr/bin/node --import tsx /opt/reputation-oracle/bot/src/index.ts
```

Node 22 must be installed at `/usr/bin/node` (via NodeSource apt repo, not nvm — nvm paths are user-specific and break systemd). tsx must be in `node_modules/.bin/tsx` which node resolves via `--import tsx` when run from the bot directory.

### systemd Unit Files

Two unit files required:

**`/etc/systemd/system/reputation-oracle-sepolia.service`**

```ini
[Unit]
Description=Kleros Reputation Oracle Bot (Sepolia)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=reputation-oracle
Group=reputation-oracle
WorkingDirectory=/opt/reputation-oracle/bot
EnvironmentFile=/etc/reputation-oracle/sepolia.env
ExecStart=/usr/bin/node --import tsx /opt/reputation-oracle/bot/src/index.ts
StandardOutput=journal
StandardError=journal
SyslogIdentifier=reputation-oracle-sepolia
TimeoutStartSec=300
```

**`/etc/systemd/system/reputation-oracle-sepolia.timer`**

```ini
[Unit]
Description=Run Kleros Reputation Oracle Bot every 15 minutes (Sepolia)

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
AccuracySec=30s
Unit=reputation-oracle-sepolia.service

[Install]
WantedBy=timers.target
```

Key design choices:
- `Type=oneshot` matches one-shot bot semantics; systemd waits for process exit before considering run complete
- `EnvironmentFile` injects secrets from 0600 file; no secrets in unit file (visible in `systemctl show`)
- `StandardError=journal` captures pino's stderr NDJSON into journald automatically
- `SyslogIdentifier` gives filterable unit name: `journalctl -u reputation-oracle-sepolia -f`
- `AccuracySec=30s` allows systemd to batch wake-ups; fine for non-real-time oracle

**Passing flags (--dry-run override via drop-in):**

`ExecStart=` in `[Service]` is not overridable by env vars — must use a drop-in file for ad-hoc overrides:

```bash
# One-time dry run
systemctl edit reputation-oracle-sepolia --runtime
# Add:
# [Service]
# ExecStart=
# ExecStart=/usr/bin/node --import tsx /opt/reputation-oracle/bot/src/index.ts --dry-run
```

The empty `ExecStart=` before the new one clears the inherited value (systemd list semantics). `--runtime` makes it temporary (lost on reboot). Normal operations never need `--dry-run` in the unit file.

### Bootstrap Sequence (Fresh VPS)

```
1. apt update && apt install -y nodejs npm git
   (or NodeSource: curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs)

2. useradd -r -s /bin/false -m -d /opt/reputation-oracle reputation-oracle

3. cd /opt && git clone <repo> reputation-oracle
   chown -R reputation-oracle:reputation-oracle /opt/reputation-oracle

4. cd /opt/reputation-oracle/bot && npm ci --omit=dev
   (installs pino, viem, graphql-request, zod — NOT tsx which is devDep)
   NOTE: tsx IS a devDep. Either promote to dep or install all deps: npm ci

5. mkdir /etc/reputation-oracle
   install -o reputation-oracle -g reputation-oracle -m 0600 /dev/null /etc/reputation-oracle/sepolia.env
   # populate: CHAIN_ID, RPC_URL, ROUTER_ADDRESS, PGTCR_ADDRESS, SUBGRAPH_URL,
   #           BOT_PRIVATE_KEY, PINATA_JWT, BETTERSTACK_SOURCE_TOKEN,
   #           BETTERSTACK_HEARTBEAT_URL, LOG_LEVEL=info

6. cp deploy/systemd/*.service deploy/systemd/*.timer /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now reputation-oracle-sepolia.timer
```

**tsx devDep issue:** `npm ci --omit=dev` will skip tsx, breaking ExecStart. Options:
- Move tsx to `dependencies` (cleanest — it's a runtime necessity in this deployment model)
- OR run `npm ci` (installs all deps, larger node_modules)
- OR compile to dist/ and use `node dist/index.js` (adds build step)

Recommendation: move tsx to `dependencies` in `package.json`. It is already a runtime requirement.

### Update Flow

```bash
cd /opt/reputation-oracle
git pull origin master
cd bot && npm ci --omit=dev
systemctl restart reputation-oracle-sepolia.timer
```

No blue/green needed. Bot is stateless — a skipped timer cycle just means one delayed sync (typically <15min of lag). Downtime during update is acceptable. If a run was in progress when `restart` is called, systemd sends SIGTERM → bot's `handleSignal` sets `shutdownHolder.shutdown = true` → current tx completes → loop exits → `flushAndExit(0)`.

---

## Feature 2: Betterstack Observability

### Two Separate Betterstack Products

| Product | Purpose | Integration Point |
|---------|---------|------------------|
| Betterstack Logs (Telemetry) | Forward structured NDJSON logs | pino transport → HTTPS POST |
| Betterstack Uptime | Detect missed runs, alert on failure | HTTP ping from bot after success |

### 2a. Log Forwarding — Betterstack Logs

**Transport approach: `@logtail/pino` npm package.**

The package uses `pino.transport()` with a worker thread that POSTs NDJSON to Betterstack's ingest endpoint. This runs in a separate worker thread — the main thread writes to the transport synchronously (from its perspective), the worker batches and ships.

**Worker thread + process.exit interaction (critical):**

Pino's transport system hooks `process.on('beforeExit')` and `process.on('exit')` to synchronously flush the worker thread stream via `thread-stream`'s `.end()`. This means the existing `flushAndExit` pattern (callback form) still handles stderr flushing correctly. The worker thread flush is automatic on exit, BUT there is a documented risk: if `process.exit()` is called while the worker has not yet drained its buffer, some logs may be lost.

**Mitigation:** The existing `flushAndExit` callback fires after pino's internal stderr stream is flushed. The worker thread for the Betterstack transport is a separate concern. To ensure both flush before exit, the transport must be waited on.

**Recommended pattern for `logger.ts`:**

```typescript
// Two transports: stderr (local/journald) + Betterstack (remote)
// Token presence determines whether remote transport is active

const targets: pino.TransportTargetOptions[] = [
  { target: "pino/file", options: { destination: 2 }, level: "debug" }, // stderr always
];

if (process.env.BETTERSTACK_SOURCE_TOKEN) {
  targets.push({
    target: "@logtail/pino",
    options: {
      sourceToken: process.env.BETTERSTACK_SOURCE_TOKEN,
      options: { endpoint: "https://in.logs.betterstack.com" },
    },
    level: "info",
  });
}

const transport = targets.length > 1 ? pino.transport({ targets }) : pino.destination(2);
export const logger = pino({ level: "info", ... }, transport);
```

**Key constraint:** `BETTERSTACK_SOURCE_TOKEN` absent → transport array has one entry → `pino/file` to stderr → behavior identical to today. Token present → two transports active. Dev/local/dry-run modes unaffected.

**Flush before exit with multi-transport:**

When using `pino.transport()`, the returned stream object has a `.end()` method. Change `flushAndExit` to:

```typescript
function flushAndExit(code: number): void {
  // For pino.transport() (worker-thread transports), use stream.end()
  // For pino.destination() (direct fd), use logger.flush(cb)
  // The transport stream returned by pino.transport() handles worker drain on .end()
  if (transport && typeof (transport as NodeJS.WritableStream).end === "function") {
    (transport as NodeJS.WritableStream).end(() => process.exit(code));
  } else {
    logger.flush(() => process.exit(code));
  }
}
```

In practice: keep the transport reference in module scope of `logger.ts`, export a `closeLogger(cb)` function that calls `transport.end(cb)` when a transport exists, or `logger.flush(cb)` for direct destination. `index.ts` calls `closeLogger(() => process.exit(code))`.

**New config fields:**

```typescript
BETTERSTACK_SOURCE_TOKEN: z.string().optional(), // absent = no remote log forwarding
```

**New dependency:**

```bash
npm install @logtail/pino
```

### 2b. Heartbeat — Betterstack Uptime

Betterstack Uptime heartbeat pattern:
- Create a "Heartbeat Monitor" in Betterstack UI → get unique URL: `https://uptime.betterstack.com/api/v1/heartbeat/<TOKEN>`
- Bot pings this URL on successful completion
- Betterstack waits `period + grace_period`; if no ping → incident created → alert sent
- Explicit failure ping: `<HEARTBEAT_URL>/fail` (Betterstack creates incident immediately)

**Where the ping fires in `index.ts`:**

```
main():
  ...
  emitSummary(summary, startTime)
  await pingHeartbeat(config, summary.systemicFailure)  // NEW: before flushAndExit
  closeLogger(() => process.exit(summary.systemicFailure ? 1 : 0))
```

`pingHeartbeat(config, isFailure)`:
- If `BETTERSTACK_HEARTBEAT_URL` absent: no-op (dev mode)
- If `isFailure`: ping `<URL>/fail` (explicit failure signal)
- If success: ping `<URL>` (success signal)
- Use `fetch()` with 5s timeout (native Node 22 fetch)
- On ping failure: `logger.warn("heartbeat ping failed", { err })` — log and swallow. Never let a Betterstack outage cause systemic failure of the bot itself.

**New config fields:**

```typescript
BETTERSTACK_HEARTBEAT_URL: z.string().url().optional(), // absent = no heartbeat
```

**Grace period recommendation:** Set Betterstack heartbeat period to 15min (matches timer), grace period to 5min. If the bot takes longer than 20min total (period + grace), an alert fires. Normal bot runs take 5-30s; this gives ample headroom while catching genuinely missed runs (VPS crash, timer disabled, etc.).

**Missed run detection:** Betterstack detects the miss automatically when no ping arrives within period + grace. No active polling needed from the bot. If the VPS is down, systemd never runs the bot, no ping sent, Betterstack alerts.

### `runId` for Log Correlation

The bot currently logs at the run level without a per-run correlation ID. Adding a `runId` field to every log line simplifies Betterstack log queries when investigating a specific run.

```typescript
// index.ts: generate once at startup
const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const log = logger.child({ runId });
```

Pass `log` (child logger) through `executeActions` instead of importing the root logger. All log lines in a run share `runId`. `RunSummary` includes `runId`. Betterstack query: `runId = "abc123"` shows all logs for that run.

This is a NEW addition — `runId` does not currently exist in the codebase.

### Journald Integration

pino writes to stderr (fd:2). systemd's `StandardError=journal` captures all stderr as journald entries. No pino-journald binding needed. `SyslogIdentifier` tags entries for filtering. Log lines arrive as raw text in journald (NDJSON strings) — journald does not parse JSON fields, but `journalctl --output=json` exposes `MESSAGE` containing the NDJSON line, which Betterstack's ingest can parse.

For structured journald fields from NDJSON, a `pino-journald` transport would be needed — but that adds complexity without clear value since Betterstack parses JSON directly from the transport stream. Not recommended.

---

## Feature 3: Ethereum Mainnet Support

### Registry Addresses (CONFIRMED via erc-8004-contracts repo)

Mainnet addresses differ from Sepolia:

| Registry | Sepolia | Mainnet |
|----------|---------|---------|
| ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |

Source: erc-8004/erc-8004-contracts GitHub (HIGH confidence).

Deploy.s.sol currently has Sepolia addresses hardcoded as constants. These must be parameterized.

### Config — No Chain-ID Branching in Bot

`CHAIN_ID` already exists in config (`z.coerce.number().int().positive()`). All other chain-specific values (`RPC_URL`, `ROUTER_ADDRESS`, `PGTCR_ADDRESS`, `SUBGRAPH_URL`) are already env-var driven. Chain-ID-based branching is NOT needed in bot code. The bot is chain-agnostic — env vars fully determine chain context.

Mainnet config is a second `EnvironmentFile` (`mainnet.env`) with mainnet values for all vars. One bot codebase, two systemd service instances.

### Deploy.s.sol Parameterization

Current: `REPUTATION_REGISTRY` and `IDENTITY_REGISTRY` are hardcoded constants inside `Deploy.s.sol`.

Required change: read from env or compute from `CHAIN_ID`:

```solidity
// Option A: env vars (simplest, matches existing pattern)
address reputationRegistry = vm.envAddress("REPUTATION_REGISTRY");
address identityRegistry = vm.envAddress("IDENTITY_REGISTRY");

// Option B: chain-id-based lookup map (more robust, no extra env vars)
address reputationRegistry = block.chainid == 1
    ? 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
    : 0x8004B663056A597Dffe9eCcC1965A193B7388713;
```

Recommendation: Option B (chain-id-based) — self-documenting, no operator error risk, both addresses are known constants. Mainnet chainId = 1.

### Foundry Mainnet Config

`foundry.toml` currently has one fork profile:

```toml
[profile.fork]
eth_rpc_url = "${SEPOLIA_RPC_URL}"
```

Add:

```toml
[profile.mainnet-fork]
eth_rpc_url = "${MAINNET_RPC_URL}"
```

Mainnet deploy command:

```bash
forge script script/Deploy.s.sol \
  --rpc-url $MAINNET_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

`Verify.s.sol` from v1.0 Phase 3 works unchanged — pass `--rpc-url $MAINNET_RPC_URL`.

### Mainnet Safety Guard (Bot)

Risk: bot misconfigured with Mainnet RPC but wrong router (e.g. Sepolia router address). On mainnet, contract call fails at gas estimation, not silently. The stateless diff means worst case is no actions executed. Still, a safety assertion is useful:

```typescript
// config.ts: validate CHAIN_ID matches expected for production
// Not a hard-coded check — operator sets CHAIN_ID. The guard is documentation + logging.
if (config.CHAIN_ID === 1) {
  logger.warn({ chainId: 1 }, "Running on Ethereum Mainnet");
}
```

No `--i-know-this-is-mainnet` flag needed — adds friction without safety. CHAIN_ID=1 in the env file is the explicit opt-in. A clear warn log at startup provides the audit trail.

### Rollback Considerations

- UUPS proxy: if mainnet Router impl has a bug, upgrade via `upgradeToAndCall()` from owner wallet. Idempotent deploy script handles re-registration checks.
- If Identity is mis-registered (wrong `klerosAgentId`): the Router's `klerosAgentId` is set once in `initialize()`. If wrong, must deploy a new proxy. Pre-deployment verification of `KLEROS_AGENT_URI` and `BOT_ADDRESS` is critical.
- Mainnet bot wallet: a separate private key from Sepolia (different `BOT_PRIVATE_KEY` in mainnet.env). Prevents accidental cross-contamination.

---

## Component Boundaries — New vs Modified

### New Components

| Component | File | What |
|-----------|------|------|
| Betterstack log transport | `bot/src/logger.ts` | Add `pino.transport({ targets })` with conditional `@logtail/pino` target |
| Heartbeat ping | `bot/src/index.ts` | `pingHeartbeat()` async function, called after `emitSummary`, before `closeLogger` |
| Logger close export | `bot/src/logger.ts` | `closeLogger(cb: () => void): void` — replaces `flushAndExit`'s direct `logger.flush()` call |
| runId child logger | `bot/src/index.ts` | Generate `runId` at startup, pass child logger to `executeActions` |
| Mainnet env file | `mainnet.env.example` | Template for mainnet secrets |
| systemd units (Sepolia) | `deploy/systemd/reputation-oracle-sepolia.{service,timer}` | New files |
| systemd units (Mainnet) | `deploy/systemd/reputation-oracle-mainnet.{service,timer}` | New files |
| Bootstrap runbook | `docs/deploy-vps.md` | Step-by-step VPS setup |

### Modified Components

| Component | File | Change |
|-----------|------|--------|
| Config | `bot/src/config.ts` | Add `BETTERSTACK_SOURCE_TOKEN`, `BETTERSTACK_HEARTBEAT_URL` (both optional) |
| Dependencies | `bot/package.json` | Move tsx to `dependencies`; add `@logtail/pino` to `dependencies` |
| Deploy script | `contracts/script/Deploy.s.sol` | Parameterize registry addresses by chainId |
| Foundry config | `contracts/foundry.toml` | Add `[profile.mainnet-fork]` profile |
| Contracts README | `contracts/README.md` | Add mainnet deployed addresses |

### Unchanged Components

`subgraph.ts`, `validation.ts`, `chain.ts`, `diff.ts`, `evidence.ts`, `ipfs.ts`, `tx.ts`, `types.ts`, `Verify.s.sol`, `Upgrade.s.sol`, all tests.

---

## Data Flow — v1.2 Full Picture

```
systemd timer fires (every 15min)
  │
  ▼
node --import tsx bot/src/index.ts
  │  EnvironmentFile injects: CHAIN_ID, RPC_URL, ROUTER_ADDRESS, PGTCR_ADDRESS,
  │  SUBGRAPH_URL, BOT_PRIVATE_KEY, PINATA_JWT, LOG_LEVEL, BETTERSTACK_SOURCE_TOKEN,
  │  BETTERSTACK_HEARTBEAT_URL
  │
  ▼
logger.ts creates pino instance:
  - Always: pino/file transport → stderr (fd:2) → journald
  - If BETTERSTACK_SOURCE_TOKEN present: @logtail/pino transport → HTTPS POST → Betterstack Logs
  │
  ▼
main(): runId generated → child logger created with { runId }
  │
  ▼
[existing diff pipeline: fetchAllItems → validate → readRouterStates → computeActions]
  │
  ▼
executeActions() → [IPFS uploads → on-chain txs, existing logic unchanged]
  │
  ▼
emitSummary() → logs RunSummary NDJSON line (runId included via child logger)
  │
  ▼
pingHeartbeat():
  - systemicFailure? → fetch(BETTERSTACK_HEARTBEAT_URL + "/fail", timeout:5s)
  - success?         → fetch(BETTERSTACK_HEARTBEAT_URL, timeout:5s)
  - absent token?    → no-op
  - ping fails?      → logger.warn, swallow
  │
  ▼
closeLogger(() => process.exit(code)):
  - transport.end(cb) if multi-transport (drains worker thread buffers)
  - logger.flush(cb) if single destination
  │
  ▼
process.exit(0 or 1)
journald captures final NDJSON lines
Betterstack Logs receives buffered lines via worker thread drain
```

---

## Build Order (Phase → Phase Dependencies)

```
Phase 7: Packaging (systemd + VPS runbook)
  - No bot code changes. Pure infra and docs.
  - Unblocks Phase 8: gives real runtime environment for observability testing.
  - Dependency: none (can start immediately).

Phase 8: Observability (Betterstack Logs + Uptime)
  - Modifies: logger.ts, config.ts, index.ts (heartbeat), package.json
  - Requires: Phase 7 (real VPS to validate Betterstack ingest and heartbeat)
  - Must validate logger changes don't regress --dry-run stdout behavior
  - Unblocks Phase 9: gives runtime telemetry when mainnet traffic starts.

Phase 9: Mainnet (Router deploy + bot config + runbook)
  - Modifies: Deploy.s.sol (registry addresses), foundry.toml (profile), contracts/README.md
  - New: mainnet.env.example, deploy/systemd/reputation-oracle-mainnet.{service,timer}
  - Requires: Phase 7 (systemd model is established), Phase 8 (observability online before first mainnet run)
  - Bot code changes: minimal (logger warn for CHAIN_ID=1, no logic changes)
  - Contract deploy is a one-shot external operation (not automated).
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Betterstack Transport Active in --dry-run

**What:** Remote log transport fires during `--dry-run`, polluting Betterstack logs with non-production runs.
**Why bad:** Noise in production log stream; may trigger false alerts; dev activity mixed with prod metrics.
**Instead:** Check `process.argv.includes("--dry-run")` before constructing transport targets. If dry-run, use stderr-only transport regardless of token presence. OR rely on `LOG_LEVEL=debug` being absent in prod env — dry-run is a dev-only mode.

### Anti-Pattern 2: Heartbeat Ping Before Final Log Flush

**What:** Ping Betterstack Uptime, then `closeLogger()`. Some log lines not yet delivered when heartbeat fires.
**Why bad:** Betterstack may show "success" heartbeat but Betterstack Logs missing the RunSummary line — confusing correlation.
**Instead:** `pingHeartbeat()` → `closeLogger(cb)` — logs flush AFTER ping. The ping is a signal the run completed; logs may arrive slightly later due to HTTP batching, which is fine.

### Anti-Pattern 3: Hardcoded Registry Addresses in Deploy.s.sol

**What:** Separate copies of Deploy.s.sol per chain (Deploy.sepolia.sol, Deploy.mainnet.sol).
**Why bad:** Drift between files; double maintenance; easy to deploy wrong one.
**Instead:** Single Deploy.s.sol with chain-ID-based address selection. One source of truth.

### Anti-Pattern 4: nvm for Node Installation on VPS

**What:** Install nvm in user profile, use nvm-managed node in ExecStart.
**Why bad:** nvm paths are shell-session-relative; systemd services don't source user profile; `ExecStart=/home/user/.nvm/versions/node/v22.x.x/bin/node` breaks on nvm version change.
**Instead:** NodeSource apt repository → system-wide `/usr/bin/node`. Clean, predictable, system-managed.

### Anti-Pattern 5: tsx as devDependency in Production

**What:** `npm ci --omit=dev` on VPS, then `ExecStart` invokes tsx.
**Why bad:** tsx not installed → ExecStart fails at runtime.
**Instead:** Move tsx to `dependencies` OR switch to compiled JS. See Packaging section.

---

## Sources

- Existing codebase (`bot/src/*.ts`, `contracts/script/Deploy.s.sol`) — HIGH confidence (direct read)
- Betterstack Logs pino transport: https://betterstack.com/docs/logs/javascript/pino/ — MEDIUM confidence (docs lack v10 specifics)
- `@logtail/pino` npm package: https://www.npmjs.com/package/@logtail/pino — MEDIUM confidence
- Betterstack Uptime heartbeat: https://betterstack.com/docs/uptime/cron-and-heartbeat-monitor/ — HIGH confidence (direct doc read)
- pino transport worker thread flush: https://adventures.nodeland.dev/archive/solving-the-exit-problem-of-pino-transports-and/ — HIGH confidence
- pino transports.md: https://github.com/pinojs/pino/blob/main/docs/transports.md — HIGH confidence
- ERC-8004 contract addresses: https://github.com/erc-8004/erc-8004-contracts — HIGH confidence (direct repo read)
- systemd EnvironmentFile patterns: https://oneuptime.com/blog/post/2026-03-02-how-to-configure-systemd-service-environment-files-on-ubuntu/view — MEDIUM confidence
- tsx vs tsc production: https://betterstack.com/community/guides/scaling-nodejs/tsx-vs-ts-node/ — MEDIUM confidence

---
*Architecture research for: Kleros Reputation Oracle v1.2 Deploy-to-Mainnet*
*Researched: 2026-04-23*
