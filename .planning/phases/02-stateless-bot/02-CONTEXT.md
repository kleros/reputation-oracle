# Phase 2: Stateless Bot - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning

<domain>
## Phase Boundary

A one-shot TypeScript bot that reads PGTCR subgraph state and Router on-chain state, computes a stateless diff via a pure function, and executes reconciliation actions against the deployed Router. One run, then exit. No daemon, no DB, no polling loop.

</domain>

<decisions>
## Implementation Decisions

### Project Structure
- **D-01:** Bot lives in `bot/` at repo root alongside `contracts/`. Independent `package.json`, `tsconfig.json`, `node_modules`. Clean separation of Solidity and TypeScript worlds.
- **D-02:** Entry point: `node --env-file=.env --import tsx bot/src/index.ts`. Node 22 native env loading, tsx for TS execution. No build step for running.
- **D-03:** Type checking via `tsc --noEmit` in CI/pre-commit. tsx skips type checking at runtime — standard modern TS workflow.

### Diff Engine
- **D-04:** `computeActions()` is a pure function: takes `(subgraphItems[], routerStates: Map<bigint, FeedbackType>)`, returns `Action[]`. No I/O, no async. Unit testable with vitest, deterministic, enables trivial dry-run.
- **D-05:** Router state read via viem Multicall3 — batch all `feedbackType(agentId)` calls. Chunked via viem's `batchSize` option (200 per eth_call). Multicall3 at `0xcA11bde05977b3631167028862bE2a173976CA11`.
- **D-06:** Router uses `feedbackType(agentId)` enum (None=0, Positive=1, Negative=2) — NOT `hasFeedback()`. Bot maps: Submitted + (None OR Negative) → positive, Absent+Reject + Positive → negative, Absent+withdrawal + Positive → revoke. (Carried from Phase 1 D-01/D-02.)
- **D-07:** Invalid subgraph items (missing key0, bad CAIP-10 in key2, wrong chain) are logged with details and skipped. Bot continues with valid items. Per BOT-05 and BOT-09.
- **D-08:** Subgraph pagination uses `id_gt` cursor, never `skip`. Fetch ALL items including Absent status (needed for Scenarios 2 and 3).

### Transaction Execution
- **D-09:** Sequential transaction submission — one tx per action, wait for receipt with bounded timeout. Explicit nonce management (fetch once at start, increment locally per tx).
- **D-10:** Stop on first failure — any tx failure, revert, or receipt timeout stops the entire run. Next run re-diffs and retries. Safest approach for low-volume steady state (0-2 actions/run).
- **D-11:** Dry-run mode (BOT-08): `--dry-run` flag prints the action list as JSON to stdout, sends no transactions, exits with code 0.

### Evidence / feedbackURI
- **D-12:** v1 uses `data:application/json;base64,...` URI for feedbackURI — evidence JSON embedded directly in calldata. No IPFS dependency, no Pinata, no external hosting. Acceptable gas cost on Sepolia.
- **D-13:** Evidence follows `kleros-reputation-oracle/v1` schema from PRD §13. The bot constructs the JSON, base64-encodes it, and passes as the feedbackURI parameter.

### Claude's Discretion
- Exact file layout within `bot/src/` (module boundaries, helper files)
- Zod config schema shape (BOT-06) — as long as it validates required env vars with secret redaction
- Logging approach (console.log vs structured logger) — keep it simple for PoC
- GraphQL query structure and type generation approach
- vitest config and test file organization

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Router Contract (Phase 1 output — the ABI the bot calls)
- `contracts/src/KlerosReputationRouter.sol` — Router implementation: function signatures, FeedbackType enum, events, constants
- `contracts/src/interfaces/IReputationRegistry.sol` — ERC-8004 interface (for understanding what Router calls)

### Bot Spec
- `.planning/research/kleros-reputation-oracle-prd-v2.md` §12 — Bot spec (config, polling, diff) — historical reference, GSD decisions override
- `.planning/research/kleros-reputation-oracle-prd-v2.md` §8 — PGTCR subgraph schema (GraphQL fields, status values, metadata)
- `.planning/research/kleros-reputation-oracle-prd-v2.md` §13 — IPFS evidence schema (kleros-reputation-oracle/v1)

### Subgraph & PGTCR
- `.claude/skills/pgtcr-stake-curate-skill.md` — PGTCR operations: GraphQL queries, ABI fragments, subgraph endpoints, item status logic
- `ethskills:indexing` — Subgraph fundamentals, Multicall3 with viem, pagination patterns

### Prior PoC (reference for validation patterns only — do not reuse code directly)
- `../erc8004-feedback-bot-fortunato/src/goldsky-items-mapper.ts` — CAIP-10 parsing, key0 validation patterns. Uses ethers (we use viem), skip pagination (we use id_gt cursor), class-based (we use pure functions). Extract validation logic patterns only.

### Pitfalls
- `.planning/research/PITFALLS.md` — Pitfalls 1 (subgraph lag), 2 (nonce collision), 6 (IPFS blocking — N/A with data: URI), 7 (multicall batch size), 9 (pagination cursor), 12 (CAIP-10 validation), 15 (Goldsky rate limiting)

### Technology Stack
- `.planning/research/STACK.md` — viem ^2.47, graphql-request ^7.4, zod ^4.3, tsx ^4.21, vitest ^4.1

### Phase 1 Decisions
- `.planning/phases/01-router-contract-on-chain-setup/01-CONTEXT.md` — D-01 through D-04 (FeedbackType enum, atomic submitNegativeFeedback, revokeOnly)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `contracts/src/KlerosReputationRouter.sol` — The ABI the bot calls. Functions: `submitPositiveFeedback(uint256, bytes32, string)`, `submitNegativeFeedback(uint256, string)`, `revokeOnly(uint256)`, `feedbackType(uint256)`, `authorizedBots(address)`.
- Router ABI can be extracted from Foundry build artifacts (`contracts/out/KlerosReputationRouter.sol/KlerosReputationRouter.json`) or defined as a TypeScript const.

### Established Patterns
- Foundry project lives in `contracts/` — bot in `bot/` mirrors this separation.
- Fork testing pattern from Phase 1 (`forge test --fork-url`) — bot tests use vitest with different patterns (pure function unit tests, no fork needed for diff logic).

### Integration Points
- Bot → Router: viem contract writes (`submitPositiveFeedback`, `submitNegativeFeedback`, `revokeOnly`)
- Bot → Router: viem multicall reads (`feedbackType(agentId)` for all agents)
- Bot → Goldsky subgraph: graphql-request queries with `id_gt` cursor pagination
- Bot → stdout: dry-run JSON output, exit codes (0 success, non-zero failure)

</code_context>

<specifics>
## Specific Ideas

- Prior PoC at `../erc8004-feedback-bot-fortunato/` has proven CAIP-10 parsing and key0 validation patterns. Rewrite in viem/pure-function style, don't copy the class-based ethers code.
- `data:application/json;base64,...` for feedbackURI is a Sepolia PoC approach. Production (v2) should switch to IPFS — the only change is how feedbackURI is constructed, Router doesn't care.
- Bot calls `submitNegativeFeedback` for Scenario 2 — one call, Router handles revoke internally (Phase 1 D-03). Bot never calls revoke + negative separately.

</specifics>

<deferred>
## Deferred Ideas

- **Multicall batching for tx execution** — Current design is sequential (one tx per action). For high-volume scenarios (large list bootstrap), Multicall3 with `allowFailure: true` could batch all actions into one tx. Low priority since steady-state is 0-2 actions/run. Document as future optimization path.
- **IPFS evidence upload (IPFS-01/02/03)** — v2 requirement. Replace `data:` URI with IPFS CID from Pinata. Separate prepare phase (upload all IPFS) from execute phase (send txs).
- **Subgraph lag detection (Pitfall 1)** — Query `_meta { block { number } }` and compare to chain head. Skip run if lag exceeds threshold. Production hardening, not needed for PoC.
- **Transaction safety hardening (TXSAFE-01 through TXSAFE-04)** — v2 requirements: gas estimation retry, dropped receipt handling, balance preflight, SIGTERM graceful shutdown.

</deferred>

---

*Phase: 02-stateless-bot*
*Context gathered: 2026-03-26*
