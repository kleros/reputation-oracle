# Kleros Reputation Oracle

## What This Is

A system that converts Kleros PGTCR (Stake Curate) curation events into ERC-8004 on-chain reputation feedback. When an AI agent is verified on a Kleros curated registry, it receives positive reputation (+95). When removed by dispute, it receives negative reputation (-95). When it voluntarily withdraws, the positive reputation is revoked (neutral). Three components: a Router smart contract (Solidity), a stateless Bot (TypeScript), and a one-time Kleros 8004 Identity registration.

## Core Value

Kleros-backed, economically-secured reputation signals for ERC-8004 AI agents — the first reputation oracle where feedback is backed by real economic stake (WETH bonds) and human jury rulings.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Router contract deployed on Sepolia with hardcoded feedback constants (±95, decimals 0)
- [ ] Router tracks feedback state per agentId (hasFeedback, feedbackIndex)
- [ ] Router maps PGTCR itemId → agentId via on-chain mapping (Strategy C for admin, Strategy A as primary via subgraph key0)
- [ ] Bot reads PGTCR state from Goldsky subgraph (cursor-based pagination, all items including Absent)
- [ ] Bot reads Router state via Multicall3-batched hasFeedback() calls
- [ ] Bot computes stateless diff: subgraph state vs Router state → action list
- [ ] Scenario 1: Item Submitted/Reincluded + no feedback → giveFeedback(+95, "verified", "kleros-agent-registry")
- [ ] Scenario 2: Item Absent + disputeOutcome=Reject + has feedback → revokeFeedback then giveFeedback(-95, "removed", "kleros-agent-registry")
- [ ] Scenario 3: Item Absent + voluntary withdrawal + has feedback → revokeFeedback only
- [ ] Bot resolves agentId from subgraph metadata.key0, validates chain via metadata.key2 (CAIP-10)
- [ ] Bot uploads IPFS evidence JSON (kleros-reputation-oracle/v1 schema) before feedback calls
- [ ] Bot is one-shot (run once, exit) — no daemon mode, no polling loop
- [ ] Transaction safety: gas estimation retryable, tx submission not; handle null/dropped receipts; balance preflight; SIGTERM graceful shutdown
- [ ] Subgraph data validation: itemID format, metadata fields, status enum, disputeOutcome
- [ ] Config validation at startup: required CHAIN_ID, generic RPC_URL, private key redaction
- [ ] Kleros registered as 8004 agent on IdentityRegistry with oracle service metadata
- [ ] Contract upgradeable (proxy pattern) to support future multi-list and multi-product extensions
- [ ] All three scenarios verifiable on Sepolia via getSummary()

### Out of Scope

- Local database or persistent state — stateless diff architecture eliminates the need
- Eligibility engine or age thresholds — PGTCR submissionPeriod already handles this
- Configurable feedback values — ±95, decimals 0, tags are protocol constants in Router
- Multi-chain routing within a single process — one deployment per chain, chain = env vars
- Daemon mode or long-running polling — one-shot run, external scheduler invokes
- Multi-list support in v1 — single PGTCR list per Router deployment; contract upgradeable for future
- Curate v2 / Kleros v2 support — using v1 for now; architecture supports future migration
- Re-registration revocation — history accumulates; agent removed then re-accepted shows mixed record

## Context

- **Target chain:** Ethereum Sepolia (chainId 11155111) for PoC, then Mainnet/Arbitrum/Base
- **PGTCR contract:** `0x3162df9669affa8b6b6ff2147afa052249f00447` (Sepolia Verified Agents list)
- **Subgraph endpoints:**
  - Sepolia: `https://api.goldsky.com/api/public/project_cmgx9all3003atlp2bqha1zif/subgraphs/pgtcr-sepolia/v0.0.2/gn`
  - Mainnet: `https://api.goldsky.com/api/public/project_cmgx9all3003atlp2bqha1zif/subgraphs/pgtcr-mainnet/v0.0.1/gn`
- **Arbitrator:** Kleros v1 on Ethereum
- **Agent resolution:** Strategy A — metadata.key0 = numeric agentId, metadata.key2 = CAIP-10 chain validation
- **PGTCR model:** CAIP-10 multi-chain item registrations, one list on Sepolia for testing, one on Mainnet (not yet deployed) for all production chains
- **Prior work:** A vibe-coded PoC was reviewed and its architectural issues documented in the PRD amendments (over-engineering, mock-heavy tests, daemon mode, local DB — all explicitly excluded from this build)
- **Tooling:** Foundry (contracts), viem (bot), Biome.js (linting), vitest (testing)
- **Multicall3:** `0xcA11bde05977b3631167028862bE2a173976CA11` for batched view calls

## Constraints

- **Tech stack**: Solidity ^0.8.20 (Router), TypeScript with viem (Bot), Foundry (testing/deployment) — per PRD §18
- **Architecture**: Bot calls Router only, never ReputationRegistry directly — Router is the trusted clientAddress
- **Tags**: tag1 = semantic signal (`verified`/`removed`), tag2 = source identifier (`kleros-agent-registry`) — designed for future multi-product Kleros feedback
- **Testing**: Test boundaries (subgraph, contracts), not wiring. No mock-call-ordering tests. Forked integration tests against anvil. Pure function tests for computeActions() diff logic.
- **Upgradability**: Router must be upgradeable (proxy) to support future multi-list, multi-product extensions without redeployment

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Strategy A for agent resolution (key0 = agentId) | AgentId already in PGTCR item metadata; no admin overhead | — Pending |
| Tags: verified/removed + kleros-agent-registry | Generic tag1 enables cross-provider filtering; tag2 identifies Kleros source; future-proof for Reality proxy etc. | — Pending |
| Stateless diff architecture | No local DB needed; idempotency from architecture; prior PoC proved DB approach adds complexity without value | — Pending |
| One-shot bot, no daemon | External scheduler handles frequency; simpler ops; prior PoC's daemon mode was over-engineered | — Pending |
| Kleros v1 arbitrator | Current PGTCR uses v1; architecture supports future v2 migration | — Pending |
| History accumulates on re-registration | Agent removed then re-accepted shows mixed record (-95, +95); no revoke of old negative | — Pending |
| Upgradeable Router contract | Future multi-list and multi-product extensions without redeployment | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-24 after initialization*
