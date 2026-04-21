---
phase: "05-transaction-safety"
plan: "03"
subsystem: "bot"
tags: ["chain", "executeActions", "failure-policy", "shutdown", "receipt-timeout", "vitest"]
dependency_graph:
  requires:
    - "05-01"  # types: ExecuteActionsResult, ShutdownHolder
    - "05-02"  # tx.ts: estimateGasWithRetry, isRevertError
  provides:
    - "executeActions returning ExecuteActionsResult with differentiated failure policy"
  affects:
    - "05-04"  # index.ts wires executeActions with new signature + shutdownHolder
tech_stack:
  added: []
  patterns:
    - "Differentiated failure policy: item-specific skip vs systemic stop"
    - "ShutdownHolder object threaded from index.ts for graceful SIGTERM/SIGINT"
    - "TX_RECEIPT_TIMEOUT_MS from config replaces hardcoded 60_000"
    - "Pitfall C: hash captured from writeContract outer scope before waitForTransactionReceipt"
key_files:
  created:
    - bot/test/chain.test.ts
  modified:
    - bot/src/chain.ts
decisions:
  - "Evidence building duplicated between gas estimation and writeContract params (intentional, per plan: no caching at 0-2 actions/run)"
  - "FeedbackType import retained in chain.ts (used by readRouterStates via types.ts)"
  - "Config imported from config.ts in tests (not types.ts — Config is a zod-inferred type)"
metrics:
  duration: "~5min"
  completed_date: "2026-04-21"
  tasks_completed: 2
  files_modified: 2
---

# Phase 05 Plan 03: Harden executeActions with Differentiated Failure Policy Summary

Rewrote `executeActions()` in `bot/src/chain.ts` to return `ExecuteActionsResult` (not void) with a full differentiated failure policy per D-01, plus 7 passing vitest unit tests in `bot/test/chain.test.ts` covering all four success criteria behaviors.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Rewrite executeActions() with differentiated failure policy | 6a3a8c6 | bot/src/chain.ts |
| 2 | Create chain.test.ts for SC-1, SC-2, SC-4 | 1499761 | bot/test/chain.test.ts |

## What Was Built

**bot/src/chain.ts** — `executeActions()` rewrite:
- Signature: `(walletClient, publicClient, actions, config, shutdownHolder: ShutdownHolder) => Promise<ExecuteActionsResult>`
- Gas estimation via `estimateGasWithRetry` from `tx.ts`: revert → skip (warn, `gas_estimation_reverted`); exhausted transient → skip (warn, `gas_estimation_exhausted`, `attempts: 3`)
- `writeContract`: revert → skip (warn, `submission_reverted`); non-revert → systemic stop (`submission_failed_non_revert`)
- `waitForTransactionReceipt` uses `config.TX_RECEIPT_TIMEOUT_MS` (replaces hardcoded `60_000`): timeout → systemic stop (`receipt_timeout`); reverted receipt → skip (`receipt_reverted`); unknown error → systemic stop (`receipt_null`)
- Shutdown check at top of each iteration: `shutdownHolder.shutdown === true` → break, return accumulated result (exit-0 path)
- On success: `nonce++`, `txSent++`, info log with `txHash`

**bot/test/chain.test.ts** — 7 unit tests:
- Empty actions → `{skipped: 0, txSent: 0}`
- SC-1a: gas revert on action1, action2 succeeds → `skipped=1, txSent=1`
- SC-1b: gas exhausted (3× HttpRequestError) on action1, action2 succeeds → `skipped=1, txSent=1`
- SC-2: `WaitForTransactionReceiptTimeoutError` → `systemicFailure="receipt_timeout"`, `txSent=0`
- Receipt reverted → skip, continue to next action
- SC-4: shutdown flag set inside action1's receipt handler → `txSent=1`, `writeContract` called once
- Non-revert `writeContract` error → `systemicFailure="submission_failed_non_revert"`

## Verification

```
pnpm exec tsc --noEmit  → 1 pre-existing error in index.ts (Wave 4 scope, intentional)
pnpm test -- chain.test → 53 tests pass (5 test files, 0 failures)
grep "ExecuteActionsResult" bot/src/chain.ts  → present (line 115)
grep "shutdownHolder" bot/src/chain.ts        → present (lines 114, 134)
grep "TX_RECEIPT_TIMEOUT_MS" bot/src/chain.ts → present (lines 295, 320)
grep "timeout: 60_000" bot/src/chain.ts       → NOT present (replaced)
grep "receipt_timeout\|gas_estimation" bot/src/chain.ts → present
```

## Deviations from Plan

None — plan executed exactly as written.

The pre-existing `index.ts(16,8): error TS2741: Property 'skipped' is missing` is intentional and documented in the wave context (Wave 4 / Plan 05-04 scope). Not fixed here.

## Known Stubs

None. `executeActions` is fully implemented; no placeholder paths.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. All mitigations from the threat model (T-05-07, T-05-08, T-05-09) are implemented:
- T-05-07: `TX_RECEIPT_TIMEOUT_MS` configurable, systemic stop exits cleanly
- T-05-08: Non-revert submission errors → systemic stop (prevents nonce confusion)
- T-05-09: `err.message` passed as plain string through logger's existing `sanitizeObject`

## Self-Check: PASSED

- [x] `bot/src/chain.ts` exists and contains all required patterns
- [x] `bot/test/chain.test.ts` exists with 7 tests all passing
- [x] Commit `6a3a8c6` exists (feat: chain.ts rewrite)
- [x] Commit `1499761` exists (test: chain.test.ts)
- [x] No unexpected file deletions in either commit
