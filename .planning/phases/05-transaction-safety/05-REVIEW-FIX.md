---
phase: 05-transaction-safety
fixed_at: 2026-04-21T20:00:50Z
review_path: .planning/phases/05-transaction-safety/05-REVIEW.md
iteration: 2
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 05: Code Review Fix Report

**Fixed at:** 2026-04-21T20:00:50Z
**Source review:** .planning/phases/05-transaction-safety/05-REVIEW.md
**Iteration:** 2

**Summary:**
- Findings in scope: 6 (CR-01, WR-01, WR-02, WR-03, IN-01, IN-02)
- Already fixed out-of-band (iteration 0): 4 (CR-01, WR-01, WR-02, WR-03)
- Fixed in iteration 1: 3 (WR-01, WR-02, WR-03)
- Fixed in iteration 2: 2 (IN-01, IN-02)
- Skipped: 0

## Already Fixed (pre-existing commits)

### CR-01: Nonce not incremented after on-chain revert

**File:** `bot/src/chain.ts:293-304`
**Commit:** `8864380` (fixed out-of-band before iteration 1)
**Evidence:** `bot/src/chain.ts` lines 293-304 contain `nonce++` before `skipped++` in the `receipt.status === "reverted"` branch. Regression test "skips action when receipt.status is reverted and advances nonce" in `bot/test/chain.test.ts` asserts `writeCalls[0].nonce === 0` and `writeCalls[1].nonce === 1`.

### WR-02: agentId bigint silently truncated to number in EvidenceJson

**Files modified:** `bot/src/types.ts`, `bot/src/evidence.ts`, `bot/test/evidence.test.ts`
**Commit:** `71d5b12` (fixed in iteration 1)
**Applied fix:**
- `EvidenceJson.agentId` changed from `number` to `string` with comment "decimal string — lossless for uint256 agent IDs above Number.MAX_SAFE_INTEGER"
- `buildPositiveEvidence` and `buildNegativeEvidence`: `agentId: Number(params.agentId)` → `agentId: params.agentId.toString()`
- `evidence.test.ts`: updated fixtures from `agentId: 42` to `agentId: "42"` and updated assertions accordingly

### WR-03: isTransientError exported but never used in estimateGasWithRetry

**Files modified:** `bot/src/tx.ts`, `bot/test/tx.test.ts`
**Commit:** `3eb8c60` (fixed in iteration 1)
**Applied fix (option A):** Added `if (!isTransientError(err)) throw err;` after the `isRevertError` guard in `estimateGasWithRetry`. Non-transient, non-revert errors now throw immediately without consuming retry attempts. Added unit test asserting the fast-fail path is taken.

### WR-01: Gas estimate uses different calldata than writeContract (createdAt timestamp drift)

**Files modified:** `bot/src/chain.ts`
**Commit:** `ce7a6ee` (fixed in iteration 1)
**Applied fix:** Hoisted `feedbackURI` declaration before the gas-params block. `buildPositiveEvidence` and `buildNegativeEvidence` called exactly once per action; `feedbackURI` reused in the `writeContract` block with no second evidence build calls.

## Fixed Issues (iteration 2)

### IN-01: formatStake precision loss for large stake values

**Files modified:** `bot/src/evidence.ts`, `bot/test/evidence.test.ts`
**Commit:** `cae80ff`
**Applied fix:**
- Replaced `Number(wei) / 1e18` with bigint integer-division and remainder arithmetic: `wei / 10n ** 18n` for the integer part, `wei % 10n ** 18n` for the fractional part, padded to 18 digits and trailing-zero-trimmed.
- Added `describe("formatStake precision (IN-01)")` block with 4 tests: null stake returns "0", 0.002 ETH formats to "0.002", 100 ETH (100_000_000_000_000_000_000 wei, beyond `Number.MAX_SAFE_INTEGER`) formats to "100", and 100.5 ETH formats to "100.5".
- `tsc --noEmit` clean; all 65 tests pass.

### IN-02: privateKeyToAccount called twice — redundant key derivation in index.ts

**Files modified:** `bot/src/index.ts`
**Commit:** `30a571d`
**Applied fix:**
- Moved `createViemWalletClient(config)` call to immediately after `createViemPublicClient(config)`, before the balance preflight.
- Balance preflight now uses `walletClient.account!.address` instead of deriving a new account via `privateKeyToAccount`.
- Removed the now-unused `import { privateKeyToAccount } from "viem/accounts"` line.
- `tsc --noEmit` clean; all 65 tests pass.

## Skipped Issues

None — all 6 findings resolved.

---

_Fixed: 2026-04-21T20:00:50Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
