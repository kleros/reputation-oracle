---
status: partial
phase: 08-observability
source: [08-VERIFICATION.md]
started: 2026-04-23T23:06:00Z
updated: 2026-04-23T23:06:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live Betterstack Telemetry log stream with runId/chainId filter
expected: Log entries appear in Betterstack Telemetry with `runId` and `chainId` fields present on every line; filtering by the runId UUID from stderr returns exactly the lines from that run
result: [pending]
why_human: Requires live Betterstack account, network connectivity to in.logs.betterstack.com, and at least one real Sepolia run — not testable in CI
procedure: Start the Sepolia bot with `BETTERSTACK_SOURCE_TOKEN` set; capture the runId UUID from stderr; open Betterstack Telemetry and filter by that runId

### 2. Live Betterstack Uptime heartbeat monitor
expected: Monitor shows Up after a successful Sepolia run; last heartbeat timestamp matches the run; no alert fires during normal operation; alert fires when the timer window is missed (grace = 10 min at 5-min cadence)
result: [pending]
why_human: Requires live Betterstack Uptime account and real Sepolia run — cannot be exercised by unit tests
procedure: Follow RUNBOOK §9.2 to create the heartbeat monitor (5-min cadence, 600s grace); run the bot; verify Up in Uptime dashboard; stop the timer and verify alert fires after ~15 min total

### 3. --dry-run invocations do not forward logs to Betterstack
expected: Zero log entries appear in Betterstack Telemetry for the `--dry-run` invocation (transport disabled when dry-run flag set even with token present)
result: [pending]
why_human: Requires live Betterstack account to confirm the conditional `@logtail/pino` target was absent from the transport
procedure: Run bot with `BETTERSTACK_SOURCE_TOKEN` set AND `--dry-run` flag; check Betterstack Telemetry for zero new entries during the run window

### 4. 7-day Sepolia burn-in gate (criteria B-01..B-05 in RUNBOOK §10.1)
expected: All 5 gate criteria pass — 7+ consecutive heartbeats (≥2016 pings over 7 calendar days at 5-min cadence), runId/chainId present in every log line, no systemicFailure, no uncaught exceptions, no missed timer windows
result: [pending]
why_human: 7-calendar-day soak test against live infrastructure — must be executed in production before Phase 9 Mainnet begins
procedure: Follow RUNBOOK §10 sign-off format; record start date, tick through B-01..B-05 daily, complete sign-off before running `/gsd:verify-work 08`

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps

[none — all items are live-infra acceptance, not code gaps]
