# Feature Landscape: v1.2 Deploy-to-Mainnet

**Domain:** VPS packaging + observability + Ethereum Mainnet (one-shot blockchain bot)
**Researched:** 2026-04-23
**Confidence:** HIGH (systemd/packaging, Betterstack patterns); MEDIUM (Mainnet dry-run conventions); HIGH (anti-features derived from explicit project constraints)
**Scope:** NEW features only — v1.0/v1.1 core already shipped; see `.planning/milestones/v1.1-research/FEATURES.md`

---

## A. Packaging & VPS Deployment

### Table Stakes

Features any dev expects when "productionizing" a one-shot Node bot on a bare Ubuntu VPS.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Idempotent bootstrap script | Re-running setup on the same VPS must not break it; ops requirement for disaster recovery and onboarding | LOW | `apt-get install -y` is idempotent; `useradd --system` errors if user exists — guard with `id oracle \|\| useradd ...` |
| Dedicated service-account user | Bot runs as non-root with no shell; standard security baseline for any daemon/timer | LOW | `useradd --system --no-create-home --shell /usr/sbin/nologin oracle`; service unit specifies `User=oracle` |
| `EnvironmentFile` secret injection | Secrets never in unit file (visible via `systemctl show`), never in shell history, never in code | LOW | `/etc/reputation-oracle/env` at mode 0600 owned root:root; node `--env-file` removed from ExecStart (redundant with EnvironmentFile); zod validates at startup |
| journald log capture | NDJSON to stderr is journald-native; `journalctl -u reputation-oracle` gives full run history without extra tooling | LOW | pino already writes to stderr (fd 2); journald captures automatically; no logrotate needed |
| journald retention cap | Unbounded journals fill disk on long-lived VPS | LOW | `/etc/systemd/journald.conf`: `SystemMaxUse=500M`, `SystemMaxFileSize=50M`; at 15-min cadence bot produces < 1MB/day |
| Systemd sandboxing directives | `ProtectSystem=strict`, `PrivateTmp=true`, `NoNewPrivileges=true` — baseline for any systemd service | LOW | All available on Ubuntu 22.04 (systemd 249); add `MemoryMax=512M`, `CPUQuota=50%` as resource ceiling |
| Config-only backup story | Bot is stateless — nothing to back up except the env file and unit files | LOW | Runbook documents `cp /etc/reputation-oracle/env ~/backup.env` pre-upgrade; no DB snapshots, no chain state |
| Network dependency guard | Bot makes external calls to subgraph + RPC + Pinata; must not fire before network is up | LOW | `After=network-online.target` + `Wants=network-online.target` in `[Unit]`; prevents silent failures on VPS reboot |

### Differentiators

Patterns specific to blockchain bots and one-shot workloads that generic Node deploy guides miss.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| `Persistent=true` on timer | If VPS reboots mid-interval, timer fires immediately on boot-up rather than waiting a full 15-min cycle — prevents a missed sync window during maintenance | LOW | Already in STACK.md unit template; zero code change |
| `RandomizedDelaySec=60` | Prevents thundering-herd on shared VPS restarts (multiple services starting simultaneously) | LOW | Adds up to 60s jitter on boot; no effect on normal timer cadence |
| `OnUnitActiveSec=` over `OnCalendar=` | Monotonic timer immune to DST/NTP jumps — a blockchain bot syncing at precise wall-clock times can drift after clock corrections | LOW | `OnCalendar=` is fine for daily jobs; for 15-min intervals monotonic is cleaner |
| `RemainAfterExit=no` explicitly set | Type=oneshot defaults to RemainAfterExit=no, but explicit is self-documenting; timer requires service to reach "inactive" state to re-trigger | LOW | Prevents operator confusion when reading unit file |
| Deploy runbook covers first-run verification | Blockchain bots have an asymmetric failure mode: silently no-op if misconfigured (wrong list address, wrong chain) rather than crash | MEDIUM | Runbook step: after first run, `journalctl -u reputation-oracle -n 50` and verify `itemsFetched > 0`, `actionsComputed >= 0` in run-summary log line |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Docker / Compose | Explicit project decision; adds registry, image build pipeline, and `docker run` wrapping to a 1-file one-shot bot | bare Node 22 + systemd timer |
| pm2 | pm2 is a daemon manager for long-running processes; one-shot bot exits after each run — pm2 "restart" semantics conflict with stateless design | systemd timer with `Type=oneshot` |
| Kubernetes / Helm | Vastly over-engineered for a single-VPS one-bot workload; no horizontal scaling benefit for a stateless diff-and-exit job | systemd timer |
| Ansible / Terraform | Single VPS; a shell runbook is auditable, portable, and requires no control-plane infra | shell runbook (`bootstrap.sh`) |
| Complex secret managers (Vault, AWS SSM) | Attack surface exceeds benefit for a single-secret-file threat model; process exits in seconds | EnvironmentFile 0600 |
| `LoadCredential=` in v1.2 | Requires app-code refactor (read from `$CREDENTIALS_DIRECTORY/` files); deferred to v1.3 | EnvironmentFile (agreed user decision) |
| Health-check HTTP endpoint | Bot is one-shot, not a server; no persistent listener to expose | outbound heartbeat ping to Betterstack Uptime |
| nvm / asdf on VPS | Per-user version managers; awkward in systemd unit paths; no benefit for single fixed version | NodeSource apt repo for Node 22 |
| `dotenv` npm package | Node 22 native `--env-file` + systemd `EnvironmentFile=` replace it entirely | built-in Node 22 env loading |

---

## B. Observability (Betterstack Telemetry + Uptime)

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Structured log fields on every line | Aggregators (Betterstack Telemetry) pattern-match on fields, not freetext; `runId`, `chain`, `level`, `msg` are the minimum | LOW | pino child loggers already propagate context; add `runId` (UUID or timestamp) at process start in `index.ts`; `chain` = `chainId` from config |
| Run-level summary log line | Single parseable JSON object at end of run: `itemsFetched`, `actionsComputed`, `txsSent`, `txsSucceeded`, `errors`, `durationMs` | LOW | Already planned in v1.1 differentiators — promote to table stakes for v1.2 since Betterstack alerting will pattern-match it |
| Exit-code-aware heartbeat ping | Betterstack Uptime needs to know success vs failure per run; `/heartbeat/<token>/0` vs `/heartbeat/<token>/1` | LOW | Native `fetch()` with 3s `AbortSignal.timeout()`; called in `flushAndExit()` before `process.exit`; non-fatal if ping itself fails |
| Missed-timer alerting | Betterstack alerts when no heartbeat arrives within grace period; operators discover silent cron failures | LOW | Configure in Betterstack UI: grace period = 20 min (15-min interval + 5-min slack); email/PagerDuty alert channel |
| Log forwarding via `@logtail/pino` | pino multi-transport sends NDJSON to both stderr (journald) and Betterstack Telemetry simultaneously | LOW | `@logtail/pino@^0.5.8`; conditional on `BETTERSTACK_SOURCE_TOKEN` env var being set; local dev skips Betterstack transport |
| Betterstack log search on error | Operators can search `level:error` or `runId:<uuid>` in Betterstack UI to investigate a specific failed run | LOW | No code work; follows from structured log fields above |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| `txHash` in every tx-related log line | Enables log-to-Etherscan deep-link in Betterstack (paste hash into search); significantly shortens MTTR for tx investigation | LOW | Already emitted by chain.ts in v1.1; just ensure it propagates to Betterstack — no new code |
| `agentId` in every action-scoped log | Filter Betterstack logs by `agentId` to trace one agent's feedback history across runs | LOW | pino child logger per action already sets this in v1.1 |
| Gas used per tx in run summary | `gasUsed` per action enables cost tracking; ROI dashboard: ETH spent per reputation signal | LOW | `receipt.gasUsed` already available after `waitForTransactionReceipt`; add to per-action log and run summary |
| Systemic-failure log entry before exit | Log `level:fatal` with `reason` field before exiting 1; Betterstack can alert on `level:fatal` as a secondary trigger independent of missed heartbeat | LOW | Requires adding `logger.fatal({ reason })` before `flushAndExit(1)` in the systemic-failure path |
| `runId` correlation across log lines | UUID per run threads every log line from subgraph fetch → diff → IPFS upload → tx → summary; enables per-run trace in Betterstack | LOW | Generate once at process start: `const runId = crypto.randomUUID()`; set on root logger as `logger = logger.child({ runId })` |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Self-hosted log infra (ELK, Loki) | Ops overhead exceeds value for a single-bot workload; maintenance distraction | Betterstack Telemetry free tier (3 GB/month, ample) |
| Prometheus + Grafana (self-hosted) | Custom metrics backend requires persistent server, scrape config, alertmanager — enormous ops surface for 4 metrics | log-derived metrics in Betterstack dashboard (parse `durationMs`, `gasUsed` from NDJSON) |
| Sentry APM | Sentry's value is stack traces for long-lived web apps; one-shot bot errors are in the log with full context already | pino structured logs + Betterstack search |
| Pino-pretty in production | Adds overhead, defeats aggregator parsing; pretty logs in production means freetext instead of NDJSON | `LOG_PRETTY=true` dev-only, never in systemd unit |
| Per-action heartbeat pings | Betterstack Uptime is run-level; per-action pings would require a different monitor type and don't map to the one-shot model | single ping per run in `flushAndExit()` |
| Alert on every log error | Error-rate alerts require baseline tuning to avoid noise; per-item errors (IPFS failure, gas revert) are isolated and expected | alert only on `level:fatal` (systemic) or missed heartbeat |

---

## C. Ethereum Mainnet Support

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Router UUPS deployment on Mainnet | The contract must exist on Mainnet with correct PGTCR list, Kleros v1 Arbitrator, and Mainnet ReputationRegistry wired in | MEDIUM | Foundry Deploy.s.sol already works; swap `--rpc-url` + addresses; requires verification of ERC-8004 Mainnet addresses before deploy |
| Kleros 8004 Identity Mainnet registration | Router proxy address must be registered as `clientAddress` in Mainnet IdentityRegistry; without this, `giveFeedback` reverts | MEDIUM | One-time `cast send` or Foundry script; Mainnet IdentityRegistry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (verify before use) |
| `chainId`-driven config switching | Bot config must cleanly support `chainId=1` (Mainnet) vs `chainId=11155111` (Sepolia) via env vars; no hardcoded addresses | LOW | All addresses already in env vars (zod config); no code changes needed if env file is chain-specific; one EnvironmentFile per chain |
| Separate systemd units per chain | Two independent timers (Sepolia + Mainnet) each with their own EnvironmentFile; no shared process | LOW | `reputation-oracle-sepolia.service/.timer` + `reputation-oracle-mainnet.service/.timer`; explicit user decision to avoid multi-chain-in-one-process |
| "First run on Mainnet" verification runbook | Mainnet txs cost real ETH; operator must manually confirm correct behavior before letting timer run unattended | MEDIUM | Runbook: (1) dry-run or fork test, (2) manual first run with logging, (3) inspect summary log for correct `actionsComputed`, (4) enable timer |
| Config and runbook updated for Mainnet addresses | PGTCR Mainnet list address, Mainnet subgraph endpoint, Kleros v1 arbitrator, ERC-8004 Mainnet registry — all must be documented | LOW | Runbook section; no code changes beyond env file population |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Fork-tested Mainnet deployment | `forge script --fork-url mainnet` against a Mainnet fork verifies constructor args and proxy setup before spending real ETH | MEDIUM | Uses existing `forge test --fork-url` pattern; extend Deploy.s.sol with a fork simulation step; zero real ETH cost |
| Manually-gated first N transactions | Operator reviews computed action list before first live Mainnet run; catches misconfiguration silently | MEDIUM | `DRY_RUN=true` mode: log actions without executing; operator inspects, confirms, then re-runs with `DRY_RUN=false`; dry-run stdout already reserved in v1.1 pino design |
| RPC fallback transport | viem `fallbackTransport` with two providers; Mainnet RPC downtime doesn't kill the run | LOW | `RPC_URL` (primary: Alchemy) + `RPC_URL_FALLBACK` (secondary: QuickNode or publicnode.com); already in STACK.md |
| Etherscan contract verification post-deploy | Verified source on Etherscan builds trust with external consumers of the reputation data | LOW | `forge verify-contract --etherscan-api-key ...`; one command post-deploy |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Multi-chain routing in one process | Explicit architectural exclusion; shared nonce + gas management across chains creates failure coupling | separate systemd service + env file per chain |
| Cross-chain tx relayers | Out of scope; adds protocol complexity with no v1.2 benefit | single-chain one-shot per service unit |
| Custom Mainnet RPC node (self-hosted) | Ops overhead (disk, sync time, maintenance) vastly exceeds cost of free Alchemy tier | Alchemy free tier (300M CU/month — sufficient at < 50 req/run) |
| Upgradeable proxy re-deployment as new proxy | Re-deploying the proxy resets the Router address that is registered in IdentityRegistry; must upgrade via UUPS `upgradeToAndCall` not redeploy | use UUPS upgrade path for contract changes post-deploy |
| Re-using Sepolia private key on Mainnet | Key reuse is an ops risk; Sepolia key exposure compromises Mainnet bot | separate funded Mainnet EOA with minimal ETH balance (gas-only) |

---

## Feature Dependencies

```
Packaging (systemd units + EnvironmentFile)
    └──required by──> Observability (BETTERSTACK_* vars in EnvironmentFile)
    └──required by──> Mainnet (Mainnet EnvironmentFile as separate unit)

journald log capture (pino stderr → fd2)
    └──enhanced by──> Betterstack Telemetry (@logtail/pino multi-transport)
        └──enhanced by──> runId field (per-run correlation in Betterstack)

Run summary log line (v1.1 differentiator → v1.2 table stakes)
    └──consumed by──> Betterstack alerting (pattern-match on level:fatal)
    └──consumed by──> Betterstack heartbeat (ping carries exit code, not content)

Mainnet Router UUPS deployment
    └──requires──> Kleros 8004 Identity Mainnet registration
    └──requires──> fork-tested deployment (differentiator gates table stakes)

DRY_RUN mode (differentiator)
    └──enhances──> First-run verification runbook (table stakes)
    └──depends on──> stdout reserved for dry-run output (v1.1 pino design — already done)
```

### Dependency Notes

- **Packaging before Observability:** BETTERSTACK tokens live in EnvironmentFile; systemd unit must exist first
- **Run summary (v1.1) before Betterstack alerting:** alert rules pattern-match on summary fields; ship summary first, configure alerts second
- **Fork-test before Mainnet deploy:** deploy on fork, verify proxy wiring, then deploy real — prevents wasting ETH on misconfigured constructor args
- **Separate EOAs per chain:** Mainnet and Sepolia must have distinct private keys in separate EnvironmentFiles from day one — not a migration step later

---

## MVP Definition (v1.2)

### Must-have (all table stakes)

**Packaging:**
- [ ] Bootstrap script (idempotent): Node 22 NodeSource, `oracle` user, directory layout, systemd units, journald config
- [ ] Systemd service + timer units with sandboxing directives
- [ ] EnvironmentFile at 0600; runbook for populating it
- [ ] Verified journald capture (pino stderr → `journalctl -u reputation-oracle`)

**Observability:**
- [ ] `@logtail/pino` transport (conditional on `BETTERSTACK_SOURCE_TOKEN`)
- [ ] Run summary log line promoted to table stakes (feeds Betterstack alerting)
- [ ] Heartbeat ping in `flushAndExit()` (exit-code-aware)
- [ ] Betterstack Uptime monitor configured (grace period 20 min, alert channel set)

**Mainnet:**
- [ ] Router UUPS deployed on Mainnet with correct addresses
- [ ] Kleros 8004 Identity registered on Mainnet
- [ ] Mainnet EnvironmentFile + separate systemd units
- [ ] "First run" runbook with manual verification gates

### Should-have (differentiators)

- [ ] `DRY_RUN=true` mode — log actions without executing; gates first Mainnet run
- [ ] Fork-tested Mainnet deployment (forge script on Mainnet fork before real deploy)
- [ ] `runId` UUID per run in pino root logger child
- [ ] `level:fatal` log before systemic exit (secondary Betterstack alert trigger)
- [ ] RPC fallback transport (`RPC_URL_FALLBACK`)
- [ ] Etherscan contract verification post-deploy

### Defer (v1.3+)

- [ ] `LoadCredential=` secret injection (requires app code refactor)
- [ ] Pausable Router upgrade (PROD-03, explicit user deferral)
- [ ] Key rotation runbook (PROD-03, explicit user deferral)

---

## Prioritization Matrix

| Feature | Operator Value | Implementation Cost | Priority |
|---------|---------------|---------------------|----------|
| Bootstrap script (idempotent) | HIGH | LOW | P1 |
| systemd units (service + timer) | HIGH | LOW | P1 |
| EnvironmentFile 0600 + runbook | HIGH | LOW | P1 |
| `@logtail/pino` transport | HIGH | LOW | P1 |
| Heartbeat ping (exit-code-aware) | HIGH | LOW | P1 |
| Missed-timer alert (Betterstack UI config) | HIGH | LOW (UI only) | P1 |
| Mainnet Router UUPS deploy | HIGH | MEDIUM | P1 |
| 8004 Identity Mainnet registration | HIGH | LOW | P1 |
| First-run verification runbook | HIGH | LOW (docs) | P1 |
| `DRY_RUN=true` mode | HIGH | LOW | P2 |
| Fork-tested deployment | MEDIUM | LOW | P2 |
| `runId` UUID correlation | MEDIUM | LOW | P2 |
| `level:fatal` before systemic exit | MEDIUM | LOW | P2 |
| RPC fallback transport | MEDIUM | LOW | P2 |
| Etherscan contract verification | MEDIUM | LOW | P2 |
| `gasUsed` in run summary | LOW | LOW | P3 |

---

## Sources

- [Betterstack Uptime — Cron & Heartbeat Monitor](https://betterstack.com/docs/uptime/cron-and-heartbeat-monitor/) — heartbeat URL format, exit-code suffix, grace period config
- [Betterstack Telemetry — pino transport](https://betterstack.com/docs/logs/javascript/pino/) — `@logtail/pino` setup, source token, multi-transport
- [Betterstack pricing](https://betterstack.com/pricing) — free tier: 3 GB/month logs, 10 heartbeat monitors
- [@logtail/pino on npmjs.com](https://www.npmjs.com/package/@logtail/pino) — v0.5.8, pino v7+ peer dep
- [systemd.timer(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html) — OnUnitActiveSec, Persistent, RandomizedDelaySec
- [systemd EnvironmentFile Ubuntu guide](https://oneuptime.com/blog/post/2026-03-02-how-to-configure-systemd-service-environment-files-on-ubuntu/view)
- [erc-8004/erc-8004-contracts GitHub](https://github.com/erc-8004/erc-8004-contracts) — Mainnet IdentityRegistry + ReputationRegistry addresses
- [Kleros smart contract integration docs](https://docs.kleros.io/integrations/types-of-integrations/1.-dispute-resolution-integration-plan/smart-contract-integration) — KlerosLiquid v1 Mainnet address
- `.planning/research/STACK.md` — v1.2 stack decisions (this milestone); primary source for packaging + observability patterns
- `.planning/milestones/v1.1-research/FEATURES.md` — v1.1 features (baseline; not duplicated here)

---
*Feature research for: Kleros Reputation Oracle v1.2 Deploy-to-Mainnet*
*Researched: 2026-04-23*
