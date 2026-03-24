# Feature Research

**Domain:** On-chain reputation oracle (PGTCR curation events to ERC-8004 feedback)
**Researched:** 2026-03-24
**Confidence:** HIGH

This is infrastructure, not a user-facing application. "Features" means capabilities of the Router contract + stateless bot system. "Users" are operators running the bot + downstream consumers querying reputation via `getSummary()`.

## Feature Landscape

### Table Stakes (System Is Broken Without These)

These capabilities are non-negotiable. If any is missing, the oracle does not function.

#### Contract Layer

| Feature | Why Required | Complexity | Notes |
|---------|-------------|------------|-------|
| Scenario 1: Positive feedback (giveFeedback +95) | Core value proposition -- verified agents get reputation | LOW | Constants hardcoded in Router. Single `giveFeedback` call to ReputationRegistry. |
| Scenario 2: Revoke-then-negative feedback (-95) | Dispute removal must produce -95, not average of (+95,-95)=0 | MEDIUM | Must revoke existing positive first, then submit negative. Atomic sequence in one tx function. |
| Scenario 3: Revoke-only (voluntary withdrawal) | Neutral exit -- agent stops committing but was not condemned | LOW | Single `revokeFeedback` call, clears `hasFeedback` state. |
| Feedback state tracking (hasFeedback + feedbackIndex per agentId) | Bot needs to know current Router state for stateless diff | LOW | Two mappings. Critical for idempotency. |
| Duplicate prevention (revert on double-positive) | Prevents corrupted reputation if bot runs twice | LOW | `require(!hasFeedback[agentId])` guard in `submitPositiveFeedback`. |
| Bot authorization (onlyAuthorizedBot modifier) | Only trusted addresses can submit feedback on Kleros's behalf | LOW | `mapping(address => bool) authorizedBots` with owner-only setter. |
| Owner admin functions (transferOwnership, setAuthorizedBot, registry setters) | Operational control -- swap bot wallets, update registry addresses | LOW | Standard owner pattern. |
| Router as clientAddress (never bot EOA) | Consumers trust a verifiable contract, not a random wallet. If bot wallet changes, reputation is preserved. | LOW | Architectural constraint, not code complexity. Bot calls Router; Router calls ReputationRegistry. |

#### Bot Layer

| Feature | Why Required | Complexity | Notes |
|---------|-------------|------------|-------|
| Subgraph polling with cursor-based pagination | Read PGTCR state -- source of truth for curation events | MEDIUM | Must use `id_gt` cursor, NOT `skip` (degrades >5000). Fetch ALL items including Absent. |
| Multicall3 batched Router state reads | Read on-chain feedback state efficiently | MEDIUM | Batch `hasFeedback()` calls via Multicall3. Without this, 1000 agents = 1000 RPC calls. |
| Stateless diff engine (computeActions pure function) | Core business logic -- compare subgraph vs Router, produce action list | MEDIUM | Pure function: `(SubgraphItem[], RouterState) => Action[]`. No local state needed. |
| Agent ID resolution from subgraph metadata | Map PGTCR items to 8004 agentIds | LOW | Strategy A: `metadata.key0` = numeric agentId. Validate with `metadata.key2` CAIP-10 chain. |
| IPFS evidence upload before feedback calls | ERC-8004 expects `feedbackURI` pointing to structured evidence | MEDIUM | Upload JSON to Pinata, get CID, pass as URI to Router. Schema: `kleros-reputation-oracle/v1`. |
| One-shot execution (run once, exit) | Stateless architecture -- external scheduler handles frequency | LOW | No `while(true)`, no `sleep()`. Process exits after one diff-execute pass. |
| Config validation at startup | Fail fast on misconfiguration before any network calls | LOW | Required: CHAIN_ID, RPC_URL, ROUTER_ADDRESS, private key format. Redact secrets from errors. |

#### Setup (One-Time)

| Feature | Why Required | Complexity | Notes |
|---------|-------------|------------|-------|
| Kleros 8004 identity registration | Kleros must exist as an agent in IdentityRegistry to give feedback | LOW | Manual: `IdentityRegistry.register(agentURI)` with IPFS-hosted metadata JSON. |
| Router deployment + configuration | The contract must exist on-chain and know its klerosAgentId | LOW | Deploy, then `setKlerosAgentId()` and `setAuthorizedBot()`. |

### Differentiators (Competitive Advantage)

These capabilities distinguish a robust, production-quality oracle from a fragile proof of concept.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Transaction safety: gas estimation retry, tx submission no-retry | Prevents duplicate on-chain actions from retry bugs. Gas estimation is a read (safe to retry); tx submission may be in mempool even if response lost (unsafe to retry). | MEDIUM | Separate the two concerns explicitly. Log tx hash for operator investigation if dropped. |
| Balance preflight check | Fail fast with clear operator signal instead of wasting time on actions that will fail for insufficient gas | LOW | Query ETH balance, compare to threshold (0.01 ETH), exit with error code if below. |
| Graceful shutdown (SIGTERM/SIGINT handling) | Let current transaction complete before exiting. Stateless model means next run picks up remaining work. | LOW | Set shutdown flag, check between batch items. |
| Subgraph data validation | Malformed subgraph data should be logged and skipped, not crash the run | MEDIUM | Validate: itemID format, metadata fields, status enum values, disputeOutcome values, CAIP-10 chain match. |
| Structured logging with run summary | Operators need to know: how many items scanned, how many actions taken, any errors | LOW | Log at start (config summary, redacted key) and end (action count, error count). |
| IPFS evidence with Kleros-specific metadata | Evidence includes dispute details, stake amounts, evidence links -- gives reputation consumers full provenance | LOW | Schema already defined. Adds `kleros.disputeId`, `kleros.ruling`, `kleros.evidenceLinks` to standard ERC-8004 fields. |
| Upgradeable Router (proxy pattern) | Future multi-list, multi-product extensions without redeploying and losing all accumulated feedback state | HIGH | UUPS or TransparentProxy. Storage layout must be carefully managed for future upgrades. |
| Contract event emissions | Enable off-chain indexing and monitoring of oracle actions | LOW | Events already specified: `PositiveFeedbackSubmitted`, `NegativeFeedbackSubmitted`, `FeedbackRevoked`, etc. |

### Anti-Features (Deliberately NOT Built)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Local database / persistent state (SQLite, files, checkpoints) | "Track what we already processed" | Adds complexity, consistency bugs, deployment burden. Prior PoC proved this adds no value -- state lives on-chain (Router) and off-chain (subgraph). | Stateless diff: read both sources, compute diff, execute, exit. Idempotency from architecture. |
| Eligibility engine / age thresholds / cooldown periods | "Don't give reputation too early" | PGTCR `submissionPeriod` already enforces a challenge window. Adding a second delay duplicates a protocol guarantee and delays reputation signals unnecessarily. | Trust the PGTCR: if subgraph says `Submitted`/`Reincluded`, the protocol has already validated durability. |
| Configurable feedback values (env vars for value, tags) | "Make it flexible" | Values are protocol constants, not application config. Making them configurable invites misconfiguration and breaks the semantic contract with consumers. | Hardcode in Router contract: +/-95, decimals 0, tags as constants. |
| Daemon mode / long-running polling loop | "Keep it running continuously" | Adds process management complexity (health checks, restart logic, memory leaks). Prior PoC's daemon was over-engineered. | One-shot run + external scheduler (cron, systemd timer, K8s CronJob). Simpler ops, same result. |
| Multi-chain routing in a single process | "Handle all chains at once" | Per-chain config overlays, suffix-based env resolution, error isolation across chains -- all unnecessary complexity. | One deployment per chain. Chain = env vars (RPC_URL, CHAIN_ID). Simple, isolated, independently deployable. |
| DRY_RUN mode as testing substitute | "Test without real transactions" | DRY_RUN skips the exact code path that has bugs (transaction lifecycle). Creates false confidence. | Forked integration tests with anvil. Test real contract calls against a local fork. |
| Mock-call-ordering tests | "Verify dependencies are called correctly" | Tests implementation details, not behavior. Every refactor breaks tests even if system still works. | Test boundaries: pure `computeActions()` tests, subgraph validation tests, forked contract tests. |
| Multi-list support in v1 | "Support different PGTCR lists" | Premature generalization. Single list is enough for PoC. Multi-list changes storage layout (nested mappings), adds complexity to diff logic. | Upgradeable Router supports future multi-list via proxy upgrade. Design for it, don't build it yet. |
| Re-registration revocation (clear old negative on re-acceptance) | "Clean slate for re-accepted agents" | History should accumulate. An agent that was condemned then re-accepted should show a mixed record. This is a feature, not a bug -- consumers can see the full reputation trajectory. | Accept that `getSummary` returns the average of all feedback. Mixed history = mixed reputation. |

## Feature Dependencies

```
[Config validation]
    └──requires──> [nothing -- runs first at startup]

[Subgraph polling with pagination]
    └──requires──> [Config validation]

[Multicall3 batched Router reads]
    └──requires──> [Config validation]

[Stateless diff engine (computeActions)]
    └──requires──> [Subgraph polling]
    └──requires──> [Multicall3 batched reads]

[Agent ID resolution]
    └──requires──> [Subgraph polling] (reads metadata.key0/key2)

[IPFS evidence upload]
    └──requires──> [Agent ID resolution]
    └──requires──> [Subgraph polling] (needs item data for evidence fields)

[Scenario 1/2/3 execution]
    └──requires──> [Stateless diff engine] (determines actions)
    └──requires──> [IPFS evidence upload] (for Scenarios 1 and 2)
    └──requires──> [Router contract deployed with all 3 functions]
    └──requires──> [Kleros 8004 identity registered]
    └──requires──> [Bot wallet authorized on Router]

[Transaction safety]
    └──enhances──> [Scenario 1/2/3 execution]

[Balance preflight]
    └──enhances──> [Scenario 1/2/3 execution]

[Graceful shutdown]
    └──enhances──> [Scenario 1/2/3 execution]

[Subgraph data validation]
    └──enhances──> [Subgraph polling]

[Upgradeable Router]
    └──conflicts──> [Simple Router deployment] (choose one pattern)
```

### Dependency Notes

- **computeActions requires both data sources:** The diff engine needs subgraph state AND Router state. Both must be fetched before any actions can be computed.
- **IPFS upload before contract call:** Evidence JSON must be pinned and CID available before `submitPositiveFeedback` or `submitNegativeFeedback` can be called (they take `feedbackURI` as parameter).
- **One-time setup gates everything:** Kleros identity registration, Router deployment, bot authorization -- all must happen before the bot can execute any scenario.
- **Upgradeable Router conflicts with simple deployment:** Must choose proxy pattern upfront. Cannot easily retrofit upgradeability later without redeploying and losing state.

## MVP Definition

### Launch With (v1 -- PoC on Sepolia)

- [ ] Router contract with all 3 scenario functions + constants + state tracking
- [ ] Bot: config validation, subgraph polling (cursor pagination), Multicall3 reads, computeActions diff, IPFS upload, one-shot execution
- [ ] All 3 scenarios working end-to-end on Sepolia
- [ ] Kleros 8004 identity registered
- [ ] Subgraph data validation (log and skip invalid items)
- [ ] Transaction safety (separate gas estimation from submission, handle dropped tx)
- [ ] Balance preflight check
- [ ] Foundry contract tests + vitest pure function tests for computeActions

### Add After Validation (v1.x)

- [ ] Upgradeable Router (proxy pattern) -- trigger: confirmed need for multi-list or parameter changes
- [ ] Graceful shutdown (SIGTERM handling) -- trigger: running in production with real economic value
- [ ] Structured JSON logging -- trigger: ops team needs log aggregation
- [ ] Monitoring/alerting integration -- trigger: production deployment

### Future Consideration (v2+)

- [ ] Multi-list support (different PGTCR lists with different tag2 values) -- defer until second Kleros list exists
- [ ] Multi-chain deployment tooling -- defer until mainnet/Arbitrum deployment
- [ ] Batched write transactions -- defer until gas costs matter (mainnet scale)
- [ ] Curate v2 / Kleros v2 arbitrator support -- defer until v1 vs v2 question (Q7) resolved

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Scenario 1: Positive feedback | HIGH | LOW | P1 |
| Scenario 2: Revoke-then-negative | HIGH | MEDIUM | P1 |
| Scenario 3: Revoke-only | HIGH | LOW | P1 |
| Feedback state tracking | HIGH | LOW | P1 |
| Stateless diff engine | HIGH | MEDIUM | P1 |
| Subgraph polling + pagination | HIGH | MEDIUM | P1 |
| Multicall3 batched reads | HIGH | MEDIUM | P1 |
| Agent ID resolution | HIGH | LOW | P1 |
| IPFS evidence upload | HIGH | MEDIUM | P1 |
| Config validation | MEDIUM | LOW | P1 |
| Transaction safety | MEDIUM | MEDIUM | P1 |
| Balance preflight | MEDIUM | LOW | P1 |
| Subgraph data validation | MEDIUM | MEDIUM | P1 |
| Kleros 8004 identity setup | HIGH | LOW | P1 |
| Contract event emissions | MEDIUM | LOW | P1 |
| Upgradeable Router | MEDIUM | HIGH | P2 |
| Graceful shutdown | LOW | LOW | P2 |
| Structured logging | LOW | LOW | P2 |
| Multi-list support | LOW | HIGH | P3 |
| Multi-chain deployment | LOW | MEDIUM | P3 |
| Batched write transactions | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for PoC launch (validates the concept end-to-end on Sepolia)
- P2: Should have for production readiness
- P3: Future consideration when ecosystem demands it

## Competitor Feature Analysis

There are no direct competitors -- this is the first economically-secured reputation oracle for ERC-8004. The comparison is against alternative approaches to the same problem.

| Feature | Manual feedback (no oracle) | Generic oracle (Chainlink-style) | Kleros Reputation Oracle |
|---------|----------------------------|----------------------------------|--------------------------|
| Economic security backing | None -- anyone calls `giveFeedback` | Oracle stake (node operator bonds) | PGTCR continuous collateral (WETH bonds) + human jury |
| Dispute resolution | None | Oracle dispute (limited) | Full Kleros court with game-theoretic incentives |
| Sybil resistance | None | Moderate (reputation of node operators) | High (real economic stake per registration) |
| Negative signals | Manual, unverified | Possible but no standard mechanism | Automatic: dispute removal = -95, backed by court ruling |
| Revocation support | Manual | Not standard | Built-in: voluntary withdrawal cleanly revokes |
| Evidence trail | None | Varies | Full IPFS evidence with dispute details, stake amounts, rulings |
| Trust model | Consumer must vet each clientAddress individually | Trust the oracle network | Trust the PGTCR + Kleros court mechanism |

## Sources

- PRD v2: `.planning/research/kleros-reputation-oracle-prd-v2.md` (sections 2, 6, 11, 12, 13, 16, 19, 20)
- PRD Amendments: `.planning/research/kleros-reputation-oracle-prd-v2-amendments.md` (all 10 amendments)
- PROJECT.md: `.planning/PROJECT.md` (requirements, constraints, out of scope)
- ERC-8004 specification: referenced in PRD section 4
- Prior PoC review: documented in amendments (anti-patterns identified and excluded)

---
*Feature research for: Kleros Reputation Oracle (PGTCR to ERC-8004)*
*Researched: 2026-03-24*
