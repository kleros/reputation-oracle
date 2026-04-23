---
phase: 08-observability
plan: "05"
subsystem: bot
tags: [observability, runId, child-logger, heartbeat, closeLogger, index]
dependency_graph:
  requires:
    - 08-02  # RunSummary.itemsFetched rename
    - 08-03  # closeLogger exported from logger.ts
    - 08-04  # sendHeartbeat exported from heartbeat.ts
  provides:
    - runId bound to all log lines after config load
    - sendHeartbeat wired at all exit paths
    - closeLogger replaces logger.flush in flushAndExit
  affects:
    - bot/src/index.ts
tech_stack:
  added: []
  patterns:
    - "let logger = rootLogger; rebind via rootLogger.child() after config load"
    - "config hoisted to let Config|undefined; narrowed via cfg const for TypeScript closures"
    - "if (config) guard in catch block for T-08-14 (loadConfig may throw)"
key_files:
  created: []
  modified:
    - bot/src/index.ts
decisions:
  - "Use cfg const to narrow Config|undefined after hoisted let config assignment — avoids TypeScript callback narrowing gap"
  - "config hoisted outside try block so catch handler can conditionally call sendHeartbeat (T-08-14)"
  - "sendHeartbeat placed after emitSummary and before flushAndExit at all 5 exit paths (D-18)"
  - "Module-level let logger = rootLogger allows child rebind without renaming 20+ call sites"
metrics:
  duration_minutes: 25
  completed_date: "2026-04-23T21:52:53Z"
  tasks_completed: 1
  tasks_total: 1
  files_modified: 1
---

# Phase 08 Plan 05: Index.ts Observability Integration Summary

**One-liner:** Wired runId generation, child logger binding, sendHeartbeat at all exit paths, and closeLogger swap into bot/src/index.ts — completing Phase 8 integration.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Wire runId, child logger, heartbeat, closeLogger into index.ts | ee6898a | bot/src/index.ts |

## What Was Built

Four integration points wired into `bot/src/index.ts`:

**1. runId generation (D-05)**
`const runId = crypto.randomUUID();` — first substantive line of `main()`. Uses Node 22 built-in; no import needed.

**2. Child logger binding (D-06)**
Module-level `let logger = rootLogger;` allows rebind after config load:
```typescript
logger = rootLogger.child({ runId, chainId: cfg.CHAIN_ID });
```
All subsequent `logger.xxx()` calls in `main()` (and `emitSummary`, `flushAndExit`, signal handlers) automatically carry `runId` and `chainId` in every log line.

**3. closeLogger swap (D-15)**
`flushAndExit` changed from `logger.flush(cb)` to `closeLogger(cb)`. All 6 call sites (4 in try block, 1 in catch, 1 in `.catch()`) use the new drain-safe shutdown path.

**4. sendHeartbeat at all exit paths (D-18)**
`await sendHeartbeat(summary, cfg)` inserted after `emitSummary` and before `flushAndExit` at all exit paths:
- Site A: balance preflight failure (systemicFailure → /fail ping)
- Site B: dry-run exit (no-op per D-21)
- Site C: no-actions exit (healthy ping)
- Site D: main success/failure path (/fail if systemicFailure)
- Site E: catch block — guarded `if (config)` because `loadConfig()` may have thrown (T-08-14)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript closure narrowing for Config|undefined**
- **Found during:** Task 1 typecheck
- **Issue:** `config` hoisted as `let Config|undefined` outside try block; TypeScript doesn't narrow inside `.map()` callback even after `config = loadConfig()` assignment
- **Fix:** Introduced `const cfg = config;` immediately after assignment — `cfg` is narrowed to `Config` and safe to use in closures; all `config.xxx` references inside try block changed to `cfg.xxx`; catch block uses guarded `if (config)` check
- **Files modified:** bot/src/index.ts
- **Commit:** ee6898a

**2. [Rule 3 - Blocking] Unused biome-ignore suppression**
- **Found during:** Task 1 lint
- **Issue:** `// biome-ignore lint/style/noParameterAssign` was added but the rule doesn't apply to local variable assignment (only function parameters)
- **Fix:** Removed the suppression comment; replaced with plain comment explaining the hoisting rationale
- **Files modified:** bot/src/index.ts (via `npm run lint:fix`)
- **Commit:** ee6898a

**3. [Rule 3 - Blocking] Worktree at wrong base (d47b787 instead of a455e845)**
- **Found during:** Startup base verification
- **Issue:** `git reset --hard` was blocked; worktree HEAD was ancestor of expected base — wave 2 files (heartbeat.ts, updated logger.ts, updated types.ts) were not on disk
- **Fix:** `git merge --ff-only a455e845` — safe fast-forward, no content conflicts; wave 2 artifacts now present
- **Files affected:** bot/src/heartbeat.ts (added), bot/src/logger.ts (updated), bot/src/types.ts (updated), bot/src/config.ts (updated)

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. All changes are additive wiring of existing modules. T-08-14 (loadConfig catch guard) addressed per threat register.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| bot/src/index.ts exists | FOUND |
| 08-05-SUMMARY.md exists | FOUND |
| commit ee6898a exists | FOUND |
| `crypto.randomUUID` in index.ts | FOUND |
| `closeLogger` in index.ts | FOUND |
| `logger.flush` absent from index.ts | CONFIRMED ABSENT |
| sendHeartbeat appears ≥4 times | 5 occurrences |
| `rootLogger.child` in index.ts | FOUND |
| `summary.items` absent from index.ts | CONFIRMED ABSENT |
| typecheck exits 0 | PASSED |
| npm test exits 0 (98 passed, 1 skipped) | PASSED |
| npm run lint exits 0 (0 findings) | PASSED |
