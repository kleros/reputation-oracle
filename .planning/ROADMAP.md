# Roadmap: Kleros Reputation Oracle

## Milestones

- ✅ **v1.0 Kleros Reputation Oracle** — Phases 1-3 (shipped 2026-03-27)
- ✅ **v1.1 Production Hardening** — Phases 4-6 (shipped 2026-04-22)
- 🚧 **v1.2 Deploy-to-Mainnet** — Phases 7-9 (in progress)

## Phases

<details>
<summary>✅ v1.0 Kleros Reputation Oracle (Phases 1-3) — SHIPPED 2026-03-27</summary>

- [x] Phase 1: Router Contract & On-Chain Setup (3/3 plans) — UUPS proxy, 3 scenarios, fork tests, deploy script
- [x] Phase 2: Stateless Bot (4/4 plans) — diff engine, subgraph client, Multicall3, dry-run — completed 2026-03-26
- [x] Phase 3: End-to-End Verification (2/2 plans) — Verify.s.sol, live E2E on Sepolia — completed 2026-03-27

Full details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

<details>
<summary>✅ v1.1 Production Hardening (Phases 4-6) — SHIPPED 2026-04-22</summary>

- [x] Phase 4: Structured Logging (2/2 plans) — pino logger, secret redaction, run summary — completed 2026-03-30
- [x] Phase 5: Transaction Safety (4/4 plans) — gas retry, balance preflight, receipt handling, graceful shutdown — completed 2026-04-21
- [x] Phase 6: IPFS Evidence (5/5 plans) — Pinata upload, prepare/execute split, failure isolation — completed 2026-04-22

Full details: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)

</details>

<details>
<summary>Orphan: Phase 1000 — Upgrade bot dependencies to latest majors (SHIPPED 2026-03-27)</summary>

- [x] 1000-01-PLAN.md — Upgrade zod v4 + vitest v4 (zero code changes) — completed 2026-03-27
- [x] 1000-02-PLAN.md — Upgrade Biome v2 (config migration + lint fixes) + update CLAUDE.md

Standalone dependency-maintenance phase, not tied to a milestone. Completed between v1.0 close and v1.1 start to align with other Kleros projects.

</details>

### 🚧 v1.2 — Deploy-to-Mainnet (Phases 7-9)

- [x] **Phase 7: Packaging** — systemd runtime, idempotent bootstrap, tsx devDep fix, Sepolia VPS acceptance _(completed 2026-04-23; 10/10 must-haves verified; live-VPS acceptance deferred to operator at provisioning time — see [`.planning/phases/07-packaging/07-HUMAN-UAT.md`](phases/07-packaging/07-HUMAN-UAT.md) and STATE.md Deferred Items)_
- [ ] **Phase 8: Observability** — Betterstack Telemetry + Uptime, runId/chainId, closeLogger, 7-day burn-in gate
- [ ] **Phase 9: Mainnet Cutover** — Router deploy on Mainnet, Identity registration, Mainnet systemd unit, go-live

## Phase Details

### Phase 7: Packaging
**Goal**: Bot runs reliably on a fresh Ubuntu 24.04 VPS via a single idempotent bootstrap script with systemd scheduling and hardened secrets handling
**Depends on**: Nothing (builds on shipped v1.1 bot code; no bot logic changes)
**Requirements**: PKG-01, PKG-02, PKG-03, PKG-04, PKG-05, PKG-06, PKG-07, PKG-08
**Success Criteria** (what must be TRUE):
  1. Fresh VPS → running bot in ≤ 10 minutes: `bootstrap.sh` completes idempotently and `--dry-run` emits a valid `RunSummary`
  2. `npm ci --omit=dev` does not break execution — `tsx` is a production dependency and `node --import tsx src/index.ts` starts cleanly
  3. systemd timer fires on schedule; run output is visible in `journalctl -u reputation-oracle@sepolia`
  4. `systemctl show reputation-oracle@sepolia` does not expose secret values — all secrets are in `/etc/reputation-oracle/sepolia.env` at mode 0600
  5. journald retention is capped (`SystemMaxUse=500M`) — verified via `journalctl --disk-usage`
**Plans**: 6 plans

Plans:
- [x] 07-01-PLAN.md — Move tsx to dependencies in bot/package.json; verify npm ci --omit=dev
- [x] 07-02-PLAN.md — systemd service + timer unit templates + journald retention drop-in
- [x] 07-03-PLAN.md — deploy/bootstrap.sh (11-step idempotent VPS provisioner)
- [x] 07-04-PLAN.md — deploy/update.sh (atomic 4-step update) + deploy/start-timer.sh
- [x] 07-05-PLAN.md — deploy/RUNBOOK.md (operator lifecycle guide) + README.md pointer
- [x] 07-06-PLAN.md — deploy/ACCEPTANCE.md (PKG-01..PKG-08 VPS acceptance checklist)

### Phase 8: Observability
**Goal**: Every Sepolia run is observable in Betterstack with structured log search by runId/chainId, and a heartbeat confirms liveness after each successful run
**Depends on**: Phase 7 (systemd EnvironmentFile must exist to hold Betterstack tokens; runtime established)
**Requirements**: OBS-01, OBS-02, OBS-03, OBS-04, OBS-05, OBS-06, OBS-07, OBS-08
**Success Criteria** (what must be TRUE):
  1. Betterstack Telemetry shows a live log stream; filtering by `runId` or `chainId` returns exactly the lines from that run
  2. Uptime heartbeat appears in Betterstack after every successful Sepolia run; alert fires when timer window is missed (grace = 10 min at 5-min cadence, revised 2026-04-23 from 20 min)
  3. Heartbeat reflects true exit code — systemic failure sends `/fail` variant; heartbeat failure never cascades to bot exit status
  4. `--dry-run` invocations do not forward logs to Betterstack (transport disabled when token absent or dry-run flag set)
  5. 7-day Sepolia burn-in shows 7+ consecutive successful heartbeats with `runId`/`chainId` present in every log line — gate documented before Phase 9 begins
**Plans**: 6 plans

Plans:
- [x] 08-01-PLAN.md — config.ts: 3 new Betterstack zod fields (BETTERSTACK_SOURCE_TOKEN, BETTERSTACK_HEARTBEAT_URL, HEARTBEAT_TIMEOUT_MS)
- [x] 08-02-PLAN.md — types.ts: RunSummary.items → itemsFetched rename + index.ts call sites
- [x] 08-03-PLAN.md — logger.ts: pino multi-transport + @logtail/pino + closeLogger + heartbeat URL redaction
- [x] 08-04-PLAN.md — heartbeat.ts (NEW): sendHeartbeat with AbortSignal.timeout + /fail routing + 7 unit tests
- [ ] 08-05-PLAN.md — index.ts: runId generation, child logger binding, sendHeartbeat wiring, closeLogger swap
- [ ] 08-06-PLAN.md — deploy/bootstrap.sh typo fix + deploy/RUNBOOK.md §9 Betterstack Setup + §10 Burn-in Gate

### Phase 9: Mainnet Cutover
**Goal**: Router UUPS proxy is live on Ethereum Mainnet with a dedicated systemd instance, and the first real Mainnet feedback transaction is verified on Etherscan
**Depends on**: Phase 8 (7-day Sepolia burn-in gate; structured logs required for Mainnet incident MTTR)
**Requirements**: MAIN-01, MAIN-02, MAIN-03, MAIN-04, MAIN-05, MAIN-06, MAIN-07, MAIN-08, MAIN-09
**Success Criteria** (what must be TRUE):
  1. `Deploy.s.sol` passes against forked Mainnet state (`forge script --fork-url $MAINNET_RPC_URL`) with correct ERC-8004 registry addresses asserted
  2. Router UUPS proxy deployed on Ethereum Mainnet; `cast call $ROUTER_PROXY "reputationRegistry()(address)"` returns expected Mainnet registry address
  3. Mainnet signer is a fresh keypair never shared with Sepolia; `mainnet.env` is a separate file at mode 0600
  4. Mandatory dry-run on Mainnet fork passes inspection before first live run; first live tx verified on Etherscan against dry-run output
  5. Mainnet systemd timer active; Betterstack Uptime monitor and alert configured for Mainnet heartbeat; `viem fallbackTransport` wired with primary + fallback RPC
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Router Contract & On-Chain Setup | v1.0 | 3/3 | Complete | 2026-03-25 |
| 2. Stateless Bot | v1.0 | 4/4 | Complete | 2026-03-26 |
| 3. End-to-End Verification | v1.0 | 2/2 | Complete | 2026-03-27 |
| 1000. Upgrade bot deps | — | 2/2 | Complete | 2026-03-27 |
| 4. Structured Logging | v1.1 | 2/2 | Complete | 2026-03-30 |
| 5. Transaction Safety | v1.1 | 4/4 | Complete | 2026-04-21 |
| 6. IPFS Evidence | v1.1 | 5/5 | Complete | 2026-04-22 |
| 7. Packaging | v1.2 | 6/6 | Complete   | 2026-04-23 |
| 8. Observability | v1.2 | 0/6 | Planned | - |
| 9. Mainnet Cutover | v1.2 | 0/? | Not started | - |

## Backlog

_(empty)_
