---
phase: 05-transaction-safety
plan: "02"
subsystem: bot
tags: [gas-estimation, retry, error-classification, viem, vitest, tx-safety]
dependency_graph:
  requires:
    - bot/src/types.ts (ShutdownHolder, ExecuteActionsResult — from 05-01)
    - bot/src/config.ts (TX_RECEIPT_TIMEOUT_MS, MIN_BALANCE_WEI — from 05-01)
  provides:
    - bot/src/tx.ts exports estimateGasWithRetry, isRevertError, isTransientError
    - bot/test/tx.test.ts unit tests for all retry and classification behaviors
  affects:
    - bot/src/chain.ts (will import estimateGasWithRetry, isRevertError from tx.ts in plan 05-03)
tech_stack:
  added: []
  patterns:
    - viem err.walk() for error chain traversal (Pitfall B: ContractFunctionExecutionError wraps revert)
    - Fake timers with Promise.all(expect().rejects, vi.runAllTimersAsync()) to avoid vitest 4 PromiseRejectionHandledWarning
    - async mockImplementationOnce to avoid pre-created rejected promises floating before try/catch
key_files:
  created:
    - bot/src/tx.ts
    - bot/test/tx.test.ts
  modified: []
decisions:
  - "Used err.walk() not direct instanceof — ContractFunctionExecutionError wraps ContractFunctionRevertedError so direct check returns false"
  - "MAX_ATTEMPTS=3, BASE_DELAY_MS=1000ms, exponential: delays are 1s/2s between attempts 1-2 and 2-3"
  - "Used Promise.all(expect().rejects, vi.runAllTimersAsync()) for exhausted-retry test — avoids vitest 4's PromiseRejectionHandledWarning when rejection is handled asynchronously"
  - "Used async mockImplementationOnce (not mockRejectedValueOnce) to avoid pre-created rejected promises in strict rejection detection mode"
metrics:
  duration: 155s
  completed: "2026-04-21"
  tasks_completed: 2
  files_modified: 2
---

# Phase 05 Plan 02: Gas Estimation Retry Utilities Summary

**One-liner:** Pure retry+classification utilities in bot/src/tx.ts — estimateGasWithRetry with 3-attempt exponential backoff, isRevertError and isTransientError via viem's err.walk() — with full vitest unit coverage.

## What Was Built

1. **bot/src/tx.ts (new)** — pure utility module with three exports:
   - `estimateGasWithRetry(publicClient, params)`: retries `estimateContractGas` up to MAX_ATTEMPTS=3 with 1s/2s exponential backoff. Revert errors throw immediately (no retry). Transient errors (HttpRequestError, TimeoutError) are retried. After exhaustion, throws last error for caller to log and skip.
   - `isRevertError(err)`: uses `err.walk()` to detect `ContractFunctionRevertedError` in the error chain. Returns false for non-BaseError inputs.
   - `isTransientError(err)`: uses `err.walk()` to detect `HttpRequestError` or `TimeoutError`. Returns false for non-BaseError inputs.

2. **bot/test/tx.test.ts (new)** — 11 unit tests covering:
   - `estimateGasWithRetry`: first success (1 call), retry-then-succeed (3 calls), exhausted 3 attempts (throws), immediate revert throw (1 call)
   - `isRevertError`: wrapped error (ContractFunctionExecutionError wrapping revert), direct revert, HttpError, non-Error
   - `isTransientError`: HttpRequestError, ContractFunctionRevertedError, non-BaseError

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1: bot/src/tx.ts | a4ccd71 | feat(05-02): create bot/src/tx.ts with estimateGasWithRetry and error classification |
| Task 2: bot/test/tx.test.ts | 8de4846 | test(05-02): add tx.test.ts covering all retry and error classification behaviors |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed duplicate "gas_estimation_exhausted" test that caused unhandled rejections**
- **Found during:** Task 2 test run
- **Issue:** Plan template included a duplicate test for gas_estimation_exhausted alongside the "throws after exhausting 3 attempts" test. The duplicate used `.mockRejectedValue` (non-Once), causing the mock to keep rejecting after the promise settled, triggering vitest 4's strict PromiseRejectionHandledWarning.
- **Fix:** Removed the duplicate test. Kept the original "throws after exhausting 3 attempts" test.
- **Files modified:** bot/test/tx.test.ts

**2. [Rule 1 - Bug] Fixed vitest 4 PromiseRejectionHandledWarning for exhausted-retry test**
- **Found during:** Task 2 test iterations
- **Issue:** vitest 4.1.2 strict rejection detection: `mockRejectedValueOnce` creates pre-rejected promises that Node.js marks as unhandled before the retry loop's try/catch handles them. `PromiseRejectionHandledWarning` is treated as an error.
- **Fix:** Used `async mockImplementationOnce` (not `mockRejectedValueOnce`) + `Promise.all(expect().rejects, vi.runAllTimersAsync())` pattern so the rejection is consumed concurrently with timer advancement.
- **Files modified:** bot/test/tx.test.ts
- **Commits:** Both fixes included in 8de4846

**3. [Rule 2 - Missing functionality] Added `afterEach(() => vi.useRealTimers())` import**
- **Found during:** Task 2 setup
- **Issue:** Plan template used `afterEach` without importing it from vitest.
- **Fix:** Added `afterEach` to vitest imports.
- **Files modified:** bot/test/tx.test.ts

## Threat Model Coverage

| Threat | Mitigation Applied |
|--------|-------------------|
| T-05-04: DoS via retry loop | MAX_ATTEMPTS=3 hard cap; worst-case 3s delay per action; no infinite loop |
| T-05-05: Tampering via error classification | instanceof check via .walk() verified stable across viem 2.47.x patch versions |

## Known Stubs

None — all exports are fully implemented with complete behavior.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundary changes. tx.ts is a pure utility module with no I/O beyond the passed-in publicClient.

## Self-Check: PASSED

- [x] `bot/src/tx.ts` exists at /Users/jaybuidl/project/kleros/reputation-oracle/bot/src/tx.ts
- [x] `bot/src/tx.ts` contains `export async function estimateGasWithRetry`
- [x] `bot/src/tx.ts` contains `export function isRevertError`
- [x] `bot/src/tx.ts` contains `export function isTransientError`
- [x] `bot/src/tx.ts` contains `err.walk(` (uses walk, not direct instanceof)
- [x] `bot/src/tx.ts` contains `MAX_ATTEMPTS = 3`
- [x] `bot/src/tx.ts` contains `BASE_DELAY_MS = 1000`
- [x] `bot/test/tx.test.ts` exists
- [x] `bot/test/tx.test.ts` contains `describe("estimateGasWithRetry"`
- [x] `bot/test/tx.test.ts` contains `describe("isRevertError"`
- [x] `bot/test/tx.test.ts` contains `describe("isTransientError"`
- [x] `bot/test/tx.test.ts` contains `vi.useFakeTimers()`
- [x] All 11 tx.test.ts tests pass (0 failures, 0 errors)
- [x] Full test suite: 53 tests pass (0 failures, 0 errors)
- [x] Commit a4ccd71 exists (Task 1)
- [x] Commit 8de4846 exists (Task 2)
- [x] TypeScript: only pre-existing index.ts error (Wave 4 scope), no errors from tx.ts
