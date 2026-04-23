---
phase: 08-observability
plan: "03"
subsystem: bot/logger
tags: [pino, multi-transport, betterstack, closeLogger, redaction, observability]
dependency_graph:
  requires: [08-01]
  provides: [closeLogger, multi-transport-pino, betterstack-transport, heartbeat-url-redaction]
  affects: [bot/src/logger.ts, bot/src/index.ts]
tech_stack:
  added: ["@logtail/pino@^0.5.8"]
  patterns: [pino-multi-transport, transport-drain-closeLogger, module-level-transport-ref]
key_files:
  modified:
    - bot/src/logger.ts
    - bot/package.json
    - bot/package-lock.json
  created:
    - bot/test/logger.test.ts
decisions:
  - "Use local const t = transport to narrow type — avoids ! assertions that Biome noNonNullAssertion flags"
  - "biome-ignore noConsole not needed — rule not enabled in project biome.json; removed suppression comments"
  - "3-test strategy: stderr-only callback, deduplication guard, 5s fallback via vi.useFakeTimers()"
metrics:
  duration: "~7 minutes"
  completed: "2026-04-23T21:45:00Z"
  tasks_completed: 2
  files_changed: 4
---

# Phase 08 Plan 03: Multi-Transport Logger with closeLogger Summary

**One-liner:** pino.transport({ targets }) multi-transport with conditional @logtail/pino target, closeLogger(cb) 3-step drain, and Betterstack token/URL redaction.

## What Was Built

Refactored `bot/src/logger.ts` from a single `pino.destination(2)` stderr sink to a `pino.transport({ targets })` multi-transport setup. The `@logtail/pino` Betterstack target is added conditionally when `BETTERSTACK_SOURCE_TOKEN` is set and `--dry-run` is not active. A `closeLogger(cb)` function was exported to enable async drain of the worker thread before `process.exit`, with a 5-second fallback timer (D-17) preventing hung exits on dead Betterstack endpoints.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Install @logtail/pino and refactor logger.ts | 147d3bf | bot/package.json, bot/package-lock.json, bot/src/logger.ts |
| 2 | Unit tests for closeLogger behavior | 9c6eae3 | bot/test/logger.test.ts |

## Verification Results

- `grep "pino.destination(2)" bot/src/logger.ts` (code only) — 0 matches (old pattern gone)
- `grep "@logtail/pino" bot/package.json` — in `dependencies` block at `^0.5.8`
- `ls bot/node_modules/@logtail/pino/` — directory exists (npm installed)
- `grep "closeLogger" bot/src/logger.ts` — exported function definition present
- Betterstack key occurrences in `redact.paths` + `sanitizeValue` — 5 lines
- `grep "uptime\.betterstack\.com" bot/src/logger.ts` — heartbeat URL regex present
- `cd bot && npm run typecheck` — exit 0
- `cd bot && npm test` — 91 passed, 1 skipped (3 new logger tests + 88 pre-existing)
- `cd bot && npm run lint` — 0 findings

## Key Implementation Details

**Transport type narrowing:** Used `const t = transport` local capture before the `logger.flush()` callback to narrow the type from `ReturnType<typeof pino.transport> | null` to `ReturnType<typeof pino.transport>`. This avoids `!` non-null assertions that Biome's `noNonNullAssertion` rule would flag.

**Pitfall 2 eliminated:** `pino.destination(2)` removed from `pino()` second arg. Stderr now expressed as `{ target: "pino/file", options: { destination: 2 } }` inside `targets[]`. Previously both would have produced duplicate stderr lines.

**Pitfall 5 avoided:** `@logtail/pino` referenced only as a string literal in the `target:` field — never imported. Avoids `PinoLog`'s `[key: string]: any` index signature triggering Biome's `noExplicitAny`.

**closeLogger drain sequence (D-14..D-17):**
1. `logger.flush(cb)` — drains SharedArrayBuffer IPC queue (main → worker)
2. `t.end()` — signals end-of-stream, triggers worker `_destroy` → `logtail.flush()` (HTTP delivery)
3. `t.on("close", done)` — fires when worker fully closed
4. `setTimeout(done, 5000).unref()` — fallback if worker never acks (dead Betterstack)

**Redaction coverage (D-12):**
- `redact.paths`: 4 Betterstack entries (`BETTERSTACK_SOURCE_TOKEN`, `BETTERSTACK_HEARTBEAT_URL`, `config.BETTERSTACK_SOURCE_TOKEN`, `config.BETTERSTACK_HEARTBEAT_URL`)
- `sanitizeValue`: heartbeat URL regex `/https:\/\/uptime\.betterstack\.com\/api\/v1\/heartbeat\/[A-Za-z0-9_-]+/g` → `[REDACTED_HEARTBEAT_URL]`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Inline biome-ignore comments flagged as suppressions/unused**
- **Found during:** Task 1 lint check
- **Issue:** Plan template placed `biome-ignore lint/style/noNonNullAssertion` as inline end-of-line comments on the `transport!.end()` and `transport!.on(...)` lines. Biome v2 requires suppressions to be on the preceding line, not inline.
- **Fix:** Replaced `transport!` with a local `const t = transport` capture (type narrowing eliminates the `!` entirely). No suppression needed.
- **Files modified:** bot/src/logger.ts
- **Commit:** 147d3bf

**2. [Rule 1 - Bug] biome-ignore noConsole flagged as suppressions/unused**
- **Found during:** Task 1 lint check
- **Issue:** `lint/suspicious/noConsole` is not enabled in this project's `biome.json` (only `recommended: true`). The suppression comments had no effect and Biome v2 flags unused suppressions as warnings.
- **Fix:** Removed the three `biome-ignore lint/suspicious/noConsole` comments. The `console.error` calls in `closeLogger` D-16 escape hatch remain and are valid (Biome doesn't flag them).
- **Files modified:** bot/src/logger.ts
- **Commit:** 147d3bf

## Known Stubs

None. All exports (`logger`, `closeLogger`, `createChildLogger`, `reconfigureLogLevel`) are fully implemented and wired.

## Threat Surface Scan

No new network endpoints or auth paths introduced. The `@logtail/pino` worker thread accesses `https://in.logs.betterstack.com` but this is the intended OBS-02 surface documented in the plan's threat model (T-08-04, T-08-05, T-08-06, T-08-07 — all mitigated).

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| bot/src/logger.ts exists | FOUND |
| bot/test/logger.test.ts exists | FOUND |
| 08-03-SUMMARY.md exists | FOUND |
| commit 147d3bf (Task 1) | FOUND |
| commit 9c6eae3 (Task 2) | FOUND |
