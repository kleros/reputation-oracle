---
phase: 06-ipfs-evidence
fixed_at: 2026-04-22T14:17:40Z
review_path: .planning/phases/06-ipfs-evidence/06-REVIEW.md
iteration: 1
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase 6: Code Review Fix Report

**Fixed at:** 2026-04-22T14:17:40Z
**Source review:** .planning/phases/06-ipfs-evidence/06-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope (critical + warning): 1
- Fixed: 1
- Skipped: 0

## Fixed Issues

### WR-01: `duration_ms: 0` hardcoded in IPFS upload success log

**Files modified:** `bot/src/ipfs.ts`
**Commit:** 3aaec4b
**Applied fix:**
Added `const uploadStartMs = Date.now();` before the `for` retry loop (line 62), then replaced `duration_ms: 0` in the `ipfs-upload-ok` log (line 114) with `duration_ms: Date.now() - uploadStartMs`. The start time is captured once before all retry attempts, so the logged duration spans the full elapsed time including any retry delays.

## Skipped Issues

None — all in-scope findings were fixed.

## Verification

**TypeScript (`npx tsc --noEmit`):** Clean — no errors.

**Test suite (`npx vitest run`):** 81 passed, 1 skipped — identical to pre-fix baseline.

Notable test output: mock-based tests show `duration_ms: 0` (synchronous mock resolution) and the retry-delay test shows `duration_ms: 1000` (actual 1 s `RETRY_DELAY_MS` elapsed), confirming the fix captures real wall-clock time.

## Info Findings (out of scope for this run)

The following findings were excluded by `fix_scope: critical_warning`:

- **IN-01** (`bot/src/chain.ts:229`): `config.PINATA_TIMEOUT_MS ?? 30_000` is unreachable dead code — zod `.default()` always fills the value. Low-risk cosmetic cleanup; deferred.
- **IN-02** (`bot/src/evidence.ts:49`): `Number.parseInt(disputeId)` has silent precision loss for IDs > 2^53. No practical risk for current Kleros dispute counts; schema change deferred to a future version.

---

_Fixed: 2026-04-22T14:17:40Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
