# Kleros Reputation Oracle

Converts Kleros PGTCR (Stake Curate) curation events → ERC-8004 on-chain reputation feedback.
Three components: **Router contract** (Solidity), **Bot** (TypeScript), **Kleros 8004 Identity** (one-time setup).
Target: Ethereum Sepolia (chainId 11155111). Tooling: Foundry, viem, Biome.js, vitest.

## Architecture

```
PGTCR subgraph (GraphQL) → Bot (TS) → Router.sol → 8004 ReputationRegistry
                                ↕
                          IPFS (evidence JSON)
```

Bot reads PGTCR state from Goldsky subgraph + Router state from chain, diffs, calls Router.
Router is the `clientAddress` for 8004 ReputationRegistry. Bot NEVER calls ReputationRegistry directly.

## Three scenarios (entire business logic)

| # | Trigger | Router calls |
|---|---------|--------------|
| 1 | Item Submitted/Reincluded, no feedback yet | `giveFeedback(agentId, 95, 0, "curate-verified", "kleros-agent-registry", "", ipfsCID, 0x0)` |
| 2 | Item Absent + disputeOutcome=Reject, has feedback | `revokeFeedback(oldIndex)` then `giveFeedback(agentId, -95, 0, "curate-removed", ...)` |
| 3 | Item Absent + voluntary withdrawal, has feedback | `revokeFeedback(oldIndex)` — no new feedback |

Revoke-then-negative (Scenario 2) ensures `getSummary` = -95, not average of (+95,-95) = 0.

## Don't do

- **No local DB/persistence.** No SQLite, no files, no checkpoints. Stateless diff engine.
- **No eligibility engine/age thresholds.** PGTCR `submissionPeriod` already handles this.
- **No configurable feedback values.** ±95, decimals 0, tags — all constants in Router contract.
- **No multi-chain routing in one process.** One deployment per chain, chain = env vars.
- **No daemon mode.** One-shot run, external scheduler invokes. No `while(true)`.
- **No mock-call-ordering tests.** Test boundaries (subgraph, contracts), not wiring.

## Key design decisions

- Stateless diff: read subgraph + Router → `computeActions()` pure function → execute → exit.
- Multicall3 (`0xcA11bde05977b3631167028862bE2a173976CA11`) for batched `hasFeedback()` reads.
- Subgraph pagination: `id_gt` cursor, NOT `skip` (degrades >5000). Fetch ALL items incl. Absent.
- Tx safety: gas estimation retryable, tx submission NOT. Handle null/dropped receipts. Balance preflight. SIGTERM graceful shutdown.
- POC: admin mapping (Strategy C) for item→agentId. Production: agentId column in PGTCR schema.
- IPFS evidence schema: `kleros-reputation-oracle/v1` — details in PRD §13.

## Open questions (§19)

- **Q1:** Re-registration after dispute — history accumulates. Router's single `feedbackIndex[agentId]` needs refinement for this edge case.
- **Q7:** v1 vs v2 arbitrator — PENDING confirmation. Affects subgraph, arbitratorExtraData format.

## PRD section index

| §  | Topic | Lines |
|----|-------|-------|
| 2  | Solution overview, value encoding | 109–131 |
| 3  | Architecture, component summary | 133–190 |
| 5  | Deployed addresses | 311–343 |
| 6  | Mapping logic, 3 scenarios, resolution strategies | 345–461 |
| 7  | PermanentGTCR contract reference | 463–707 |
| 8  | PGTCR subgraph schema (GraphQL) | 708–987 |
| 11 | Router contract full spec | 1109–1383 |
| 12 | Bot spec (config, polling, diff) | 1384–1852 |
| 13 | IPFS evidence schema | 1853–1931 |
| 14 | Kleros 8004 identity setup | 1945–2008 |
| 16 | Testing plan | 2055–2117 |
| 17 | File structure | 2119–2170 |
| 19 | Open design questions | 2213–2278 |
| 20 | Success criteria | 2281–2306 |

## Reference docs

- PRD: `.planning/research/kleros-reputation-oracle-prd-v2.md` — read by section number above
- Amendments: `.planning/research/kleros-reputation-oracle-prd-v2-amendments.md`

## Skills (when to use which)

| Skill | Use for |
|-------|---------|
| `.claude/skills/pgtcr-stake-curate-skill.md` | PGTCR operations: GraphQL queries, ABI fragments, subgraph endpoints, item status logic, tx patterns |
| `8004scan-skill:8004` | ERC-8004 protocol deep-dive: feedback struct, trust labels, value scales, revocation, SDK recipes |
| `8004scan-skill:8004scan` | 8004scan API: search agents, query feedback, lookup by owner, platform stats |
| `ethskills:standards` | Broader Ethereum standards context: x402 payment protocol, EIP-3009, EIP-7702, how ERC-8004 fits the ecosystem |
| `ethskills:indexing` | Subgraph fundamentals, Multicall3 with viem, event design, pagination, alternative indexing solutions |
