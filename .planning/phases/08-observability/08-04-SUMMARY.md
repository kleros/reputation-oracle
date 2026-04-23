---
phase: 08-observability
plan: "04"
subsystem: bot
tags: [heartbeat, betterstack, observability, tdd]
dependency_graph:
  requires: [08-01, 08-02]
  provides: [sendHeartbeat export, heartbeat.ts, heartbeat.test.ts]
  affects: []
tech_stack:
  added: []
  patterns: [AbortSignal.timeout, vi.stubGlobal fetch mock, swallow-on-fail optional HTTP call]
key_files:
  created:
    - bot/src/heartbeat.ts
    - bot/test/heartbeat.test.ts
  modified: []
decisions:
  - "Use logger (root) not createChildLogger — heartbeat is a leaf utility called once per run"
  - "AbortSignal.timeout(ms) instead of AbortController + setTimeout — Node 22 built-in, zero deps"
  - "warn not error on failure — avoid cascading Betterstack alert logic (D-20)"
  - "url=[REDACTED] in warn log — token embedded in URL path (D-12)"
metrics:
  duration_min: 8
  completed: "2026-04-23"
  tasks_completed: 1
  files_created: 2
  files_modified: 0
---

# Phase 08 Plan 04: Heartbeat Module Summary

**One-liner:** Bounded-timeout Betterstack liveness ping via AbortSignal.timeout with /fail routing and swallow-on-fail guarantee.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| RED | Add failing tests for sendHeartbeat | 7530494 | bot/test/heartbeat.test.ts |
| GREEN | Implement sendHeartbeat with /fail routing | c30a24f | bot/src/heartbeat.ts, bot/test/heartbeat.test.ts |

## Implementation Details

### heartbeat.ts

`sendHeartbeat(summary: RunSummary, config: Config): Promise<void>` — leaf utility, called once per run from `index.ts` after `emitSummary`.

Key behaviors:
- **D-19:** routes to `${url}/fail` when `summary.systemicFailure` is set, base URL otherwise
- **D-20:** `AbortSignal.timeout(config.HEARTBEAT_TIMEOUT_MS)` bounds each fetch (default 10s per D-22)
- **D-21:** returns early (no-op) when `BETTERSTACK_HEARTBEAT_URL` absent or `--dry-run` in argv
- **D-23:** try/catch swallows all errors — network, timeout, non-2xx; never throws, never cascades to exit code (OBS-04 hard guarantee)
- **D-12:** logs `url: "[REDACTED]"` not actual pingUrl — Betterstack liveness token embedded in URL path

### heartbeat.test.ts

7 unit tests via `vi.stubGlobal("fetch", vi.fn())` pattern (ipfs.test.ts analog):

| Test | Coverage |
|------|----------|
| Test 1 | GET to base URL when systemicFailure absent |
| Test 2 | GET to /fail URL when systemicFailure truthy |
| Test 3 | Resolves undefined on network error (swallowed) |
| Test 4 | Resolves undefined on AbortError (swallowed) |
| Test 5 | Resolves undefined on non-2xx (503) response |
| Test 6 | No-op when BETTERSTACK_HEARTBEAT_URL undefined |
| Test 7 | No-op when --dry-run in process.argv |

No fake timers needed — `AbortSignal.timeout()` is not a real timer in vitest's fake timer model; heartbeat has no retry delay.

## TDD Gate Compliance

- RED commit: `7530494` — `test(08-04): add failing tests for sendHeartbeat — RED state`
- GREEN commit: `c30a24f` — `feat(08-04): implement sendHeartbeat with AbortSignal.timeout and /fail routing`
- REFACTOR: not needed — implementation is clean as written

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Import ordering — Biome organizeImports**
- **Found during:** Task 1 (lint step after GREEN)
- **Issue:** `bot/src/heartbeat.ts` had value import before type imports; `bot/test/heartbeat.test.ts` had similar issue
- **Fix:** `npm run lint:fix` applied safe Biome auto-fix (organizeImports)
- **Files modified:** bot/src/heartbeat.ts, bot/test/heartbeat.test.ts
- **Impact:** Zero — import order change only, no runtime semantics

## Known Stubs

None — heartbeat.ts fully wired. Integration into `index.ts` is plan 08-05's responsibility.

## Threat Surface

No new threat surface beyond what the plan's threat model documents (T-08-08 through T-08-11). Token in URL is guarded by `url: "[REDACTED]"` in warn log; `sanitizeValue` regex in logger.ts Pitfall 3 mitigation applies as second defense.

## Self-Check: PASSED

Files exist:
- bot/src/heartbeat.ts: FOUND
- bot/test/heartbeat.test.ts: FOUND

Commits exist:
- 7530494: FOUND (RED test)
- c30a24f: FOUND (GREEN implementation)

Tests: 7/7 pass. Lint: 0 findings. Typecheck: clean.
