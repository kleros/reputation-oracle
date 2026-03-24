# Project Research Summary

**Project:** Kleros Reputation Oracle
**Domain:** Subgraph-to-chain oracle / PGTCR curation events to ERC-8004 on-chain reputation
**Researched:** 2026-03-24
**Confidence:** HIGH

## Executive Summary

The Kleros Reputation Oracle is an infrastructure system -- not a user-facing application -- that bridges Kleros PGTCR (Stake Curate) curation events into ERC-8004 on-chain reputation feedback. It consists of three components: a Solidity Router contract (the trusted `clientAddress`), a stateless TypeScript bot (diff engine), and a one-time Kleros 8004 identity registration. The entire business logic reduces to three scenarios: positive feedback for verified agents, revoke-then-negative for dispute removals, and revoke-only for voluntary withdrawals. Experts build this type of oracle as a stateless diff engine: read desired state from subgraph, read actual state from chain, compute the delta, execute the minimum set of transactions, exit. No local database, no daemon mode, no persistent state.

The recommended approach is Foundry + viem + TypeScript on Node 22 LTS. The Router contract is the foundation -- everything depends on it. Build it first with UUPS upgradeability and storage gaps, deploy to Sepolia, then build the bot against its ABI. The bot's core is a pure function (`computeActions`) that takes two data sources and returns an action list. This function is trivially testable and contains all business logic. The architecture is well-specified in the PRD and amendments, with high confidence across all research areas.

The primary risks are: (1) the revoke-then-negative sequence (Scenario 2) is not atomic -- if revoke succeeds but negative fails, the agent ends up with zero reputation instead of -95, and the current diff logic has no recovery branch; (2) agent re-registration after dispute creates a state where the diff logic silently skips the agent forever; (3) subgraph indexing lag can temporarily show incorrect reputation. All three must be resolved in the Router contract design before coding begins, not deferred to later phases.

## Key Findings

### Recommended Stack

The stack is modern, well-integrated, and avoids legacy tools. Foundry for contracts (faster than Hardhat, native fork testing), viem for Ethereum interaction (type-safe, native Multicall3), TypeScript 5.7+ for the bot, Node 22 LTS (native `--env-file`, stable fetch). No dotenv, no ethers.js, no Hardhat. See [STACK.md](STACK.md) for full details.

**Core technologies:**
- **Solidity ^0.8.20 + Foundry:** Router contract with UUPS proxy, custom errors, PUSH0 opcode support
- **TypeScript ^5.7 + viem ^2.47:** Bot with type-safe ABI inference, native Multicall3 batching
- **Node.js 22 LTS:** Native env-file loading, stable fetch API, LTS until 2027
- **graphql-request ^7.4:** Lightweight subgraph queries with cursor-based pagination
- **zod ^4.3:** Config validation with TypeScript inference and secret redaction
- **Biome.js ^2.4 + vitest ^4.1:** Linting/formatting + testing (replaces ESLint/Prettier/Jest)

### Expected Features

See [FEATURES.md](FEATURES.md) for the complete feature landscape and dependency graph.

**Must have (table stakes -- system broken without these):**
- All 3 scenario functions in Router (positive +95, revoke-then-negative -95, revoke-only)
- Feedback state tracking (`hasFeedback`, `feedbackIndex` per agentId) for idempotent diffs
- Duplicate prevention guards and bot authorization (`onlyAuthorizedBot`)
- Subgraph polling with `id_gt` cursor pagination (never `skip`)
- Multicall3 batched Router state reads
- Stateless diff engine (`computeActions` pure function)
- IPFS evidence upload before feedback calls
- One-shot execution model (no daemon)
- Config validation with fail-fast and secret redaction

**Should have (production robustness):**
- Transaction safety: gas estimation retryable, tx submission NOT retryable
- Balance preflight check (fail fast on insufficient gas)
- Subgraph data validation (skip malformed items, don't crash)
- Upgradeable Router (UUPS proxy with storage gaps)
- Graceful shutdown (SIGTERM/SIGINT handling)

**Defer (v2+):**
- Multi-list support (wait for second PGTCR list)
- Multi-chain deployment tooling (wait for mainnet)
- Batched write transactions (wait for gas cost pressure)
- Curate v2 / Kleros v2 arbitrator support (pending Q7 resolution)

### Architecture Approach

The system follows a stateless diff engine pattern: each bot run reads full state from two sources (subgraph = desired state, Router = actual state), computes the minimum reconciliation actions via a pure function, executes them sequentially, and exits. The Router contract is the stable identity -- the bot is a replaceable "hand" that operates it. See [ARCHITECTURE.md](ARCHITECTURE.md) for component boundaries, data flow, and project structure.

**Major components:**
1. **KlerosReputationRouter.sol** -- Encapsulates all feedback logic, hardcodes constants (+/-95, tags), tracks per-agent state, authorizes bot addresses. Is the trusted `clientAddress` that consumers verify.
2. **Bot (TypeScript)** -- Stateless diff engine with clear module boundaries: config loader, subgraph reader, router state reader (Multicall3), diff engine (pure function), executor (IPFS + tx), transaction safety layer.
3. **Kleros 8004 Identity** -- One-time registration of Kleros as an agent in IdentityRegistry. Produces `klerosAgentId` for Router configuration.

### Critical Pitfalls

See [PITFALLS.md](PITFALLS.md) for all 15 pitfalls with detailed prevention strategies.

1. **Non-atomic revoke-then-negative (Pitfall 3)** -- If revoke succeeds but negative submission fails, agent gets zero reputation instead of -95, and the diff logic has no recovery branch. Fix: make `submitNegativeFeedback` handle both cases (with and without prior feedback). The diff should trigger on "Absent + Reject" regardless of `hasFeedback`.
2. **Agent re-registration silently skipped (Pitfall 8)** -- After Scenario 2, `hasFeedback=true` (pointing to -95). Re-registered agent with `Submitted` status matches no diff branch. Fix: track feedback type (Positive/Negative/None) instead of boolean. This is a design-time decision that must be resolved before implementation.
3. **Subgraph indexing lag creates false negatives (Pitfall 1)** -- Bot may submit positive feedback for an agent currently under dispute. Fix: check `_meta { block { number } }` and compare to chain head. Skip run if lag exceeds threshold.
4. **Nonce collision on partial run failure (Pitfall 2)** -- Timed-out tx response leaves nonce state ambiguous. Fix: explicit nonce management, stop the entire run on any tx ambiguity.
5. **Proxy storage collision on upgrade (Pitfall 10)** -- New state variables inserted between existing ones corrupt all feedback state. Fix: use `uint256[50] private __gap`, UUPS pattern, storage layout diffing in CI.

## Implications for Roadmap

Based on research, the system has clear dependency ordering that dictates phase structure. The Router contract is the foundation -- everything depends on it. The bot cannot be built without the Router ABI. End-to-end testing requires both.

### Phase 1: Router Contract

**Rationale:** Everything depends on the Router. It defines the ABI the bot codes against, the on-chain state the diff engine reads, and the proxy pattern that must be correct from day one. The re-registration edge case (Pitfall 8) and non-atomic negative (Pitfall 3) must be resolved in the contract design, not patched later.
**Delivers:** Deployed, tested Router contract on Sepolia with UUPS proxy, storage gaps, all 3 scenario functions, bot authorization, event emissions.
**Addresses:** All contract-layer table stakes features: Scenarios 1/2/3, feedback state tracking, duplicate prevention, bot authorization, owner admin.
**Avoids:** Pitfall 3 (non-atomic negative), Pitfall 4 (feedbackIndex desync), Pitfall 8 (re-registration skip), Pitfall 10 (storage collision), Pitfall 11 (ERC-8004 interface pinning).

### Phase 2: Kleros 8004 Identity + Router Configuration

**Rationale:** Can run in parallel with Phase 3 once Router is deployed. One-time setup that produces the `klerosAgentId` the Router needs. Quick phase -- Foundry script execution.
**Delivers:** Kleros agent registered in IdentityRegistry, Router configured with `klerosAgentId` and authorized bot address.
**Addresses:** One-time setup features from FEATURES.md.

### Phase 3: Bot Core (Diff Engine + Data Readers)

**Rationale:** Requires Router ABI from Phase 1. The diff engine is the heart of the bot and is a pure function -- can be developed and thoroughly tested without any infrastructure beyond the ABI types. Subgraph reader and Router state reader are developed here but can be tested independently.
**Delivers:** `computeActions` pure function with full test coverage, subgraph reader with cursor pagination, Router state reader with Multicall3 batching, config validation with zod.
**Uses:** TypeScript, viem, graphql-request, zod, vitest.
**Avoids:** Pitfall 1 (subgraph lag -- `_meta` check), Pitfall 5 (Disputed status handling), Pitfall 7 (Multicall3 batch size), Pitfall 9 (pagination cursor sanity check), Pitfall 12 (CAIP-10 validation), Pitfall 15 (rate limiting/backoff).

### Phase 4: Bot Integration (IPFS + Transaction Execution + End-to-End)

**Rationale:** Depends on Phases 1-3. Wires the diff engine to real IPFS pinning and Router transaction submission. This is where transaction safety (Pitfall 2) and IPFS failure handling (Pitfall 6) matter.
**Delivers:** Complete working bot: IPFS evidence upload, transaction execution with safety, balance preflight, graceful shutdown, structured logging. End-to-end verification on Sepolia.
**Addresses:** All bot-layer table stakes + differentiator features: IPFS evidence, tx safety, balance preflight, graceful shutdown.
**Avoids:** Pitfall 2 (nonce collision -- explicit nonce management, stop on ambiguity), Pitfall 6 (IPFS blocking -- separate prepare/execute phases).

### Phase 5: Production Hardening

**Rationale:** After end-to-end verification on Sepolia, harden for production use.
**Delivers:** Monitoring, alerting, key rotation documentation, Pausable contract upgrade, structured JSON logging.
**Addresses:** P2 features: graceful shutdown, structured logging, monitoring integration.
**Avoids:** Pitfall 14 (key compromise -- Pausable, monitoring).

### Phase Ordering Rationale

- **Contract first, bot second:** The bot codes against the Router's ABI. Changing the Router's interface after the bot is built creates unnecessary rework. The re-registration edge case (Pitfall 8) changes the Router's state model (boolean to enum), which cascades to the bot's diff logic.
- **Pure function core before integration:** `computeActions` can be tested with zero infrastructure. Building and testing it first ensures business logic correctness before adding network complexity.
- **IPFS and tx execution last in bot development:** These are the most failure-prone components (network dependencies, gas estimation, nonce management). By the time they're built, the diff logic is proven correct.
- **Identity registration parallel with bot development:** No dependency on bot code. Can happen as soon as the Router is deployed.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1 (Router Contract):** Must resolve Pitfall 8 (re-registration state model) and verify ERC-8004 `giveFeedback` return value (Pitfall 4) before implementation. Research the exact `ReputationRegistry` interface deployed on Sepolia.
- **Phase 3 (Bot Core):** Needs real subgraph data from the target PGTCR list to validate pagination, CAIP-10 format assumptions, and metadata field mapping. Run `/gsd:research-phase` to examine actual subgraph responses.

Phases with standard patterns (skip research-phase):
- **Phase 2 (Identity Registration):** One-time Foundry script. Standard pattern.
- **Phase 4 (Bot Integration):** viem transaction lifecycle, Pinata IPFS pinning -- well-documented APIs. Standard patterns.
- **Phase 5 (Production Hardening):** OpenZeppelin Pausable, monitoring setup -- standard ops work.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified via npm registry. Well-established tools with strong documentation. No exotic dependencies. |
| Features | HIGH | Derived directly from PRD v2 + amendments. Three scenarios cover entire business logic. Anti-features clearly documented from PoC learnings. |
| Architecture | HIGH | Stateless diff engine is a proven pattern. Component boundaries are clean. Data flow is unidirectional. PRD fully specifies the architecture. |
| Pitfalls | MEDIUM-HIGH | Critical pitfalls (1-4) are well-known oracle/subgraph patterns. Project-specific pitfalls (5, 8, 11) derived from PRD analysis -- less battle-tested. |

**Overall confidence:** HIGH

### Gaps to Address

- **ERC-8004 `giveFeedback` return value:** Does the ReputationRegistry return the feedback index from `giveFeedback`? If yes, the Router should use it directly instead of calling `getLastIndex` separately (Pitfall 4). Verify against deployed contract on Sepolia.
- **Open Question Q1 (re-registration):** PRD flags this but provides no solution. Research identified a concrete fix (feedback type enum instead of boolean). Must be confirmed as the approach before Phase 1 implementation.
- **Open Question Q7 (v1 vs v2 arbitrator):** Affects subgraph schema and `arbitratorExtraData` format. Deferred to v2+ but should be tracked.
- **Actual PGTCR subgraph data format:** CAIP-10 format in `metadata.key2`, item ID format, pagination behavior -- all assumptions that should be validated against the real Goldsky endpoint before Phase 3.
- **Disputed status during active feedback:** Identified as a known limitation (Pitfall 5). Acceptable for PoC but needs documentation for consumers.

## Sources

### Primary (HIGH confidence)
- PRD v2: `.planning/research/kleros-reputation-oracle-prd-v2.md` -- full system specification
- PRD Amendments: `.planning/research/kleros-reputation-oracle-prd-v2-amendments.md` -- PoC lessons learned
- CLAUDE.md project instructions -- distilled design decisions and constraints
- npm registry -- package versions verified 2026-03-24
- viem docs -- multicall API, contract interaction patterns
- OpenZeppelin docs -- UUPS proxy pattern, v5 migration
- Foundry book -- forge test, anvil fork mode, deployment scripts

### Secondary (MEDIUM confidence)
- The Graph documentation -- cursor pagination limits, `_meta` block height
- Goldsky subgraph behavior -- indexing latency patterns
- ERC-8004 specification -- interface stability assumptions

### Tertiary (LOW confidence)
- PGTCR subgraph data format assumptions -- need validation against real endpoint
- Multicall3 batch size limits per RPC provider -- need testing with target provider

---
*Research completed: 2026-03-24*
*Ready for roadmap: yes*
