---
id: 260423-odh
mode: quick-full
created: 2026-04-23
description: Type viem TransactionReceipt mocks in chain.test.ts — makeReceipt helper
---

# Quick Task 260423-odh: Type TransactionReceipt Mocks

## Goal

Replace the 9 `{ status: "..." } as any` mock receipts in `bot/test/chain.test.ts` with a typed `makeReceipt(status)` helper. Eliminates the remaining 9 Biome `noExplicitAny` warnings. Zero behavior change (production only reads `receipt.status`).

## Context

- Production code (`chain.ts:417-433`) uses only `receipt.status` — either `"reverted"` (skip path) or success.
- Existing factory pattern: `makeAction`, `makeRevertError`, `makeIpfsResult` at the top of the test file. Place `makeReceipt` alongside for consistency.
- viem v2's `TransactionReceipt` has many required fields (blockHash, blockNumber, from, gasUsed, logs, logsBloom, etc.) but the mock only needs to satisfy the type — the production code never reads those fields.

## Approach

Single typed factory with dummy-but-type-correct values for all required `TransactionReceipt` fields.

**Why this over alternatives:**
- `satisfies Partial<TransactionReceipt>` would still need a cast at the `mockResolvedValueOnce` call site (vitest's type expects full `TransactionReceipt`)
- Leaving `as unknown as TransactionReceipt` at each call site is 9 casts — no improvement over `as any`
- Centralizing the cast in ONE place (the helper) is the standard pattern and matches existing `makeMockPublicClient()` which already uses `as unknown as PublicClient`

## Task 1 — Add `makeReceipt()` helper

**File:** `bot/test/chain.test.ts`

**Location:** after `makeIpfsResult()` (around line 94-100), before the first `describe` block.

**Import:** add `type TransactionReceipt` to the existing viem import block.

**Implementation:**
```ts
function makeReceipt(status: "success" | "reverted"): TransactionReceipt {
    return {
        blockHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
        blockNumber: 1n,
        contractAddress: null,
        cumulativeGasUsed: 21000n,
        effectiveGasPrice: 1_000_000_000n,
        from: "0x0000000000000000000000000000000000000000",
        gasUsed: 21000n,
        logs: [],
        logsBloom: `0x${"0".repeat(512)}`,
        status,
        to: "0x0000000000000000000000000000000000000000",
        transactionHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
        transactionIndex: 0,
        type: "eip1559",
    } as TransactionReceipt;
}
```

**Why the final cast:** viem's `TransactionReceipt` is a discriminated union parameterized by `type`. The object-literal shape above is structurally compatible with the `eip1559` variant but TypeScript's inference doesn't always narrow correctly to the right union member. A single typed cast here keeps the call sites clean. If the literal matches without the cast, remove it.

**Done:** helper defined, type-checks, `as TransactionReceipt` (or no cast) — no `as any`.

## Task 2 — Replace 9 call sites

Mechanical find-and-replace. All sites are in `bot/test/chain.test.ts`:

| Line | Current | Replacement |
|------|---------|-------------|
| 123 | `.mockResolvedValueOnce({ status: "success" } as any)` | `.mockResolvedValueOnce(makeReceipt("success"))` |
| 151 | `.mockResolvedValueOnce({ status: "success" } as any)` | `.mockResolvedValueOnce(makeReceipt("success"))` |
| 189 | `.mockResolvedValueOnce({ status: "reverted" } as any)` | `.mockResolvedValueOnce(makeReceipt("reverted"))` |
| 190 | `.mockResolvedValueOnce({ status: "success" } as any)` | `.mockResolvedValueOnce(makeReceipt("success"))` |
| 221 | `return { status: "success" } as any;` | `return makeReceipt("success");` |
| 267 | `.mockResolvedValueOnce({ status: "success" } as any)` | `.mockResolvedValueOnce(makeReceipt("success"))` |
| 288 | `.mockResolvedValueOnce({ status: "success" } as any)` | `.mockResolvedValueOnce(makeReceipt("success"))` |
| 304 | `.mockResolvedValueOnce({ status: "success" } as any)` | `.mockResolvedValueOnce(makeReceipt("success"))` |
| 342 | `.mockResolvedValueOnce({ status: "success" } as any)` | `.mockResolvedValueOnce(makeReceipt("success"))` |

**Done:** all 9 sites replaced, no `as any` remains in `chain.test.ts`.

## Verification

1. `cd bot && npm run typecheck` — must exit 0 (catches type mismatches in the helper).
2. `cd bot && npm test` — must stay at **82/82 pass**.
3. `cd bot && npm run lint` — expect warning count **9 → 0**. If `noExplicitAny` remains, we missed a site.
4. `.claude/hooks/lint-check.sh <<< '{}'` — exit 0 silently.
5. `grep "as any" bot/test/chain.test.ts` — empty.

## must_haves

**Truths:**
- All 9 `as any` sites replaced with `makeReceipt(...)`.
- Helper type-checks against viem v2's `TransactionReceipt`.
- `bot` tests still pass 82/82.
- `biome check` in bot/ reports 0 warnings (down from 9).

**Artifacts:**
- `bot/test/chain.test.ts` modified — 1 import addition, 1 helper added, 9 call sites updated.
- `260423-odh-SUMMARY.md`.

**Key links:**
- `bot/test/chain.test.ts` (edit)
- `bot/src/chain.ts:417-433` (reference — proves only `.status` is read)
- viem `TransactionReceipt` type (from `viem` package)

## Out of scope

- Refactoring other `as unknown as X` casts (`PublicClient`, `WalletClient`, `Config`) — those are legitimate test-setup patterns and not flagged by Biome.
- Typing the `estimateContractGas` mock return (bigint primitives — not `any`).
