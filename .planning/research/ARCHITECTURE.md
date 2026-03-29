# Architecture Patterns

**Domain:** v1.1 Production Hardening -- IPFS evidence, transaction safety, structured logging
**Researched:** 2026-03-30
**Confidence:** HIGH (existing codebase is small and well-understood; patterns are established)

## Current Architecture (v1.0 Baseline)

```
index.ts (orchestrator)
  |
  +-- config.ts          loadConfig() -> Config
  +-- subgraph.ts        fetchAllItems() -> RawSubgraphItem[]
  +-- validation.ts      validateAndTransformItem() -> ValidatedItem | null
  +-- chain.ts           readRouterStates() via Multicall3 -> Map<bigint, FeedbackType>
  +-- diff.ts            computeActions() PURE -> Action[]
  +-- evidence.ts        buildPositiveEvidence/buildNegativeEvidence -> EvidenceJson
  +-- chain.ts           buildFeedbackURI() -> data: URI, executeActions() -> sequential txs
  +-- types.ts           shared types
```

**Key characteristics:**
- evidence.ts builds JSON + encodes as `data:application/json;base64,...` URI
- chain.ts executeActions() calls evidence builders inline, manages nonce manually
- All logging is `console.log`/`console.error` unstructured strings
- No retry, no gas estimation separation, no signal handling
- Stop-on-first-failure: reverted tx throws, halts remaining actions

## v1.1 Architecture (Target)

```
index.ts (orchestrator) ---- logger.ts (structured JSON, used everywhere)
  |
  +-- config.ts          loadConfig() -> Config (NEW: PINATA_JWT, LOG_LEVEL)
  +-- subgraph.ts        fetchAllItems() (unchanged)
  +-- validation.ts      validateAndTransformItem() (unchanged)
  +-- chain.ts           readRouterStates() (unchanged)
  +-- diff.ts            computeActions() PURE (unchanged)
  +-- evidence.ts        buildPositiveEvidence/buildNegativeEvidence (unchanged)
  +-- ipfs.ts            NEW: pinToIPFS(evidence) -> ipfs:// URI
  +-- tx.ts              NEW: submitTx() with gas retry, receipt handling
  +-- chain.ts           MODIFIED: executeActions() uses ipfs.ts + tx.ts, SIGTERM-aware
  +-- types.ts           (unchanged)
```

### Component Boundaries

| Component | Responsibility | Status | Communicates With |
|-----------|---------------|--------|-------------------|
| **config.ts** | Env parsing, Zod validation | MODIFIED -- add PINATA_JWT, LOG_LEVEL | All modules at init |
| **logger.ts** | Structured JSON log output, log levels | NEW | All modules import |
| **ipfs.ts** | Pin JSON to Pinata, return `ipfs://` CID | NEW | chain.ts (executeActions) |
| **tx.ts** | Gas estimation (retryable), tx submission (not retryable), receipt wait | NEW | chain.ts (executeActions) |
| **chain.ts** | Client factories, Multicall3 reads, action execution loop | MODIFIED -- use ipfs.ts, tx.ts, SIGTERM | index.ts |
| **evidence.ts** | Build EvidenceJson objects | UNCHANGED | chain.ts |
| **diff.ts** | Pure diff: computeActions() | UNCHANGED | index.ts |
| **index.ts** | Orchestration, SIGTERM handler registration, balance preflight | MODIFIED | All |
| **types.ts** | Shared types | UNCHANGED (or minor additions) | All |

## Feature 1: IPFS Evidence Upload via Pinata

### Integration Point

**Current flow (chain.ts lines 121-131):**
```
evidence = buildPositiveEvidence(params)
feedbackURI = buildFeedbackURI(evidence)  // -> data:application/json;base64,...
hash = walletClient.writeContract(..., feedbackURI)
```

**New flow:**
```
evidence = buildPositiveEvidence(params)  // unchanged
feedbackURI = await pinToIPFS(evidence)   // -> ipfs://Qm... (NEW)
hash = walletClient.writeContract(..., feedbackURI)
```

### New Module: `bot/src/ipfs.ts`

**Responsibility:** Single function `pinToIPFS(evidence: EvidenceJson): Promise<string>` that:
1. Serializes EvidenceJson to JSON
2. POSTs to Pinata pin API (`https://api.pinata.cloud/pinning/pinJSONToIPFS`)
3. Returns `ipfs://<CID>` string

**Design decisions:**
- Use native `fetch` (Node 22) -- no axios dependency
- Pinata JWT from config (not per-request auth)
- No retry on pin failure -- if IPFS is down, skip the action (evidence is supplementary, not critical). Log warning, continue to next action.
- Pin metadata: include `name: "kleros-reputation-oracle/${agentId}"` for Pinata dashboard discoverability

**Config addition:**
```typescript
PINATA_JWT: z.string().min(1).optional(),  // optional: if absent, fall back to data: URI
```

**Fallback behavior:** If `PINATA_JWT` is not set, keep using `buildFeedbackURI()` (data: URI). This preserves backward compatibility and allows dry-run/testing without Pinata credentials.

### What Changes in chain.ts

The `executeActions()` function currently calls `buildFeedbackURI()` inline. Replace with:
```typescript
const feedbackURI = config.PINATA_JWT
  ? await pinToIPFS(evidence, config.PINATA_JWT)
  : buildFeedbackURI(evidence);
```

**evidence.ts remains unchanged.** It builds `EvidenceJson` objects. The serialization target (data: URI vs IPFS) is an orthogonal concern handled by the caller.

## Feature 2: Transaction Safety Hardening

### Current Problems

1. **No gas estimation separation** -- `writeContract` bundles estimation + submission. If estimation fails transiently (RPC hiccup), the entire action fails permanently.
2. **No receipt handling for dropped txs** -- `waitForTransactionReceipt` with 60s timeout throws on timeout. Dropped txs (gas too low, mempool eviction) are indistinguishable from slow confirmation.
3. **No balance preflight** -- if wallet is empty, the bot discovers this only when the first tx fails.
4. **No SIGTERM handling** -- `kill` during execution leaves partial state. Next run recovers (stateless diff), but logs give no signal about intentional vs crash shutdown.

### New Module: `bot/src/tx.ts`

**Responsibility:** Isolated transaction lifecycle management.

```typescript
interface TxResult {
  hash: `0x${string}`;
  receipt: TransactionReceipt;
}

// Gas estimation with retry (read operation, safe to retry)
async function estimateGas(
  publicClient: PublicClient,
  txRequest: SimulateContractParameters
): Promise<bigint>;

// Tx submission -- NO retry (write operation, may already be in mempool)
async function submitTx(
  walletClient: WalletClient,
  txRequest: WriteContractParameters
): Promise<`0x${string}`>;

// Receipt wait with replacement detection
async function waitForReceipt(
  publicClient: PublicClient,
  hash: `0x${string}`,
  timeout?: number
): Promise<TransactionReceipt>;

// Balance preflight check
async function checkBalance(
  publicClient: PublicClient,
  address: Address,
  minBalance: bigint
): Promise<void>;
```

**Key design:**
- `estimateGas`: retry up to 3 times with exponential backoff (1s, 2s, 4s). Gas estimation is a read -- safe to retry.
- `submitTx`: NO retry. If submission fails, log the error and throw. Retrying a write may produce duplicate txs with different nonces.
- `waitForReceipt`: use viem's `waitForTransactionReceipt` with `confirmations: 1`. On timeout, log the hash for manual investigation rather than silently swallowing.
- `checkBalance`: called once before execution loop. If balance < estimated gas for all actions, warn but don't abort (gas prices fluctuate). If balance is zero, abort.

### SIGTERM Graceful Shutdown

**Where:** `index.ts` registers the handler. `executeActions()` checks the flag.

```typescript
// index.ts
let shutdownRequested = false;
process.on("SIGTERM", () => {
  shutdownRequested = true;
  logger.warn("SIGTERM received, finishing current action then exiting");
});
process.on("SIGINT", () => {
  shutdownRequested = true;
  logger.warn("SIGINT received, finishing current action then exiting");
});
```

**In executeActions loop:**
```typescript
for (const action of actions) {
  if (shutdownRequested) {
    logger.info("Shutdown requested, stopping before next action", {
      remaining: actions.length - i,
    });
    break;
  }
  // ... execute action
}
```

**No AbortController complexity.** The bot is one-shot with sequential txs. A boolean flag checked between actions is sufficient. The current tx completes (or fails), then the loop exits cleanly.

### What Changes in chain.ts

`executeActions()` is refactored to use `tx.ts` functions instead of raw `walletClient.writeContract`:

```typescript
// Before (v1.0)
hash = await walletClient.writeContract({ ... });
receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });

// After (v1.1)
const gasEstimate = await estimateGas(publicClient, { ... });
hash = await submitTx(walletClient, { ..., gas: gasEstimate });
receipt = await waitForReceipt(publicClient, hash);
```

The `nonce` management stays in `executeActions()` -- it's loop-level state, not per-tx concern.

## Feature 3: Structured JSON Logging

### New Module: `bot/src/logger.ts`

**Responsibility:** Replace all `console.log`/`console.error` with structured JSON output.

**Design:** Thin wrapper, not a framework. No pino/winston dependency -- they're overkill for a one-shot CLI bot.

```typescript
type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

const logger = {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
};
```

**Output format:** One JSON object per line (NDJSON), parseable by jq, CloudWatch, Datadog.

```json
{"timestamp":"2026-03-30T12:00:00.000Z","level":"info","message":"Fetched items from subgraph","count":42}
{"timestamp":"2026-03-30T12:00:01.000Z","level":"info","message":"TX confirmed","hash":"0xabc...","action":"submitPositiveFeedback","agentId":"123"}
```

**Config addition:**
```typescript
LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
```

**Why not pino/winston:**
- One-shot bot, not a server. No log rotation, no transports, no async flushing.
- 30 lines of code vs 200KB dependency.
- JSON output to stdout is the only requirement. `console.log(JSON.stringify(...))` does the job.
- If monitoring needs grow, swap the implementation later without changing call sites.

### What Changes Everywhere

Every `console.log` and `console.error` call in every module is replaced:

| Module | Current | New |
|--------|---------|-----|
| index.ts | `console.log("Fetched ${n} raw items")` | `logger.info("Fetched items from subgraph", { count: n })` |
| chain.ts | `console.log("TX ${hash} confirmed")` | `logger.info("TX confirmed", { hash, action, agentId })` |
| chain.ts | `console.log("Read router states")` | `logger.debug("Read router states", { count: agentIds.length })` |
| config.ts | `console.error("Config validation failed")` | `logger.error("Config validation failed", { issues: safeIssues })` |
| validation.ts | `console.warn(...)` | `logger.warn("Invalid item skipped", { itemId, reason })` |

**This is the most pervasive change** -- it touches every module but is purely mechanical (search-replace with structured data extraction).

## Data Flow Changes

### v1.0 Execute Phase
```
for each action:
  1. buildEvidence(params) -> EvidenceJson
  2. buildFeedbackURI(evidence) -> data: URI string
  3. walletClient.writeContract(routerAddress, functionName, args, nonce)
  4. publicClient.waitForTransactionReceipt(hash, 60s)
  5. if reverted: throw
  6. nonce++
```

### v1.1 Execute Phase
```
checkBalance(publicClient, account.address)     // NEW: preflight
for each action:
  0. if (shutdownRequested) break               // NEW: SIGTERM check
  1. buildEvidence(params) -> EvidenceJson       // unchanged
  2. pinToIPFS(evidence) -> ipfs:// URI          // NEW: replaces buildFeedbackURI
     (fallback to data: URI if no Pinata JWT)
  3. estimateGas(publicClient, txRequest)        // NEW: retryable estimation
  4. submitTx(walletClient, txRequest, gas)      // NEW: no-retry submission
  5. waitForReceipt(publicClient, hash)          // NEW: replacement-aware
  6. if reverted: throw                          // unchanged
  7. nonce++                                     // unchanged
  8. logger.info("TX confirmed", {...})          // NEW: structured log
```

## Build Order (Dependency-Driven)

Features have clear dependencies that dictate implementation order:

```
Step 1: logger.ts + config.ts updates
  |  No external dependency.
  |  logger.ts is imported by ALL other modules.
  |  config.ts adds LOG_LEVEL, PINATA_JWT.
  |  Must come first -- everything else uses the logger.
  |
Step 2: Migrate all console.log -> logger calls
  |  Requires: Step 1
  |  Mechanical change across all modules.
  |  All existing tests still pass (output format changes, logic unchanged).
  |
Step 3: ipfs.ts
  |  Requires: Step 1 (logger)
  |  Independent of tx.ts.
  |  Testable in isolation (mock Pinata API or use test JWT).
  |
Step 4: tx.ts
  |  Requires: Step 1 (logger)
  |  Independent of ipfs.ts.
  |  Contains: estimateGas, submitTx, waitForReceipt, checkBalance.
  |  Testable against anvil fork.
  |
Step 5: Refactor executeActions() in chain.ts
  |  Requires: Steps 1-4
  |  Integrates ipfs.ts, tx.ts, SIGTERM flag.
  |  This is the convergence point -- all features meet here.
  |
Step 6: SIGTERM handling in index.ts
  |  Requires: Step 5 (executeActions reads the flag)
  |  Simple: register handler, pass flag/callback to executeActions.
```

**Steps 3 and 4 can be built in parallel** -- they don't depend on each other, only on the logger from Step 1.

## Module Dependency Graph

```
types.ts        (no deps)
logger.ts       (no deps, imports types for LogLevel)
config.ts       (imports zod, logger)
evidence.ts     (imports types)
ipfs.ts         (imports types, logger, config)    NEW
tx.ts           (imports logger, viem types)        NEW
diff.ts         (imports types)
subgraph.ts     (imports types, logger, config)
validation.ts   (imports types, logger)
chain.ts        (imports config, evidence, ipfs, tx, logger, types, viem)  MODIFIED
index.ts        (imports everything)               MODIFIED
```

## Patterns to Follow

### Pattern: Fallback Chain for Evidence URI

```typescript
async function resolveEvidenceURI(
  evidence: EvidenceJson,
  pinataJwt: string | undefined
): Promise<string> {
  if (pinataJwt) {
    try {
      return await pinToIPFS(evidence, pinataJwt);
    } catch (err) {
      logger.warn("IPFS pin failed, falling back to data: URI", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return buildFeedbackURI(evidence);
}
```

IPFS is preferred but not required. Evidence enriches feedback but is not protocol-critical. Graceful degradation to data: URI prevents IPFS outages from blocking feedback submission.

### Pattern: Separated Retry Policies

```
READ operations (estimation, balance check):  retryable, 3 attempts, exponential backoff
WRITE operations (tx submission):             NOT retryable, fail immediately
WAIT operations (receipt polling):            timeout + log hash for investigation
```

This is the most important safety pattern. Retrying a write can produce duplicate transactions with different nonces, draining the wallet.

### Pattern: Structured Context Propagation

Each log call includes relevant context as structured fields, not interpolated strings:

```typescript
// BAD: unstructured, unparseable
console.log(`TX ${hash} confirmed for ${action.type} agentId=${action.agentId}`);

// GOOD: structured, queryable
logger.info("TX confirmed", { hash, action: action.type, agentId: action.agentId.toString() });
```

This enables log aggregation queries like `level=error AND action=submitNegativeFeedback`.

## Anti-Patterns to Avoid

### Anti-Pattern: Heavy Logging Framework

**What:** Installing pino, winston, or bunyan for a one-shot CLI tool.
**Why bad:** Adds dependency weight, async flushing complexity (logs lost on process.exit), configuration surface area. A one-shot bot writes 10-50 log lines per run.
**Instead:** 30-line custom logger. `console.log(JSON.stringify(entry))`. Swap later if monitoring needs grow.

### Anti-Pattern: Retry on Transaction Submission

**What:** Wrapping `walletClient.writeContract` in a retry loop.
**Why bad:** If the RPC accepted the tx but the response timed out, the tx is in the mempool. Retrying submits a SECOND tx with a different nonce. Both confirm. Wallet drained, duplicate feedback.
**Instead:** Retry gas estimation (read). Submit once (write). If submission fails ambiguously, log the nonce and exit. Next run's stateless diff will detect the actual on-chain state.

### Anti-Pattern: IPFS Pin as Hard Requirement

**What:** Aborting the entire run if Pinata is unreachable.
**Why bad:** Evidence is informational. The on-chain feedback (+95/-95, tags, agentId) is the protocol-critical data. Blocking feedback because a supplementary service is down prioritizes metadata over the core function.
**Instead:** Fall back to data: URI. Log a warning. The evidence is still available (just inline instead of IPFS-hosted).

### Anti-Pattern: Global Mutable Logger State

**What:** `logger.setLevel()` called mid-execution, or logger instance mutated after creation.
**Why bad:** In a one-shot bot this is minor, but it sets bad precedent. Log level should be config-driven and immutable after init.
**Instead:** Create logger once from config at startup. Pass or import. Never mutate.

## Testing Strategy for New Modules

| Module | Test Approach | Notes |
|--------|--------------|-------|
| logger.ts | Unit test: capture stdout, parse JSON, verify fields | Mock `console.log`, check output shape |
| ipfs.ts | Unit test: mock fetch, verify Pinata API call shape | Integration: use Pinata test JWT against real API |
| tx.ts | Unit test: mock publicClient/walletClient for retry logic | Integration: anvil fork for real gas estimation |
| chain.ts (executeActions) | Integration: anvil fork with all features wired | Verify SIGTERM flag, IPFS fallback, nonce management |

## Sources

- Existing codebase: `bot/src/*.ts` -- HIGH confidence (direct code reading)
- v1.0 ARCHITECTURE.md (`.planning/research/ARCHITECTURE.md` prior version) -- HIGH confidence
- Pinata API: `https://docs.pinata.cloud/api-reference/endpoint/pin-json-to-ipfs` -- HIGH confidence
- viem transaction lifecycle: `writeContract`, `waitForTransactionReceipt`, `simulateContract` -- HIGH confidence
- CLAUDE.md project constraints -- HIGH confidence

---
*Architecture research for: Kleros Reputation Oracle v1.1 Production Hardening*
*Researched: 2026-03-30*
