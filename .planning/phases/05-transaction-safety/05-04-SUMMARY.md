---
phase: 05-transaction-safety
plan: 04
subsystem: bot-entry-point
tags: [typescript, pino, viem, signals, process-management, exit-codes]

requires:
  - phase: 05-transaction-safety
    plan: 01
    provides: "ShutdownHolder, ExecuteActionsResult, extended RunSummary types in types.ts"
  - phase: 05-transaction-safety
    plan: 02
    provides: "config.ts with TX_RECEIPT_TIMEOUT_MS and MIN_BALANCE_WEI"
  - phase: 05-transaction-safety
    plan: 03
    provides: "executeActions() with ShutdownHolder param and ExecuteActionsResult return in chain.ts"
provides:
  - "Hardened bot/src/index.ts: SIGTERM/SIGINT handlers, balance preflight, flushAndExit at all exit paths"
  - "ExecuteActionsResult wired into RunSummary (skipped, txSent, systemicFailure)"
  - "Single process.exit path: inside logger.flush() callback in flushAndExit"
affects: ["06-ipfs-evidence", "phase-05-transaction-safety"]

tech-stack:
  added: []
  patterns:
    - "flushAndExit(code): flush pino buffer async before process.exit — never bare process.exit"
    - "ShutdownHolder: {shutdown: boolean} registered in index.ts main(), threaded into executeActions"
    - "Balance preflight: publicClient.getBalance before executeActions, exit 1 if below MIN_BALANCE_WEI"
    - "Exit code: binary based on summary.systemicFailure presence (D-16/D-17)"

key-files:
  created: []
  modified:
    - bot/src/index.ts
    - bot/src/chain.ts
    - bot/test/chain.test.ts

key-decisions:
  - "flushAndExit uses logger.flush(cb) callback form — pino v10 flush is async (Pitfall F)"
  - "Signal handlers set shutdownHolder.shutdown=true only; process.exit never called inside handler (D-04)"
  - "Balance preflight placed after publicClient creation, before computeActions (startup-only per D-07)"
  - "Exit 0 for item-specific skips; exit 1 only for systemicFailure (D-16/D-17)"

patterns-established:
  - "emitSummary() then flushAndExit() then return — mandatory order at every exit path"
  - "No bare process.exit anywhere except inside flushAndExit callback"

requirements-completed:
  - TXSAFE-03
  - TXSAFE-04

duration: 2min
completed: 2026-04-21
---

# Phase 5 Plan 04: index.ts Hardening Summary

**SIGTERM/SIGINT handlers, balance preflight, and async pino flush wired into bot/src/index.ts — completing Phase 5 transaction safety end-to-end**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-21T19:25:40Z
- **Completed:** 2026-04-21T19:27:30Z
- **Tasks:** 1 (+ 1 checkpoint:human-verify)
- **Files modified:** 3

## Accomplishments

- Rewrote `bot/src/index.ts` with all four TXSAFE behaviors active: signal handlers, balance preflight, flushAndExit, result wiring
- Fixed pre-existing TS errors in `chain.test.ts` (invalid `WaitForTransactionReceiptTimeoutError` constructor param)
- Removed unused `TransactionExecutionError` import from `chain.ts` (biome fix)
- `pnpm exec tsc --noEmit` exits 0 — no errors across the entire bot/ codebase
- All 60 tests pass across 6 test files

## Task Commits

1. **Task 1: Harden index.ts — signal handlers, balance preflight, flushAndExit, result wiring** - `9eac441` (feat)

## Files Created/Modified

- `bot/src/index.ts` — SIGTERM/SIGINT handlers, balance preflight (MIN_BALANCE_WEI), flushAndExit helper, ExecuteActionsResult wiring, all exit paths use flushAndExit
- `bot/src/chain.ts` — Removed unused `TransactionExecutionError` import (biome auto-fix)
- `bot/test/chain.test.ts` — Fixed `WaitForTransactionReceiptTimeoutError` constructor (remove invalid `timeout` param); biome formatting fixes; import sort

## Decisions Made

- Followed plan decisions D-03, D-04, D-05, D-06, D-07, D-16, D-17 exactly as specified in 05-CONTEXT.md
- Used `privateKeyToAccount(config.BOT_PRIVATE_KEY)` to get `account.address` for balance preflight — account created locally rather than duplicating wallet client creation early
- Balance preflight placed after `createViemPublicClient` and before `computeActions` (matches D-07: startup-only)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed WaitForTransactionReceiptTimeoutError constructor in chain.test.ts**
- **Found during:** Task 1 verification (tsc --noEmit)
- **Issue:** TS type definition for `WaitForTransactionReceiptTimeoutError` only accepts `{hash}` but test passed `{hash, timeout}`. Pre-existing from wave 3.
- **Fix:** Removed `timeout: 5000` from constructor call at line 142
- **Files modified:** `bot/test/chain.test.ts`
- **Verification:** `tsc --noEmit` exits 0
- **Committed in:** 9eac441

**2. [Rule 1 - Bug] Removed unused TransactionExecutionError import in chain.ts**
- **Found during:** Task 1 verification (biome check)
- **Issue:** `TransactionExecutionError` imported but never used — biome `noUnusedImports` error. Pre-existing from wave 3.
- **Fix:** biome `--write` auto-removed the unused import
- **Files modified:** `bot/src/chain.ts`
- **Verification:** `biome check` exits 0
- **Committed in:** 9eac441

---

**Total deviations:** 2 auto-fixed (2x Rule 1 - pre-existing bugs from wave 3)
**Impact on plan:** Both fixes were necessary for clean TypeScript and biome. No scope creep.

## Issues Encountered

None — plan specified all patterns precisely. Pino v10 flush Pitfall F documented in RESEARCH.md was followed exactly.

## Known Stubs

None — all functionality fully wired.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced.

## Next Phase Readiness

- Phase 5 transaction safety is fully implemented end-to-end: tx.ts (retry + classification), chain.ts (differentiated failure policy), index.ts (signal handlers, balance preflight, flush-on-exit)
- Bot is ready for the human-verify checkpoint: `pnpm test`, `tsc --noEmit`, `biome check`, dry-run smoke test, balance-threshold exit code check
- Phase 6 (IPFS evidence) can proceed — pino logger, structured errors, and all tx safety behaviors are in place

## Self-Check: PASSED

- `bot/src/index.ts` exists and contains `flushAndExit`, `logger.flush(`, `shutdownHolder`, `SIGTERM`, `SIGINT`, `getBalance`, `MIN_BALANCE_WEI`, `balance_below_threshold`, `summary.skipped`, `summary.systemicFailure`
- `bot/src/index.ts` contains only one `process.exit` — inside `logger.flush(() => process.exit(code))` callback
- Commit `9eac441` exists in git log
- `pnpm exec tsc --noEmit` exits 0 — verified
- `pnpm exec vitest run` — 60 tests pass across 6 files — verified
- `pnpm exec biome check src/ test/` exits 0 — verified

---
*Phase: 05-transaction-safety*
*Completed: 2026-04-21*
