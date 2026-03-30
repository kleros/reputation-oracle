---
phase: 04-structured-logging
plan: 01
subsystem: logging
tags: [pino, structured-logging, ndjson, redaction, stderr]

requires: []
provides:
  - "Configured pino logger module (bot/src/logger.ts) with stderr output, secret redaction, child loggers"
  - "RunSummary type definition for exit-time log summary"
  - "LOG_LEVEL config field in zod schema"
affects: [04-02-console-migration]

tech-stack:
  added: [pino ^10.3, pino-pretty ^13.1]
  patterns: [pino stderr destination, child loggers per module, reconfigure-after-config pattern]

key-files:
  created: [bot/src/logger.ts]
  modified: [bot/src/types.ts, bot/src/config.ts, bot/package.json]

key-decisions:
  - "Logger writes to stderr via pino.destination(2) — stdout reserved for dry-run JSON output"
  - "Custom error serializer sanitizes hex private keys and Bearer tokens in nested viem error causes"
  - "Logger initialized with env default before config loads, reconfigured after via reconfigureLogLevel()"

patterns-established:
  - "Import logger from logger.ts, use createChildLogger('module') for per-module context"
  - "Redact paths for top-level secrets + regex sanitization for nested error chains"

requirements-completed: [LOG-01, LOG-04]

duration: 1min
completed: 2026-03-30
---

# Phase 04 Plan 01: Logger Foundation Summary

**Pino logger module with NDJSON stderr output, secret redaction (top-level + nested error causes), child loggers, and RunSummary type**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-30T00:16:32Z
- **Completed:** 2026-03-30T00:17:52Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Pino logger writing structured NDJSON to stderr with configurable log level
- Secret redaction via pino redact paths (BOT_PRIVATE_KEY, PINATA_JWT, authorization headers) plus custom error serializer catching hex keys and Bearer tokens in nested cause chains
- RunSummary interface in types.ts for the exit-time summary log line
- start:dev script with pino-pretty pipe for development

## Task Commits

Each task was committed atomically:

1. **Task 1: Install pino deps and add RunSummary type** - `90342b1` (chore)
2. **Task 2: Create logger.ts module and add LOG_LEVEL to config** - `3346d93` (feat)

## Files Created/Modified
- `bot/src/logger.ts` - Configured pino instance with stderr destination, redaction, error serializer, child loggers
- `bot/src/types.ts` - Added RunSummary interface
- `bot/src/config.ts` - Added LOG_LEVEL optional field to zod schema
- `bot/package.json` - Added pino, pino-pretty deps and start:dev script

## Decisions Made
- Logger writes to stderr via `pino.destination(2)` — keeps stdout clean for dry-run JSON output
- Custom error serializer uses regex to sanitize hex private keys (`0x[0-9a-fA-F]{64}`) and Bearer tokens in nested viem error causes — pino's built-in redact only handles top-level paths
- Logger initialized with `process.env.LOG_LEVEL ?? "info"` before config loads; `reconfigureLogLevel()` called after config validates — handles the bootstrap ordering problem

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Logger module ready for import by all bot modules
- Plan 02 (console migration) can now replace all 24 console calls with pino structured logging
- RunSummary type ready for exit-time summary implementation in Plan 02

---
*Phase: 04-structured-logging*
*Completed: 2026-03-30*

## Self-Check: PASSED
