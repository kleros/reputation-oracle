---
quick_task: 260423-2ev
date: "2026-04-23"
completed: "2026-04-23T00:45:48Z"
commit: 3e8b106
files_modified:
  - bot/src/chain.ts
requirements:
  - IN-01
---

# Quick Task 260423-2ev: Remove dead ?? 30_000 fallback on PINATA_TIMEOUT_MS

One-line fix: removed unreachable `?? 30_000` null-coalescing fallback from `uploadEvidenceToIPFS` call; zod schema guarantees `config.PINATA_TIMEOUT_MS` is always `number` via `.optional().default(30_000)`.

## Change

**File:** `bot/src/chain.ts` line 228

Before:
```ts
config.PINATA_TIMEOUT_MS ?? 30_000,
```

After:
```ts
config.PINATA_TIMEOUT_MS,
```

## Verification

- `pnpm exec tsc --noEmit` — 0 errors
- `pnpm exec vitest run` — 81 passed, 1 skipped (pre-existing skip)

## Deviations

None — plan executed exactly as written.

## Self-Check: PASSED

- File modified: bot/src/chain.ts — FOUND
- Commit 3e8b106 — FOUND
