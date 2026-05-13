---
phase: quick
plan: 260513-x0m
subsystem: bot/diff
tags: [bugfix, oscillation, multi-item, agentId-grouping, regression-tests]
dependency_graph:
  requires: []
  provides: [correct-per-agentid-deduplication, race-detector-log]
  affects: [bot/src/diff.ts, bot/test/diff.test.ts, OPEN_QUESTIONS.md]
tech_stack:
  added: []
  patterns: [vi.hoisted for ESM mock hoisting, Map<bigint,T> grouping, lexicographic tiebreak]
key_files:
  created: [OPEN_QUESTIONS.md]
  modified: [bot/src/diff.ts, bot/test/diff.test.ts]
decisions:
  - Live item wins over Absent/Reject when both exist for same agentId (reject+resubmit race)
  - Multiple live items: lexicographically largest itemID is deterministic tiebreak
  - Race-detector warn log (Betterstack-visible) emitted; -95 silently skipped with explanation
  - "None" disputeOutcome corrected to RTA/no ruling (not "challenger lost")
metrics:
  duration: ~15min
  completed: 2026-05-14
  tasks_completed: 3
  files_changed: 3
---

# Quick Task 260513-x0m: Fix Multi-Item Per AgentId Oscillation

**One-liner:** `computeActions` rewritten to group items by agentId and emit at most one action per agentId per run, with race-detector warn log for reject+resubmit race scenarios.

## What Was Built

**Task 1 — `bot/src/diff.ts` rewrite** (`ad89e8d`):
- Replaced per-item loop with `Map<bigint, ValidatedItem[]>` grouping by agentId
- Per-agentId logic: live items (Submitted|Reincluded) trigger Scenario 1; Absent items are ignored if any live item exists
- Multiple live items: deterministic tiebreak by largest `itemID` (lexicographic), commented
- Race-detector `log.warn(...)` fires when live item coexists with Absent/Reject in same group
- Scenario 2 (Absent+Reject only) and Scenario 3 (voluntary withdrawal only) preserved
- Corrected misleading comment: `disputeOutcome "None"` = RTA/no ruling, not "challenger lost"
- Imported `createChildLogger` from `./logger.js`; `const log = createChildLogger("diff")`

**Task 2 — `bot/test/diff.test.ts` regression tests** (`cd4fc67`):
- New describe block "Multi-item per agentId (oscillation regression)" with 5 tests
- Used `vi.hoisted` pattern for `mockWarn` to work correctly with `vi.mock` hoisting in ESM
- R-1: Submitted+Absent/None, routerState=None → 1 submitPositiveFeedback
- R-2: Submitted+Absent/None, routerState=Positive → 0 actions (steady state)
- R-3: Submitted+Absent/Reject, routerState=None → submitPositiveFeedback + race warn asserted
- R-4: Absent/None only, routerState=Positive → revokeOnly
- R-5: Absent/Reject only, routerState=Positive → submitNegativeFeedback

**Task 3 — `OPEN_QUESTIONS.md` entry** (`15e3af5`):
- Created file in repo (was untracked on master; content preserved + entry appended)
- Documents reject+resubmit race scenario, 3 solution paths, rationale for deferral
- Trigger: any production `"reject+resubmit race detected"` warn in Betterstack

## Verification

- `npm run test -- diff`: 20 passed (15 original + 5 new)
- `npm run lint`: 0 findings (Biome baseline maintained)
- `forge fmt --check`: no diff (contracts untouched)

## Deviations from Plan

**[Rule 1 - Bug] `vi.mock` hoisting: `mockWarn` not available in factory**
- Found during: Task 2
- Issue: `const mockWarn = vi.fn()` is not accessible inside `vi.mock(...)` factory because `vi.mock` is hoisted above all variable declarations at compile time
- Fix: Used `vi.hoisted(() => ({ mockWarn: vi.fn() }))` — the documented vitest pattern for this exact case
- Files modified: `bot/test/diff.test.ts`

**[Rule 1 - Bug] Biome formatter: long object literals in tests**
- Found during: Task 2 lint check
- Issue: `makeItem({ agentId: 1436n, itemID: "...", pgtcrItemId: "...", status: "Absent", latestDisputeOutcome: null })` exceeded line width limit
- Fix: `npm run lint:fix` auto-formatted to multi-line object style (safe, no semantic change)
- Files modified: `bot/test/diff.test.ts`

**[Deviation] OPEN_QUESTIONS.md not in worktree**
- The file was untracked on master (not committed). Worktree was reset to base commit which predates it. Created the file in the worktree with the original content intact plus the new entry appended. Content verified to match the master copy exactly before appending.

## Self-Check: PASSED

- `bot/src/diff.ts` exists: FOUND
- `bot/test/diff.test.ts` exists: FOUND
- `OPEN_QUESTIONS.md` exists: FOUND
- Commit `ad89e8d` (fix): FOUND
- Commit `cd4fc67` (test): FOUND
- Commit `15e3af5` (docs): FOUND
