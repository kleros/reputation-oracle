# Phase 5: Transaction Safety - Pattern Map

**Mapped:** 2026-04-21
**Files analyzed:** 8 (5 modified, 1 new, 1 new optional, 1 config)
**Analogs found:** 8 / 8 (all in-repo; no analog for net-new capabilities — RESEARCH.md patterns apply)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `bot/src/chain.ts` | service | request-response | `bot/src/chain.ts` itself | self (rewrite of `executeActions`) |
| `bot/src/index.ts` | entry-point | request-response | `bot/src/index.ts` itself | self (additive) |
| `bot/src/config.ts` | config | transform | `bot/src/config.ts` itself | self (additive) |
| `bot/src/types.ts` | model | — | `bot/src/types.ts` itself | self (additive) |
| `bot/src/tx.ts` | utility | request-response | `bot/src/chain.ts` (estimateContractGas callers) | role-match |
| `bot/test/chain.test.ts` | test | — | `bot/test/diff.test.ts` | role-match (mock-heavy unit test) |
| `bot/test/tx.test.ts` | test | — | `bot/test/config.test.ts` | role-match (pure-function unit test) |
| `bot/.env.example` | config | — | `bot/.env.example` itself | self (additive) |

---

## Pattern Assignments

### `bot/src/types.ts` (model — extend RunSummary)

**Analog:** `bot/src/types.ts` lines 63-71

**Existing RunSummary pattern** (lines 63-71):
```typescript
/** Run summary emitted as the final log line before exit (D-05). */
export interface RunSummary {
	items: number;
	valid: number;
	actions: number;
	txSent: number;
	errors: number;
	durationMs: number;
}
```

**New fields to add** (D-20 — extend, no breaking change):
```typescript
/** Run summary emitted as the final log line before exit (D-05, extended by D-20). */
export interface RunSummary {
	items: number;
	valid: number;
	actions: number;
	txSent: number;       // counts only confirmed non-reverted receipts (semantic change from Phase 4)
	errors: number;
	durationMs: number;
	skipped: number;      // NEW: count of item-specific skips during this run
	systemicFailure?: string; // NEW: reason code from D-19 taxonomy; absent on success
}
```

**Also add** — `ExecuteActionsResult` interface (new, consumed by `chain.ts` return and `index.ts`):
```typescript
export interface ExecuteActionsResult {
	skipped: number;
	txSent: number;
	systemicFailure?: string;
}
```

**Also add** — `ShutdownHolder` type (new, threaded from `index.ts` → `chain.ts`):
```typescript
export interface ShutdownHolder {
	shutdown: boolean;
}
```

---

### `bot/src/config.ts` (config — add two env vars)

**Analog:** `bot/src/config.ts` lines 1-34

**Existing z.coerce pattern** (line 8):
```typescript
CHAIN_ID: z.coerce.number().int().positive(),
```

**New fields to add** after `LOG_LEVEL` (D-12, D-06):
```typescript
TX_RECEIPT_TIMEOUT_MS: z.coerce.number()
    .int()
    .positive()
    .optional()
    .default(120_000),

MIN_BALANCE_WEI: z.coerce.bigint()
    .optional()
    .default(5_000_000_000_000_000n),  // 0.005 ETH — bigint literal required (Pitfall D)
```

**Existing error handling pattern** (lines 25-33) — unchanged, carries through automatically:
```typescript
const safeIssues = result.error.issues.map((issue) => ({
    path: issue.path,
    message: issue.message,
    ...(issue.path.includes("BOT_PRIVATE_KEY") ? { received: "[REDACTED]" } : {}),
}));
logger.error({ issues: safeIssues }, "Config validation failed");
process.exit(1);
```

**Note:** Logging `MIN_BALANCE_WEI` anywhere must call `.toString()` — pino cannot serialize BigInt natively.

---

### `bot/src/tx.ts` (utility — new file, gas retry + error classification)

**Analog:** `bot/src/chain.ts` (writeContract call structure, import pattern)

**Import pattern** — copy from `bot/src/chain.ts` lines 1-14, adapting to tx.ts scope:
```typescript
import {
    type PublicClient,
    BaseError,
    ContractFunctionRevertedError,
    HttpRequestError,
    TimeoutError,
    type EstimateContractGasParameters,
} from "viem";
import { createChildLogger } from "./logger.js";
```

**Module-level logger pattern** — copy from `bot/src/chain.ts` line 16:
```typescript
const log = createChildLogger("tx");
```

**Core retry pattern** (from RESEARCH.md §Gas Estimation Retry Implementation):
```typescript
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;

export async function estimateGasWithRetry(
    publicClient: PublicClient,
    params: EstimateContractGasParameters,
): Promise<bigint> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            return await publicClient.estimateContractGas(params);
        } catch (err) {
            lastError = err;
            if (isRevertError(err)) {
                throw err; // immediate skip — no retry for reverts
            }
            if (attempt < MAX_ATTEMPTS) {
                // delays: 1000ms before attempt 2, 2000ms before attempt 3
                await delay(BASE_DELAY_MS * 2 ** (attempt - 1));
            }
        }
    }
    throw lastError; // exhausted — caller classifies and skips
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
```

**Error classification pattern** (from RESEARCH.md §viem v2.47 Error Classification — VERIFIED):
```typescript
// Use .walk() not direct .cause — error chain may have intermediate wrappers
export function isRevertError(err: unknown): boolean {
    if (!(err instanceof BaseError)) return false;
    return err.walk((e) => e instanceof ContractFunctionRevertedError)
        instanceof ContractFunctionRevertedError;
}

export function isTransientError(err: unknown): boolean {
    if (!(err instanceof BaseError)) return false;
    const inner = err.walk(
        (e) => e instanceof HttpRequestError || e instanceof TimeoutError,
    );
    return inner instanceof HttpRequestError || inner instanceof TimeoutError;
}
```

---

### `bot/src/chain.ts` (service — rewrite `executeActions`)

**Analog:** `bot/src/chain.ts` itself — existing `executeActions` lines 102-192 is the rewrite target.

**Existing imports pattern** (lines 1-14) — extend with new viem error types:
```typescript
import {
    type Chain,
    http,
    type PublicClient,
    createPublicClient as viemCreatePublicClient,
    createWalletClient as viemCreateWalletClient,
    type WalletClient,
    WaitForTransactionReceiptTimeoutError,
    TransactionExecutionError,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { routerAbi } from "./abi/router.js";
import type { Config } from "./config.js";
import { buildFeedbackURI, buildNegativeEvidence, buildPositiveEvidence } from "./evidence.js";
import { createChildLogger } from "./logger.js";
import { isRevertError } from "./tx.js";
import { type Action, type ExecuteActionsResult, FeedbackType, type ShutdownHolder } from "./types.js";
```

**New `executeActions` signature** (replaces current `Promise<void>` — D-20, RESEARCH.md §executeActions Return Shape):
```typescript
export async function executeActions(
    walletClient: WalletClient,
    publicClient: PublicClient,
    actions: Action[],
    config: Config,
    shutdownHolder: ShutdownHolder,
): Promise<ExecuteActionsResult>
```

**Existing nonce pattern** (lines 117-119) — unchanged, keep as-is:
```typescript
let nonce = await publicClient.getTransactionCount({
    address: account.address,
});
```

**Existing writeContract dispatch pattern** (lines 124-176) — keep all three branches, add `gas: estimate` param from `estimateGasWithRetry` result, wrap each action in try/catch for differentiated failure.

**Receipt wait pattern** (line 179-181) — replace hardcoded `60_000` with config var:
```typescript
const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: config.TX_RECEIPT_TIMEOUT_MS,
});
```

**Existing success log pattern** (line 190) — unchanged:
```typescript
log.info({ txHash: hash, action: action.type, agentId: action.agentId.toString() }, "TX confirmed");
```

**Skip-log pattern** (D-18 — new, copy structure from existing `log.debug` at line 94):
```typescript
log.warn(
    { action: action.type, agentId: action.agentId.toString(), reason, attempts: MAX_ATTEMPTS, lastError: safeMsg },
    "Action skipped",
);
skipped++;
```

**Systemic-stop pattern** (D-19 — new):
```typescript
log.error(
    { txHash: hash, action: action.type, agentId: action.agentId.toString(), timeoutMs: config.TX_RECEIPT_TIMEOUT_MS, reason: "receipt_timeout" },
    "Receipt timeout — tx may still be pending",
);
return { skipped, txSent, systemicFailure: "receipt_timeout" };
```

**Shutdown check at top of loop** (D-05 — new):
```typescript
for (const action of actions) {
    if (shutdownHolder.shutdown) {
        log.info("Shutdown requested, skipping remaining actions");
        break;
    }
    // ... action handling
}
```

---

### `bot/src/index.ts` (entry-point — additive changes)

**Analog:** `bot/src/index.ts` itself

**Existing import pattern** (lines 1-7) — extend:
```typescript
import { createViemPublicClient, createViemWalletClient, executeActions, readRouterStates } from "./chain.js";
import { loadConfig } from "./config.js";
import { computeActions } from "./diff.js";
import { logger, reconfigureLogLevel } from "./logger.js";
import { fetchAllItems } from "./subgraph.js";
import type { RunSummary, ShutdownHolder, ValidatedItem } from "./types.js";
import { validateAndTransformItem } from "./validation.js";
```

**Existing `emitSummary` pattern** (lines 9-12) — unchanged but `summary` now includes `skipped` and `systemicFailure?`:
```typescript
function emitSummary(summary: RunSummary, startTime: number): void {
    summary.durationMs = Date.now() - startTime;
    logger.info({ summary }, "Run complete");
}
```

**New `flushAndExit` helper** — add near top of file, before `main()`:
```typescript
function flushAndExit(code: number): void {
    logger.flush(() => process.exit(code));
}
```

**Existing summary init** (line 16) — extend with new fields:
```typescript
const summary: RunSummary = { items: 0, valid: 0, actions: 0, txSent: 0, errors: 0, durationMs: 0, skipped: 0 };
```

**New signal handler registration** — add at start of `main()` before step 1 (D-05):
```typescript
const shutdownHolder: ShutdownHolder = { shutdown: false };
const handleSignal = (signal: string): void => {
    logger.warn({ signal }, "Signal received, finishing current action then exiting");
    shutdownHolder.shutdown = true;
};
process.on("SIGTERM", () => handleSignal("SIGTERM"));
process.on("SIGINT", () => handleSignal("SIGINT"));
```

**Balance preflight** — add after clients are created, before step 9 (no-actions check), after step 6 (D-06):
```typescript
const balance = await publicClient.getBalance({ address: account.address });
if (balance < config.MIN_BALANCE_WEI) {
    logger.error(
        { actual: balance.toString(), required: config.MIN_BALANCE_WEI.toString(), reason: "balance_below_threshold" },
        "Insufficient wallet balance, aborting",
    );
    summary.errors = 1;
    summary.systemicFailure = "balance_below_threshold";
    emitSummary(summary, startTime);
    flushAndExit(1);
    return;
}
```

**Existing `executeActions` call** (line 75) — update signature and wire result:
```typescript
const result = await executeActions(walletClient, publicClient, actions, config, shutdownHolder);
summary.txSent = result.txSent;
summary.skipped = result.skipped;
if (result.systemicFailure) {
    summary.errors = 1;
    summary.systemicFailure = result.systemicFailure;
}
```

**Existing exit pattern** (lines 88-93) — replace bare `process.exit` with `flushAndExit`:
```typescript
// was: .then(() => process.exit(0))
main()
    .then(() => {
        emitSummary(summary, startTime); // if not already emitted
        flushAndExit(summary.systemicFailure ? 1 : 0);
    })
    .catch((error) => {
        logger.error({ err: error }, "Bot failed");
        flushAndExit(1);
    });
```

**Note:** `emitSummary` must always be called BEFORE `flushAndExit`. Every exit path (dry-run return, no-actions return, systemic failure, normal completion, catch) must emit summary then flush.

---

### `bot/test/tx.test.ts` (test — new, unit tests for `tx.ts`)

**Analog:** `bot/test/config.test.ts` (pure-function test: no external mocks, `safeParse` calls)

**File structure pattern** — copy from `bot/test/config.test.ts` lines 1-3:
```typescript
import { describe, expect, it, vi } from "vitest";
import { estimateGasWithRetry, isRevertError, isTransientError } from "../src/tx.js";
```

**Test block structure** — copy from `bot/test/diff.test.ts` lines 18-31 (describe + helper + it):
```typescript
describe("estimateGasWithRetry", () => {
    it("succeeds on first attempt", async () => { ... });
    it("retries on HttpRequestError and succeeds on 3rd attempt", async () => { ... });
    it("exhausts 3 retries on HttpRequestError -> throws", async () => { ... });
    it("skips retries on ContractFunctionRevertedError -> throws immediately", async () => { ... });
});

describe("isRevertError", () => { ... });
describe("isTransientError", () => { ... });
```

**viem mock pattern** (from RESEARCH.md §Vitest Mock Pattern):
```typescript
import { vi } from "vitest";
import type { PublicClient } from "viem";

const mockPublicClient = {
    estimateContractGas: vi.fn(),
} as unknown as PublicClient;

// Reset between tests
beforeEach(() => {
    vi.clearAllMocks();
});
```

**Mock rejection with viem error types:**
```typescript
import { ContractFunctionExecutionError, ContractFunctionRevertedError, HttpRequestError } from "viem";

// Simulate a revert (note: wrapped in ExecutionError per error hierarchy)
mockPublicClient.estimateContractGas
    .mockRejectedValueOnce(new ContractFunctionExecutionError(
        new ContractFunctionRevertedError({ ... }),
        { ... }
    ));

// Simulate transient error
mockPublicClient.estimateContractGas
    .mockRejectedValueOnce(new HttpRequestError({ url: "http://rpc", status: 503 }));
```

---

### `bot/test/chain.test.ts` (test — new, unit tests for `executeActions`)

**Analog:** `bot/test/diff.test.ts` (mock-heavy unit test with helper functions)

**File structure pattern** — copy from `bot/test/diff.test.ts` lines 1-17:
```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { executeActions } from "../src/chain.js";
import { FeedbackType, type Action, type ShutdownHolder, type ValidatedItem } from "../src/types.js";
```

**Helper factory pattern** — copy from `bot/test/diff.test.ts` lines 6-16 (`makeItem`):
```typescript
function makeAction(overrides: Partial<Action> = {}): Action {
    return {
        type: "submitPositiveFeedback",
        agentId: 1n,
        pgtcrItemId: "0xabc",
        item: makeItem({ agentId: 1n }),
        ...overrides,
    } as Action;
}
```

**viem client mock setup** (from RESEARCH.md §Vitest Mock Pattern):
```typescript
const mockPublicClient = {
    estimateContractGas: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
    getBalance: vi.fn(),
    getTransactionCount: vi.fn(),
} as unknown as PublicClient;

const mockWalletClient = {
    writeContract: vi.fn(),
    account: { address: "0x1234567890123456789012345678901234567890" as `0x${string}` },
    chain: { id: 11155111 },
} as unknown as WalletClient;

beforeEach(() => {
    vi.clearAllMocks();
});
```

**Shutdown holder reset pattern** (Pitfall E):
```typescript
// Create fresh holder per test — DO NOT use module-scoped let
const shutdownHolder: ShutdownHolder = { shutdown: false };
```

**SC-1: Gas estimation → skip test structure:**
```typescript
it("skips action on gas estimation revert, continues to next action", async () => {
    mockPublicClient.estimateContractGas
        .mockRejectedValueOnce(/* ContractFunctionRevertedError */)
        .mockResolvedValueOnce(21000n);
    mockWalletClient.writeContract.mockResolvedValueOnce("0xhash");
    mockPublicClient.waitForTransactionReceipt.mockResolvedValueOnce({ status: "success" });

    const result = await executeActions(mockWalletClient, mockPublicClient, [action1, action2], config, shutdownHolder);

    expect(result.skipped).toBe(1);
    expect(result.txSent).toBe(1);
    expect(result.systemicFailure).toBeUndefined();
});
```

**SC-2: Receipt timeout → systemic stop:**
```typescript
import { WaitForTransactionReceiptTimeoutError } from "viem";

it("returns systemicFailure on receipt timeout", async () => {
    mockPublicClient.waitForTransactionReceipt
        .mockRejectedValueOnce(new WaitForTransactionReceiptTimeoutError({ hash: "0xhash", timeout: 120000 }));

    const result = await executeActions(...);
    expect(result.systemicFailure).toBe("receipt_timeout");
    expect(result.txSent).toBe(0);
});
```

**SC-4: SIGTERM mid-batch:**
```typescript
it("stops after current action when shutdownHolder.shutdown is set", async () => {
    // After first action completes, set shutdown flag
    mockPublicClient.waitForTransactionReceipt.mockImplementationOnce(async () => {
        shutdownHolder.shutdown = true;
        return { status: "success" };
    });

    const result = await executeActions(mockWalletClient, mockPublicClient, [action1, action2, action3], config, shutdownHolder);

    expect(result.txSent).toBe(1);
    expect(mockWalletClient.writeContract).toHaveBeenCalledTimes(1);
});
```

---

### `bot/.env.example` (config — additive)

**Analog:** `bot/.env.example` lines 1-7

**Existing format** — one var per line, no inline comments except `0x...` placeholders:
```
CHAIN_ID=11155111
RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
```

**New lines to add** at end of file (D-12, D-06):
```
# TX_RECEIPT_TIMEOUT_MS: Receipt wait timeout in ms. Default: 120000 (L1). L2 deployments: 30000.
# TX_RECEIPT_TIMEOUT_MS=120000

# MIN_BALANCE_WEI: Minimum wallet balance in wei before aborting. Default: 5000000000000000 (0.005 ETH).
# MIN_BALANCE_WEI=5000000000000000
```

---

## Shared Patterns

### Child Logger Initialization
**Source:** `bot/src/chain.ts` line 16, `bot/src/logger.ts` lines 44-46
**Apply to:** `bot/src/tx.ts` (new file)
```typescript
const log = createChildLogger("tx");
```

### Pino Flush Before Exit (Pitfall F — DO NOT use pino.final)
**Source:** RESEARCH.md §pino v10 Flush Pattern (VERIFIED against pino 10.3.1)
**Apply to:** Every `process.exit()` site in `bot/src/index.ts`
```typescript
function flushAndExit(code: number): void {
    logger.flush(() => process.exit(code));
}
```
Rule: `emitSummary(summary, startTime)` THEN `flushAndExit(code)`. Never `flushAndExit` without emitting summary first.

### viem Error Walk Pattern (Pitfall B — do not use direct instanceof)
**Source:** RESEARCH.md §viem v2.47 Error Classification (VERIFIED against viem 2.47.6)
**Apply to:** `bot/src/tx.ts` `isRevertError`, `isTransientError`; `bot/src/chain.ts` writeContract error classification
```typescript
// CORRECT — .walk() traverses full chain
err.walk((e) => e instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError

// WRONG — ContractFunctionExecutionError wraps ContractFunctionRevertedError
err instanceof ContractFunctionRevertedError
```

### ShutdownHolder as Passed Object (Pitfall E — no module-scoped state)
**Source:** RESEARCH.md §shuttingDown Holder Shape
**Apply to:** `bot/src/index.ts` (create), `bot/src/chain.ts` (consume), all tests for `executeActions`
```typescript
// index.ts: create and pass
const shutdownHolder: ShutdownHolder = { shutdown: false };

// chain.ts: check at top of each action iteration
if (shutdownHolder.shutdown) { break; }

// tests: create fresh per test (not module-scoped)
const shutdownHolder: ShutdownHolder = { shutdown: false };
```

### BigInt Serialization Guard
**Source:** RESEARCH.md §Zod v4 Config Schema Additions
**Apply to:** Any log call in `bot/src/index.ts` or `bot/src/chain.ts` that logs `MIN_BALANCE_WEI` or balance values
```typescript
// REQUIRED: pino cannot serialize BigInt
{ actual: balance.toString(), required: config.MIN_BALANCE_WEI.toString() }
```

### Vitest Mock Reset Pattern
**Source:** `bot/test/validation.test.ts` lines 53-56 (spy-per-test idiom)
**Apply to:** `bot/test/chain.test.ts`, `bot/test/tx.test.ts`
```typescript
beforeEach(() => {
    vi.clearAllMocks();
});
```

### WaitForTransactionReceiptTimeoutError Hash Capture (Pitfall C)
**Source:** RESEARCH.md §Pitfall C
**Apply to:** `bot/src/chain.ts` receipt timeout handler
```typescript
// Capture hash from writeContract return BEFORE calling waitForTransactionReceipt
const hash = await walletClient.writeContract({ ... });
try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: config.TX_RECEIPT_TIMEOUT_MS });
} catch (err) {
    if (err instanceof WaitForTransactionReceiptTimeoutError) {
        // log `hash` from outer scope — NOT err.hash (property does not exist)
        log.error({ txHash: hash, reason: "receipt_timeout" }, "...");
    }
}
```

---

## No Analog Found

All files have in-repo analogs or direct RESEARCH.md patterns. The following capabilities are net-new with no prior codebase example — RESEARCH.md patterns are authoritative:

| Capability | Location | Source Pattern |
|------------|----------|----------------|
| Exponential backoff retry | `bot/src/tx.ts` `estimateGasWithRetry` | RESEARCH.md §Gas Estimation Retry Implementation |
| viem error walk classification | `bot/src/tx.ts` `isRevertError`/`isTransientError` | RESEARCH.md §viem v2.47 Error Classification |
| SIGTERM/SIGINT handler | `bot/src/index.ts` | RESEARCH.md §Signal Handler + Flush Exit |
| `flushAndExit` helper | `bot/src/index.ts` | RESEARCH.md §pino v10 Flush Pattern |
| Balance preflight | `bot/src/index.ts` | RESEARCH.md §Balance Preflight |
| `executeActions` returning `ExecuteActionsResult` | `bot/src/chain.ts` | RESEARCH.md §executeActions Return Shape |

---

## Metadata

**Analog search scope:** `bot/src/`, `bot/test/`
**Files scanned:** 10 source files, 4 test files
**Pattern extraction date:** 2026-04-21
