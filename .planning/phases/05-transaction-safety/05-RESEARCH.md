# Phase 5: Transaction Safety - Research

**Researched:** 2026-04-21
**Domain:** viem v2.47 error types, pino v10 flush, zod v4 bigint coercion, Node.js signal handling, vitest testing patterns
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Error Handling Policy (replaces Phase 2 D-10):**
- D-01: Skip-and-continue for item-specific failures; stop-and-exit-nonzero for systemic failures; stop-and-exit-zero for SIGTERM/SIGINT.
- D-02: A single revert is a skip, not a systemic stop.
- D-03: Register SIGTERM and SIGINT on same graceful path; set `shuttingDown = true`; flush then exit.
- D-04: Do NOT call `process.exit()` inside signal handler while async work is in-flight.
- D-05: Signal handlers registered in `index.ts main()` before `executeActions()`; shuttingDown passed by reference.
- D-06: Single startup balance check against configurable `MIN_BALANCE_WEI` (default 5000000000000000 wei = 0.005 ETH); exit 1 if below.
- D-07: No per-tx balance re-check.
- D-08: Gas estimation via `estimateContractGas` separate from `writeContract`; 3 attempts, base 1000ms, multiplier 2.
- D-09: Classify estimation errors — revert errors do NOT retry; only transient errors retry.
- D-10: After retries exhausted on transient error, skip action; log `warn` with `{action, agentId, attempts: 3, reason: "gas_estimation_exhausted", lastError}`.
- D-11: `writeContract` is NEVER retried.
- D-12: `TX_RECEIPT_TIMEOUT_MS` env var (default 120000); replaces hardcoded 60000 at chain.ts:181.
- D-13: On timeout or null receipt: log `error`, emit RunSummary, `process.exit(1)`.
- D-14: Do NOT probe `eth_getTransactionByHash` after timeout.
- D-15: `receipt.status === "reverted"` is a skip, not a systemic stop (reverts Phase 2 D-10's throw at chain.ts:185).
- D-16: Binary exit codes: 0 = no systemic failure; 1 = systemic failure.
- D-17: Item-specific skips do NOT promote to exit 1.
- D-18: Per-skip `warn` log with `{action, agentId, reason, attempts?, lastError?}`; reason in `["gas_estimation_exhausted", "gas_estimation_reverted", "submission_reverted", "receipt_reverted"]`.
- D-19: Systemic failure `error` log with `{reason, ...context}`; reason in `["receipt_timeout", "receipt_null", "balance_below_threshold", "rpc_connection_lost", "submission_failed_non_revert", "nonce_rejected"]`.
- D-20: Extend `RunSummary` with `skipped: number` and `systemicFailure?: string`; `txSent` counts only confirmed non-reverted receipts.

### Claude's Discretion
- Backoff timer implementation (setTimeout vs p-timers) — pure function style preferred, no new deps
- Whether to extract retry helper into `bot/src/tx.ts` or keep inline in `chain.ts`
- Exact viem error classification predicates (instanceof vs name string matching)
- `shuttingDown` holder shape (module-scoped let, `{shutdown: boolean}` holder, or AbortSignal)
- How to wire `logger.flush()` on exit paths without regressing stdout/stderr separation from Phase 4

### Deferred Ideas (OUT OF SCOPE)
- Contract-level idempotency for `submitPositiveFeedback` / `revokeOnly`
- Execution-time global budget
- `eth_getTransactionByHash` probe after receipt timeout
- Circuit breaker for RPC after N consecutive failures
- Multi-instance coordination / mutex
- Retry-after-scaled-gas for timeout recovery
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TXSAFE-01 | Gas estimation retries with exponential backoff (3 attempts); tx submission never retried | D-08/D-09/D-10/D-11 locked; viem `estimateContractGas` is the correct separation point; `ContractFunctionExecutionError.walk()` detects reverts |
| TXSAFE-02 | Null or timed-out receipts logged with tx hash; treated as errors; next run re-diffs | D-12/D-13 locked; viem throws `WaitForTransactionReceiptTimeoutError` on timeout; `hash` is available on that error |
| TXSAFE-03 | Bot checks wallet balance before sending; exits early if below threshold | D-06 locked; `publicClient.getBalance()` + `MIN_BALANCE_WEI` env var; `z.coerce.bigint()` zod v4 validated |
| TXSAFE-04 | SIGTERM/SIGINT finishes current tx, skips remaining, exits cleanly with summary | D-03/D-04/D-05 locked; `{shutdown: boolean}` holder is simplest testable pattern |
</phase_requirements>

---

## Summary

Phase 5 hardens `executeActions()` in `bot/src/chain.ts` against four failure modes: gas estimation transience, receipt non-arrival, wallet depletion, and external termination signals. All 20 implementation decisions are locked in CONTEXT.md. Research scope is narrow: confirm exact viem v2.47 error class hierarchy for D-09 classification, verify pino v10.3 flush mechanics for D-03/D-04, verify zod v4 bigint coercion for D-06's `MIN_BALANCE_WEI`, and identify the cleanest test-entry points for the four success criteria.

The installed stack is viem 2.47.6, pino 10.3.1, zod 4.3.6, vitest 4.1.2. All confirmations below are `[VERIFIED]` against the installed packages in `bot/node_modules/`.

**Primary recommendation:** Extract the retry+classification logic into `bot/src/tx.ts` (per ARCHITECTURE.md's component plan). This makes the pure estimation/classification logic unit-testable without anvil, while `executeActions()` integration tests via anvil fork handle the full loop. The `shuttingDown` holder should be `{shutdown: boolean}` passed into `executeActions()` — trivially assertable in tests and avoids module-scoped state that bleeds between test cases.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Gas estimation retry | Bot (tx.ts) | — | Read-only RPC call, retryable; isolated from write path |
| Tx submission (no retry) | Bot (chain.ts) | — | Write operation; nonce management is loop-level state in executeActions |
| Receipt wait + timeout | Bot (tx.ts or chain.ts) | — | viem waitForTransactionReceipt; timeout is configurable |
| Balance preflight | Bot (index.ts) | — | One-time check before executeActions; belongs at orchestration layer |
| SIGTERM handler registration | Bot (index.ts) | — | Signal handlers must be registered at process boundary, not inside modules |
| shuttingDown flag propagation | Bot (index.ts → chain.ts) | — | Flag is set in index.ts, checked in executeActions loop |
| RunSummary extension | Bot (types.ts) | — | Type definition; consumed by index.ts emitSummary |
| Env var validation | Bot (config.ts) | — | New optional vars: MIN_BALANCE_WEI, TX_RECEIPT_TIMEOUT_MS |

---

## Standard Stack

No new packages required for this phase.

### Core (unchanged)
| Library | Version | Purpose | Note |
|---------|---------|---------|------|
| viem | 2.47.6 | Ethereum client, error classes | `[VERIFIED: bot/package-lock.json]` |
| pino | 10.3.1 | Structured logger, `logger.flush()` | `[VERIFIED: bot/node_modules/pino/package.json]` |
| zod | 4.3.6 | Config schema with `z.coerce.bigint()` | `[VERIFIED: bot/node_modules/zod/package.json]` |
| vitest | 4.1.2 | Unit + integration tests | `[VERIFIED: bot/package.json]` |
| Node.js | 22 LTS | `process.on('SIGTERM')`, `setTimeout` | `[VERIFIED: CLAUDE.md]` |

**No new npm packages needed.** All required primitives exist in the current dependency tree.

---

## Architecture Patterns

### System Architecture Diagram

```
index.ts main()
  |
  +-- [startup] loadConfig() -> Config  (adds MIN_BALANCE_WEI, TX_RECEIPT_TIMEOUT_MS)
  |
  +-- [startup] register signal handlers -> {shutdown: boolean} holder
  |             process.on('SIGTERM') / process.on('SIGINT') set holder.shutdown = true
  |
  +-- [startup] publicClient.getBalance(account) vs MIN_BALANCE_WEI
  |             < threshold -> log error + emitSummary + exit(1)
  |
  +-- executeActions(walletClient, publicClient, actions, config, shutdownHolder)
  |     |
  |     +-- [each action] check shutdownHolder.shutdown -> break if true
  |     |
  |     +-- estimateGasWithRetry(publicClient, txParams)   [tx.ts]
  |     |     |-- attempt 1..3 with backoff (1s, 2s between attempts)
  |     |     |-- isRevertError(err)? -> throw immediately (no retry)
  |     |     |-- isTransientError(err)? -> wait + retry
  |     |     |-- exhausted -> throw GasEstimationExhaustedError
  |     |     [classify error in caller] -> skip action on revert/exhausted
  |     |
  |     +-- walletClient.writeContract({...params, gas: estimate, nonce})
  |     |     [no retry; TransactionExecutionError wraps inner cause]
  |     |     isRevertError(err)? -> skip action ("submission_reverted")
  |     |     else              -> systemic stop (log error + throw)
  |     |
  |     +-- publicClient.waitForTransactionReceipt({hash, timeout: TX_RECEIPT_TIMEOUT_MS})
  |     |     WaitForTransactionReceiptTimeoutError -> systemic stop (log hash + throw)
  |     |     receipt.status === "reverted"        -> skip action ("receipt_reverted")
  |     |     receipt.status === "success"         -> nonce++, txSent++
  |     |
  |     +-- returns {skipped, txSent, systemicFailure?}
  |
  +-- [exit] emitSummary -> logger.flush() -> process.exit(0 or 1)
```

### Recommended File Changes
```
bot/src/
├── types.ts       # extend RunSummary: + skipped, + systemicFailure?; txSent semantic change
├── config.ts      # add MIN_BALANCE_WEI, TX_RECEIPT_TIMEOUT_MS to configSchema
├── tx.ts          # NEW: estimateGasWithRetry(), isRevertError(), isTransientError()
├── chain.ts       # rewrite executeActions() to use tx.ts + differentiated failure policy
└── index.ts       # add signal handlers, balance preflight, flush before every exit
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Error class detection | Regex on error.message | `err instanceof ContractFunctionRevertedError` (see below) | String matching is fragile across viem versions; instanceof is stable |
| Receipt timeout detection | Poll loop with setInterval | `waitForTransactionReceipt({hash, timeout})` | viem already throws `WaitForTransactionReceiptTimeoutError` |
| Bigint env var parsing | Custom string-to-bigint parser | `z.coerce.bigint()` in zod v4 | Handles "5000000000000000" -> 5000000000000000n natively |
| Retry with backoff | npm `p-retry` | Custom ~15-line `withRetry()` | REQUIREMENTS.md explicitly lists p-retry as "Out of Scope" |

---

## viem v2.47 Error Classification (D-09 — CRITICAL)

### Error Hierarchy for `estimateContractGas`

`[VERIFIED: bot/node_modules/viem/errors/contract.ts, utils/errors/getContractError.ts]`

`publicClient.estimateContractGas()` wraps errors via `getContractError()`:

```
ContractFunctionExecutionError          <- what you catch
  └── .cause: ContractFunctionRevertedError   <- REVERT (do not retry)
  └── .cause: HttpRequestError                <- TRANSIENT (retry)
  └── .cause: TimeoutError                    <- TRANSIENT (retry)
  └── .cause: <other BaseError>               <- UNKNOWN (treat as transient or stop)
```

**Detection pattern (recommended — instanceof, stable in v2.47):**

```typescript
// Source: bot/node_modules/viem/errors/contract.ts (ContractFunctionRevertedError exported from viem)
import {
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  HttpRequestError,
  TimeoutError,
} from "viem";

export function isRevertError(err: unknown): boolean {
  if (!(err instanceof BaseError)) return false;
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
  return revert instanceof ContractFunctionRevertedError;
}

export function isTransientError(err: unknown): boolean {
  if (!(err instanceof BaseError)) return false;
  const inner = err.walk(
    (e) => e instanceof HttpRequestError || e instanceof TimeoutError,
  );
  return inner instanceof HttpRequestError || inner instanceof TimeoutError;
}
```

**Why `err.walk()` not direct `.cause`:** The error chain may have intermediate wrappers (`ContractFunctionExecutionError` -> `ContractFunctionRevertedError`). `.walk()` traverses the full chain. `[VERIFIED: viem/errors/base.ts exports walk()]`

**Fallback (name-string matching):** If a future viem upgrade breaks instanceof (unlikely for stable error classes), name-string matching is the fallback:

```typescript
// Fallback only — prefer instanceof
function isRevertErrorByName(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (err as any).name === "ContractFunctionRevertedError" ||
    !!(err as any).walk?.((e: Error) => (e as any).name === "ContractFunctionRevertedError");
}
```

### Error Hierarchy for `writeContract`

`[VERIFIED: bot/node_modules/viem/actions/wallet/sendTransaction.ts, utils/errors/getTransactionError.ts]`

`walletClient.writeContract()` wraps via `getTransactionError()`:

```
TransactionExecutionError               <- what you catch
  └── .cause: ContractFunctionRevertedError   <- execution reverted (skip)
  └── .cause: HttpRequestError                <- network issue (systemic stop)
  └── .cause: <nonce rejection RpcError>      <- nonce too low/high (systemic stop)
```

**Detection for writeContract errors:**

```typescript
import { TransactionExecutionError, ContractFunctionRevertedError, BaseError } from "viem";

// After writeContract throws:
if (err instanceof TransactionExecutionError) {
  if (isRevertError(err)) {
    // skip action, reason: "submission_reverted"
  } else {
    // systemic stop, reason: "submission_failed_non_revert"
  }
}
```

**Note:** The same `isRevertError()` function works on `TransactionExecutionError` because `.walk()` traverses the full chain. `[VERIFIED: viem/errors/base.ts BaseError.walk()]`

### Error Hierarchy for `waitForTransactionReceipt`

`[VERIFIED: bot/node_modules/viem/errors/transaction.ts]`

```typescript
import { WaitForTransactionReceiptTimeoutError } from "viem";

// On timeout:
// throws WaitForTransactionReceiptTimeoutError with .message containing the hash
// The error object does NOT directly expose the hash as a property — but the hash
// is available in the calling scope before the await.
```

**Receipt status check (no throw needed):**

```typescript
const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: config.TX_RECEIPT_TIMEOUT_MS });
// receipt.status is "success" | "reverted" — check directly
if (receipt.status === "reverted") {
  // skip action, reason: "receipt_reverted"
}
```

---

## Zod v4 Config Schema Additions

`[VERIFIED: bot/node_modules/zod/package.json v4.3.6, Context7 docs for z.coerce.bigint()]`

```typescript
// config.ts additions:

// MIN_BALANCE_WEI: string env var -> bigint
// z.coerce.bigint() calls BigInt(input) — works for numeric strings like "5000000000000000"
MIN_BALANCE_WEI: z.coerce.bigint()
  .optional()
  .default(5_000_000_000_000_000n),  // 0.005 ETH

// TX_RECEIPT_TIMEOUT_MS: string env var -> number
TX_RECEIPT_TIMEOUT_MS: z.coerce.number()
  .int()
  .positive()
  .optional()
  .default(120_000),
```

**Caution:** `z.coerce.bigint()` throws a zod error (not a JS error) if the input cannot be coerced (e.g., `"abc"`). The existing `loadConfig()` error handling already catches and logs zod validation failures. No extra handling needed.

**Caution:** Pino does not serialize `BigInt` natively. When logging `MIN_BALANCE_WEI`, always call `.toString()`:

```typescript
logger.error(
  { actual: balance.toString(), required: config.MIN_BALANCE_WEI.toString() },
  "Insufficient balance",
);
```

---

## pino v10 Flush Pattern (Pitfall 14)

`[VERIFIED: bot/node_modules/pino/pino.d.ts, pino v10.3.1]`

The installed logger uses `pino.destination(2)` (fd 2 = stderr, async by default). Buffered lines are dropped on `process.exit()` unless flushed first.

### `logger.flush()` signature

```typescript
// pino.d.ts line 129:
flush(cb?: (err?: Error) => void): void;
```

`flush()` is **asynchronous** — it takes a callback. Calling `logger.flush()` without a callback and immediately calling `process.exit()` is NOT safe because the flush has not completed.

**Correct pattern for synchronous exit paths:**

```typescript
// Option A: callback-based (correct)
function flushAndExit(code: number): void {
  logger.flush(() => process.exit(code));
}

// Option B: promisify (also correct)
function flushAndExit(code: number): Promise<void> {
  return new Promise((resolve) => {
    logger.flush(() => {
      process.exit(code);
      resolve(); // unreachable, for TS
    });
  });
}
```

**Do NOT do:**

```typescript
// WRONG: flush() is async; process.exit fires before flush completes
logger.flush();
process.exit(0);
```

**Application to this phase:** Every `process.exit()` site in `index.ts` must use the callback form. Current `index.ts` exit sites (lines 89, 92) become:

```typescript
// line 89 (success path):
.then(() => { logger.flush(() => process.exit(0)); })

// line 92 (error path):
.catch((error) => {
  logger.error({ err: error }, "Bot failed");
  logger.flush(() => process.exit(1));
});
```

**Signal handler exit (D-03):**
```typescript
// In main() after emitSummary():
logger.flush(() => process.exit(0));
```

**Note on `pino.final`:** The `pino.final(logger, handler)` API does NOT exist in pino v10. It existed in pino v6-v8 and was removed. Do not use it. `logger.flush(cb)` is the correct v10 pattern. `[VERIFIED: pino v10.3.1 pino.d.ts — no pino.final export]`

---

## shuttingDown Holder Shape (D-05 — Claude's Discretion)

**Recommendation:** `{shutdown: boolean}` plain object passed into `executeActions()`.

```typescript
// index.ts
const shutdownHolder = { shutdown: false };

process.on("SIGTERM", () => {
  logger.warn({ signal: "SIGTERM" }, "Signal received, finishing current action");
  shutdownHolder.shutdown = true;
});
process.on("SIGINT", () => {
  logger.warn({ signal: "SIGINT" }, "Signal received, finishing current action");
  shutdownHolder.shutdown = true;
});

await executeActions(walletClient, publicClient, actions, config, shutdownHolder);
```

```typescript
// chain.ts executeActions signature
export async function executeActions(
  walletClient: WalletClient,
  publicClient: PublicClient,
  actions: Action[],
  config: Config,
  shutdownHolder: { shutdown: boolean },  // NEW
): Promise<{ skipped: number; txSent: number; systemicFailure?: string }> {
  // At top of action loop:
  for (const action of actions) {
    if (shutdownHolder.shutdown) {
      log.info({ remaining: actions.length - i }, "Shutdown requested, skipping remaining actions");
      break;
    }
    // ...
  }
}
```

**Why this shape over alternatives:**
- Module-scoped `let shuttingDown = false` in `chain.ts`: test isolation problem — signal tests cannot reset state between cases without module reload.
- `AbortSignal`: correct but adds `AbortController` in `index.ts` and `signal.throwIfAborted()` semantics that don't match the "finish current tx, skip next" behavior — we want to CHECK between actions, not abort mid-action.
- `{shutdown: boolean}` holder: trivially resettable in tests (`holder.shutdown = false`), explicit contract between `index.ts` and `chain.ts`, zero extra imports.

---

## executeActions Return Shape (D-20)

Current signature: `async function executeActions(...): Promise<void>`

New signature:

```typescript
interface ExecuteActionsResult {
  skipped: number;
  txSent: number;
  systemicFailure?: string;  // reason string from D-19 taxonomy, absent on success
}

export async function executeActions(
  walletClient: WalletClient,
  publicClient: PublicClient,
  actions: Action[],
  config: Config,
  shutdownHolder: { shutdown: boolean },
): Promise<ExecuteActionsResult>
```

`executeActions` no longer throws for item-specific failures. It collects `skipped` and `txSent` counts. For systemic failures it sets `systemicFailure` and returns (does NOT throw) — so `index.ts` decides the exit code without try/catch gymnastics.

**Only exception:** Pre-condition errors that should never happen in production (e.g., `WalletClient has no account`) may still throw. These are caught by `main()`'s outer `catch`.

---

## Gas Estimation Retry Implementation (D-08)

```typescript
// bot/src/tx.ts (recommended extraction)

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
        throw err; // immediate skip — no retry
      }
      if (attempt < MAX_ATTEMPTS) {
        // delays: 1000ms (before attempt 2), 2000ms (before attempt 3)
        await delay(BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    }
  }
  throw lastError; // exhausted
}

// Pure function, no side effects — safe to unit test with mocked publicClient
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

**Nonce note:** `estimateContractGas` does NOT consume or advance the nonce. The nonce is only passed to `writeContract`. Separating estimation from submission is safe. `[VERIFIED: viem estimateContractGas docs — nonce is optional param that does not affect chain state]`

---

## Common Pitfalls

### Pitfall A: `logger.flush()` without callback drops last log lines
**What goes wrong:** `logger.flush(); process.exit(0)` — flush is async, exit fires first.
**Prevention:** Always use callback form: `logger.flush(() => process.exit(code))`.
**Source:** Pitfall 14 in PITFALLS.md + pino v10.3 type signature confirmed.

### Pitfall B: `ContractFunctionRevertedError` is nested, not top-level
**What goes wrong:** `err instanceof ContractFunctionRevertedError` returns false because `estimateContractGas` throws `ContractFunctionExecutionError` wrapping the revert.
**Prevention:** Use `err.walk(e => e instanceof ContractFunctionRevertedError)` instead of direct instanceof check.
**Source:** `[VERIFIED: viem/utils/errors/getContractError.ts]`

### Pitfall C: `WaitForTransactionReceiptTimeoutError` does not expose hash as property
**What goes wrong:** Trying to log `err.hash` from the caught `WaitForTransactionReceiptTimeoutError` — the property does not exist.
**Prevention:** Capture `hash` from the `writeContract` return value before calling `waitForTransactionReceipt`. Log it in the catch block from the outer scope.
**Source:** `[VERIFIED: viem/errors/transaction.ts WaitForTransactionReceiptTimeoutError constructor — no hash property]`

### Pitfall D: `z.coerce.bigint()` default literal requires bigint suffix
**What goes wrong:** `.default(5_000_000_000_000_000)` passes a Number, which silently loses precision above 2^53.
**Prevention:** Use bigint literal: `.default(5_000_000_000_000_000n)`.
**Source:** `[VERIFIED: zod v4 docs, standard JS bigint literal syntax]`

### Pitfall E: Module-scoped shuttingDown bleeds between vitest tests
**What goes wrong:** If `shuttingDown` is a module-scoped `let` in `chain.ts`, the first test that sets it to `true` poisons all subsequent tests in the same process.
**Prevention:** Pass `{shutdown: boolean}` holder into `executeActions`; tests create a fresh holder per test.

### Pitfall F: pino.final does not exist in pino v10
**What goes wrong:** Code copied from pino v6-v8 examples using `pino.final(logger, handler)` fails at runtime with "pino.final is not a function".
**Prevention:** Use `logger.flush(callback)` directly.
**Source:** `[VERIFIED: bot/node_modules/pino/pino.d.ts — no final export]`

### Pitfall G: SIGINT handler disables Node.js default Ctrl+C exit
**What goes wrong:** Registering `process.on('SIGINT', ...)` suppresses Node.js's default behavior of exiting on Ctrl+C. If the handler doesn't eventually call `process.exit()`, the process hangs.
**Prevention:** Ensure the handler sets `shutdownHolder.shutdown = true`; the main loop exits naturally and calls `flushAndExit(0)`.
**Source:** `[CITED: https://nodejs.org/api/process.html#signal-events]`

---

## Code Examples

### Verified viem Error Classification

```typescript
// Source: VERIFIED against viem 2.47.6 bot/node_modules/viem/errors/
import {
  BaseError,
  ContractFunctionRevertedError,
  HttpRequestError,
  TimeoutError,
  WaitForTransactionReceiptTimeoutError,
  TransactionExecutionError,
} from "viem";

export function isRevertError(err: unknown): boolean {
  if (!(err instanceof BaseError)) return false;
  return err.walk((e) => e instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError;
}

export function isTransientError(err: unknown): boolean {
  if (!(err instanceof BaseError)) return false;
  const inner = err.walk(
    (e) => e instanceof HttpRequestError || e instanceof TimeoutError,
  );
  return inner instanceof HttpRequestError || inner instanceof TimeoutError;
}
```

### Balance Preflight (TXSAFE-03)

```typescript
// Source: VERIFIED against viem PublicClient.getBalance() API
const balance = await publicClient.getBalance({ address: account.address });
if (balance < config.MIN_BALANCE_WEI) {
  log.error(
    {
      actual: balance.toString(),
      required: config.MIN_BALANCE_WEI.toString(),
      reason: "balance_below_threshold",
    },
    "Insufficient wallet balance, aborting",
  );
  return { skipped: 0, txSent: 0, systemicFailure: "balance_below_threshold" };
}
```

### Signal Handler + Flush Exit (TXSAFE-04)

```typescript
// Source: VERIFIED pino v10.3 flush(cb) pattern
const shutdownHolder = { shutdown: false };

const handleSignal = (signal: string) => {
  logger.warn({ signal }, "Signal received, finishing current action then exiting");
  shutdownHolder.shutdown = true;
};
process.on("SIGTERM", () => handleSignal("SIGTERM"));
process.on("SIGINT",  () => handleSignal("SIGINT"));

// Flush helper used at every exit site:
function flushAndExit(code: number): void {
  logger.flush(() => process.exit(code));
}
```

### Config Schema Additions

```typescript
// Source: VERIFIED zod 4.3.6 z.coerce.bigint() + z.coerce.number()
MIN_BALANCE_WEI: z.coerce.bigint()
  .optional()
  .default(5_000_000_000_000_000n),

TX_RECEIPT_TIMEOUT_MS: z.coerce.number()
  .int()
  .positive()
  .optional()
  .default(120_000),
```

---

## Testing Strategy

`nyquist_validation` is explicitly `false` in `.planning/config.json` — formal test map section is omitted, but test approach is documented for the planner.

### Existing Test Infrastructure
- Framework: vitest 4.1.2
- Config: no `vitest.config.ts` found; vitest uses package.json `"test": "vitest run"`
- Existing tests: `bot/test/{config,diff,evidence,validation}.test.ts` — unit tests, no anvil
- No existing `chain.ts` tests

### Test Approach by Success Criterion

**SC-1 (TXSAFE-01): Gas estimation retries → skip, no tx submission**

Approach: Unit test `tx.ts` with mocked `publicClient.estimateContractGas`:
- Mock throws `ContractFunctionRevertedError` (via `ContractFunctionExecutionError`) → assert immediately skipped (0 retries)
- Mock throws `HttpRequestError` 3 times → assert `warn` logged with `reason: "gas_estimation_exhausted"`, no `writeContract` call
- Mock throws `HttpRequestError` twice then succeeds → assert `writeContract` called once

No anvil needed. Pure mocking of the `publicClient` object.

**SC-2 (TXSAFE-02): Receipt timeout → log hash, exit non-zero**

Approach: Unit test with mocked `publicClient.waitForTransactionReceipt` that throws `WaitForTransactionReceiptTimeoutError`. Assert:
- `systemicFailure === "receipt_timeout"` in return value
- Log includes `{txHash, reason: "receipt_timeout"}`

No anvil needed for this unit test. Anvil integration test can additionally verify the real timeout fires.

**SC-3 (TXSAFE-03): Empty wallet → exit before any tx**

Approach: Unit test with mocked `publicClient.getBalance` returning `0n`. Assert:
- `executeActions` returns `{systemicFailure: "balance_below_threshold"}`
- No `estimateContractGas` or `writeContract` calls made

No anvil needed.

**SC-4 (TXSAFE-04): SIGTERM mid-batch → finish current tx, skip rest**

Approach: Unit test with mocked clients. Create a holder `{shutdown: false}`. Call `executeActions` with 3 actions. After action 1 completes (in mock), set `holder.shutdown = true`. Assert:
- `txSent === 1`, `skipped === 0` (remaining 2 never attempted)
- Summary log emitted

No anvil needed. The shutdown check is between actions, not inside async calls.

### Vitest Mock Pattern for viem Clients

```typescript
import { vi } from "vitest";
import type { PublicClient, WalletClient } from "viem";

const mockPublicClient = {
  estimateContractGas: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  getBalance: vi.fn(),
  getTransactionCount: vi.fn(),
} as unknown as PublicClient;

const mockWalletClient = {
  writeContract: vi.fn(),
  account: { address: "0x1234..." as `0x${string}` },
  chain: { id: 11155111 },
} as unknown as WalletClient;
```

**Resetting between tests:**
```typescript
beforeEach(() => {
  vi.clearAllMocks();
  // Reset shutdown holder if scoped outside test
});
```

---

## Environment Availability

Step 2.6: SKIPPED — Phase 5 is code/config-only changes (no new external dependencies, no CLI tools beyond what Phase 4 already uses). viem, pino, zod, vitest all already installed.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `pino.final()` was removed in pino v9/v10 | pino flush section | If pino.final still exists, code using `logger.flush(cb)` is still correct — no regression |
| A2 | `estimateContractGas` does not submit a tx or advance nonce on-chain | Gas estimation pattern | If wrong, the retry loop could burn gas; but viem docs confirm it is `eth_estimateGas` (read call) `[CITED: context7 viem estimateContractGas docs]` |

**A2 is LOW risk** — `eth_estimateGas` is a standard JSON-RPC read call and is definitionally non-state-mutating. Multiple viem docs confirm this. `[VERIFIED: Context7 viem estimateContractGas docs — "Estimates the gas necessary to complete a transaction without submitting it"]`

---

## Open Questions

1. **How does `SIGINT` from Ctrl+C interact with the scheduler (systemd/cron)?**
   - What we know: Schedulers send SIGTERM; user Ctrl+C sends SIGINT; both are handled identically per D-03.
   - What's unclear: Whether the scheduler sends SIGKILL after a grace period if SIGTERM is ignored — but bot's 120s receipt wait is well within typical systemd `TimeoutStopSec`.
   - Recommendation: Document the expected signal in `.env.example` comments; no code change needed.

2. **Should `emitSummary()` be called before or after `flushAndExit()`?**
   - What we know: `emitSummary` calls `logger.info()`; must happen before `logger.flush()`.
   - What's unclear: Nothing — `emitSummary()` then `flushAndExit(code)` is unambiguous.
   - Recommendation: Always call `emitSummary(summary, startTime)` then `flushAndExit(code)`. Never `flushAndExit` without `emitSummary` first.

---

## Sources

### Primary (HIGH confidence)
- `[VERIFIED: bot/node_modules/viem/errors/contract.ts]` — ContractFunctionRevertedError class, constructor, name
- `[VERIFIED: bot/node_modules/viem/errors/request.ts]` — HttpRequestError, TimeoutError classes
- `[VERIFIED: bot/node_modules/viem/errors/transaction.ts]` — WaitForTransactionReceiptTimeoutError, TransactionExecutionError
- `[VERIFIED: bot/node_modules/viem/utils/errors/getContractError.ts]` — wrapping hierarchy for estimateContractGas
- `[VERIFIED: bot/node_modules/viem/index.ts]` — confirms all error classes are exported from viem root
- `[VERIFIED: bot/node_modules/pino/pino.d.ts]` — flush(cb) signature, no pino.final in v10
- `[VERIFIED: bot/node_modules/zod/package.json]` — zod v4.3.6
- `[CITED: Context7 /colinhacks/zod]` — z.coerce.bigint() confirmed for zod v4
- `[CITED: Context7 /wevm/viem]` — waitForTransactionReceipt timeout parameter, simulateContract error catching pattern
- `bot/src/chain.ts` — existing executeActions implementation (lines 102-192)
- `bot/src/logger.ts` — pino instance with `pino.destination(2)`, sanitizeObject
- `bot/src/config.ts` — existing zod schema pattern with z.coerce
- `.planning/phases/05-transaction-safety/05-CONTEXT.md` — all 20 locked decisions

### Secondary (MEDIUM confidence)
- `.planning/research/PITFALLS.md` — Pitfalls 3, 4, 8, 9, 10, 14 (project research, codebase-verified)
- `.planning/research/ARCHITECTURE.md` — Feature 2 Transaction Safety Hardening, tx.ts component plan
- `[CITED: nodejs.org/api/process.html]` — SIGINT disables default Ctrl+C exit behavior

---

## Metadata

**Confidence breakdown:**
- viem error classification: HIGH — verified against installed 2.47.6 source
- pino flush pattern: HIGH — verified against installed 10.3.1 type definitions
- zod coercion: HIGH — verified against installed 4.3.6 + Context7 docs
- Test approach: HIGH — based on existing test patterns in project
- Architecture decisions: HIGH — all locked in CONTEXT.md, no ambiguity

**Research date:** 2026-04-21
**Valid until:** 2026-07-21 (stable libraries; viem error classes are stable across patch versions)
