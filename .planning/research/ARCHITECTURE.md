# Architecture Research

**Domain:** Oracle/bridge system — stateless diff engine converting curation events to on-chain reputation
**Researched:** 2026-03-24
**Confidence:** HIGH (architecture is fully specified in PRD + amendments; patterns are well-established)

## Standard Architecture

### System Overview

```
                                    EXTERNAL DATA SOURCES
┌───────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  ┌──────────────┐           ┌──────────────┐                         │
│  │ PGTCR        │           │ IPFS         │                         │
│  │ Subgraph     │           │ (Pinata/     │                         │
│  │ (Goldsky)    │           │  web3.stor)  │                         │
│  └──────┬───────┘           └──────▲───────┘                         │
│         │ GraphQL                  │ pin JSON                        │
│         │ (read)                   │ (write)                         │
└─────────┼──────────────────────────┼─────────────────────────────────┘
          │                          │
          ▼                          │
┌─────────────────────────────────────────────────────────────────────┐
│                         BOT (TypeScript)                             │
│                                                                      │
│  ┌─────────┐   ┌────────────┐   ┌──────────┐   ┌───────────┐       │
│  │ Config  │──►│ Subgraph   │──►│ Diff     │──►│ Executor  │       │
│  │ Loader  │   │ Reader     │   │ Engine   │   │           │       │
│  └─────────┘   └────────────┘   │(pure fn) │   └─────┬─────┘       │
│                                  └──────────┘         │              │
│  ┌─────────┐   ┌────────────┐        ▲               │              │
│  │ Balance │   │ Router     │────────┘               │              │
│  │ Check   │   │ State      │  (Multicall3           │              │
│  └─────────┘   │ Reader     │   batched reads)       │              │
│                └────────────┘                         │              │
└───────────────────────────────────────────────────────┼──────────────┘
                                                        │ tx calls
                                                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      ETHEREUM (Sepolia / Mainnet)                    │
│                                                                      │
│  ┌──────────────────┐     ┌──────────────────┐                      │
│  │ Kleros           │     │ 8004             │                      │
│  │ Reputation       │────►│ Reputation       │                      │
│  │ Router.sol       │     │ Registry         │                      │
│  │                  │     │                  │                      │
│  │ (clientAddress)  │     └──────────────────┘                      │
│  └──────────────────┘                                                │
│                            ┌──────────────────┐                      │
│  ┌──────────────────┐      │ 8004             │                      │
│  │ Kleros PGTCR     │      │ Identity         │                      │
│  │ Contract         │      │ Registry         │                      │
│  └──────────────────┘      └──────────────────┘                      │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| **KlerosReputationRouter.sol** | Encapsulates all feedback logic. Is the trusted `clientAddress` that consumers verify. Hardcodes feedback constants (+/-95, tags). Tracks per-agent feedback state (`hasFeedback`, `feedbackIndex`). Authorizes bot addresses. | Solidity ^0.8.20, upgradeable proxy, Foundry for testing/deployment |
| **Bot** | Stateless diff engine. Reads two data sources, computes required actions, executes them, exits. One-shot (no daemon). Handles IPFS pinning, transaction safety, graceful shutdown. | TypeScript, viem, graphql-request, one-shot CLI process |
| **Kleros 8004 Identity** | One-time registration of Kleros as an 8004 agent on the IdentityRegistry. Provides the `klerosAgentId` the Router uses. | Foundry deployment script, run once |

### Critical Boundary: Bot Never Calls ReputationRegistry

This is the most important architectural invariant. The Router contract is the `clientAddress` -- the identity consumers use to filter Kleros-backed reputation. If the bot called `ReputationRegistry.giveFeedback()` directly, the bot's EOA would become the `clientAddress`, which:
- Orphans all reputation if the bot wallet changes
- Requires consumers to trust a random EOA instead of a verifiable contract
- Makes the system fragile to key rotation

The bot is a "hand" that operates the Router, not an independent actor.

## Recommended Project Structure

```
kleros-reputation-oracle/
├── contracts/                     # Foundry project (Router contract)
│   ├── src/
│   │   ├── KlerosReputationRouter.sol
│   │   └── interfaces/
│   │       ├── IReputationRegistry.sol
│   │       └── IIdentityRegistry.sol
│   ├── test/
│   │   └── KlerosReputationRouter.t.sol
│   ├── script/
│   │   ├── DeployRouter.s.sol
│   │   └── RegisterKlerosAgent.s.sol
│   ├── foundry.toml
│   └── remappings.txt
│
├── bot/                           # TypeScript bot (stateless diff engine)
│   ├── src/
│   │   ├── index.ts               # Entry point: config -> read -> diff -> execute -> exit
│   │   ├── config.ts              # Env parsing + validation (Zod), fail-fast
│   │   ├── subgraph.ts            # GraphQL reader with cursor pagination
│   │   ├── router-state.ts        # On-chain state reader (Multicall3 batched)
│   │   ├── diff.ts                # Pure function: computeActions(subgraph, router) -> Action[]
│   │   ├── executor.ts            # Executes actions: IPFS pin -> Router tx
│   │   ├── ipfs.ts                # IPFS evidence builder + pinner
│   │   ├── tx.ts                  # Transaction submission with safety (no-retry on broadcast)
│   │   ├── types.ts               # Shared types: SubgraphItem, Action, RouterState
│   │   └── abis/
│   │       └── router.ts          # Router ABI (generated or hand-maintained)
│   ├── test/
│   │   ├── diff.test.ts           # Pure function tests -- bulk of test effort
│   │   ├── subgraph.test.ts       # Validation: malformed data, missing fields, bad CAIP-10
│   │   ├── config.test.ts         # Config validation, secret redaction
│   │   └── integration/
│   │       └── router.test.ts     # Forked anvil tests: ABI verification, tx lifecycle
│   ├── package.json
│   ├── tsconfig.json
│   ├── biome.json
│   └── .env.example
│
├── metadata/                      # Static files for one-time setup
│   ├── kleros-agent-registration.json
│   └── example-evidence.json
│
├── .planning/                     # Project planning (not shipped)
├── biome.json                     # Root Biome config (shared)
├── package.json                   # Root workspace (if monorepo scripts needed)
└── .gitignore
```

### Structure Rationale

- **`contracts/` and `bot/` are siblings, not nested.** They have different toolchains (Foundry vs Node.js), different test runners (forge vs vitest), and different deployment targets. Keeping them at the same level avoids toolchain conflicts and makes CI configuration straightforward.
- **`bot/src/diff.ts` is the core module.** The `computeActions()` pure function contains all business logic. It takes data in, returns actions out, has no side effects, and is trivially testable. This is where most test effort should go.
- **`bot/src/tx.ts` isolates transaction safety.** Gas estimation retry vs. no-retry on submission, dropped receipt handling, and SIGTERM awareness live in one place. The executor calls `tx.ts` without knowing the safety details.
- **No `utils/` or `helpers/` folders.** Every module has a clear responsibility. If something doesn't fit, the design needs revisiting, not a junk drawer.
- **ABIs in `bot/src/abis/`.** The Router ABI should be generated from the Foundry build artifacts (`forge build` output) and copied to the bot. This ensures ABI-contract consistency. A build script can automate this.

## Architectural Patterns

### Pattern 1: Stateless Diff Engine

**What:** Each run reads the full current state from two sources (subgraph = desired state, Router = actual state), computes the difference, executes the minimum set of actions to reconcile them, then exits. No local state persists between runs.

**When to use:** When both data sources are queryable and the total dataset fits in memory. This system has at most a few thousand PGTCR items -- well within bounds.

**Trade-offs:**
- Pro: Idempotency from architecture. If a run fails halfway, the next run re-diffs and naturally picks up remaining work.
- Pro: No state migration, no database maintenance, no corruption recovery.
- Pro: Trivially testable core logic (pure function).
- Con: Reads all data every run. At 100k items this becomes expensive. But the PGTCR registry will not reach that scale.
- Con: Cannot detect "what changed since last run" -- only "what's different now." This is fine because the system only cares about current state, not history.

**Example:**
```typescript
// The entire business logic is a pure function
function computeActions(
  pgtcrItems: SubgraphItem[],
  routerState: Map<bigint, { hasFeedback: boolean }>
): Action[] {
  const actions: Action[] = [];
  for (const item of pgtcrItems) {
    const agentId = resolveAgentId(item);
    if (!agentId) continue;
    const has = routerState.get(agentId)?.hasFeedback ?? false;

    if ((item.status === "Submitted" || item.status === "Reincluded") && !has) {
      actions.push({ type: "positive", agentId, item });
    } else if (item.status === "Absent" && has) {
      const dispute = item.challenges?.[0];
      if (dispute?.disputeOutcome === "Reject") {
        actions.push({ type: "negative", agentId, item, challenge: dispute });
      } else {
        actions.push({ type: "revoke", agentId, item });
      }
    }
  }
  return actions;
}
```

### Pattern 2: Multicall3 Batched Reads

**What:** Instead of making N individual `eth_call` RPCs (one per agent) to read Router state, batch them into groups of ~100 using the Multicall3 contract deployed at `0xcA11bde05977b3631167028862bE2a173976CA11` on all major chains.

**When to use:** When reading the same view function for many different arguments. In this case, `Router.hasFeedback(agentId)` for every known agent.

**Trade-offs:**
- Pro: Reduces RPC calls from N to ceil(N/100). At 1000 agents: 10 calls instead of 1000.
- Pro: viem has first-class `multicall` support -- no custom encoding needed.
- Con: If one call in the batch reverts, behavior depends on `allowFailure` setting. Use `allowFailure: true` and handle individual failures.

**Example:**
```typescript
import { multicall } from "viem/actions";

const results = await publicClient.multicall({
  contracts: agentIds.map((id) => ({
    address: routerAddress,
    abi: ROUTER_ABI,
    functionName: "hasActiveFeedback",
    args: [id],
  })),
  allowFailure: true,
});

const routerState = new Map<bigint, { hasFeedback: boolean }>();
for (let i = 0; i < agentIds.length; i++) {
  const result = results[i];
  if (result.status === "success") {
    routerState.set(agentIds[i], { hasFeedback: result.result as boolean });
  }
}
```

### Pattern 3: Cursor-Based Subgraph Pagination

**What:** Paginate subgraph queries using `id_gt` (cursor) instead of `skip`. The Graph Protocol degrades above 5000 skip and silently truncates above 10000.

**When to use:** Always, when querying The Graph subgraphs with more than 1000 potential results.

**Trade-offs:**
- Pro: Reliable at any scale. No data loss from silent truncation.
- Pro: Deterministic ordering (by `id` ascending).
- Con: Slightly more code than `skip`-based pagination.

**Example:**
```typescript
async function fetchAllItems(
  client: GraphQLClient,
  registry: string
): Promise<SubgraphItem[]> {
  const allItems: SubgraphItem[] = [];
  let lastId = "";

  while (true) {
    const page = await client.request(ITEMS_QUERY, { registry, lastId });
    if (page.items.length === 0) break;
    allItems.push(...page.items);
    lastId = page.items[page.items.length - 1].id;
    if (page.items.length < 1000) break; // last page
  }

  return allItems;
}
```

### Pattern 4: Separated Gas Estimation and Tx Submission

**What:** Gas estimation is a read operation (retryable). Transaction submission is a write (not retryable -- it may already be in the mempool). These must be handled with different retry policies.

**When to use:** Any system that submits Ethereum transactions.

**Trade-offs:**
- Pro: Prevents duplicate transactions from retry-on-timeout.
- Pro: Clear failure modes: estimation failure = skip (temporary), submission failure = log and exit (needs investigation).
- Con: More complex than a simple `writeContract` call. But the alternative (duplicate txs with different nonces) is far worse.

## Data Flow

### Single Run Data Flow

```
[External Scheduler: cron/systemd]
    |
    v
[Bot: Load Config]
    | validate env vars, fail fast
    v
[Bot: Balance Preflight]
    | check ETH balance >= threshold
    v
[Bot: Read Phase]
    |
    |---> [Subgraph: fetchAllItems()]
    |     cursor-paginated GraphQL
    |     returns SubgraphItem[]
    |
    +---> [Router: batchReadState()]
          Multicall3-batched hasFeedback()
          returns Map<agentId, {hasFeedback}>
    |
    v
[Bot: Diff Phase]
    | computeActions(subgraphItems, routerState)
    | PURE FUNCTION -- no side effects
    | returns Action[]
    v
[Bot: Execute Phase]
    | for each action:
    |   1. Build IPFS evidence JSON
    |   2. Pin to IPFS -> get CID
    |   3. Estimate gas (retryable)
    |   4. Submit tx to Router (NOT retryable)
    |   5. Wait for receipt (handle null/dropped)
    |   6. Check SIGTERM flag between actions
    v
[Bot: Exit]
    exit code 0 (success) or 1 (fatal error)
```

### Contract Interaction Flow

```
Bot EOA --tx--> Router.submitPositiveFeedback(agentId, pgtcrItemId, ipfsURI)
                    |
                    |-- require(!hasFeedback[agentId])  // guard
                    |
                    |--> ReputationRegistry.giveFeedback(
                    |        agentId, 95, 0,
                    |        "curate-verified", "kleros-agent-registry",
                    |        "", ipfsURI, 0x0
                    |    )
                    |
                    |-- idx = ReputationRegistry.getLastIndex(agentId, address(this))
                    |
                    |-- feedbackIndex[agentId] = idx
                    |-- hasFeedback[agentId] = true
                    +-- emit PositiveFeedbackSubmitted(agentId, pgtcrItemId, idx)
```

### Key Data Flows

1. **Agent ID Resolution:** PGTCR subgraph item `metadata.key0` contains the numeric 8004 agentId. `metadata.key2` contains CAIP-10 chain identifier for validation. Strategy A (subgraph-native) for production; Strategy C (admin mapping via `setPGTCRMapping`) for PoC bootstrap.

2. **IPFS Evidence:** Before each `giveFeedback` call, the bot constructs a JSON evidence document (schema: `kleros-reputation-oracle/v1`), pins it to IPFS, and passes the resulting `ipfs://` CID as the `feedbackURI` parameter. The evidence is informational -- it enriches the on-chain feedback with context (dispute details, stake amounts, PGTCR metadata) but is not required for the protocol to function.

3. **Feedback Index Tracking:** When the Router calls `giveFeedback`, it immediately reads back the `getLastIndex()` from the ReputationRegistry and stores it in `feedbackIndex[agentId]`. This stored index is needed for future `revokeFeedback` calls. The Router is the single source of truth for "what index to revoke."

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-100 agents | Current design works perfectly. Individual `hasFeedback()` calls are fine. No Multicall3 needed. |
| 100-5,000 agents | Multicall3 batching becomes important. Subgraph pagination kicks in. No other changes. |
| 5,000-50,000 agents | Subgraph query time becomes the bottleneck. Consider parallel page fetches. Gas costs for tx execution become significant on mainnet -- batch feedback submissions (Router extension). |
| 50,000+ agents | Beyond the scope of a single PGTCR list. Architecture supports this via multiple Router deployments (one per list), each with its own bot instance. |

### Scaling Priorities

1. **First bottleneck: RPC calls for state reads.** At 1000+ agents, individual `eth_call` for each `hasFeedback` is slow. Multicall3 solves this. Build with Multicall3 from the start.
2. **Second bottleneck: Subgraph response time.** Large registries take longer to paginate. Cursor-based pagination handles correctness; parallel page fetches handle speed. Not needed for PoC.

## Anti-Patterns

### Anti-Pattern 1: Local Database for State Tracking

**What people do:** Add SQLite/files to track which items have been processed, creating a "processed items" table that the bot checks before acting.
**Why it's wrong:** Introduces a state synchronization problem. If the DB says "processed" but the tx was dropped, the item is stuck. If the DB is lost, the bot re-processes everything (duplicate feedback). The prior PoC had exactly this problem.
**Do this instead:** Read the Router's `hasFeedback()` on every run. The chain is the source of truth. No local state to corrupt or lose.

### Anti-Pattern 2: Bot Calls ReputationRegistry Directly

**What people do:** Have the bot call `ReputationRegistry.giveFeedback()` directly, bypassing the Router.
**Why it's wrong:** The bot's EOA becomes the `clientAddress`. If the wallet changes (key rotation, compromise), all past reputation is orphaned under the old address. Consumers cannot verify the feedback source is Kleros.
**Do this instead:** Bot calls Router. Router calls ReputationRegistry. Router's contract address is the stable `clientAddress`.

### Anti-Pattern 3: Daemon Mode with In-Memory State

**What people do:** Run the bot as a long-lived process with `while(true)` loop, accumulating state in memory across iterations.
**Why it's wrong:** Memory leaks over time. Process restarts lose all accumulated state. Crash recovery requires checkpoint logic. Scheduling is coupled to the application.
**Do this instead:** One-shot run. External scheduler (cron/systemd timer) handles frequency. Each run is independent. Crash recovery is free -- just run again.

### Anti-Pattern 4: Mocking Contract Interactions in Tests

**What people do:** Mock `ethers.Contract` or `viem` client entirely, making `giveFeedback` return a pre-built receipt object.
**Why it's wrong:** The mock never exhibits real failure modes (dropped tx, null receipt, ABI mismatch, gas estimation failure). Tests pass but critical bugs ship.
**Do this instead:** Test the diff logic (pure function, no mocks needed). Test contract interactions against a forked anvil node with real ABI execution.

### Anti-Pattern 5: `skip`-Based Subgraph Pagination

**What people do:** Use `skip: 1000`, `skip: 2000`, etc. to paginate subgraph queries.
**Why it's wrong:** The Graph Protocol degrades above 5000 skip and silently truncates above 10000. Items are silently lost.
**Do this instead:** Cursor-based pagination with `id_gt`.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| **PGTCR Subgraph (Goldsky)** | GraphQL over HTTPS. Cursor-paginated queries. | Read-only. May have indexing lag (seconds to minutes). Bot tolerates this -- next run catches up. |
| **IPFS (Pinata)** | REST API to pin JSON. Returns CID. | Write-only from bot's perspective. Evidence is supplementary -- if pinning fails, the bot should skip the action (not submit feedback without evidence). |
| **Ethereum RPC** | JSON-RPC via viem. Both reads (Multicall3) and writes (Router txs). | Use a reliable RPC provider. The bot is not latency-sensitive (hourly runs), so public RPCs are acceptable for PoC. |
| **Multicall3** | Deployed at `0xcA11bde05977b3631167028862bE2a173976CA11` on all EVM chains. | Use viem's built-in `multicall` action. Set `allowFailure: true`. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| **Config -> All modules** | Config object passed at initialization | Validated once at startup. Immutable after that. |
| **Subgraph Reader -> Diff Engine** | Returns `SubgraphItem[]` | Pure data. No business logic in the reader. |
| **Router State Reader -> Diff Engine** | Returns `Map<bigint, {hasFeedback: boolean}>` | Pure data. Multicall3-batched. |
| **Diff Engine -> Executor** | Returns `Action[]` | Pure function output. The executor does not question the actions. |
| **Executor -> IPFS + Router** | Sequential per action: pin evidence, then submit tx | If IPFS fails, skip the action. If tx fails, log and continue (or stop on SIGTERM). |
| **Bot -> Router contract** | `submitPositiveFeedback`, `submitNegativeFeedback`, `revokeOnly` | Bot never calls any other contract directly. |
| **Router -> ReputationRegistry** | `giveFeedback`, `revokeFeedback`, `getLastIndex` | Router is the only caller. Bot does not interact. |

## Build Order (Dependencies)

The components have clear build-order dependencies:

```
Phase 1: Router Contract
    |  No external dependency to build.
    |  Foundry tests against mock/minimal ReputationRegistry.
    |  Deploys to Sepolia.
    |
Phase 2: Kleros 8004 Identity Registration
    |  Requires: deployed IdentityRegistry on Sepolia (already exists)
    |  One-time Foundry script execution.
    |  Produces: klerosAgentId for Router configuration.
    |
Phase 3: Bot Core (diff engine)
    |  Requires: Router ABI (from Phase 1 build artifacts)
    |  Can develop with mocked subgraph data + anvil fork.
    |  Pure function tests for computeActions() -- no infra needed.
    |
Phase 4: Bot Integration (subgraph + IPFS + tx)
    |  Requires: deployed Router (Phase 1), real subgraph endpoint
    |  Integration tests against forked Sepolia.
    |
Phase 5: End-to-End Verification
    Requires: all above.
    Run bot against Sepolia with real PGTCR data.
    Verify via getSummary() on ReputationRegistry.
```

**Key insight:** The Router contract is the foundation. Everything depends on it. Build it first, test it thoroughly, deploy it. The bot is built second, against the deployed Router's ABI. The identity registration can happen in parallel with bot development once the Router is deployed.

## Sources

- PRD v2: `.planning/research/kleros-reputation-oracle-prd-v2.md` (sections 3, 11, 12, 17) -- HIGH confidence, primary specification
- PRD v2 Amendments: `.planning/research/kleros-reputation-oracle-prd-v2-amendments.md` -- HIGH confidence, architectural corrections from PoC review
- CLAUDE.md project instructions -- HIGH confidence, distilled design decisions
- viem Multicall3 support -- HIGH confidence (well-established viem feature)
- The Graph cursor pagination -- HIGH confidence (documented limitation of skip-based pagination)

---
*Architecture research for: Kleros Reputation Oracle (PGTCR to ERC-8004 stateless diff engine)*
*Researched: 2026-03-24*
