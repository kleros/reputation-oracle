---
phase: 08
phase_name: "observability"
project: "kleros-reputation-oracle"
generated: "2026-04-23T23:12:00Z"
counts:
  decisions: 14
  lessons: 7
  patterns: 9
  surprises: 5
missing_artifacts: []
---

# Phase 08 Learnings: observability

## Decisions

### Pino multi-transport with conditional @logtail/pino target
Replace `pino.destination(2)` with `pino.transport({ targets })`. Betterstack target added only when `BETTERSTACK_SOURCE_TOKEN` is set AND `--dry-run` is not in argv; stderr (`pino/file` destination 2) stays as the always-on target.

**Rationale:** single logger instance serves both local ops (stderr) and cloud (Betterstack); conditional target avoids spurious forwarding during dry-runs and in environments without a token.
**Source:** 08-03-SUMMARY.md, 08-CONTEXT.md D-27

### Use local `const t = transport` to narrow type (no `!` assertions)
When the transport reference could be null, capture `const t = transport` inside the block that needs it instead of `transport!.end()`.

**Rationale:** Biome's `noNonNullAssertion` rule flags `!`; type narrowing via local const is a cleaner fix than suppression comments and avoids Biome v2 inline-suppression placement pitfalls.
**Source:** 08-03-SUMMARY.md Deviations

### `closeLogger(cb)` 3-step async drain with 5s fallback
Drain sequence: `logger.flush(cb)` → `t.end()` → `t.on("close", done)` → `setTimeout(done, 5000).unref()`.

**Rationale:** pino v10 removed `pino.final()` and made `flush` async; worker-thread transports need `end()` + `close` event to guarantee HTTP delivery; 5s unref'd fallback prevents hung exits on dead Betterstack endpoints (D-17).
**Source:** 08-03-SUMMARY.md, 08-CONTEXT.md D-14..D-17

### Module-level `let logger = rootLogger`, rebind via child after config load
Hoist a mutable `logger` at module scope; after `loadConfig()`, reassign with `rootLogger.child({ runId, chainId })`.

**Rationale:** allows 20+ call sites in main/emitSummary/flushAndExit/signal handlers to acquire `runId`+`chainId` automatically without renaming any of them.
**Source:** 08-05-SUMMARY.md, 08-CONTEXT.md D-06

### `AbortSignal.timeout(ms)` over `AbortController + setTimeout`
Use Node 22 built-in `AbortSignal.timeout(config.HEARTBEAT_TIMEOUT_MS)` directly in `fetch` options.

**Rationale:** zero deps, no manual cleanup; not a real timer in vitest's fake-timer model, so tests stay simple (no `vi.useFakeTimers()` needed in heartbeat.test.ts).
**Source:** 08-04-SUMMARY.md

### `sendHeartbeat` never throws — hard swallow-on-fail guarantee
Single try/catch swallows all network, timeout, and non-2xx errors; logs `warn` (not `error`), never re-raises.

**Rationale:** OBS-04 contract — heartbeat failure must never cascade to bot exit status or trigger Betterstack alerting cascades (D-20, D-23).
**Source:** 08-04-SUMMARY.md, 08-CONTEXT.md D-20

### `HEARTBEAT_TIMEOUT_MS` defaults to 10s, not aggressive
10,000ms default via `z.coerce.number().int().positive().optional().default(10_000)`.

**Rationale:** tolerant over aggressive — heartbeat is optional liveness telemetry, not a critical-path call; 10s leaves headroom for transient Betterstack latency without bouncing the bot into /fail spuriously (DISC-01/D-22).
**Source:** 08-01-SUMMARY.md, 08-01-PLAN.md

### `config` hoisted to `let Config|undefined` outside try; narrowed via `const cfg`
Hoist config so catch-block can conditionally call `sendHeartbeat`; immediately after `config = loadConfig()`, capture `const cfg = config` inside the try to narrow to `Config` for closures.

**Rationale:** T-08-14 — `loadConfig` can throw (e.g. bad env); catch path still needs guarded heartbeat; TypeScript doesn't narrow hoisted `let` inside `.map()` or other callbacks.
**Source:** 08-05-SUMMARY.md Deviations

### `sendHeartbeat` placed AFTER `emitSummary` and BEFORE `flushAndExit` at all 5 exit paths
Five wire-in sites: balance preflight, dry-run, no-actions, main success/failure, and catch-block (guarded).

**Rationale:** emitSummary finalizes the summary struct (including `systemicFailure`); heartbeat reads it to choose base vs `/fail` URL; must fire before drain so the HTTP call has time to reach Betterstack before process.exit (D-18).
**Source:** 08-05-SUMMARY.md

### RunSummary field rename `items` → `itemsFetched`
Explicit rename in types.ts + both call sites in index.ts.

**Rationale:** OBS-08 dashboard alert queries read this field; "items" is ambiguous (items fetched? items processed? items skipped?) and made ClickHouse SQL harder to write safely (D-25).
**Source:** 08-02-SUMMARY.md

### Heartbeat URL redacted in logs via regex in `sanitizeValue`
Apply `/https:\/\/uptime\.betterstack\.com\/api\/v1\/heartbeat\/[A-Za-z0-9_-]+/g` → `[REDACTED_HEARTBEAT_URL]` in the sanitizer.

**Rationale:** Betterstack Uptime liveness tokens are embedded in the URL path; both `redact.paths` for structured-log keys AND the regex sanitizer for freeform strings are needed (D-12, T-08-07).
**Source:** 08-03-SUMMARY.md, 08-01-SUMMARY.md D-12

### Timer cadence revision 15→5 min triggered grace-window revision 20→10 min
Revised in a Phase 7→8 sweep before executing phase 8: `OnUnitActiveSec=5min`, heartbeat grace 10 min, itemsFetched===0 streak alert threshold 5 runs (up from 3).

**Rationale:** fresher reputation signals (~3min avg lag vs ~8min) while preserving alert signal-to-noise (D-04, D-24).
**Source:** STATE.md (Accumulated Context), 08-06-SUMMARY.md D-24

### Deploy docs append (not rewrite) for RUNBOOK.md §9 + §10
§9 Betterstack Setup and §10 Burn-in Gate Procedure were appended to the existing RUNBOOK; §2 was edited in-place to correct env key names.

**Rationale:** RUNBOOK is an operator reference, not a changelog — append new sections to preserve link stability and existing bookmarks; only touch existing sections for canonical-name corrections.
**Source:** 08-06-SUMMARY.md

### Worktree base hard-reset pattern when wave-N base is an ancestor
When `worktree-agent-*` branch is created from `main` instead of the current feature HEAD, `git reset --hard <EXPECTED_BASE>` is safe because the worktree has no uncommitted user work.

**Rationale:** Wave 3 executor discovered wave 2 files absent because EnterWorktree created the branch from d47b787 instead of a455e84; ff-only merge was the safe fix since the working tree was fresh.
**Source:** 08-05-SUMMARY.md Deviations #3

---

## Lessons

### Biome v2 inline suppressions must be on the PRECEDING line, not end-of-line
`// biome-ignore` as a same-line trailing comment is treated as unused-suppression by Biome v2.

**Context:** 08-03 plan template used inline suppressions on `transport!.end()` / `transport!.on(...)` — Biome flagged them as "suppressions/unused" on lint. Fix was to remove the `!` entirely via `const t = transport` type narrowing.
**Source:** 08-03-SUMMARY.md Deviations #1

### Unused `biome-ignore` comments are themselves a Biome v2 warning
Don't add suppression comments speculatively — only when the rule actually fires on that exact line.

**Context:** 08-03 template included `biome-ignore lint/suspicious/noConsole` for `closeLogger` error logging, but `noConsole` is not enabled in this project's biome.json (only `recommended: true`). The dead suppressions surfaced as warnings.
**Source:** 08-03-SUMMARY.md Deviations #2

### `loadConfig` can throw → catch-block callers must guard `if (config)` before using it
The main try/catch in index.ts covers `config = loadConfig()`; if config fails validation, catch runs with `config` still undefined.

**Context:** T-08-14 threat — without the `if (config)` guard, the catch-block `sendHeartbeat(summary, config!)` would crash, masking the original config error with a TypeError.
**Source:** 08-05-SUMMARY.md, 08-CONTEXT.md T-08-14

### `summary.systemicFailure` must be set on unhandled exceptions, not just on classified systemic errors
If the catch block calls `sendHeartbeat` without first setting `summary.systemicFailure = "unhandled_exception"`, Betterstack is pinged at the healthy URL even though the bot exited with code 1.

**Context:** Code review WR-01 at `bot/src/index.ts:161` — routing regression found post-verification; discovered only because the reviewer cross-read the heartbeat contract (D-19) against index.ts catch paths.
**Source:** 08-REVIEW.md WR-01

### Docs lag behind code revisions unless actively swept
RUNBOOK §3 still said "15-minute countdown" at verify time even though the timer was revised to 5-min in commit 8d39afe days earlier.

**Context:** Code review WR-02 — the cadence sweep from 15→5min updated the systemd unit and phase 8 grace-window math but missed one English-language mention in an older RUNBOOK section. Operator would have been confused during incidents.
**Source:** 08-REVIEW.md WR-02

### Burn-in criterion "7+ consecutive heartbeats" is ambiguous at 5-min cadence
7 heartbeats at 5-min cadence is 35 minutes — not 7 calendar days. Criterion needs an explicit count (≥2016 pings) or an explicit calendar window.

**Context:** Code review IN-02 — wording worked at the original 15-min cadence ("7 heartbeats ≈ first check-in of a 7-day soak"); broke silently when cadence was revised.
**Source:** 08-REVIEW.md IN-02

### Field renames that cross word-wrap thresholds trigger non-semantic Biome reformatting
`items: n` → `itemsFetched: n` pushed the `summary` object initializer past Biome's print-width, auto-reflowing it to multi-line.

**Context:** 08-02 `lint:fix` applied a safe format-only change on top of the rename; the test suite and typecheck didn't budge. Harmless but worth noting so future planners don't double-count the reflow as an unintended change.
**Source:** 08-02-SUMMARY.md (task notification deviation note)

---

## Patterns

### Module-level mutable logger + child-rebind
Declare `let logger = rootLogger;` at module scope; after config is known, `logger = rootLogger.child({ runId, chainId })`. All pre-existing call sites automatically pick up the bound context fields.

**When to use:** adding bound fields to every log line in an existing module without renaming 20+ call sites; any phase that threads a runtime-generated correlation ID (runId, requestId, traceId) through an existing logger.
**Source:** 08-05-SUMMARY.md

### Hoisted `let` + narrowed `const` alias for TypeScript closures
`let config: Config | undefined;` at function scope → `config = loadConfig()` → immediately `const cfg = config` inside the try. Use `cfg` inside closures (`.map`, setTimeout cbs) where TS wouldn't narrow the hoisted `let`.

**When to use:** any hoisted variable whose narrowing is lost in callbacks, when the hoisting is required for catch-block access.
**Source:** 08-05-SUMMARY.md

### `AbortSignal.timeout(ms)` in fetch options for bounded optional HTTP
Pass `signal: AbortSignal.timeout(ms)` to fetch; no controller, no setTimeout bookkeeping, no fake-timer setup in tests.

**When to use:** any Node 22+ HTTP call where a hard timeout is required and you don't need to cancel for other reasons.
**Source:** 08-04-SUMMARY.md

### `vi.stubGlobal("fetch", vi.fn())` for testable HTTP in leaf utilities
Stub `fetch` globally per-test with `vi.stubGlobal`; assert on `fetch.mock.calls[0][0]` for URL routing and `[1].signal` for timeout signal presence.

**When to use:** leaf HTTP utilities that own no client abstraction and that you don't want to refactor into DI just for tests. Mirrors the existing `bot/test/ipfs.test.ts` pattern.
**Source:** 08-04-SUMMARY.md

### Heartbeat "base vs `/fail`" routing via single `systemicFailure` boolean on summary
`const pingUrl = summary.systemicFailure ? \`${url}/fail\` : url;` — single decision point, single mutable field on the summary object.

**When to use:** any two-endpoint external monitor where healthy vs failure routing is derived from a run's summary state.
**Source:** 08-04-SUMMARY.md

### Swallow-on-fail with `warn` (not `error`) for optional telemetry
`try { await fetch(...) } catch (err) { logger.warn({ err, url: "[REDACTED]" }, "heartbeat-failed"); }` — single try/catch, no re-raise, `warn` level.

**When to use:** any non-critical-path external call where failure should not influence program exit status and should not fire severity-based alerts downstream.
**Source:** 08-04-SUMMARY.md D-20

### 3-step async drain for worker-thread transports
Flush IPC queue → end transport → wait for close event → fallback timer.unref(). All four steps are required for pino v10 worker-thread targets; skipping any causes data loss or hung exits.

**When to use:** any pino (v10+) setup with `pino.transport({ targets })` where a transport runs in a worker thread; also applies to any logger-worker shutdown path.
**Source:** 08-03-SUMMARY.md

### Redaction in two layers: structured paths + freeform sanitizer regex
`redact.paths` covers known key names (env var names, config field names); `sanitizeValue` regex covers URL-embedded secrets that slip into error messages or freeform log strings.

**When to use:** any system where a secret can appear both as a named field and as a substring of a user-facing error or freeform message.
**Source:** 08-03-SUMMARY.md D-12

### Preserve RUNBOOK anchor links by appending new sections
Never renumber; always append §N+1, §N+2 for new procedures. Edit existing sections only for factual corrections, never for structural reorg.

**When to use:** any operator-facing doc that operators bookmark or cite from Slack/incidents.
**Source:** 08-06-SUMMARY.md

---

## Surprises

### Wave 3 worktree was based on `d47b787` not `a455e84` — wave 2 files missing at start
The runtime's worktree-creation step created the Wave 3 agent's branch from the pre-wave-1 commit, not the current master HEAD. Wave 2's heartbeat.ts/logger.ts/config.ts didn't exist on disk inside the worktree.

**Impact:** Wave 3 executor detected it via the mandatory `worktree_branch_check` step and ff-merged to the correct base; no content lost. But this means the orchestrator's `EXPECTED_BASE` plumbing is load-bearing — without it the executor would have rebuilt missing Wave 2 files from scratch and collided on merge.
**Source:** 08-05-SUMMARY.md Deviations #3

### Merge orphan file `08-06-SUMMARY.md` in main working tree blocked Wave 3 merge
Main working tree had an untracked, variant copy of `08-06-SUMMARY.md` (5 extra lines) at merge time, causing `git merge` to refuse with "untracked file would be overwritten." Source of the orphan is unknown — possibly leaked when the Bash shell's cwd was captured inside a worktree during Wave 1 dispatch.

**Impact:** Orchestrator had to remove the orphan and re-merge. Adds a post-merge hygiene step worth documenting — if you ever see `?? X-SUMMARY.md` on main between waves, it's likely stale and safe to delete in favor of the worktree's committed version.
**Source:** execute-phase session transcript (Wave 3 merge step)

### Verifier ran at Phase 8, not at wave boundaries — WR-01 (real routing bug) only surfaced post-verification
Code review found WR-01 (`summary.systemicFailure` never set in catch-block) AFTER the verifier had already signed off on 21/23 must-haves. WR-01 is a behaviour regression against OBS-03 (/fail routing), not a stylistic nit.

**Impact:** The verifier's goal-backward analysis correctly read `heartbeat.ts`'s routing logic but didn't cross-reference every call site in index.ts. Lesson for future phases: code review is not a redundant pass — it's the cross-file consistency check verification explicitly skips.
**Source:** 08-VERIFICATION.md (21/23 passed), 08-REVIEW.md WR-01

### pino v10's `logger.flush` signature and worker-thread semantics required all three drain steps
Early assumption was "flush() + 100ms sleep" would do. Actual: flush ACKs only when the SharedArrayBuffer IPC queue is empty — not when Betterstack receives the HTTP POST. End-to-end delivery required `t.end()` + `close` event wait.

**Impact:** Without the full 3-step drain, cloud logs could silently drop the last N lines of a run, masking the post-mortem evidence for the exact failure path Betterstack exists to expose.
**Source:** 08-RESEARCH.md, 08-03-SUMMARY.md

### 7 unit tests for `sendHeartbeat` needed NO fake timers
Plan assumed `vi.useFakeTimers()` would be needed for the 10s timeout test. Turns out `AbortSignal.timeout()` is not a real `setTimeout` in vitest's fake-timer model — it's a native AbortSignal that fires immediately when aborted via the mocked fetch. Tests stayed simple.

**Impact:** 7 tests completed in ~200ms total (vs. projected ~1.5s with fake timer advance calls). Informs future heartbeat-like tests: reach for `AbortSignal.timeout` and mock `fetch` directly before reaching for fake timers.
**Source:** 08-04-SUMMARY.md
