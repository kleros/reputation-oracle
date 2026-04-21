---
phase: 05-transaction-safety
fixed_at: 2026-04-21T19:53:00Z
review_path: .planning/phases/05-transaction-safety/05-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 3
skipped: 0
already_fixed: 1
status: all_fixed
---

# Phase 05: Code Review Fix Report

**Fixed at:** 2026-04-21T19:53:00Z
**Source review:** .planning/phases/05-transaction-safety/05-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (CR-01, WR-01, WR-02, WR-03)
- Already fixed out-of-band: 1 (CR-01)
- Fixed this run: 3 (WR-01, WR-02, WR-03)
- Skipped: 0

## Already Fixed

### CR-01: Nonce not incremented after on-chain revert

**File:** `bot/src/chain.ts:293-304`
**Commit:** `8864380` (pre-existing, fixed out-of-band)
**Evidence:** `bot/src/chain.ts` lines 293-304 confirm `nonce++` is present before `skipped++` in the `receipt.status === "reverted"` branch. `bot/test/chain.test.ts` contains the regression test "skips action when receipt.status is reverted and advances nonce" which asserts `writeCalls[0].nonce === 0` and `writeCalls[1].nonce === 1`.

## Fixed Issues

### WR-02: agentId bigint silently truncated to number in EvidenceJson

**Files modified:** `bot/src/types.ts`, `bot/src/evidence.ts`, `bot/test/evidence.test.ts`
**Commit:** `71d5b12`
**Applied fix:**
- `EvidenceJson.agentId` changed from `number` to `string` with comment: "decimal string — lossless for uint256 agent IDs above Number.MAX_SAFE_INTEGER"
- `buildPositiveEvidence`: `agentId: Number(params.agentId)` → `agentId: params.agentId.toString()`
- `buildNegativeEvidence`: same change
- `evidence.test.ts`: updated two `EvidenceJson` literal fixtures from `agentId: 42` to `agentId: "42"`, and updated assertion `expect(decoded.agentId).toBe(42)` to `expect(decoded.agentId).toBe("42")`
- `tsc --noEmit` clean; all 61 tests pass

### WR-03: isTransientError exported but never used in estimateGasWithRetry

**Files modified:** `bot/src/tx.ts`, `bot/test/tx.test.ts`
**Commit:** `3eb8c60`
**Applied fix (option A — narrow retry scope):**
- Added `if (!isTransientError(err)) throw err;` after the `isRevertError` guard in `estimateGasWithRetry`, before the retry delay. Non-transient, non-revert errors (e.g. plain `Error`, unexpected error types) now throw immediately without consuming retry attempts.
- Added unit test: "throws immediately on non-transient non-revert error without retrying (WR-03)" — throws a plain `Error`, asserts `estimateContractGas` called exactly once.
- `tsc --noEmit` clean; all 61 tests pass (1 new)

### WR-01: Gas estimate uses different calldata than writeContract (createdAt timestamp drift)

**Files modified:** `bot/src/chain.ts`
**Commit:** `ce7a6ee`
**Applied fix:**
- Hoisted `feedbackURI` declaration (`let feedbackURI: string | undefined`) before the gas-params block.
- `buildPositiveEvidence` and `buildNegativeEvidence` are now called exactly once per action in the gas-params block; `feedbackURI` is set there.
- The `writeContract` block was refactored to reuse `feedbackURI as string` directly — all duplicate `buildPositiveEvidence`/`buildNegativeEvidence`/`buildFeedbackURI` calls in that block removed.
- Added comment: "Build evidence and feedbackURI ONCE per action so gas estimate and writeContract use identical calldata (WR-01)"
- `tsc --noEmit` clean; all 61 tests pass. Note: pre-existing `TransactionExecutionError` unused-import warning in `chain.ts` was present before this fix and is not in scope.

## Skipped Issues

None — all in-scope findings resolved.

---

_Fixed: 2026-04-21T19:53:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
