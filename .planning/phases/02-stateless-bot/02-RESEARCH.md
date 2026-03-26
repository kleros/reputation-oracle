# Phase 2: Stateless Bot - Research

**Researched:** 2026-03-26
**Domain:** TypeScript stateless diff bot -- subgraph reads, on-chain reads via Multicall3, transaction execution against Router contract
**Confidence:** HIGH

## Summary

This phase builds a one-shot TypeScript bot that reads PGTCR subgraph state (all items via cursor pagination), reads Router on-chain state (feedbackType per agentId via Multicall3), computes a pure diff via `computeActions()`, and executes reconciliation transactions sequentially. The bot exits after one run with code 0 (success) or non-zero (failure). No daemon loop, no local DB, no polling.

The technology stack is fully locked: viem ^2.47 for Ethereum client (wallet + multicall + public actions), graphql-request ^7.4 for subgraph queries, zod ^4.3 for config validation, tsx ^4.21 for TypeScript execution, vitest ^4.1 for testing. The Router contract from Phase 1 is deployed and uses `FeedbackType` enum (None=0, Positive=1, Negative=2), not a boolean. Evidence uses `data:application/json;base64,...` URI encoding (no IPFS dependency in v1).

**Primary recommendation:** Structure the bot as three clean layers: (1) data fetching (subgraph + chain), (2) pure diff computation (`computeActions()`), (3) transaction execution. The pure diff function is the core -- it takes typed inputs and returns actions with zero I/O. This enables trivial unit testing with vitest and dry-run mode by simply printing the action list.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Bot lives in `bot/` at repo root alongside `contracts/`. Independent `package.json`, `tsconfig.json`, `node_modules`.
- **D-02:** Entry point: `node --env-file=.env --import tsx bot/src/index.ts`. Node 22 native env loading, tsx for TS execution.
- **D-03:** Type checking via `tsc --noEmit` in CI/pre-commit. tsx skips type checking at runtime.
- **D-04:** `computeActions()` is a pure function: takes `(subgraphItems[], routerStates: Map<bigint, FeedbackType>)`, returns `Action[]`. No I/O, no async.
- **D-05:** Router state read via viem Multicall3 -- batch all `feedbackType(agentId)` calls. Chunked via viem's `batchSize` option (200 per eth_call).
- **D-06:** Router uses `feedbackType(agentId)` enum (None=0, Positive=1, Negative=2). Bot maps: Submitted + (None OR Negative) -> positive, Absent+Reject + Positive -> negative, Absent+withdrawal + Positive -> revoke.
- **D-07:** Invalid subgraph items (missing key0, bad CAIP-10 in key2, wrong chain) are logged with details and skipped.
- **D-08:** Subgraph pagination uses `id_gt` cursor, never `skip`. Fetch ALL items including Absent status.
- **D-09:** Sequential transaction submission -- one tx per action, wait for receipt with bounded timeout. Explicit nonce management.
- **D-10:** Stop on first failure -- any tx failure stops the entire run. Next run re-diffs.
- **D-11:** Dry-run mode: `--dry-run` flag prints the action list as JSON to stdout, sends no transactions, exits with code 0.
- **D-12:** v1 uses `data:application/json;base64,...` URI for feedbackURI. No IPFS.
- **D-13:** Evidence follows `kleros-reputation-oracle/v1` schema from PRD S13.

### Claude's Discretion
- Exact file layout within `bot/src/` (module boundaries, helper files)
- Zod config schema shape (as long as it validates required env vars with secret redaction)
- Logging approach (console.log vs structured logger -- keep it simple for PoC)
- GraphQL query structure and type generation approach
- vitest config and test file organization

### Deferred Ideas (OUT OF SCOPE)
- Multicall batching for tx execution (sequential is fine for 0-2 actions/run)
- IPFS evidence upload (IPFS-01/02/03) -- v2 requirement
- Subgraph lag detection (`_meta { block { number } }`) -- production hardening
- Transaction safety hardening (TXSAFE-01 through TXSAFE-04) -- v2 requirements
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BOT-01 | Bot reads all PGTCR items from Goldsky subgraph using cursor-based pagination (`id_gt`, never `skip`) | Subgraph schema from PRD S8; `id_gt` cursor pattern from PGTCR skill S4B; graphql-request ^7.4 |
| BOT-02 | Bot reads Router state via Multicall3-batched `feedbackType()` calls | viem `multicall()` with `batchSize` option; Router ABI from Phase 1; Multicall3 at canonical address |
| BOT-03 | `computeActions()` pure function computes diff between subgraph state and Router state | Pure function design from D-04; FeedbackType enum mapping from D-06; three scenario logic |
| BOT-04 | Bot resolves agentId from `metadata.key0` and validates chain via `metadata.key2` (CAIP-10) | Prior PoC GoldskyItemsMapper patterns; CAIP-10 parsing; key0 numeric validation |
| BOT-05 | Bot validates subgraph data before acting: itemID format, metadata fields, status enum values | Validation patterns from prior PoC; skip-and-log approach from D-07 |
| BOT-06 | Config validated at startup via zod schema | Zod ^4.3 env validation pattern; secret redaction for BOT_PRIVATE_KEY |
| BOT-07 | Bot is one-shot -- runs once, exits with code 0 on success, non-zero on failure | Entry point design from D-02; process.exit pattern |
| BOT-08 | Dry-run mode displays planned actions without submitting transactions | D-11: `--dry-run` flag; JSON output to stdout |
| BOT-09 | Items that fail validation are logged and skipped, not crash the run | D-07: log with details and continue |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **No local DB/persistence.** Stateless diff engine.
- **No daemon mode.** One-shot run, external scheduler invokes.
- **No mock-call-ordering tests.** Test boundaries, not wiring.
- **No dotenv.** Node 22 has `--env-file`.
- **No ethers.js.** Use viem.
- **No axios.** Use native fetch.
- **Biome.js** for linting + formatting (replaces ESLint + Prettier).
- **vitest** for bot tests.
- Tags: on-chain `tag1` = "verified"/"removed", `tag2` = "kleros-agent-registry" (constants in Router contract).
- Agent resolution: Strategy A -- `metadata.key0` = numeric agentId, `metadata.key2` = CAIP-10 chain validation.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| viem | 2.47.6 | Ethereum client: wallet, multicall, public actions | Type-safe, native Multicall3, first-class ABI typing |
| graphql-request | 7.4.0 | Subgraph GraphQL queries | Lightweight, no caching overhead, works with cursor pagination |
| zod | 4.3.6 | Config/env validation at startup | Best TS type inference, `.transform()` for parsing, error customization for secret redaction |
| tsx | 4.21.0 | TypeScript execution without build step | Zero-config, used as `--import tsx` with Node 22 |

### Development
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 4.1.1 | Unit/integration tests | Pure function tests for `computeActions()`, validation tests |
| @biomejs/biome | 2.4.9 | Linting + formatting | All TypeScript files in `bot/` |
| typescript | ^5.7 | Type checking (tsc --noEmit) | CI/pre-commit, not at runtime |
| @types/node | latest | Node.js type definitions | TypeScript development |

**Version verification:** All versions confirmed via `npm view` on 2026-03-26. These are current stable releases.

**Installation:**
```bash
cd bot/
npm init -y
npm install viem graphql-request zod
npm install -D typescript tsx vitest @biomejs/biome @types/node
```

## Architecture Patterns

### Recommended Project Structure
```
bot/
├── package.json
├── tsconfig.json
├── biome.json
├── .env.example
├── src/
│   ├── index.ts              # Entry point: parse args, load config, orchestrate
│   ├── config.ts             # Zod schema, env validation, Config type export
│   ├── types.ts              # Shared types: SubgraphItem, Action, FeedbackType enum
│   ├── subgraph.ts           # GraphQL queries, cursor pagination, item fetching
│   ├── chain.ts              # viem client setup, Multicall3 reads, tx execution
│   ├── diff.ts               # computeActions() pure function
│   ├── validation.ts         # CAIP-10 parsing, key0 validation, item validation
│   ├── evidence.ts           # Evidence JSON builder, base64 data URI encoding
│   └── abi/
│       └── router.ts         # Router ABI as const (for viem type inference)
└── test/
    ├── diff.test.ts          # Core: computeActions() unit tests
    ├── validation.test.ts    # CAIP-10 parsing, key0 validation
    ├── evidence.test.ts      # Evidence JSON + base64 encoding
    └── config.test.ts        # Zod schema validation tests
```

### Pattern 1: Pure Diff Engine
**What:** `computeActions()` takes immutable inputs and returns an action list. Zero side effects.
**When to use:** Always -- this IS the core logic.
**Example:**
```typescript
// bot/src/diff.ts
import type { SubgraphItem, Action, FeedbackType } from './types.js';

export function computeActions(
  items: SubgraphItem[],
  routerStates: Map<bigint, FeedbackType>
): Action[] {
  const actions: Action[] = [];

  for (const item of items) {
    const agentId = item.agentId; // already validated and resolved
    const currentType = routerStates.get(agentId) ?? FeedbackType.None;

    // Scenario 1: Submitted/Reincluded + (None or Negative) -> positive
    if (
      (item.status === 'Submitted' || item.status === 'Reincluded') &&
      (currentType === FeedbackType.None || currentType === FeedbackType.Negative)
    ) {
      actions.push({
        type: 'submitPositiveFeedback',
        agentId,
        pgtcrItemId: item.itemID,
        item,
      });
    }

    // Scenario 2: Absent + disputeOutcome=Reject + Positive -> negative
    if (
      item.status === 'Absent' &&
      item.latestDisputeOutcome === 'Reject' &&
      currentType === FeedbackType.Positive
    ) {
      actions.push({
        type: 'submitNegativeFeedback',
        agentId,
        item,
      });
    }

    // Scenario 3: Absent + voluntary withdrawal + Positive -> revoke only
    if (
      item.status === 'Absent' &&
      item.latestDisputeOutcome !== 'Reject' &&
      currentType === FeedbackType.Positive
    ) {
      actions.push({
        type: 'revokeOnly',
        agentId,
        item,
      });
    }
  }

  return actions;
}
```

### Pattern 2: Viem Multicall3 for Batched Reads
**What:** Batch all `feedbackType(agentId)` reads into chunked Multicall3 calls.
**When to use:** Reading Router state for all known agentIds.
**Example:**
```typescript
// bot/src/chain.ts
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { routerAbi } from './abi/router.js';

const client = createPublicClient({
  chain: sepolia,
  transport: http(config.rpcUrl),
  batch: {
    multicall: {
      batchSize: 1024 * 200, // ~200 calls per batch (bytes-based)
    },
  },
});

// Batch read feedbackType for all agentIds
async function readRouterStates(
  routerAddress: `0x${string}`,
  agentIds: bigint[]
): Promise<Map<bigint, FeedbackType>> {
  const results = await client.multicall({
    contracts: agentIds.map((agentId) => ({
      address: routerAddress,
      abi: routerAbi,
      functionName: 'feedbackType',
      args: [agentId],
    })),
  });

  const map = new Map<bigint, FeedbackType>();
  for (let i = 0; i < agentIds.length; i++) {
    const result = results[i];
    if (result.status === 'success') {
      map.set(agentIds[i], result.result as FeedbackType);
    } else {
      // Treat failed reads as None (conservative: will trigger positive if Submitted)
      map.set(agentIds[i], FeedbackType.None);
    }
  }
  return map;
}
```

### Pattern 3: Cursor-Based Subgraph Pagination
**What:** Fetch ALL items using `id_gt` cursor. Never use `skip`.
**When to use:** Always for subgraph queries.
**Example:**
```typescript
// bot/src/subgraph.ts
import { GraphQLClient, gql } from 'graphql-request';

const ITEMS_QUERY = gql`
  query GetItems($registryAddress: String!, $lastId: String!, $first: Int!) {
    items(
      where: { registryAddress: $registryAddress, id_gt: $lastId }
      orderBy: id
      orderDirection: asc
      first: $first
    ) {
      id
      itemID
      status
      submitter
      stake
      includedAt
      withdrawingTimestamp
      metadata {
        key0
        key2
      }
      challenges(orderBy: challengeID, orderDirection: desc, first: 1) {
        disputeOutcome
        disputeID
        resolutionTime
      }
    }
  }
`;

async function fetchAllItems(
  client: GraphQLClient,
  registryAddress: string
): Promise<RawSubgraphItem[]> {
  const allItems: RawSubgraphItem[] = [];
  let lastId = '';
  const pageSize = 1000;

  while (true) {
    const data = await client.request(ITEMS_QUERY, {
      registryAddress: registryAddress.toLowerCase(),
      lastId,
      first: pageSize,
    });

    const items = data.items;
    if (items.length === 0) break;

    allItems.push(...items);
    lastId = items[items.length - 1].id;

    if (items.length < pageSize) break;
  }

  return allItems;
}
```

### Pattern 4: Sequential Transaction Execution with Explicit Nonce
**What:** Execute actions one at a time, managing nonce locally.
**When to use:** Transaction execution phase (after dry-run check).
**Example:**
```typescript
// bot/src/chain.ts
async function executeActions(
  walletClient: WalletClient,
  actions: Action[],
  config: Config
): Promise<void> {
  // Fetch nonce once at start
  let nonce = await walletClient.getTransactionCount({
    address: walletClient.account.address,
  });

  for (const action of actions) {
    const hash = await sendAction(walletClient, action, config, nonce);

    // Wait for receipt with timeout
    const receipt = await walletClient.waitForTransactionReceipt({
      hash,
      timeout: 60_000, // 60 seconds
    });

    if (receipt.status === 'reverted') {
      console.error(`Transaction reverted: ${hash}`);
      process.exit(1); // Stop on first failure (D-10)
    }

    nonce++;
  }
}
```

### Pattern 5: Data URI Evidence Encoding
**What:** Build evidence JSON, base64-encode, produce `data:` URI.
**When to use:** Building feedbackURI for Scenarios 1 and 2.
**Example:**
```typescript
// bot/src/evidence.ts
interface EvidenceJson {
  schema: 'kleros-reputation-oracle/v1';
  agentRegistry: string;
  agentId: number;
  clientAddress: string;
  createdAt: string;
  value: number;
  valueDecimals: number;
  tag1: string;
  tag2: string;
  kleros: {
    pgtcrAddress: string;
    pgtcrItemId: string;
    stakeAmount: string;
    stakeToken: string;
    disputeId: number | null;
    ruling: number | null;
  };
}

function buildFeedbackURI(evidence: EvidenceJson): string {
  const json = JSON.stringify(evidence);
  const base64 = Buffer.from(json).toString('base64');
  return `data:application/json;base64,${base64}`;
}
```

### Anti-Patterns to Avoid
- **Class-based architecture:** The prior PoC used classes (`SubgraphPoller`, `RouterCaller`). Use plain functions and modules instead. Classes add indirection without value for a one-shot bot.
- **Local state tracking:** The PRD S12 shows `LocalState` with `processedItems` map. DO NOT implement this. The bot is stateless -- it reads Router state on-chain, not from memory.
- **`skip`-based pagination:** Degrades above 5000 items, silently truncates above 10000. Always use `id_gt` cursor.
- **Daemon loop (`while(true)`):** The PRD S12.7 shows a polling loop. This is the OLD design. The bot is one-shot per CLAUDE.md and D-07.
- **Fire-and-forget transactions:** Every tx must be confirmed or the run must stop (D-10).
- **Tag value confusion:** On-chain tags (Router constants) are "verified"/"removed". The PRD evidence schema uses "curate-verified"/"curate-removed" for the evidence JSON field. These are DIFFERENT: the on-chain call uses "verified"/"removed" (from Router). The evidence JSON tag1 is informational context and should match the on-chain tag values for consistency.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multicall3 batching | Custom aggregate3 encoder | `viem.multicall()` with `batchSize` | Handles chunking, error per call, ABI encoding automatically |
| Nonce management | Custom nonce tracker | viem's `getTransactionCount` + local increment | One fetch at start, increment per tx is sufficient for sequential execution |
| ABI encoding | Manual calldata building | viem's typed contract interactions with `as const` ABI | Type-safe, catches errors at compile time |
| Base64 encoding | Third-party library | `Buffer.from(json).toString('base64')` | Node.js built-in, zero dependencies |
| GraphQL client | Custom fetch wrapper | graphql-request | Type-safe, handles errors, minimal footprint |
| Env validation | Manual parsing | Zod schema with `z.string().min(1)` + `.transform()` | Type inference, error messages, secret redaction |

## Common Pitfalls

### Pitfall 1: Subgraph Item ID Format for Cursor Pagination
**What goes wrong:** The subgraph entity ID format is `<itemID>@<tcrAddress>`. If you use `itemID` (the bytes32 hash) as the cursor instead of `id` (the entity ID), pagination breaks.
**Why it happens:** Confusion between `id` (entity primary key used for cursor) and `itemID` (the keccak256 item hash).
**How to avoid:** Always use the `id` field (not `itemID`) for `id_gt` cursor. The GraphQL query must select `id` and use it as the cursor value.
**Warning signs:** Pagination returns duplicate items or stops early.

### Pitfall 2: FeedbackType Enum Mapping (Not Boolean)
**What goes wrong:** Treating Router state as boolean (has/doesn't have feedback) instead of the three-state enum. This breaks re-registration after dispute (Submitted + Negative should trigger positive).
**Why it happens:** PRD S12 uses `hasFeedback` boolean. The actual Router uses `FeedbackType` enum (Phase 1 D-01).
**How to avoid:** Always read `feedbackType(agentId)` which returns uint8 (0=None, 1=Positive, 2=Negative). Map to TypeScript enum. The diff logic handles all three states.
**Warning signs:** Re-registered agents (Submitted after prior dispute) are silently skipped.

### Pitfall 3: Voluntary Withdrawal vs Dispute Removal Detection
**What goes wrong:** Both voluntary withdrawal and dispute removal result in `status = Absent`. The bot needs to distinguish them to choose Scenario 2 vs 3.
**Why it happens:** The `status` field alone is insufficient. You need the latest challenge's `disputeOutcome`.
**How to avoid:** For `Absent` items, check the latest challenge's `disputeOutcome`. If `Reject` -> Scenario 2 (submitNegativeFeedback). If `None`/`Accept` or no challenge -> Scenario 3 (revokeOnly). Items that were never Submitted and are Absent with no challenge need no action.
**Warning signs:** Voluntary withdrawals get negative feedback instead of just revocation.

### Pitfall 4: agentId Type Mismatch (bigint vs number vs string)
**What goes wrong:** `metadata.key0` is a string from the subgraph. The Router expects `uint256` (bigint). JavaScript `Number` overflows for large uint256 values. Passing a JS number to viem where bigint is expected causes silent truncation or type errors.
**Why it happens:** GraphQL returns strings. The temptation is to use `parseInt()` or `Number()`.
**How to avoid:** Parse `key0` directly to `BigInt(key0)` after validation. Carry as `bigint` throughout the entire pipeline. Never convert to `number`.
**Warning signs:** Type errors from viem, or incorrect agentIds for large values.

### Pitfall 5: Missing Challenge Data for Absent Items
**What goes wrong:** An item is `Absent` but has no challenges (it was never disputed -- it was voluntarily withdrawn). The bot tries to access `challenges[0].disputeOutcome` and gets undefined, causing a crash or incorrect action.
**Why it happens:** Not all Absent items have challenges. Items can go Submitted -> Absent via voluntary withdrawal without any dispute.
**How to avoid:** Always check if challenges array is non-empty before accessing `disputeOutcome`. An Absent item with Positive feedback and no Reject challenge = Scenario 3 (revokeOnly).
**Warning signs:** Runtime errors on `.disputeOutcome` access, or Absent items without challenges being silently skipped.

### Pitfall 6: Evidence Tag Confusion (On-Chain vs JSON)
**What goes wrong:** Using "curate-verified"/"curate-removed" (from PRD S13 evidence schema) as the on-chain tag1 parameter. The Router contract constants are "verified"/"removed".
**Why it happens:** PRD S13 evidence JSON uses different tag1 values than the Router contract constants.
**How to avoid:** The bot does NOT set on-chain tags -- the Router contract has them as constants (TAG_VERIFIED="verified", TAG_REMOVED="removed"). The bot only builds the evidence JSON (where tag1 is informational). For consistency, use "verified"/"removed" in the evidence JSON too, matching the on-chain values.
**Warning signs:** Tags in evidence JSON don't match what's actually stored on-chain.

### Pitfall 7: viem batchSize is Bytes, Not Call Count
**What goes wrong:** Setting `batchSize: 200` thinking it means 200 calls per batch. It actually means 200 bytes of calldata per batch, which is far too small (one feedbackType call is ~68 bytes of calldata).
**Why it happens:** Misreading the viem docs. `batchSize` is in bytes, not call count.
**How to avoid:** Use a reasonable byte size. Each `feedbackType(uint256)` call encodes to ~68 bytes. For 200 calls: `batchSize: 1024 * 200` (~200KB) is generous. Or use viem's `multicall()` function directly (not the client-level batching) which accepts an array and handles chunking.
**Warning signs:** Hundreds of tiny multicall requests instead of a few large ones.

## Code Examples

### Router ABI (as const for viem type inference)
```typescript
// bot/src/abi/router.ts
export const routerAbi = [
  {
    type: 'function',
    name: 'feedbackType',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'submitPositiveFeedback',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'pgtcrItemId', type: 'bytes32' },
      { name: 'feedbackURI', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'submitNegativeFeedback',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'feedbackURI', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revokeOnly',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'authorizedBots',
    stateMutability: 'view',
    inputs: [{ name: 'bot', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;
```

### Zod Config Schema with Secret Redaction
```typescript
// bot/src/config.ts
import { z } from 'zod';

const hexAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid hex address');
const hexPrivateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid private key');

const configSchema = z.object({
  CHAIN_ID: z.string().transform(Number).pipe(z.number().int().positive()),
  RPC_URL: z.string().url(),
  ROUTER_ADDRESS: hexAddress,
  PGTCR_ADDRESS: hexAddress,
  SUBGRAPH_URL: z.string().url(),
  BOT_PRIVATE_KEY: hexPrivateKey,
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  try {
    return configSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Redact private key from error output
      const safeIssues = error.issues.map((issue) => ({
        ...issue,
        // Never log the actual private key value
        received: issue.path.includes('BOT_PRIVATE_KEY') ? '[REDACTED]' : undefined,
      }));
      console.error('Config validation failed:', JSON.stringify(safeIssues, null, 2));
    }
    process.exit(1);
  }
}
```

### CAIP-10 Validation (Rewritten from Prior PoC)
```typescript
// bot/src/validation.ts
interface ValidatedItem {
  agentId: bigint;
  itemID: `0x${string}`;
  status: 'Submitted' | 'Reincluded' | 'Absent' | 'Disputed';
  latestDisputeOutcome: 'None' | 'Accept' | 'Reject' | null;
}

function parseChainIdFromCAIP10(caip10: string): number | null {
  const parts = caip10.split(':');
  if (parts.length >= 2 && parts[0] === 'eip155') {
    const chainId = parseInt(parts[1], 10);
    return isNaN(chainId) ? null : chainId;
  }
  return null;
}

function validateAndTransformItem(
  raw: RawSubgraphItem,
  targetChainId: number
): ValidatedItem | null {
  // 1. Metadata must exist
  if (!raw.metadata) {
    console.warn(`Skipping item ${raw.id}: no metadata`);
    return null;
  }

  // 2. Validate key2 (CAIP-10 chain)
  const key2 = raw.metadata.key2?.trim();
  if (!key2) {
    console.warn(`Skipping item ${raw.id}: missing metadata.key2`);
    return null;
  }
  const chainId = parseChainIdFromCAIP10(key2);
  if (chainId === null) {
    console.warn(`Skipping item ${raw.id}: invalid CAIP-10 format in key2="${key2}"`);
    return null;
  }
  if (chainId !== targetChainId) {
    console.warn(`Skipping item ${raw.id}: chain ${chainId} != target ${targetChainId}`);
    return null;
  }

  // 3. Validate key0 (agentId -- must be numeric string)
  const key0 = raw.metadata.key0?.trim();
  if (!key0 || !/^\d+$/.test(key0)) {
    console.warn(`Skipping item ${raw.id}: invalid key0="${key0}"`);
    return null;
  }

  // 4. Parse agentId as bigint (not Number -- avoids overflow)
  let agentId: bigint;
  try {
    agentId = BigInt(key0);
  } catch {
    console.warn(`Skipping item ${raw.id}: key0="${key0}" not parseable as bigint`);
    return null;
  }

  // 5. Validate status
  const validStatuses = ['Submitted', 'Reincluded', 'Absent', 'Disputed'] as const;
  if (!validStatuses.includes(raw.status as any)) {
    console.warn(`Skipping item ${raw.id}: unknown status="${raw.status}"`);
    return null;
  }

  // 6. Extract latest dispute outcome
  const latestChallenge = raw.challenges?.[0];
  const latestDisputeOutcome = latestChallenge?.disputeOutcome ?? null;

  return {
    agentId,
    itemID: raw.itemID as `0x${string}`,
    status: raw.status as ValidatedItem['status'],
    latestDisputeOutcome: latestDisputeOutcome as ValidatedItem['latestDisputeOutcome'],
  };
}
```

## State of the Art

| Old Approach (PRD S12) | Current Approach (Phase 2) | When Changed | Impact |
|------------------------|---------------------------|--------------|--------|
| `hasFeedback` boolean | `FeedbackType` enum (None/Positive/Negative) | Phase 1 D-01 | Handles re-registration correctly |
| Local state tracking (`processedItems` map) | Stateless diff from chain state | PRD Amendments | No persistence needed |
| Daemon mode (`while(true)` + sleep) | One-shot run, external scheduler | PRD Amendments | Simpler, no SIGTERM handling needed for v1 |
| IPFS upload for feedbackURI | `data:application/json;base64,...` | Phase 2 D-12 | No external IPFS dependency |
| Class-based architecture | Pure functions + modules | Phase 2 design | Better testability, simpler one-shot |
| `skip`-based pagination | `id_gt` cursor pagination | CLAUDE.md | Correct for large lists |
| Separate revoke + negative calls | Single `submitNegativeFeedback` (Router handles atomically) | Phase 1 D-03 | Bot never calls revoke separately for Scenario 2 |

## Open Questions

1. **Subgraph item count sanity check**
   - What we know: Cursor pagination can silently return 0 items if subgraph is reindexing (Pitfall 9 from PITFALLS.md).
   - What's unclear: Whether the Goldsky subgraph exposes registry-level counters (`numberOfSubmitted`, `numberOfAbsent`) that the bot can check.
   - Recommendation: Query `registry(id: $registryAddress) { numberOfSubmitted numberOfAbsent }` and compare against fetched item count. Log warning if mismatch exceeds 10%. This is low-priority for PoC but easy to add.

2. **Disputed items handling**
   - What we know: Items with `status = Disputed` need no action (Pitfall 5 from PITFALLS.md). The diff ignores them.
   - What's unclear: Whether `Disputed` items should be included in the fetched set at all, or filtered out in the GraphQL query.
   - Recommendation: Fetch ALL items including Disputed (per D-08). The diff simply produces no action for them. This is simpler than trying to filter at the GraphQL level.

3. **Absent items without prior feedback**
   - What we know: An item that was Absent from the beginning (never Submitted) will have `feedbackType = None` on the Router.
   - What's unclear: Whether these items even appear in the subgraph, or if they're never indexed.
   - Recommendation: The diff handles this correctly: Absent + None = no action. No special case needed.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Bot runtime | Yes | 22.22.0 | -- |
| npm | Package management | Yes | 11.6.2 | -- |
| TypeScript | Type checking | Install needed | ^5.7 (dev dep) | -- |
| Foundry | Router ABI extraction (optional) | Check Phase 1 | -- | Define ABI manually as `const` |

**Missing dependencies with no fallback:** None -- all runtime deps are npm packages.

**Missing dependencies with fallback:** Foundry is not needed for the bot itself. Router ABI can be defined as a TypeScript `as const` array (preferred approach anyway for viem type inference).

## Sources

### Primary (HIGH confidence)
- Router contract source: `contracts/src/KlerosReputationRouter.sol` -- FeedbackType enum, function signatures, constants
- Phase 1 CONTEXT.md: `01-CONTEXT.md` -- D-01 through D-04 (FeedbackType, atomic submitNegativeFeedback)
- Phase 2 CONTEXT.md: `02-CONTEXT.md` -- All locked decisions D-01 through D-13
- PGTCR Skill: `.claude/skills/pgtcr-stake-curate-skill.md` -- GraphQL schema, endpoints, pagination
- PRD S8: Subgraph schema (Item, Challenge, Submission entities)
- PRD S13: Evidence JSON schema (`kleros-reputation-oracle/v1`)
- npm registry: Version verification for all packages (2026-03-26)

### Secondary (MEDIUM confidence)
- [viem multicall docs](https://viem.sh/docs/contract/multicall.html) -- batchSize semantics, Multicall3 usage
- [viem public client docs](https://viem.sh/docs/clients/public) -- batch configuration for automatic multicall
- Prior PoC: `../erc8004-feedback-bot-fortunato/src/goldsky-items-mapper.ts` -- CAIP-10 parsing, key0 validation patterns (rewritten for viem/pure functions)

### Tertiary (LOW confidence)
- PRD S12 (Off-Chain Bot Specification) -- Historical reference only. Multiple aspects overridden by GSD decisions (daemon mode, local state, class-based design, hasFeedback boolean). Use only for GraphQL query field selection reference.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- versions verified via npm, all locked by CLAUDE.md and STACK.md
- Architecture: HIGH -- pure function diff engine, viem multicall, cursor pagination are well-established patterns
- Pitfalls: HIGH -- derived from Phase 1 Router implementation, prior PoC review, and PITFALLS.md analysis

**Research date:** 2026-03-26
**Valid until:** 2026-04-26 (stack is stable, no fast-moving dependencies)
