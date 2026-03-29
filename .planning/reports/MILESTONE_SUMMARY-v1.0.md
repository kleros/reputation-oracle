# Milestone v1.0 — Project Summary

**Generated:** 2026-03-30
**Purpose:** Team onboarding and project review

---

## 1. Project Overview

**Kleros Reputation Oracle** converts Kleros PGTCR (Stake Curate) curation events into ERC-8004 on-chain reputation feedback. When an AI agent is verified on a Kleros curated registry, it receives positive reputation (+95). When removed by dispute, it receives negative reputation (-95). When it voluntarily withdraws, the positive reputation is revoked (neutral).

**Core Value:** Kleros-backed, economically-secured reputation signals for ERC-8004 AI agents — the first reputation oracle where feedback is backed by real economic stake (WETH bonds) and human jury rulings.

**Target users:** AI agent ecosystems that need trustworthy, human-verified reputation signals backed by economic guarantees.

**Three components:**
1. **Router contract** (Solidity) — UUPS-upgradeable proxy encoding all feedback logic as hardcoded constants
2. **Stateless Bot** (TypeScript) — one-shot diff engine that reads subgraph + chain state, computes reconciliation, executes
3. **Kleros 8004 Identity** — one-time registration on the ERC-8004 IdentityRegistry

**Architecture:**
```
PGTCR subgraph (GraphQL) → Bot (TS) → Router.sol → ERC-8004 ReputationRegistry
```

## 2. Architecture & Technical Decisions

### Contract Design
- **FeedbackType enum (None/Positive/Negative)** over boolean `hasFeedback` — richer state model enabling cleaner business logic for re-registration after dispute. Mapping: `feedbackType(agentId)` + `feedbackIndex(agentId)`. (Phase 1, D-01/D-02)
- **Atomic revoke-then-negative** — `submitNegativeFeedback` handles both paths internally: if Positive, revoke first then submit -95; if None, just submit -95. Bot never calls revoke separately for Scenario 2. (Phase 1, D-03)
- **UUPS proxy with storage gap** — `uint256[50] private __gap` for future multi-list/multi-product extensions without redeployment. OpenZeppelin v5.6.0 Upgradeable contracts. (Phase 1, D-01)
- **Hardcoded constants** — feedback values (+-95), decimals (0), tags ("verified"/"removed", "kleros-agent-registry") are contract constants, not configurable. (Phase 1)

### Bot Design
- **Stateless diff architecture** — `computeActions()` is a pure function: `(subgraphItems[], routerStates: Map<bigint, FeedbackType>) → Action[]`. No I/O, no async, trivially testable. No local DB, no persistence, no checkpoints. (Phase 2, D-04)
- **Cursor-based pagination** — `id_gt` cursor, never `skip` (degrades past 5000 items). Fetches ALL items including Absent status for Scenarios 2/3. (Phase 2, D-08)
- **Multicall3 batched reads** — viem multicall with byte-based `batchSize` (1024*200 bytes, not call count) per Pitfall 7. Failed reads default to `FeedbackType.None` (conservative). (Phase 2, D-05/D-06)
- **Data-URI evidence** — `data:application/json;base64,...` for feedbackURI, evidence JSON embedded in calldata. No IPFS dependency for v1. Clean upgrade path to IPFS in v2. (Phase 2, D-12/D-13)
- **One-shot execution** — run once, exit. No daemon, no polling loop. Sequential tx submission with stop-on-first-failure. External scheduler invokes. (Phase 2, D-09/D-10/D-11)
- **Agent resolution: Strategy A** — `metadata.key0` = numeric agentId, `metadata.key2` = CAIP-10 chain validation. No admin mapping. (PROJECT.md decision)

### Testing Strategy
- **Fork tests against real Sepolia** — all 17 Router tests deploy a fresh UUPS proxy against the real ReputationRegistry and IdentityRegistry on Sepolia. No mocks. (Phase 1, D-08/D-09)
- **TDD for diff engine** — 15 test assertions written before `computeActions()` implementation. (Phase 2)
- **Idempotent deploy script** — `Deploy.s.sol` checks on-chain state before each step; re-running skips completed steps. (Phase 1, D-10)

### Key Technology Choices

| Technology | Version | Purpose |
|------------|---------|---------|
| Solidity | 0.8.28 | Router contract (cancun EVM) |
| Foundry | latest | Contract dev, test, deploy |
| OpenZeppelin | v5.6.0 | UUPS proxy upgradeable contracts |
| TypeScript | ^5.7 | Bot language (strict mode) |
| Node.js | 22 LTS | Runtime (native `--env-file`, stable fetch) |
| viem | ^2.47 | Ethereum client (type-safe, native Multicall3) |
| zod | ^4.3 | Config validation with secret redaction |
| graphql-request | ^7.4 | Subgraph queries |
| tsx | ^4.21 | TypeScript execution (no build step) |
| Biome.js | ^2.4 | Linting + formatting |
| vitest | ^4.1 | Bot unit tests |

## 3. Phases Delivered

| Phase | Name | Status | One-Liner |
|-------|------|--------|-----------|
| 1 | Router Contract & On-Chain Setup | Complete | UUPS-upgradeable KlerosReputationRouter with 3 feedback scenarios, 17 fork tests, idempotent deploy script |
| 2 | Stateless Bot | Complete | Diff engine with subgraph client, Multicall3 reader, sequential executor, dry-run mode — 42 tests |
| 3 | End-to-End Verification | Complete | Live Sepolia proof: 4 agents verified, 28 getSummary assertions passed, idempotency proven |
| 1000 | Dep Upgrades | Complete | zod v4, vitest v4, Biome v2 — zero code changes for zod/vitest, automated Biome config migration |

### Phase 1: Router Contract & On-Chain Setup (3 plans, completed 2026-03-25)

**Plan 1 — Contract Implementation (4 min):** Foundry scaffold with OpenZeppelin v5.6.0, pinned ERC-8004 interfaces (IReputationRegistry, IIdentityRegistry), KlerosReputationRouter with FeedbackType enum, all 3 scenarios, bot authorization, UUPS proxy with storage gap.

**Plan 2 — Fork Test Suite (4 min):** 17 fork tests against real Sepolia registries covering all 3 scenarios, re-registration after dispute, authorization guards, state edge cases, owner management. Public RPC (publicnode) used.

**Plan 3 — Deploy Script (2 min):** Idempotent `Deploy.s.sol` — deploys UUPS proxy, registers Kleros identity, configures Router, authorizes bot. Each step checks on-chain state before executing.

### Phase 2: Stateless Bot (4 plans, completed 2026-03-26)

**Plan 1 — Foundation (5 min):** Project scaffold (ESM, TypeScript strict), shared types, Router ABI as const, Zod config with secret redaction, CAIP-10 validation, evidence builder with data-URI encoding — 27 tests.

**Plan 2 — Diff Engine (3 min):** Pure `computeActions()` via TDD — 15 test assertions covering all 3 scenarios plus re-registration edge case. Zero I/O, zero async.

**Plan 3 — Data Fetching (4 min):** Subgraph cursor-paginated client (`id_gt`), Multicall3-batched `feedbackType` reader (byte-based batch size), sequential tx executor with nonce management.

**Plan 4 — Orchestrator (3 min):** `index.ts` wiring all modules into one-shot pipeline. `--dry-run` prints JSON action list. Exit code 0/1. BigInt serialized as string in JSON output.

### Phase 3: End-to-End Verification (2 plans, completed 2026-03-27)

**Plan 1 — Verify.s.sol (2 min):** Forge verification script reading `getSummary()` for each agent, asserting count/value/tag-filtered results. CSV-parsed AGENT_IDS from env.

**Plan 2 — E2E Pipeline (~30 min, interactive):** Router deployed to Sepolia, bot executed 4 `submitPositiveFeedback` txs (agents 610, 1142, 1143, 1440), Verify.s.sol confirmed 28 assertions, second dry-run proved idempotency (0 actions). Bot authorization issue resolved during run.

### Phase 1000: Dependency Upgrades (2 plans, completed 2026-03-27)

**Plan 1:** zod v3→v4 and vitest v3→v4 — zero code changes, all APIs backward-compatible.
**Plan 2:** Biome v1→v2 — automated `biome migrate` for config, lint fixes applied.

## 4. Requirements Coverage

### Router Contract (10/10)
- ROUT-01: Router deployed as UUPS proxy with storage gaps
- ROUT-02: Feedback state per agentId (FeedbackType enum + feedbackIndex)
- ROUT-03: Scenario 1 — submitPositiveFeedback(+95, "verified")
- ROUT-04: Scenario 2 — submitNegativeFeedback(atomic revoke-then-negative, -95)
- ROUT-05: Scenario 3 — revokeOnly (no new feedback)
- ROUT-06: Bot authorization (onlyAuthorizedBot modifier)
- ROUT-07: Owner bot management + ownership transfer
- ROUT-08: Events for all state changes
- ROUT-09: Hardcoded feedback constants
- ROUT-10: 17 fork tests covering all scenarios + edge cases

### Bot Core (9/9)
- BOT-01: Subgraph cursor pagination (id_gt, never skip)
- BOT-02: Multicall3-batched feedbackType reads
- BOT-03: Pure computeActions() diff engine
- BOT-04: Agent resolution via metadata.key0 + CAIP-10 validation
- BOT-05: Subgraph data validation (itemID, metadata, status, disputeOutcome)
- BOT-06: Zod config validation with secret redaction
- BOT-07: One-shot exit (code 0 success, non-zero failure)
- BOT-08: Dry-run mode (JSON to stdout, no transactions)
- BOT-09: Invalid items logged and skipped, not crash

### Identity & Setup (4/4)
- SETUP-01: Deploy script deploys UUPS proxy
- SETUP-02: Register Kleros as 8004 agent
- SETUP-03: Configure Router addresses + klerosAgentId
- SETUP-04: Authorize bot address

### Verification (4/4)
- VER-01: Scenario 1 getSummary = count=1, value=95 (live E2E)
- VER-02: Scenario 2 getSummary = count=1, value=-95 (fork test)
- VER-03: Scenario 3 getSummary = count=0 (fork test)
- VER-04: Tag filtering verified/removed works correctly (live E2E)

**Total: 27/27 requirements satisfied.**

## 5. Key Decisions Log

| # | Decision | Phase | Rationale |
|---|----------|-------|-----------|
| D-01 | FeedbackType enum over boolean | Phase 1 | Richer state (None/Positive/Negative) resolves re-registration after dispute cleanly |
| D-03 | Atomic revoke-then-negative in Router | Phase 1 | Bot calls one function for Scenario 2; Router handles both paths internally |
| D-05 | Pin ERC-8004 interfaces from deployed contracts | Phase 1 | Verify against actual Sepolia contracts, not spec documents |
| D-08 | Fork tests against real Sepolia | Phase 1 | Catches interface mismatches that mocks would miss |
| D-10 | Idempotent deploy script | Phase 1 | Re-running safely skips completed steps via on-chain state checks |
| D-04 | Pure computeActions() with no I/O | Phase 2 | Deterministic, unit-testable, enables trivial dry-run |
| D-12 | data: URI for feedbackURI (no IPFS) | Phase 2 | No external dependency for v1; clean upgrade path to IPFS |
| D-09 | Sequential tx, stop on first failure | Phase 2 | Safest for low-volume steady state (0-2 actions/run) |
| D-10 | Scenarios 2/3 verified via fork tests | Phase 3 | No disputed/withdrawn items on PGTCR list yet; fork tests are acceptable proof |
| — | Strategy A for agent resolution | Project | key0 = agentId already in PGTCR metadata; no admin overhead |
| — | History accumulates on re-registration | Project | Mixed record (-95, +95) is correct; no revoke of old negative |
| — | Stateless diff, no local DB | Project | Prior PoC proved DB approach adds complexity without value |

## 6. Tech Debt & Deferred Items

### From Phase Context Files

| Item | Source | Priority |
|------|--------|----------|
| IPFS evidence upload (IPFS-01/02/03) | Phase 2 deferred | v2 — replace data: URI with IPFS CID |
| Transaction safety hardening (TXSAFE-01..04) | Phase 2 deferred | v2 — gas retry, dropped receipt, balance preflight, SIGTERM |
| Subgraph lag detection | Phase 2 deferred | v2 — query `_meta { block { number } }`, skip if stale |
| Multicall batching for tx execution | Phase 2 deferred | Future — batch all actions into one tx for high-volume bootstrap |
| Pausable contract upgrade | Phase 1 deferred | v2 — key compromise circuit breaker |
| On-chain pgtcrToAgentId mapping (Strategy C) | Phase 1 deferred | Future — admin mapping adds complexity without PoC value |
| Multi-list support | Phase 1 deferred | Future — contract upgradeable via storage gaps |
| CI integration for verification | Phase 3 deferred | Production hardening |
| Scenarios 2/3 live E2E | Phase 3 deferred | Triggered when disputes occur on PGTCR list |

### From Retrospective

- **ROADMAP/REQUIREMENTS checkbox drift** — traceability tables went stale during execution; update incrementally
- **Phase 1 verification debt** — human-gated items accumulated until Phase 3; resolve incrementally
- **Bot authorization oversight** — pre-flight check should be prominent in deployment docs

### Anti-Patterns Found (Low Severity)

- `bytes32("testItem")` unsafe typecast in fork tests — lint warning only, no runtime issue (Phase 1)
- `onlyAuthorizedBot` modifier logic not in internal function — micro-optimization, not a correctness concern (Phase 1)

## 7. Getting Started

### Run the Project

**Prerequisites:** Node.js 22+, Foundry, a Sepolia RPC URL, a funded bot wallet

**Contract tests:**
```bash
cd contracts
export SEPOLIA_RPC_URL="https://ethereum-sepolia-rpc.publicnode.com"
forge test -vv
```

**Bot dry-run (read-only):**
```bash
cd bot
cp .env.example .env  # fill in values
npm install
npm run start:dry-run
```

**Bot live run:**
```bash
npm run start
```

**Verify on-chain state:**
```bash
cd contracts
ROUTER_PROXY_ADDRESS=0xc770c4F43f84c9e010aE0Ade51be914372B7Cc02 \
AGENT_IDS="610,1142,1143,1440" \
forge script script/Verify.s.sol --rpc-url $SEPOLIA_RPC_URL
```

### Key Directories

```
contracts/                     # Foundry project
  src/KlerosReputationRouter.sol  # Router implementation (189 lines)
  src/interfaces/                 # Pinned ERC-8004 interfaces
  test/KlerosReputationRouter.t.sol  # 17 fork tests
  script/Deploy.s.sol            # Idempotent deploy script
  script/Verify.s.sol            # On-chain verification script

bot/                           # TypeScript bot
  src/index.ts                   # Entry point (one-shot pipeline)
  src/diff.ts                    # Pure computeActions() diff engine
  src/subgraph.ts                # Cursor-paginated subgraph client
  src/chain.ts                   # Multicall3 reader + tx executor
  src/validation.ts              # CAIP-10 + item validation
  src/config.ts                  # Zod config validation
  src/evidence.ts                # Evidence JSON builder
  src/types.ts                   # Shared types
  src/abi/router.ts              # Router ABI as const
  test/                          # 42 vitest unit tests
```

### Deployed Addresses (Sepolia)

| Contract | Address |
|----------|---------|
| Router Proxy | `0xc770c4F43f84c9e010aE0Ade51be914372B7Cc02` |
| ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| PGTCR (Verified Agents) | `0x3162df9669affa8b6b6ff2147afa052249f00447` |
| Kleros Agent ID | 2295 |

### Tests

- **17 Foundry fork tests** — `cd contracts && forge test -vv` (requires SEPOLIA_RPC_URL)
- **42 Vitest unit tests** — `cd bot && npm test`
- **Total: 59 tests** across Solidity and TypeScript

---

## Stats

- **Timeline:** 2026-03-13 → 2026-03-27 (14 days)
- **Phases:** 3 core + 1 maintenance (Phase 1000)
- **Plans:** 9 core + 2 maintenance = 11 total
- **Commits:** 72 (tagged v1.0)
- **Files changed:** 1,892 (+370,438 lines, includes dependencies)
- **Codebase:** ~2,000 LOC (809 Solidity, 695 TypeScript, 493 test TypeScript)
- **Contributors:** jaybuidl

---
*Generated from GSD milestone artifacts*
*Last updated: 2026-03-30*
