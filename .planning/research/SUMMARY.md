# Research Summary: v1.2 Deploy-to-Mainnet

**Synthesized:** 2026-04-23
**Sources:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md
**Milestone:** v1.2 — Packaging VPS + Observability + Ethereum Mainnet

---

## Executive Summary

v1.2 adds no new business logic. The core bot (stateless diff engine) and Router contract are complete and battle-tested on Sepolia. This milestone is purely operational: run the same code reliably on a bare Ubuntu VPS, observe it via Betterstack, and deploy the Router to Ethereum Mainnet.

The recommended approach is a strict 3-phase sequence: systemd packaging first (establishes the runtime), Betterstack observability second (gives visibility before any real ETH is spent), Mainnet cutover third. Skipping observability before Mainnet is the single highest-impact risk — without `runId`/`chainId` fields and structured log forwarding, the first Mainnet failure will require SSH sessions to debug rather than a Betterstack search.

The dominant risk category is packaging pitfalls: `tsx` being a devDependency that breaks `npm ci --omit=dev`, `nvm` paths invisible to systemd, and secrets leaking via `systemctl show` inline `Environment=` directives. All are simple to prevent if the runbook is written correctly, but each is a silent blocker that produces confusing symptoms.

---

## Key Findings

### From STACK.md

| Decision | Rationale |
|----------|-----------|
| NodeSource apt for Node 22 | System-wide `/usr/bin/node`; `apt upgrade` handles security patches; nvm breaks systemd |
| `Type=oneshot` + `.timer` unit | Matches one-shot bot semantics; `Restart=on-failure` would thrash on systemic errors |
| `EnvironmentFile` at 0600 root:root | Dev-grade prod security; `LoadCredential=` deferred to v1.3 (requires app refactor) |
| `@logtail/pino@^0.5.8` | Official Betterstack pino transport; pino v7+ peer dep; compatible with pino 10.3 |
| Native `fetch()` for heartbeat ping | No new dep; `AbortSignal.timeout(3000)`; non-fatal on ping failure |
| viem `fallbackTransport` for RPC | `RPC_URL` (Alchemy primary) + `RPC_URL_FALLBACK` (publicnode.com); free tier sufficient |
| ERC-8004 Mainnet addresses | IdentityRegistry: `0x8004A169...e9432`; ReputationRegistry: `0x8004BAa1...9b63` — verify on Etherscan before deploy |

New env vars: `BETTERSTACK_SOURCE_TOKEN` (optional), `BETTERSTACK_HEARTBEAT_TOKEN` (optional), `RPC_URL_FALLBACK` (optional). New prod dep: `@logtail/pino`. No new dev deps.

### From FEATURES.md

**Packaging table stakes** (all LOW complexity): idempotent bootstrap script, dedicated `oracle` user, EnvironmentFile 0600, journald retention cap (`SystemMaxUse=500M`), `After=network-online.target` guard.

**Packaging differentiators worth including:** `Persistent=true` on timer (catches missed runs across reboots), `OnUnitActiveSec=` over `OnCalendar=` (monotonic, DST-safe), first-run verification step checking `itemsFetched > 0`.

**Observability table stakes:** `@logtail/pino` multi-transport, run summary log line (promoted from v1.1 differentiator — Betterstack alerting pattern-matches it), exit-code-aware heartbeat, missed-timer alert (grace = 20 min).

**Observability differentiators:** `runId` UUID per run, `chainId` in root logger child, `txHash` in every tx log, `level:fatal` before systemic exit.

**Mainnet table stakes:** Router UUPS deploy, Kleros 8004 Identity Mainnet registration, separate systemd units per chain, first-run verification runbook with dry-run gate.

**v1.3+ defer:** `LoadCredential=`, Pausable Router upgrade, key rotation runbook.

### From ARCHITECTURE.md

**tsx devDep cross-file dependency (critical):** `tsconfig.json` has `"noEmit": true` — no compiled JS output. Bot runs via `node --import tsx src/index.ts`. Since `tsx` is currently a devDependency, `npm ci --omit=dev` silently omits it. Fix in Phase 7: move tsx to `dependencies` in `bot/package.json`. Highest-likelihood blocker for packaging.

**Betterstack transport flush:** `pino.transport()` uses a worker thread. `flushAndExit` must call `transport.end(cb)` (not `logger.flush(cb)`) when multi-transport is active. Export `closeLogger(cb)` from `logger.ts`; `index.ts` calls it instead of `logger.flush()` directly.

**Anti-pattern:** Betterstack transport must be disabled during `--dry-run` (check `process.argv.includes("--dry-run")` before constructing transport targets).

**Two systemd instances:** Use systemd instance units (`reputation-oracle@.service`) to prevent config drift between Sepolia and Mainnet units (P4-03).

**Deploy.s.sol parameterization:** Chain-ID-based address selection (Option B — self-documenting):
```solidity
address reputationRegistry = block.chainid == 1
    ? 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
    : 0x8004B663056A597Dffe9eCcC1965A193B7388713;
```

**Unchanged:** `subgraph.ts`, `validation.ts`, `chain.ts`, `diff.ts`, `evidence.ts`, `ipfs.ts`, `tx.ts`, `types.ts`, `Verify.s.sol`, `Upgrade.s.sol`, all tests.

### From PITFALLS.md — Top 8 by Impact

| # | Pitfall | Impact | Phase |
|---|---------|--------|-------|
| P1-02 | `tsx` missing after `npm ci --omit=dev` | Blocker — bot never starts | Packaging |
| P1-05 | EnvironmentFile wrong perms (world-readable) | Blocker — key exfiltration | Packaging |
| P1-07 | nvm Node invisible to systemd ExecStart | Blocker — service won't start | Packaging |
| P3-01 | Sepolia keypair reused on Mainnet | Blocker — irreversible if compromised | Mainnet |
| P3-04 | Wrong ERC-8004 registry addresses | Blocker — every tx reverts | Mainnet |
| P2-03 | Betterstack transport blocks bot exit | Major — Betterstack outage cascades to oracle halt | Observability |
| P4-04 | Mainnet before observability tuned | Major — MTTR on first real incident is hours | Mainnet gate |
| P2-05 | Heartbeat false positive (0 items fetched) | Major — silent misconfiguration; oracle appears live but does nothing | Observability |

Additional: P1-03 (no `Restart=` directive), P1-04 (`TimeoutStartSec=300`), P1-12 (bash history key capture), P4-01 (chain log mixing — fix with `chainId` in root logger child), P2-09 (7-day Sepolia burn-in gate).

---

## Implications for Roadmap

### Phase Order and Rationale

**Phase 7: Packaging** → **Phase 8: Observability** → **Phase 9: Mainnet**

Phase 7 first: all downstream phases depend on the systemd runtime. Betterstack tokens live in `EnvironmentFile`; Mainnet units reuse the same service template. No bot code changes — pure infra and docs.

Phase 8 second: Mainnet first-failure MTTR without structured logs is prohibitive. Observability gate: 3 successful Sepolia heartbeats + `runId`/`chainId` in every log line before Phase 9 begins. Requires `logger.ts` multi-transport change and `flushAndExit` refactor.

Phase 9 third: spends real ETH. Mandatory gates: (a) systemd model established, (b) observability live on Sepolia, (c) dry-run on Mainnet fork passes, (d) manual first run inspected. One-way operations (Identity registration, Router deploy) cannot be undone without a new proxy address.

**7-day Sepolia burn-in gate:** Before enabling the Mainnet timer, Betterstack Uptime must show 7+ days of clean Sepolia heartbeats. Proves the full stack (systemd + Betterstack + bot) works end-to-end under real conditions before real ETH is at risk.

### Phase 7 — Packaging: Key Tasks

1. Move `tsx` to `dependencies` in `bot/package.json`
2. Write idempotent `bootstrap.sh`: NodeSource Node 22, `oracle` user, `/opt/reputation-oracle`, `npm ci --omit=dev`, `/etc/reputation-oracle/sepolia.env` at 0600
3. Write systemd instance unit `reputation-oracle@.service` + `reputation-oracle@sepolia.timer`
4. `TimeoutStartSec=300`; no `Restart=` directive; `Persistent=true`; `OnUnitActiveSec=15min`
5. `/etc/systemd/journald.conf`: `SystemMaxUse=500M`, `SystemMaxFileSize=50M`
6. Atomic update runbook: stop timer → git pull → npm ci → start timer
7. Acceptance test: `npm ci --omit=dev && node --import tsx src/index.ts --dry-run` succeeds on VPS

### Phase 8 — Observability: Key Tasks

1. `npm install @logtail/pino`; add conditional multi-transport to `logger.ts`
2. Export `closeLogger(cb)` from `logger.ts`; update `index.ts` to call `closeLogger` (fixes P2-03)
3. Generate `runId = crypto.randomUUID()` at startup; root logger child with `{ runId, chainId }` (fixes P4-01)
4. Add `pingHeartbeat()` in `index.ts` after `emitSummary`, before `closeLogger`
5. Add `BETTERSTACK_SOURCE_TOKEN`, `BETTERSTACK_HEARTBEAT_URL` to `config.ts` (optional fields); add to pino redact list (P2-01)
6. Betterstack UI: grace period = 20 min, email alert channel, disable alerts during 7-day burn-in
7. Verify dry-run uses stderr-only transport

### Phase 9 — Mainnet: Key Tasks

1. Parameterize `Deploy.s.sol` with chain-ID-based registry address selection
2. Add `[profile.mainnet-fork]` to `foundry.toml`
3. Fork-test: `forge script Deploy.s.sol --fork-url $MAINNET_RPC_URL`; assert registry addresses
4. Deploy Router proxy to Mainnet; register in Mainnet IdentityRegistry
5. Post-deploy: `cast call $ROUTER_PROXY "reputationRegistry()(address)"` verification
6. Generate fresh Mainnet EOA; populate `mainnet.env` (never copy Sepolia key)
7. Enable `reputation-oracle@mainnet.timer`; mandatory dry-run gate before live run
8. Manual Goldsky Mainnet subgraph schema validation before first live run

---

## Cross-File Dependencies

| Dependency | Files | Notes |
|------------|-------|-------|
| tsx devDep → packaging blocker | ARCHITECTURE + PITFALLS P1-02 | Fix in Phase 7 or bot never starts on VPS |
| EnvironmentFile → Betterstack tokens | STACK + FEATURES | systemd units must exist before Phase 8 |
| `closeLogger` refactor → transport drain | ARCHITECTURE + STACK | Prevents P2-03 (Betterstack outage cascades) |
| Run summary (v1.1) → Betterstack alerting | FEATURES | Enables P2-05 detection (`itemsFetched == 0` alert) |
| `chainId` in root logger → chain isolation | PITFALLS P4-01 + FEATURES | Must be in Phase 8 before Mainnet timer enabled |
| Deploy.s.sol parameterization → fork test | ARCHITECTURE + PITFALLS P3-10 | Hardcoded Sepolia addresses produce false-passing fork tests |
| 7-day Sepolia burn-in → Mainnet cutover | PITFALLS P2-09 + P4-04 | Observability proven before real ETH at risk |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack (systemd, NodeSource, @logtail/pino) | HIGH | Official docs; well-established patterns |
| Betterstack transport config | HIGH | Official pino transport; URL patterns confirmed |
| ERC-8004 Mainnet registry addresses | MEDIUM | From erc-8004-contracts repo; verify on Etherscan before deploy |
| Goldsky Mainnet subgraph schema (v0.0.1) | MEDIUM | Less tested than Sepolia; manual pre-flight required |
| Kleros v1 Arbitrator Mainnet address | MEDIUM | From Kleros docs; cross-check on Etherscan |
| pino v10 + @logtail/pino v0.5.8 compat | HIGH | pino v7+ peer dep; v10 > v7 confirmed |
| Bot business logic (no changes) | HIGH | Unchanged from v1.1 |

**Gaps:**
- Mainnet PGTCR list address is an external dependency — Phase 9 cannot fully enable until list is deployed
- Goldsky Mainnet subgraph v0.0.1 field set must be manually validated against `subgraph.ts` query
- `@logtail/pino` HTTP timeout option name needs testing to confirm exact config key (prevents P2-03)

---

## Roadmap Implications Summary

Suggested phases: 3

1. **Phase 7 — Packaging** — Establish systemd runtime; fix tsx devDep; write idempotent bootstrap runbook
2. **Phase 8 — Observability** — Wire Betterstack Telemetry + Uptime; add runId/chainId; refactor flushAndExit; 7-day Sepolia burn-in
3. **Phase 9 — Mainnet** — Deploy Router; register Identity; Mainnet systemd unit; dry-run gate; fork test; go live

**Research flags:** Phase 9 needs manual pre-flight checks (Goldsky schema, ERC-8004 address verification, PGTCR list deployment status). Phases 7 and 8 use standard patterns with no additional research needed.

**Overall confidence:** HIGH for packaging + observability; MEDIUM for Mainnet addresses (verify before execute).
