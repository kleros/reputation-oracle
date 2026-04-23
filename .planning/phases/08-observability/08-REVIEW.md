---
phase: 08-observability
reviewed: 2026-04-23T21:58:53Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - bot/package.json
  - bot/src/config.ts
  - bot/src/heartbeat.ts
  - bot/src/index.ts
  - bot/src/logger.ts
  - bot/src/types.ts
  - bot/test/config.test.ts
  - bot/test/heartbeat.test.ts
  - bot/test/logger.test.ts
  - deploy/RUNBOOK.md
  - deploy/bootstrap.sh
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-04-23T21:58:53Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Phase 8 adds Betterstack Telemetry (pino multi-transport via `@logtail/pino`), heartbeat uptime monitoring, `runId`/`chainId` child logger binding, `closeLogger` drain before exit, and operator runbook/bootstrap updates.

The core implementation is solid: pino v10 callback-form flush, the `done()` deduplication guard, 5-second fallback timer with `.unref()`, heartbeat swallow-on-fail (never throws), `AbortSignal.timeout`, and dry-run/token-absent no-ops all work correctly. All 23 tests pass; Biome reports zero findings.

Two warnings were found:

1. The catch block in `index.ts` sends a healthy heartbeat ping on unhandled exception (missing `systemicFailure` assignment before `sendHeartbeat`).
2. RUNBOOK.md §4 has a stale "15-minute countdown" description — the timer cadence was changed to 5 min in commit `8d39afe` but this line was not updated.

Two info items: `config.ts` exits without draining the Betterstack transport, and the burn-in B-01 criterion says "7+ consecutive heartbeats" which is far too few for a 7-calendar-day window at 5-min cadence.

---

## Warnings

### WR-01: Catch block sends healthy heartbeat on unhandled exception

**File:** `bot/src/index.ts:161-167`

**Issue:** The `catch` block increments `summary.errors` but never sets `summary.systemicFailure`. `sendHeartbeat` routes to `${url}/fail` only when `summary.systemicFailure` is truthy. An unhandled exception (e.g., RPC connection refused, subgraph fetch error, unexpected throw) causes `flushAndExit(1)` — exit code 1 — but `sendHeartbeat` pings the base URL (healthy signal), not `/fail`. Betterstack Uptime sees a healthy ping followed by no ping on the *next* run, which delays the alert by one full grace period (10 minutes).

**Fix:**
```typescript
} catch (error) {
  summary.errors = 1;
  summary.systemicFailure = "unhandled_exception"; // add this line
  emitSummary(summary, startTime);
  if (config) await sendHeartbeat(summary, config);
  logger.error({ err: error }, "Bot failed");
  flushAndExit(1);
  return;
}
```

---

### WR-02: Stale timer cadence in RUNBOOK.md §4

**File:** `deploy/RUNBOOK.md:143`

**Issue:** The line reads "Starts the first 15-minute countdown immediately (first run fires after `OnBootSec=2min`)". The systemd timer file (`deploy/systemd/reputation-oracle@.timer`) uses `OnUnitActiveSec=5min` — the cadence was updated from 15 to 5 minutes in commit `8d39afe`, but this runbook sentence was not updated. An operator following the runbook will expect to wait up to 15 minutes for the first live run, and may incorrectly conclude the timer is broken after 5 minutes.

**Fix:** Replace the parenthetical:

```markdown
- Starts the first run after `OnBootSec=2min`; subsequent runs fire every 5 minutes (`OnUnitActiveSec=5min`)
```

---

## Info

### IN-01: Config validation exit bypasses Betterstack transport drain

**File:** `bot/src/config.ts:44-45`

**Issue:** When config validation fails, `loadConfig()` calls `logger.error(...)` then `process.exit(1)` directly, without going through `closeLogger()`. If `BETTERSTACK_SOURCE_TOKEN` is present in the process environment (which it will be once phase 8 is live), the pino worker-thread transport is already running. The `process.exit(1)` bypasses the drain sequence, so the "Config validation failed" log line may not be delivered to Betterstack Telemetry. The error will still appear on stderr (via the `pino/file` target), so the operator can diagnose it locally — but telemetry will silently miss the startup failure.

`closeLogger` is not exported to `config.ts` (and creating a circular dependency by importing it would be wrong). The cleaner fix is to have `loadConfig()` throw instead of exit, and let `index.ts`'s catch block call `flushAndExit(1)`:

```typescript
// config.ts: throw instead of exit
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = configSchema.safeParse(env);
  if (result.success) return result.data;

  const safeIssues = result.error.issues.map(/* ... redaction ... */);
  logger.error({ issues: safeIssues }, "Config validation failed");
  throw new Error("Config validation failed"); // let index.ts catch + closeLogger + exit
}
```

This requires removing the `process.exit(1)` from `config.ts` and relying on the existing catch block in `index.ts` (which already handles the case where `config` is undefined, per comment T-08-14). The catch block would then also need WR-01 fixed so it sends `/fail` before exiting.

---

### IN-02: Burn-in B-01 criterion "7+ consecutive heartbeats" is ambiguous at 5-min cadence

**File:** `deploy/RUNBOOK.md:355`

**Issue:** B-01 reads "7+ consecutive successful heartbeats (no `/fail` pings)". At 5-minute cadence, 7 heartbeats covers only 35 minutes — far short of the stated 7-calendar-day burn-in window. A literal reading of B-01 would satisfy the gate criterion in under an hour. The intent (7 calendar days of clean heartbeats) should be expressed numerically.

At 5-min cadence over 7 days: 7 × 24 × 12 = 2016 expected heartbeats.

**Fix:**
```markdown
| B-01 | 7 calendar days of clean heartbeats (≥ 2016 consecutive successful pings at 5-min cadence, no `/fail`) | Betterstack Uptime → Monitor → History: green for the full 7-day window |
```

Or alternatively, anchor to the calendar window rather than the count:
```markdown
| B-01 | No `/fail` pings during the 7-calendar-day burn-in window | Betterstack Uptime → Monitor → History: all green rows from start to end of the 7-day window |
```

---

_Reviewed: 2026-04-23T21:58:53Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
