---
phase: 05-transaction-safety
plan: "01"
subsystem: bot
tags: [types, config, interfaces, transaction-safety]
dependency_graph:
  requires: []
  provides:
    - bot/src/types.ts exports RunSummary with skipped+systemicFailure, ExecuteActionsResult, ShutdownHolder
    - bot/src/config.ts exports Config with TX_RECEIPT_TIMEOUT_MS and MIN_BALANCE_WEI
  affects:
    - bot/src/chain.ts (will import ExecuteActionsResult, ShutdownHolder)
    - bot/src/index.ts (will use RunSummary.skipped, RunSummary.systemicFailure, ShutdownHolder)
tech_stack:
  added: []
  patterns:
    - Zod z.coerce.bigint() for bigint env vars (avoids Number precision loss above 2^53)
key_files:
  created: []
  modified:
    - bot/src/types.ts
    - bot/src/config.ts
    - bot/.env.example
decisions:
  - "Used z.coerce.bigint() for MIN_BALANCE_WEI — bigint literal 5_000_000_000_000_000n preserves precision; plain Number would lose it"
  - "TX_RECEIPT_TIMEOUT_MS uses z.coerce.number().int().positive() — rejects zero/negative values per T-05-02"
metrics:
  duration: 81s
  completed: "2026-04-21"
  tasks_completed: 2
  files_modified: 3
---

# Phase 05 Plan 01: Types and Config Foundation Summary

**One-liner:** TypeScript interface contracts and Zod-validated config fields that Plans 02-04 depend on for transaction safety implementation.

## What Was Built

Established the shared type contracts and configuration foundation for Phase 5 transaction safety hardening:

1. **Extended `RunSummary`** (D-20) — added `skipped: number` and `systemicFailure?: string` to the existing interface. `txSent` semantics clarified (confirmed non-reverted only). Zero breaking changes since new fields are additive/optional.

2. **Added `ExecuteActionsResult`** — new interface replacing `Promise<void>` as `executeActions()` return type. Carries `skipped`, `txSent`, and optional `systemicFailure` reason code up to `index.ts`.

3. **Added `ShutdownHolder`** — simple mutable holder `{ shutdown: boolean }` threaded from `index.ts` into `executeActions()` for SIGTERM/SIGINT propagation without module-scoped state.

4. **Extended `configSchema`** with two optional fields:
   - `TX_RECEIPT_TIMEOUT_MS`: default 120000ms, `z.coerce.number().int().positive()` — rejects zero/negative per T-05-02
   - `MIN_BALANCE_WEI`: default `5_000_000_000_000_000n`, `z.coerce.bigint()` — bigint literal required for precision above 2^53 (Pitfall D)

5. **Updated `.env.example`** — documented both new optional vars with inline guidance comments (L2 note: use 30000ms for TX_RECEIPT_TIMEOUT_MS).

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1: types.ts | d581fb0 | feat(05-01): extend types.ts with ExecuteActionsResult and ShutdownHolder |
| Task 2: config.ts + .env.example | 7274860 | feat(05-01): add TX_RECEIPT_TIMEOUT_MS and MIN_BALANCE_WEI to config |

## Deviations from Plan

None — plan executed exactly as written.

## Threat Model Coverage

| Threat | Mitigation Applied |
|--------|-------------------|
| T-05-01: Tampering via MIN_BALANCE_WEI | z.coerce.bigint() rejects non-numeric strings; existing error handler exits 1 |
| T-05-02: Tampering via TX_RECEIPT_TIMEOUT_MS | z.coerce.number().int().positive() rejects zero/negative values |
| T-05-03: DoS via very large timeout | Accepted — operator-controlled env var, no external attack vector |

## Known Stubs

None — this plan defines interfaces and config only; no runtime behavior implemented.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundary changes.

## Self-Check: PASSED

- [x] `bot/src/types.ts` modified and contains `skipped: number`, `ExecuteActionsResult`, `ShutdownHolder`
- [x] `bot/src/config.ts` modified and contains `TX_RECEIPT_TIMEOUT_MS`, `5_000_000_000_000_000n`
- [x] `bot/.env.example` modified and contains `TX_RECEIPT_TIMEOUT_MS`, `MIN_BALANCE_WEI`
- [x] Commit d581fb0 exists (Task 1)
- [x] Commit 7274860 exists (Task 2)
- [x] `pnpm exec tsc --noEmit` exits 0 (verified from /Users/jaybuidl/project/kleros/reputation-oracle/bot)
