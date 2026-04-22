---
phase: 06-ipfs-evidence
plan: "01"
subsystem: bot
tags: [config, types, ipfs, pinata]
dependency_graph:
  requires: []
  provides:
    - PINATA_JWT config field (string | undefined)
    - PINATA_TIMEOUT_MS config field (number, default 30000)
    - ExecuteActionsResult IPFS counters and orphanedCids
    - RunSummary IPFS counters and orphanedCids
  affects:
    - bot/src/config.ts
    - bot/src/types.ts
    - bot/src/chain.ts
tech_stack:
  added: []
  patterns:
    - zod optional field with no default (PINATA_JWT)
    - zod optional field with default (PINATA_TIMEOUT_MS)
    - safeIssues redaction extended for PINATA_JWT
key_files:
  created: []
  modified:
    - bot/src/config.ts
    - bot/src/types.ts
    - bot/src/chain.ts
decisions:
  - "PINATA_JWT has no default — absence is a valid state (D-25); all IPFS upload code checks if (!config.PINATA_JWT) before use (D-26)"
  - "PINATA_TIMEOUT_MS defaults to 30_000 ms (D-14), same coerce pattern as TX_RECEIPT_TIMEOUT_MS"
  - "ExecuteActionsResult and RunSummary both carry the same four optional fields for consistent index.ts aggregation"
metrics:
  duration: "3 minutes"
  completed_date: "2026-04-22"
  tasks_completed: 2
  files_modified: 3
---

# Phase 6 Plan 1: Config + Types Foundation Summary

Config schema extended with PINATA_JWT (optional string, no default) and PINATA_TIMEOUT_MS (optional int, default 30000); ExecuteActionsResult and RunSummary both extended with four optional IPFS fields (orphanedCids, uploadsAttempted, uploadsSucceeded, uploadsFailed).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend config.ts with PINATA_JWT and PINATA_TIMEOUT_MS | ba7cb3d | bot/src/config.ts |
| 2 | Extend types.ts with IPFS fields on ExecuteActionsResult and RunSummary | d860467 | bot/src/types.ts, bot/src/chain.ts |

## What Was Built

### Task 1 — config.ts
- Added `PINATA_JWT: z.string().optional()` to `configSchema` after `MIN_BALANCE_WEI` — no default, absence is valid state per D-25
- Added `PINATA_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(30_000)` — configurable upload timeout per D-14
- Extended `safeIssues` redaction conditional to cover `PINATA_JWT` path alongside `BOT_PRIVATE_KEY` per D-27
- Did NOT modify `logger.ts` — PINATA_JWT is already present in `redact.paths` per RESEARCH.md Pitfall 10

### Task 2 — types.ts
- `ExecuteActionsResult`: added `orphanedCids?: string[]`, `uploadsAttempted?: number`, `uploadsSucceeded?: number`, `uploadsFailed?: number`
- `RunSummary`: added same four optional fields after `systemicFailure?`
- All fields are optional — existing construction sites in `index.ts` require no change

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed pre-existing TypeScript type error in chain.ts**

- **Found during:** Task 2 typecheck verification (`pnpm exec tsc --noEmit`)
- **Issue:** Plan 06-03 (wave 1, parallel agent) updated `buildFeedbackURI` signature from `(evidence: EvidenceJson) => string` to `(cid: string) => string` in `evidence.ts`, but did not update the two call sites in `chain.ts` at lines 157 and 175. This caused `TS2345: Argument of type 'EvidenceJson' is not assignable to parameter of type 'string'`.
- **Fix:** Replaced the two `buildFeedbackURI(evidence)` call sites in `chain.ts` with inline data-URI encoding (the pre-existing behavior before 06-03's change), and removed the now-unused `buildFeedbackURI` import. Added `TODO(06-04)` comments marking these lines for replacement with CID-based URIs in the prepare/execute split.
- **Scope:** This is a bridge fix — plan 06-04 will replace these lines entirely when implementing the prepare/execute split. The interim behavior (data: URI) preserves existing test compatibility.
- **Files modified:** `bot/src/chain.ts`
- **Commit:** d860467

## Verification

- `pnpm exec vitest run` — 65 tests pass across 6 test files (no regressions)
- `pnpm exec tsc --noEmit` — clean, no type errors
- `grep "PINATA_JWT: z.string().optional()"` — present in config.ts
- `grep "PINATA_TIMEOUT_MS.*default(30_000)"` — present in config.ts
- `grep -c "orphanedCids"` returns 2 in types.ts (once per interface)
- `grep -c "uploadsAttempted"` returns 2 in types.ts

## Known Stubs

None — this plan is pure type/config scaffolding with no UI rendering or data flows.

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries introduced beyond those already in the plan's threat model (T-06-01-01: PINATA_JWT redaction in zod errors — mitigated).

## Self-Check: PASSED

- bot/src/config.ts — modified, verified with grep and test run
- bot/src/types.ts — modified, verified with grep and typecheck
- bot/src/chain.ts — modified (Rule 3 deviation fix), verified with typecheck
- Commits ba7cb3d and d860467 — confirmed in git log
