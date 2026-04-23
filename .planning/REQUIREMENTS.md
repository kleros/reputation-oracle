# Requirements: Kleros Reputation Oracle — v1.2 Deploy-to-Mainnet

**Defined:** 2026-04-23
**Core Value:** Kleros-backed, economically-secured reputation signals for ERC-8004 AI agents

## v1.2 Requirements

v1.2 adds no new business logic. Goal: package the bot for VPS operation on Sepolia, wire observability via Betterstack, then extend to Ethereum Mainnet.

### Packaging

- [x] **PKG-01**: Bot runs on fresh Ubuntu 24.04 VPS via a single idempotent `bootstrap.sh` (NodeSource Node 22, dedicated `oracle` user, `/opt/reputation-oracle`, `npm ci --omit=dev`)
- [x] **PKG-02**: Bot runs via `node --import tsx src/index.ts` with `tsx` moved to `dependencies` in `bot/package.json` (prevents `npm ci --omit=dev` break)
- [x] **PKG-03**: Sepolia instance scheduled via systemd instance template `reputation-oracle@sepolia.timer` (5-min monotonic interval, `Persistent=true`, `RandomizedDelaySec=60`) — cadence revised 2026-04-23 from 15→5min for fresher reputation signals
- [x] **PKG-04**: Secrets delivered via `/etc/reputation-oracle/sepolia.env` at mode 0600 owned by the dedicated service account; never via inline `Environment=` directives
- [x] **PKG-05**: systemd hardening directives applied (`ProtectSystem=strict`, `PrivateTmp=true`, `NoNewPrivileges=true`, `TimeoutStartSec=300`, no `Restart=`)
- [x] **PKG-06**: journald retention capped (`SystemMaxUse=500M`, `SystemMaxFileSize=50M`) to prevent silent log drops during incident
- [x] **PKG-07**: Atomic-update runbook documented (stop timer → git pull → `npm ci` → start timer) with no secret-file overwrites
- [x] **PKG-08**: VPS deployment acceptance test: `--dry-run` invocation succeeds and emits a valid `RunSummary` after `npm ci --omit=dev`

### Observability

- [ ] **OBS-01**: Every log line carries `runId` (UUID generated per run) and `chainId` (numeric) via a root pino child logger
- [ ] **OBS-02**: Betterstack Telemetry log forwarding active when `BETTERSTACK_SOURCE_TOKEN` is set, via `@logtail/pino` multi-transport; disabled during `--dry-run` and when token absent
- [ ] **OBS-03**: Betterstack Uptime heartbeat fires on every run after `RunSummary` emission, reflecting exit code (success → ping; systemic failure → `/fail` variant)
- [ ] **OBS-04**: Heartbeat ping failures never cascade to bot exit status — log and swallow with bounded HTTP timeout
- [ ] **OBS-05**: `closeLogger(cb)` exported from `bot/src/logger.ts` drains multi-transport worker threads before `process.exit`; `index.ts` calls it instead of `logger.flush()`
- [ ] **OBS-06**: `BETTERSTACK_SOURCE_TOKEN` and `BETTERSTACK_HEARTBEAT_URL` added to pino `redact` config to prevent self-exfiltration in error logs
- [ ] **OBS-07**: Betterstack dashboard documented (source token setup, monitor URL, grace period = 20 min, email alert channel), with alerts muted during 7-day Sepolia burn-in
- [ ] **OBS-08**: Betterstack alert rule fires when `RunSummary.itemsFetched === 0` for 3+ consecutive runs (detects silent list-misconfiguration)

### Mainnet

- [ ] **MAIN-01**: `contracts/script/Deploy.s.sol` parameterized by `block.chainid` to select Mainnet vs Sepolia ERC-8004 IdentityRegistry, ReputationRegistry, and Kleros v1 Arbitrator addresses
- [ ] **MAIN-02**: ERC-8004 Mainnet registry addresses verified on Etherscan and asserted in fork tests (current MEDIUM-confidence addresses from `erc-8004-contracts` repo)
- [ ] **MAIN-03**: Mainnet fork-test profile added to `foundry.toml`; `forge script Deploy.s.sol --fork-url $MAINNET_RPC_URL` passes against forked Mainnet state
- [ ] **MAIN-04**: Router UUPS proxy deployed on Ethereum Mainnet with `agentId` configured, bot authorized, and Kleros 8004 Identity registered via the existing idempotent deploy script
- [ ] **MAIN-05**: Fresh Mainnet-only signer keypair generated (never reused from Sepolia); hot-wallet balance sized to ~3 days of gas at 30 gwei
- [ ] **MAIN-06**: Mainnet systemd instance `reputation-oracle@mainnet.timer` enabled with dedicated `/etc/reputation-oracle/mainnet.env` — reuses the Sepolia service template (instance-unit-parameterized)
- [ ] **MAIN-07**: viem `fallbackTransport` configured with `RPC_URL` (primary) + `RPC_URL_FALLBACK` (secondary) to survive single-provider 429s on Mainnet
- [ ] **MAIN-08**: 7-day Sepolia burn-in gate documented: Betterstack Uptime must show 7+ consecutive successful heartbeats with structured logs before Mainnet timer is enabled
- [ ] **MAIN-09**: Mainnet first-run runbook: mandatory `--dry-run` inspection → single manual live run → Etherscan verification of first tx before enabling the timer

## Future Requirements

Deferred to v1.3+. Tracked but not in current roadmap.

### Contract Hardening

- **PROD-03-A**: Pausable Router upgrade via UUPS (kill-switch for incidents)
- **PROD-03-B**: Bot signer key rotation runbook + tooling

### Bot Ergonomics

- **EVD-01**: Human-readable `text` field in IPFS feedback JSON (handled as `/gsd:quick` outside v1.2)
- **IN-02-FIX**: `parseInt(disputeId)` precision fix above 2^53 (advisory from v1.1 code review)

### Operations

- **SEC-02**: `LoadCredential=` systemd credential store migration (requires app refactor to read from `$CREDENTIALS_DIRECTORY`)
- **SEC-03**: Hardware-wallet-held UUPS upgrade key (removes single-EOA single-point-of-failure)

## Out of Scope

Explicitly excluded from v1.2. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Pausable Router upgrade (PROD-03) | v1.3 — user accepted mainnet without it given current hardening |
| Key rotation runbook (PROD-03) | v1.3 — user accepted mainnet without it |
| Evidence-text enrichment | Ships outside milestone via `/gsd:quick` — too small for a phase |
| Mainnet PGTCR Verified Agents list deployment | Coordinated externally; v1.2 assumes the list exists by cutover |
| Docker / Compose / pm2 | Bot is one-shot; bare Node + systemd timer is the natural match |
| Multi-chain routing in single process | Architecturally excluded — one deployment per chain, chain = env vars |
| Kubernetes / container orchestration | Single-VPS scope; no need |
| Self-hosted log/metrics infra (Loki/Prometheus) | Betterstack covers v1.2 observability needs |
| Sentry APM or custom metrics backends | Betterstack + structured logs sufficient |
| `LoadCredential=` systemd credential store | Deferred to v1.3 — requires app refactor |

## Traceability

Maps each requirement to a phase. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PKG-01 | Phase 7 | Complete |
| PKG-02 | Phase 7 | Complete |
| PKG-03 | Phase 7 | Complete |
| PKG-04 | Phase 7 | Complete |
| PKG-05 | Phase 7 | Complete |
| PKG-06 | Phase 7 | Complete |
| PKG-07 | Phase 7 | Complete |
| PKG-08 | Phase 7 | Complete |
| OBS-01 | Phase 8 | Pending |
| OBS-02 | Phase 8 | Pending |
| OBS-03 | Phase 8 | Pending |
| OBS-04 | Phase 8 | Pending |
| OBS-05 | Phase 8 | Pending |
| OBS-06 | Phase 8 | Pending |
| OBS-07 | Phase 8 | Pending |
| OBS-08 | Phase 8 | Pending |
| MAIN-01 | Phase 9 | Pending |
| MAIN-02 | Phase 9 | Pending |
| MAIN-03 | Phase 9 | Pending |
| MAIN-04 | Phase 9 | Pending |
| MAIN-05 | Phase 9 | Pending |
| MAIN-06 | Phase 9 | Pending |
| MAIN-07 | Phase 9 | Pending |
| MAIN-08 | Phase 9 | Pending |
| MAIN-09 | Phase 9 | Pending |

**Coverage:**
- v1.2 requirements: 25 total (PKG: 8, OBS: 8, MAIN: 9)
- Mapped to phases: 25
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-23*
*Last updated: 2026-04-23 after v1.2 milestone requirements definition*
