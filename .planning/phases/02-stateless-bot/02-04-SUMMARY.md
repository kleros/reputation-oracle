---
phase: 02-stateless-bot
plan: 04
subsystem: bot
tags: [typescript, viem, orchestrator, dry-run, one-shot]

requires:
  - phase: 02-01
    provides: types, config, validation, evidence modules
  - phase: 02-02
    provides: computeActions diff engine
  - phase: 02-03
    provides: subgraph client, chain reader, tx executor

provides:
  - Main entry point (index.ts) wiring all bot modules into one-shot pipeline
  - Dry-run mode (--dry-run) for safe action preview
  - npm start / npm run start:dry-run scripts

affects: [03-verification]

tech-stack:
  added: []
  patterns: [one-shot orchestrator, bigint JSON serialization, process exit codes]

key-files:
  created: []
  modified: [bot/src/index.ts]

key-decisions:
  - "BigInt serialized as string in dry-run JSON output (JSON.stringify cannot handle bigint)"

patterns-established:
  - "One-shot pipeline: config -> fetch -> validate -> multicall -> diff -> execute/dry-run -> exit"

requirements-completed: [BOT-07, BOT-08]

duration: 3min
completed: 2026-03-26
---

# Phase 02 Plan 04: Orchestrator & Dry-Run Summary

**One-shot bot entry point wiring config, subgraph, validation, Multicall3, diff, and execution with --dry-run flag and process exit codes**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-26T14:54:37Z
- **Completed:** 2026-03-26T14:58:10Z
- **Tasks:** 1 (Task 2 is non-blocking human-verify checkpoint)
- **Files modified:** 1

## Accomplishments
- Wired all 5 modules (config, subgraph, validation, diff, chain) into single orchestrator
- --dry-run prints JSON action list with bigint-to-string serialization
- Exit code 0 on success (incl. dry-run), exit code 1 on failure
- No daemon loop, no polling -- strict one-shot per CLAUDE.md

## Task Commits

1. **Task 1: Implement index.ts orchestrator with dry-run support** - `abf7fa8` (feat)

## Files Created/Modified
- `bot/src/index.ts` - Main entry point: loads config, fetches subgraph, validates, reads chain state, computes diff, executes or dry-runs

## Decisions Made
- BigInt values serialized as strings in dry-run JSON output (JSON.stringify throws on bigint natively)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed import ordering for biome compliance**
- **Found during:** Task 1
- **Issue:** Import order did not match biome organizeImports rule
- **Fix:** Reordered imports alphabetically by module path
- **Files modified:** bot/src/index.ts
- **Verification:** `npx biome check src/index.ts` passes
- **Committed in:** abf7fa8

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor import ordering fix. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Bot pipeline fully assembled and type-checked
- All 42 existing tests pass
- Ready for Phase 03 verification (end-to-end testing against Sepolia)
- Non-blocking checkpoint: human can test dry-run against real Sepolia subgraph via `npm run start:dry-run`

---
*Phase: 02-stateless-bot*
*Completed: 2026-03-26*
