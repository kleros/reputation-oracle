---
phase: 06-ipfs-evidence
reviewed: 2026-04-22T12:51:57Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - bot/.env.example
  - bot/src/chain.ts
  - bot/src/config.ts
  - bot/src/evidence.ts
  - bot/src/index.ts
  - bot/src/ipfs.ts
  - bot/src/types.ts
  - bot/test/chain.test.ts
  - bot/test/evidence.test.ts
  - bot/test/ipfs.integration.test.ts
  - bot/test/ipfs.test.ts
  - bot/vitest.config.ts
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 6: Code Review Report

**Reviewed:** 2026-04-22T12:51:57Z
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Phase 6 introduces IPFS evidence upload via Pinata: `bot/src/ipfs.ts` (new), prepare/execute split in `bot/src/chain.ts`, and `buildFeedbackURI` returning `ipfs://CID` in `bot/src/evidence.ts`.

The implementation is solid. The three focus areas from the prompt all check out:

- **Nonce management (CR-01):** Correctly incremented after every mined tx (success and receipt-reverted). Submission-revert via viem simulation pre-broadcast does NOT increment nonce — correct, since the tx was never sent to the chain.
- **feedbackURI lifecycle (WR-01):** Evidence is built once per action in the prepare pass; `feedbackURI` is read from `PreparedAction` in the execute pass and never rebuilt. `new Date().toISOString()` is called exactly once per action.
- **viem v2 error classification:** `isRevertError` and `isTransientError` use `.walk()` throughout. `WaitForTransactionReceiptTimeoutError` uses direct `instanceof` — correct, as that error is thrown directly by `waitForTransactionReceipt` and is not wrapped in `ContractFunctionExecutionError`.
- **pino v10 flush:** `flushAndExit()` uses the callback form `logger.flush(cb)`. Signal handlers set a flag only; `process.exit` only called inside the flush callback.
- **PINATA_JWT redaction:** Logger redact config covers `config.PINATA_JWT` and `PINATA_JWT` paths. The JWT appears only in the `Authorization` header of the fetch request body — never logged directly. `loadConfig()` redacts the JWT field from validation error output.
- **BigInt serialization:** All `agentId` and `stake` values use `.toString()` before serialization.
- **Orphaned CID tracking:** CIDs are pushed to `orphanedCids` on upload, removed on confirmed receipt, returned in result for operator visibility. The systemic-stop paths (pinata-unavailable, receipt_timeout, receipt_null, submission_failed_non_revert) all return the orphan list.

One warning and two info items found.

## Warnings

### WR-01: `duration_ms: 0` hardcoded in IPFS upload success log

**File:** `bot/src/ipfs.ts:113`
**Issue:** The structured log field `duration_ms` is hardcoded to `0` for every successful upload. It emits `"duration_ms": 0` in every `ipfs-upload-ok` log line, making this field useless and misleading for latency observability. The upload start time is never captured.
**Fix:**
```typescript
// Capture start time before the fetch loop
const uploadStartMs = Date.now();

// ... existing retry loop ...

// Replace hardcoded 0 with actual elapsed time:
log.info(
  { cid: result.cid, size: result.size, duration_ms: Date.now() - uploadStartMs, gateway_url: result.gatewayUrl },
  "ipfs-upload-ok",
);
```
`uploadStartMs` should be declared before the `for` loop (line 63) so it spans retries and measures total elapsed time from first attempt.

## Info

### IN-01: `config.PINATA_TIMEOUT_MS ?? 30_000` is unreachable dead code

**File:** `bot/src/chain.ts:229`
**Issue:** `config.PINATA_TIMEOUT_MS` is typed as `number` (not `number | undefined`) because the zod schema uses `.optional().default(30_000)`, which fills in the default at parse time. The `?? 30_000` fallback is therefore unreachable. TypeScript may not flag this if the Config type inference is loose, but it can mislead future readers into thinking the field can be absent post-parse.
**Fix:**
```typescript
// Before:
config.PINATA_TIMEOUT_MS ?? 30_000,

// After:
config.PINATA_TIMEOUT_MS,
```

### IN-02: `disputeId` parsed as `Number.parseInt` — silent precision loss for IDs > 2^53

**File:** `bot/src/evidence.ts:49`
**Issue:** `Number.parseInt(params.disputeId, 10)` is used to convert `disputeId` from string to the `number | null` type in `EvidenceJson`. For dispute IDs exceeding `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991 ≈ 9×10^15), this loses precision silently. Kleros dispute counts are nowhere near this limit today, but the schema's `number` type is a long-term constraint.
**Fix:** No immediate action needed for v1.1. For future-proofing, consider widening `EvidenceJson.kleros.disputeId` to `string | null` (serialize as decimal string) and updating `buildNegativeEvidence` to skip the `parseInt` conversion. This is a schema change and would need a schema version bump.

---

_Reviewed: 2026-04-22T12:51:57Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
