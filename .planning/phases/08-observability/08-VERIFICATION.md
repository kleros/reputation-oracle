---
phase: 08-observability
verified: 2026-04-23T23:05:00Z
status: human_needed
score: 11/13 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Start the Sepolia bot with BETTERSTACK_SOURCE_TOKEN set and observe Betterstack Logs; filter by runId UUID from stderr output"
    expected: "Log entries appear in Betterstack Telemetry with runId and chainId fields present on every line"
    why_human: "Requires live Betterstack account, network connectivity to in.logs.betterstack.com, and at least one real Sepolia run — not testable in CI"
  - test: "Configure Betterstack Uptime heartbeat monitor with 5-min cadence and 600s grace; run Sepolia bot successfully; check Uptime dashboard"
    expected: "Monitor shows Up; last heartbeat timestamp matches the run; no alert fires during normal operation"
    why_human: "Requires live Betterstack Uptime account and real Sepolia run — cannot be exercised by unit tests"
  - test: "Run Sepolia bot with BETTERSTACK_SOURCE_TOKEN set and --dry-run flag; check Betterstack Logs"
    expected: "Zero log entries appear in Betterstack Telemetry for the dry-run invocation (transport disabled)"
    why_human: "Requires live Betterstack account to confirm the conditional @logtail/pino target was absent"
  - test: "7-day Sepolia burn-in: verify 7+ consecutive heartbeats, runId/chainId in every log, no systemicFailure"
    expected: "All 5 gate criteria B-01..B-05 in RUNBOOK.md §10.1 pass"
    why_human: "7-calendar-day soak test against live infrastructure — must be done in production"
---

# Phase 8: Observability — Verification Report

**Phase Goal:** Every Sepolia run is observable in Betterstack with structured log search by runId/chainId, and a heartbeat confirms liveness after each successful run
**Verified:** 2026-04-23T23:05:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Betterstack Telemetry shows live log stream; filtering by `runId` or `chainId` returns exactly the lines from that run | HUMAN NEEDED | Transport wired conditionally in `logger.ts` (line 38-46); `runId`+`chainId` bound via `rootLogger.child` in `index.ts` (line 58); live stream requires real Betterstack account |
| 2 | Uptime heartbeat appears in Betterstack after every successful Sepolia run; alert fires when timer window missed (grace = 10 min) | HUMAN NEEDED | `sendHeartbeat` wired at all 5 exit paths in `index.ts`; grace period 600s documented in RUNBOOK §9.2; live monitor requires real Betterstack account |
| 3 | Heartbeat reflects true exit code — systemic failure sends `/fail` variant; heartbeat failure never cascades to bot exit status | VERIFIED | `heartbeat.ts` line 22: `pingUrl = summary.systemicFailure ? \`${url}/fail\` : url`; try/catch swallows all errors (line 33-37); 7 tests pass including Tests 3-5 (swallow-on-fail) |
| 4 | `--dry-run` invocations do not forward logs to Betterstack (transport disabled when token absent or dry-run flag set) | VERIFIED (code) / HUMAN (live) | `logger.ts` line 4: `isDryRun = process.argv.includes("--dry-run")`; line 38: `if (betterstackToken && !isDryRun)` — @logtail/pino target omitted from transport targets; live confirmation requires Betterstack account |
| 5 | 7-day Sepolia burn-in gate documented before Phase 9 begins | VERIFIED | RUNBOOK.md §10 exists (lines 343-390): 7-day window, B-01..B-05 criteria, sign-off format, failure/reset procedure; §10.1 gate must be executed against live infra (see human verification items) |

**Score (automated):** 3/5 truths fully verifiable programmatically; 2 require human live-infra validation (per instructions, SC-1 and SC-5 liveness items expected as human_needed)

### Plan-level Must-Have Truths (detailed breakdown)

| # | Plan | Truth | Status | Evidence |
|---|------|-------|--------|----------|
| 1 | 08-01 | zod schema accepts BETTERSTACK_SOURCE_TOKEN as optional string | VERIFIED | `config.ts` line 19: `z.string().optional()` |
| 2 | 08-01 | zod schema accepts BETTERSTACK_HEARTBEAT_URL as optional URL string, rejects non-URL values | VERIFIED | `config.ts` line 20: `z.string().url().optional()` |
| 3 | 08-01 | zod schema accepts HEARTBEAT_TIMEOUT_MS as positive integer with default 10000 | VERIFIED | `config.ts` line 21: `z.coerce.number().int().positive().optional().default(10_000)` |
| 4 | 08-02 | RunSummary.itemsFetched field exists (items field removed) | VERIFIED | `types.ts` line 65: `itemsFetched: number` with D-25 comment |
| 5 | 08-02 | All reference sites in index.ts updated (summary.items absent) | VERIFIED | `grep "summary\.items\b" bot/src/index.ts` returns EMPTY; `summary.itemsFetched` at lines 28 and 64 |
| 6 | 08-03 | pino.transport({ targets }) replaces pino.destination(2) second-arg | VERIFIED | `logger.ts` line 76 comment confirms removal; actual pino() call uses `transport` variable, not `pino.destination(2)` |
| 7 | 08-03 | @logtail/pino target added only when BETTERSTACK_SOURCE_TOKEN set AND NOT --dry-run | VERIFIED | `logger.ts` lines 4, 38: `isDryRun` check + token guard |
| 8 | 08-03 | closeLogger(cb) exported; invokes cb within 5s even if transport never closes | VERIFIED | `logger.ts` lines 91-148: exported, 5s fallback at line 101 (`setTimeout(done, 5000).unref()`); 3 logger tests pass including fake-timer fallback test (3.1s in CI) |
| 9 | 08-03 | sanitizeValue redacts heartbeat URLs matching Betterstack Uptime format | VERIFIED | `logger.ts` line 12: regex `/https:\/\/uptime\.betterstack\.com\/api\/v1\/heartbeat\/[A-Za-z0-9_-]+/g` |
| 10 | 08-04 | sendHeartbeat pings base URL on success | VERIFIED | `heartbeat.ts` line 22: `pingUrl = summary.systemicFailure ? \`${url}/fail\` : url`; Test 1 passes |
| 11 | 08-04 | sendHeartbeat pings /fail suffix URL when systemicFailure is set | VERIFIED | `heartbeat.ts` line 22; Test 2 passes |
| 12 | 08-04 | sendHeartbeat never throws — swallows all errors | VERIFIED | `heartbeat.ts` lines 33-37: single try/catch; Tests 3-5 pass |
| 13 | 08-04 | sendHeartbeat is a no-op when BETTERSTACK_HEARTBEAT_URL absent | VERIFIED | `heartbeat.ts` line 16: `if (!url) return;`; Test 6 passes |
| 14 | 08-04 | sendHeartbeat is a no-op in --dry-run mode | VERIFIED | `heartbeat.ts` lines 18-19: `isDryRun` check; Test 7 passes |
| 15 | 08-04 | heartbeat uses AbortSignal.timeout(config.HEARTBEAT_TIMEOUT_MS) | VERIFIED | `heartbeat.ts` line 27 |
| 16 | 08-05 | runId = crypto.randomUUID() is the very first line of main() | VERIFIED | `index.ts` line 25 (immediately after `async function main()` declaration) |
| 17 | 08-05 | All log lines after config load carry runId and chainId | VERIFIED (code) | `index.ts` line 58: `logger = rootLogger.child({ runId, chainId: cfg.CHAIN_ID })`; live Betterstack stream requires human check (SC-1) |
| 18 | 08-05 | sendHeartbeat called after emitSummary and before flushAndExit | VERIFIED | `index.ts` lines 99, 119, 128, 157, 164 — 5 sites; all after `emitSummary`, all before `flushAndExit` |
| 19 | 08-05 | flushAndExit calls closeLogger(() => process.exit(code)) instead of logger.flush | VERIFIED | `index.ts` line 21; grep for `logger.flush` returns EMPTY |
| 20 | 08-06 | bootstrap.sh heredoc has BETTERSTACK_HEARTBEAT_URL (not BETTERSTACK_HEARTBEAT_TOKEN typo) | VERIFIED | `bootstrap.sh` line 125: `# BETTERSTACK_HEARTBEAT_URL=`; grep for old typo returns EMPTY |
| 21 | 08-06 | bootstrap.sh heredoc has HEARTBEAT_TIMEOUT_MS=10000 placeholder | VERIFIED | `bootstrap.sh` line 126: `# HEARTBEAT_TIMEOUT_MS=10000` |
| 22 | 08-06 | RUNBOOK.md §9 Betterstack Setup documents source token creation and alert rule ClickHouse SQL | VERIFIED | RUNBOOK lines 284-340: §9.1 Telemetry Source + §9.2 Uptime Monitor; ClickHouse SQL at line 309-312 |
| 23 | 08-06 | RUNBOOK.md §10 Burn-in Gate Procedure documents 7-day Sepolia gate checklist | VERIFIED | RUNBOOK lines 343-390: 7-day gate, B-01..B-05, sign-off format, failure procedure |

**Score:** 21/23 plan must-haves verified automatically; 2 (live Betterstack stream + live heartbeat) routed to human verification.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `bot/src/config.ts` | Extended zod schema with 3 Betterstack env vars | VERIFIED | Lines 19-21: all 3 fields present with correct zod types |
| `bot/src/types.ts` | RunSummary interface with itemsFetched field | VERIFIED | Line 65: `itemsFetched: number` |
| `bot/src/logger.ts` | Multi-transport pino with closeLogger and heartbeat URL redaction | VERIFIED | 151 lines; all 4 exports present; conditional @logtail/pino transport |
| `bot/package.json` | @logtail/pino in production dependencies | VERIFIED | Line 18: `"@logtail/pino": "^0.5.8"` in `"dependencies"` block |
| `bot/src/heartbeat.ts` | sendHeartbeat(summary, config): Promise<void> | VERIFIED | 39 lines; /fail routing, AbortSignal.timeout, swallow-on-fail |
| `bot/test/heartbeat.test.ts` | 7 unit tests via vi.stubGlobal('fetch') | VERIFIED | 7 tests defined; all pass |
| `bot/test/logger.test.ts` | closeLogger callback tests | VERIFIED | 3 tests; all pass including fake-timer fallback (3.1s) |
| `bot/src/index.ts` | Wired runId, child logger, heartbeat, closeLogger | VERIFIED | crypto.randomUUID line 25; rootLogger.child line 58; 5 sendHeartbeat sites; closeLogger in flushAndExit |
| `deploy/bootstrap.sh` | Corrected Phase 8 env var placeholders in sepolia.env heredoc | VERIFIED | Lines 123-126: BETTERSTACK_HEARTBEAT_URL + HEARTBEAT_TIMEOUT_MS; old typo absent |
| `deploy/RUNBOOK.md` | §9 Betterstack Setup + §10 Burn-in Gate Procedure | VERIFIED | §9 at line 284, §10 at line 343; TOC entries at lines 18-19 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `bot/src/config.ts` | `bot/src/logger.ts` | BETTERSTACK_SOURCE_TOKEN read at module init | VERIFIED | `logger.ts` line 33: `process.env.BETTERSTACK_SOURCE_TOKEN` (read from env at module init; config type feeds the same env var value) |
| `bot/src/config.ts` | `bot/src/heartbeat.ts` | config.BETTERSTACK_HEARTBEAT_URL and HEARTBEAT_TIMEOUT_MS | VERIFIED | `heartbeat.ts` lines 15, 27: `config.BETTERSTACK_HEARTBEAT_URL`, `config.HEARTBEAT_TIMEOUT_MS` |
| `bot/src/logger.ts` | `@logtail/pino` worker thread | pino.transport({ targets: [{ target: '@logtail/pino' }] }) | VERIFIED | `logger.ts` line 41: `target: "@logtail/pino"` string literal in targets |
| `bot/src/logger.ts closeLogger` | transport worker thread | logger.flush(cb) then transport.end() then 'close' event | VERIFIED | `logger.ts` lines 125-133: 3-step drain sequence with local `const t = transport` type narrowing |
| `bot/src/index.ts main()` | pino child logger | crypto.randomUUID(); logger.child({ runId, chainId }) | VERIFIED | `index.ts` lines 25, 58 |
| `bot/src/index.ts after emitSummary` | `bot/src/heartbeat.ts sendHeartbeat` | await sendHeartbeat(summary, cfg) | VERIFIED | 5 call sites at lines 99, 119, 128, 157, 164 |
| `bot/src/index.ts flushAndExit` | `bot/src/logger.ts closeLogger` | closeLogger(() => process.exit(code)) | VERIFIED | `index.ts` line 21; no remaining `logger.flush` calls |

### Data-Flow Trace (Level 4)

Not applicable — Phase 8 adds transport/observability side-effects, not data-rendering components. All outputs are log lines and HTTP pings, not UI or data structures.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 98 unit tests pass | `cd bot && npm test` | 98 passed, 1 skipped | PASS |
| TypeScript 0 errors | `cd bot && npm run typecheck` | exit 0, no output | PASS |
| Biome 0 findings | `cd bot && npm run lint` | "Checked 27 files. No fixes applied." | PASS |
| bash syntax valid | `bash -n deploy/bootstrap.sh` | exit 0 | PASS |
| @logtail/pino installed | `ls bot/node_modules/@logtail/pino/package.json` | file exists | PASS |
| @logtail/pino in deps (not devDeps) | `grep @logtail/pino bot/package.json` | `"@logtail/pino": "^0.5.8"` in `"dependencies"` block | PASS |
| live Betterstack log stream | requires Betterstack account | cannot test in CI | SKIP → human |
| live heartbeat monitor | requires Betterstack Uptime account | cannot test in CI | SKIP → human |

### Requirements Coverage

| Requirement | Phase 8 Plans | Description | Status | Evidence |
|-------------|--------------|-------------|--------|----------|
| OBS-01 | 08-01, 08-02, 08-05 | Every log line carries `runId` and `chainId` via pino child logger | VERIFIED (code) | `rootLogger.child({ runId, chainId })` wired in `index.ts` line 58 |
| OBS-02 | 08-03 | Betterstack Telemetry log forwarding via @logtail/pino multi-transport | VERIFIED (code) / HUMAN (live) | Multi-transport implemented; live forwarding requires human check |
| OBS-03 | 08-04, 08-05 | Heartbeat fires on every run after RunSummary emission | VERIFIED (code) / HUMAN (live) | 5 sendHeartbeat sites wired; live ping requires human check |
| OBS-04 | 08-04 | Heartbeat failures never cascade to bot exit status | VERIFIED | try/catch swallows all errors; 7 heartbeat tests pass |
| OBS-05 | 08-03, 08-05 | closeLogger(cb) drains worker threads before process.exit | VERIFIED | Exported from `logger.ts`; flushAndExit uses it; 3 logger tests pass |
| OBS-06 | 08-01, 08-03 | BETTERSTACK_SOURCE_TOKEN and BETTERSTACK_HEARTBEAT_URL in pino redact config | VERIFIED | `redact.paths` has 4 Betterstack entries; `sanitizeValue` regex present; `loadConfig` redaction |
| OBS-07 | 08-06 | Betterstack dashboard documented (grace = 10 min, email alerts, muted during burn-in) | VERIFIED | RUNBOOK §9: 600s grace (line 328), email alert channel (line 337), maintenance window guidance (line 339) |
| OBS-08 | 08-02, 08-06 | Alert fires when itemsFetched === 0 for 5+ consecutive runs | VERIFIED | RUNBOOK §9.1 ClickHouse SQL + threshold ≥ 5 + 25-min confirmation period documented |

**All 8 OBS requirements covered.** REQUIREMENTS.md marks all as Pending (status column not yet updated) — that is an administrative tracking gap, not a code gap. All OBS-01 through OBS-08 have code evidence.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| None | — | — | — |

No TODO/FIXME/placeholder stubs found in Phase 8 artifacts. No `return {}` or `return []` stubs. All exports are substantive implementations with passing tests.

### Human Verification Required

#### 1. Live Betterstack Telemetry Log Stream (OBS-01 / OBS-02 / SC-1)

**Test:** Deploy to Sepolia VPS with `BETTERSTACK_SOURCE_TOKEN` filled in `/etc/reputation-oracle/sepolia.env`. Trigger one run. In Betterstack Logs, filter by the `runId` UUID printed to stderr.
**Expected:** All log lines from that run appear in Betterstack Telemetry. Every line has `runId` and `chainId` fields. Filtering by `runId` returns exactly the lines from that run and no others.
**Why human:** Requires live Betterstack account with a configured source, network access to `in.logs.betterstack.com`, and a Sepolia RPC endpoint.

#### 2. Live Heartbeat Monitor (OBS-03 / SC-2)

**Test:** Configure Betterstack Uptime heartbeat monitor (5-min cadence, 600s grace). Fill `BETTERSTACK_HEARTBEAT_URL` in sepolia.env. Trigger one successful Sepolia run.
**Expected:** Betterstack Uptime shows the monitor as Up, with a last-heartbeat timestamp matching the run time. After 2+ missed run windows, the monitor fires an alert.
**Why human:** Requires Betterstack Uptime account, configured monitor, and live Sepolia node.

#### 3. Dry-Run Log Exclusion (OBS-02 / SC-4)

**Test:** On the VPS with `BETTERSTACK_SOURCE_TOKEN` set, invoke the bot with `--dry-run`. Check Betterstack Logs immediately after.
**Expected:** Zero new entries appear in Betterstack Telemetry for the dry-run invocation.
**Why human:** Requires live Betterstack account to confirm absence of log entries.

#### 4. 7-Day Sepolia Burn-In Gate (SC-5 / MAIN-08)

**Test:** Follow RUNBOOK.md §10 Burn-in Gate Procedure over 7 calendar days after Betterstack is configured.
**Expected:** All 5 gate criteria B-01..B-05 satisfied: 7+ consecutive successful heartbeats, runId/chainId on every log line, no systemicFailure, itemsFetched > 0 on all non-empty runs, no alerts fired.
**Why human:** 7-day soak test against live production infrastructure — cannot be simulated in CI.

### Deferred Items

None. All gaps identified are human-infrastructure items, not deferred-to-later-phase items.

---

## Gaps Summary

No programmatically-detectable gaps. All code artifacts are substantive, wired, and tested. The phase goal is architecturally complete and ready for live deployment validation.

The 4 human verification items are expected live-infra items acknowledged in the task instructions: "acceptance criteria 1 and 5 are live-Betterstack dependent and will flow to HUMAN-UAT." Items 2 and 3 are the same category.

Status is `human_needed` because live Betterstack testing must precede Phase 9 enablement. The 7-day burn-in gate (RUNBOOK §10) is the formal gate document.

---

_Verified: 2026-04-23T23:05:00Z_
_Verifier: Claude (gsd-verifier)_
