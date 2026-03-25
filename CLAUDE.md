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

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Kleros Reputation Oracle**

A system that converts Kleros PGTCR (Stake Curate) curation events into ERC-8004 on-chain reputation feedback. When an AI agent is verified on a Kleros curated registry, it receives positive reputation (+95). When removed by dispute, it receives negative reputation (-95). When it voluntarily withdraws, the positive reputation is revoked (neutral). Three components: a Router smart contract (Solidity), a stateless Bot (TypeScript), and a one-time Kleros 8004 Identity registration.

**Core Value:** Kleros-backed, economically-secured reputation signals for ERC-8004 AI agents — the first reputation oracle where feedback is backed by real economic stake (WETH bonds) and human jury rulings.

### Constraints

- **Tech stack**: Solidity ^0.8.20 (Router), TypeScript with viem (Bot), Foundry (testing/deployment) — per PRD §18
- **Architecture**: Bot calls Router only, never ReputationRegistry directly — Router is the trusted clientAddress
- **Tags**: tag1 = semantic signal (`verified`/`removed`), tag2 = source identifier (`kleros-agent-registry`) — designed for future multi-product Kleros feedback
- **Testing**: Test boundaries (subgraph, contracts), not wiring. No mock-call-ordering tests. Forked integration tests against anvil. Pure function tests for computeActions() diff logic.
- **Upgradability**: Router must be upgradeable (proxy) to support future multi-list, multi-product extensions without redeployment
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Solidity | ^0.8.20 | Router contract language | Matches ERC-8004 registry contracts; ^0.8.20 for custom errors, immutable, PUSH0 |
| Foundry | latest (foundryup) | Contract dev, test, deploy | Industry standard for Solidity; forge test with fork mode for integration tests against anvil |
| TypeScript | ^5.7 | Bot language | Strict type safety; viem requires it |
| Node.js | 22 LTS | Runtime | Native `--env-file` flag (no dotenv needed), stable fetch API, LTS until 2027 |
| viem | ^2.47 | Ethereum client library | Type-safe, native Multicall3 support via `multicall()`, first-class ABI typing, lighter than ethers |
| zod | ^4.3 | Config validation | Schema validation with `.transform()` for env parsing; `.catch()` for redacting private keys in errors |
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| graphql-request | ^7.4 | Subgraph queries | Lightweight GraphQL client; cursor-based pagination with `id_gt` |
| pinata | ^2.5 | IPFS pinning | Official Pinata SDK for pinning evidence JSON; alternative: raw fetch to pinning API |
| tsx | ^4.21 | TypeScript execution | Zero-config TS runner; use for bot entry point (`tsx src/index.ts`) |
| @openzeppelin/contracts | ^5.6 | Proxy patterns | UUPS proxy for upgradeable Router; battle-tested, audited |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| Biome.js ^2.4 | Linting + formatting | Replaces ESLint + Prettier; single tool, fast, opinionated. Config: `biome.json` |
| vitest ^4.1 | Bot unit/integration tests | Jest-compatible API, native TypeScript, fast; use with viem's test utilities |
| forge (Foundry) | Contract tests | `forge test --fork-url` for integration tests against Sepolia fork |
| anvil (Foundry) | Local Ethereum node | Fork Sepolia for integration testing; deploy Router locally |
## Installation
# Bot dependencies
# Bot dev dependencies
# Contracts (Foundry)
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| viem | ethers.js v6 | Only if existing codebase uses ethers; viem has better TypeScript types and native multicall |
| graphql-request | urql / apollo-client | Only for complex caching; graphql-request is sufficient for simple polling |
| Biome.js | ESLint + Prettier | Only if team has existing ESLint config to preserve; Biome is faster and simpler |
| vitest | Jest | Only if Jest plugins are required; vitest is API-compatible and faster |
| Pinata SDK | web3.storage / Infura IPFS | web3.storage if free tier matters; Pinata has better uptime and simpler API |
| zod | joi / yup | zod has best TypeScript inference; joi/yup are runtime-only |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| ethers.js v5 | Deprecated, no maintenance, poor TypeScript types | viem ^2.47 |
| dotenv | Node 22 has native `--env-file` flag | `node --env-file=.env` or `tsx --env-file=.env` |
| hardhat | Slower compilation, plugin overhead, config complexity | Foundry (forge/anvil) |
| axios | Unnecessary for simple HTTP; fetch is built-in | Native fetch (Node 22) |
| SQLite/LevelDB/any local DB | Violates stateless architecture; see PRD amendments | Stateless diff from subgraph + chain |
| Transparent proxy (ERC-1967) | Admin slot collision risk, higher gas | UUPS proxy (ERC-1822) via OpenZeppelin |
## Stack Patterns by Variant
- Use `client.multicall({ contracts: [...] })` — viem handles batching automatically
- Multicall3 at `0xcA11bde05977b3631167028862bE2a173976CA11` (all chains)
- Batch size: ~100 calls per multicall to stay under gas limits
- Inherit `UUPSUpgradeable` from OpenZeppelin
- Use `Initializable` instead of constructor
- `_authorizeUpgrade()` restricted to owner
- Deploy via `forge script` with `ERC1967Proxy`
- Cursor-based: `where: { id_gt: $lastId }`, `orderBy: id`, `first: 1000`
- Never use `skip` — degrades above 5000, silently truncates above 10000
## Version Compatibility
| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| viem ^2.47 | TypeScript ^5.7 | viem requires strict TypeScript for ABI type inference |
| @openzeppelin/contracts ^5.6 | Solidity ^0.8.20 | v5 dropped Solidity <0.8.20 support |
| Foundry (latest) | Solidity ^0.8.20 | foundryup always installs latest; pin via foundry.toml `solc_version` |
| vitest ^4.1 | Node.js ^22 | Uses native test runner hooks |
## Sources
- npm registry — versions verified via `npm view` on 2026-03-24
- viem docs — multicall API, contract interaction patterns
- OpenZeppelin docs — UUPS proxy pattern, v5 migration
- Foundry book — forge test, anvil fork mode, deployment scripts
- PRD §18 — tech stack constraints (Foundry, viem, Biome.js, vitest)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
