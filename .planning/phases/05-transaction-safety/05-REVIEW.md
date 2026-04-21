---
phase: 05-transaction-safety
reviewed: 2026-04-21T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - bot/.env.example
  - bot/src/chain.ts
  - bot/src/config.ts
  - bot/src/index.ts
  - bot/src/tx.ts
  - bot/src/types.ts
  - bot/test/chain.test.ts
  - bot/test/tx.test.ts
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-04-21T00:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 5 adds transaction safety: differentiated failure policy, gas estimation retry (3 attempts, exponential backoff), balance preflight, and SIGTERM/SIGINT graceful shutdown. The architecture is sound and the failure taxonomy is correctly implemented in the happy path. One critical nonce-desync bug exists for on-chain-reverted transactions. Two warning-level issues affect calldata correctness (gas estimate vs. submission use different evidence URIs due to `createdAt` timestamp drift) and bigint precision for large agent IDs. Config secret redaction and pino flush patterns are correctly implemented.

---

## Critical Issues

### CR-01: Nonce not incremented after on-chain revert — desync breaks all subsequent transactions

**File:** `bot/src/chain.ts:293-300`

**Issue:** When `receipt.status === "reverted"`, the transaction was broadcast and mined — it consumed a nonce on-chain. The loop does `skipped++; continue` without incrementing `nonce`. The next iteration reuses the same nonce value, causing the subsequent `writeContract` call to fail with an RPC error ("nonce too low" / "already known"), which is classified as `submission_failed_non_revert` (systemic stop). The intended behaviour — skip the reverted item and continue — is broken for any run where an on-chain revert occurs before the last action.

**Fix:**
```typescript
if (receipt.status === "reverted") {
    log.warn(
        { action: action.type, agentId: agentIdStr, txHash: hash, reason: "receipt_reverted" },
        "Action skipped",
    );
    nonce++; // tx was mined and consumed a nonce even though it reverted
    skipped++;
    continue;
}
```

---

## Warnings

### WR-01: Gas estimate uses different calldata than writeContract (createdAt timestamp drift)

**File:** `bot/src/chain.ts:145-188` (gas params) vs `bot/src/chain.ts:213-266` (submission)

**Issue:** `buildPositiveEvidence` and `buildNegativeEvidence` both call `new Date().toISOString()` for `createdAt` (confirmed in `bot/src/evidence.ts:28,55`). The evidence object is constructed twice: once to build `gasParams` for `estimateGasWithRetry`, and again inside the `writeContract` block. Because `createdAt` changes between the two calls, the base64-encoded `feedbackURI` argument differs, meaning the gas estimate is computed for different calldata than what is actually submitted. In practice this is unlikely to cause a gas underestimate (the URI length is constant), but it is semantically incorrect and fragile.

**Fix:** Build the evidence and `feedbackURI` once per action, before the gas estimation block, and reuse it for both:

```typescript
// Build evidence and feedbackURI once
let feedbackURI: string;
if (action.type === "submitPositiveFeedback") {
    const evidence = buildPositiveEvidence({ ... });
    feedbackURI = buildFeedbackURI(evidence);
    gasParams = { ..., args: [action.agentId, action.pgtcrItemId as `0x${string}`, feedbackURI], account };
} else if (action.type === "submitNegativeFeedback") {
    const evidence = buildNegativeEvidence({ ... });
    feedbackURI = buildFeedbackURI(evidence);
    gasParams = { ..., args: [action.agentId, feedbackURI], account };
} else {
    gasParams = { ..., args: [action.agentId], account };
}

// ... estimateGasWithRetry(gasParams) ...

// Then in writeContract, reuse feedbackURI directly — no second buildPositiveEvidence() call
```

### WR-02: agentId bigint silently truncated to number in EvidenceJson

**File:** `bot/src/evidence.ts:26,53` / `bot/src/types.ts:48`

**Issue:** `agentId: Number(params.agentId)` converts a `bigint` to a JavaScript `number`. For agent IDs above `Number.MAX_SAFE_INTEGER` (2^53 − 1 = 9007199254740991), this silently produces an incorrect value with no error. The `EvidenceJson` interface declares `agentId: number`, reinforcing the truncation. The ERC-8004 registry uses `uint256` agent IDs, so IDs beyond 2^53 are theoretically valid.

**Fix:** Change `EvidenceJson.agentId` to `string` and serialize as a decimal string, which is lossless and JSON-safe:

```typescript
// types.ts
agentId: string;  // decimal string — lossless for uint256

// evidence.ts
agentId: params.agentId.toString(),
```

### WR-03: isTransientError exported but never used — retry logic silently falls through for all non-revert errors

**File:** `bot/src/tx.ts:58-62`

**Issue:** `estimateGasWithRetry` retries on any error that is not a revert — including unexpected non-transient errors (e.g., a programming error that produces a plain `Error`). The `isTransientError` predicate is exported but is not called inside `estimateGasWithRetry` itself. This means any non-`BaseError` thrown by `estimateContractGas` (e.g., a network lib change that wraps errors differently) will be retried up to 3 times instead of being immediately rethrown or classified.

The retry-all-non-revert approach is defensible as a design choice, but the unused `isTransientError` export suggests the intent was to scope retries to known-transient errors. If left as-is, the exported function should either be used in the guard or removed.

**Fix (option A — narrow retry scope to transient errors):**
```typescript
if (isRevertError(err)) throw err;
if (!isTransientError(err)) throw err; // fail fast on unexpected errors
if (attempt < MAX_ATTEMPTS) {
    await delay(BASE_DELAY_MS * 2 ** (attempt - 1));
}
```

**Fix (option B — remove the dead export if retry-all is intentional):**
Remove the `isTransientError` export from `tx.ts` and its import in `chain.test.ts` (if present), or document why it exists as a standalone utility.

---

## Info

### IN-01: formatStake precision loss for large stake values

**File:** `bot/src/evidence.ts:89`

**Issue:** `Number(wei) / 1e18` converts a `bigint` wei amount to a JavaScript `number` before dividing. For stakes larger than `Number.MAX_SAFE_INTEGER` wei (~9.007 ETH), this silently loses precision. The formatted stake appears in the IPFS evidence JSON as a human-readable display field, so this is not a security issue, but the displayed value may be wrong for large bonds.

**Fix:** Use bigint arithmetic for the integer part:
```typescript
function formatStake(stake: string | null): string {
    if (!stake) return "0";
    const wei = BigInt(stake);
    const eth = wei / 10n ** 18n;
    const rem = wei % 10n ** 18n;
    if (rem === 0n) return eth.toString();
    return `${eth}.${rem.toString().padStart(18, "0").replace(/0+$/, "")}`;
}
```

### IN-02: privateKeyToAccount called twice — redundant key derivation in index.ts

**File:** `bot/src/index.ts:62`

**Issue:** `privateKeyToAccount(config.BOT_PRIVATE_KEY)` is called in `index.ts` to get the wallet address for the balance preflight, and again inside `createViemWalletClient` → `chain.ts:58`. Both derivations produce the same address. Not a bug, but a minor duplication that also means the private key is passed through an extra function call.

**Fix:** Expose the account address from `createViemWalletClient`, or accept an `account` object rather than re-deriving it. Alternatively, read the address from `walletClient.account.address` after `createViemWalletClient` is called — but `walletClient` is currently created after the balance check (line 108), so the simplest fix is to create it earlier:

```typescript
const walletClient = createViemWalletClient(config);
const account = walletClient.account!;
const balance = await publicClient.getBalance({ address: account.address });
// ... pass walletClient to executeActions as before
```

---

_Reviewed: 2026-04-21T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
