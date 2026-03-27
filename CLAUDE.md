# Kleros Reputation Oracle

Work style: telegraph; noun-phrases ok; drop filler/grammar; min tokens

## Git

Commits require GPG passphrase (interactive — will hang). Always use `-c commit.gpgsign=false` and append `Co-Authored-By: Claude <noreply@anthropic.com>` to commit messages.

## Project

Converts Kleros PGTCR (Stake Curate) curation events → ERC-8004 on-chain reputation feedback.
Three components: **Router contract** (Solidity), **Bot** (TypeScript), **Kleros 8004 Identity** (one-time setup).
Target: Ethereum Sepolia (chainId 11155111). Tooling: Foundry, viem, Biome.js, vitest.

## Architecture

```
PGTCR subgraph (GraphQL) → Bot (TS) → Router.sol → 8004 ReputationRegistry
```

Bot reads PGTCR state from Goldsky subgraph + Router state from chain, diffs, calls Router.
Router is the `clientAddress` for 8004 ReputationRegistry. Bot NEVER calls ReputationRegistry directly.

## Three scenarios (entire business logic)

| # | Trigger | Router calls |
|---|---------|--------------|
| 1 | Item Submitted/Reincluded, no feedback yet | `giveFeedback(agentId, 95, 0, "verified", "kleros-agent-registry", "", ipfsCID, 0x0)` |
| 2 | Item Absent + disputeOutcome=Reject, has feedback | `revokeFeedback(oldIndex)` then `giveFeedback(agentId, -95, 0, "removed", ...)` |
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
- Agent resolution: Strategy A — `metadata.key0` = numeric agentId, `metadata.key2` = CAIP-10 chain validation.
- Tags: `tag1` = semantic signal (`verified`/`removed`), `tag2` = source identifier (`kleros-agent-registry`).
- Router upgradeable via UUPS proxy (OpenZeppelin) with storage gaps for future multi-list/multi-product.
- Kleros v1 arbitrator on Ethereum. PGTCR list supports CAIP-10 multi-chain item registrations.
- Re-registration after dispute: history accumulates, no revoke of old negative.

## Subgraph endpoints

- Sepolia: `https://api.goldsky.com/api/public/project_cmgx9all3003atlp2bqha1zif/subgraphs/pgtcr-sepolia/v0.0.2/gn`
- Mainnet: `https://api.goldsky.com/api/public/project_cmgx9all3003atlp2bqha1zif/subgraphs/pgtcr-mainnet/v0.0.1/gn`
- PGTCR contract (Sepolia): `0x3162df9669affa8b6b6ff2147afa052249f00447`

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Status:** v1.0 shipped (2026-03-27). Live on Sepolia.

**Core Value:** Kleros-backed, economically-secured reputation signals for ERC-8004 AI agents — the first reputation oracle where feedback is backed by real economic stake (WETH bonds) and human jury rulings.

See `.planning/PROJECT.md` for full project context, requirements, constraints, and key decisions.
See [`contracts/README.md`](./contracts/README.md) for deployed addresses and deployment guide.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Solidity | ^0.8.20 | Router contract |
| Foundry | latest | Contract dev, test, deploy (`forge test --fork-url` for integration) |
| TypeScript | ^5.7 | Bot language (viem requires strict TS) |
| Node.js | 22 LTS | Runtime (native `--env-file`, stable fetch) |
| viem | ^2.47 | Ethereum client (type-safe, native Multicall3) |
| zod | ^4.3 | Config validation with secret redaction |
| graphql-request | ^7.4 | Subgraph queries |
| tsx | ^4.21 | TypeScript execution |
| @openzeppelin/contracts | ^5.6 | UUPS proxy for upgradeable Router |
| Biome.js | ^2.4 | Linting + formatting (replaces ESLint + Prettier) |
| vitest | ^4.1 | Bot unit/integration tests |

**Do NOT use:** ethers.js v5 (deprecated), dotenv (Node 22 has `--env-file`), hardhat (use Foundry), axios (use native fetch), any local DB (stateless architecture), transparent proxy (use UUPS).

See `.planning/research/STACK.md` for full rationale, alternatives, and version compatibility.
<!-- GSD:stack-end -->

## Skills (when to use which)

| Skill | Use for |
|-------|---------|
| `.claude/skills/pgtcr-stake-curate-skill.md` | PGTCR operations: GraphQL queries, ABI fragments, subgraph endpoints, item status logic, tx patterns |
| `8004scan-skill:8004` | ERC-8004 protocol deep-dive: feedback struct, trust labels, value scales, revocation, SDK recipes |
| `8004scan-skill:8004scan` | 8004scan API: search agents, query feedback, lookup by owner, platform stats |
| `ethskills:standards` | Broader Ethereum standards context: x402 payment protocol, EIP-3009, EIP-7702, how ERC-8004 fits the ecosystem |
| `ethskills:indexing` | Subgraph fundamentals, Multicall3 with viem, event design, pagination, alternative indexing solutions |

## Document hierarchy

**Authoritative (current):**
- `CLAUDE.md` (this file) — architecture, conventions, constraints
- `.planning/PROJECT.md` — project context, validated requirements, key decisions

**v1.0 planning artifacts (archived, read-only):**
- `.planning/milestones/v1.0-REQUIREMENTS.md` — v1 requirements with final status
- `.planning/milestones/v1.0-ROADMAP.md` — v1 phase details and plans
- `.planning/phases/*/XX-CONTEXT.md` — locked implementation decisions per phase

**Historical reference (read-only):** The PRD predates the GSD project setup. It contains useful background and rationale but is **not authoritative** — several details (tag values, state tracking model, atomicity decisions) were revised during GSD context gathering. When the PRD contradicts GSD artifacts, GSD artifacts win.
- `.planning/research/kleros-reputation-oracle-prd-v2.md` (2000+ lines, read by section)
- `.planning/research/kleros-reputation-oracle-prd-v2-amendments.md`

### PRD section index (for background reading)

| §  | Topic |
|----|-------|
| 2  | Solution overview, value encoding |
| 3  | Architecture, component summary |
| 5  | Deployed addresses |
| 6  | Mapping logic, 3 scenarios, resolution strategies |
| 7  | PermanentGTCR contract reference |
| 8  | PGTCR subgraph schema (GraphQL) |
| 11 | Router contract full spec |
| 12 | Bot spec (config, polling, diff) |
| 13 | IPFS evidence schema |
| 14 | Kleros 8004 identity setup |
| 16 | Testing plan |
| 17 | File structure |
| 19 | Open design questions (many resolved in GSD CONTEXT.md files) |
| 20 | Success criteria |

<!-- GSD:conventions-start source:CONVENTIONS.md -->
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
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

> Generated by GSD from session_analysis. Run `/gsd:profile-user --refresh` to update.

| Dimension | Rating | Confidence |
|-----------|--------|------------|
| Communication | conversational | HIGH |
| Decisions | fast-intuitive | MEDIUM |
| Explanations | concise | HIGH |
| Debugging | diagnostic | MEDIUM |
| UX Philosophy | full-stack | MEDIUM |
| Vendor Choices | opinionated | MEDIUM |
| Frustrations | instruction-adherence | MEDIUM |
| Learning | guided | MEDIUM |

**Directives:**
- **Communication:** Conversational tone. Address all parts of multi-part messages. No excessive formality.
- **Decisions:** Concise options, expect quick decisions. Confirm or challenge leanings directly.
- **Explanations:** Telegraphic style. Key decisions + brief rationale. No preambles.
- **Debugging:** Root cause alongside fix. Share diagnostics and reasoning.
- **UX Philosophy:** Full-stack perspective. Proactively suggest UI/UX improvements when relevant.
- **Vendor Choices:** Respect stated tool preferences. Use what project docs specify. Don't substitute without asking.
- **Frustrations:** Follow instructions precisely. Read project docs before acting. Ask, don't guess.
- **Learning:** Explain new concepts through dialogue. Anchor in existing project patterns.
<!-- GSD:profile-end -->
