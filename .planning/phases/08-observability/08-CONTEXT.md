# Phase 8: Observability - Context

**Gathered:** 2026-04-23
**Status:** Ready for planning — DISC-01/02/03 resolved by user on 2026-04-23 (see Claude's Discretion section)

<domain>
## Phase Boundary

Make every Sepolia bot run **observable from outside the VPS** via Betterstack: structured logs searchable by `runId` and `chainId` in Betterstack Telemetry, and a liveness signal per run in Betterstack Uptime. Establishes the 7-day Sepolia burn-in evidence required before Phase 9 Mainnet cutover.

In scope: pino root child logger with `runId`+`chainId`, `@logtail/pino` multi-transport shipping logs to Betterstack, `closeLogger(cb)` async-flush helper, Betterstack Uptime heartbeat (success + `/fail` variant) after each `RunSummary` emission, bounded-timeout swallow-on-failure heartbeat semantics, redaction of Betterstack token + heartbeat URL, dashboard documentation, and the alert rule for `itemsFetched===0` streaks.

Out of scope: Mainnet RPC fallback (Phase 9 MAIN-07), Mainnet deployment (Phase 9), any change to the bot's business logic in `chain.ts`/`diff.ts`/`subgraph.ts`, any log-shipping destination other than Betterstack, any synthetic burn-in automation — the 7-day gate is a manual documented check before enabling Phase 9's Mainnet timer.

</domain>

<decisions>
## Implementation Decisions

### Pre-locked from v1.2 kickoff & requirements

- **D-01:** Log shipping vendor: **Betterstack** (formerly Logtail + Better Uptime). No other vendor evaluated — already committed during v1.2 kickoff.
- **D-02:** Transport library: `@logtail/pino` multi-transport (Betterstack's official pino transport — worker-thread-backed, async flushing). Pino v10 compatible. Installed as a regular `dependencies` entry in `bot/package.json`.
- **D-03:** 7-day Sepolia burn-in gate is **manual**: before Phase 9 enables the Mainnet timer, operator confirms in Betterstack Uptime that 7+ consecutive successful heartbeats with `runId`/`chainId` present in every log line. Documented in `deploy/RUNBOOK.md` §Burn-in. No automated gate in bot code.
- **D-04:** Alert grace period: **20 minutes** after the timer's expected 15-min cadence (25 min edge-triggered from Betterstack's perspective = heartbeat + 20 min = next expected window). Email alerts only for v1.2 — no PagerDuty/Slack escalation.

### runId generation

- **D-05:** Source: **`crypto.randomUUID()`** (Node 22 built-in). No new dep. UUID v4.
- **D-06:** Placement: generated as the **very first line of `main()`** (before config load, before any logger call), wrapped into the root logger via `logger = rootLogger.child({ runId, chainId })` once `chainId` is known from `config.CHAIN_ID`. Every subsequent log line inherits both fields.
- **D-07:** `runId` is generated even in `--dry-run` mode — useful for correlating dry-run stdout with stderr log lines. `chainId` likewise.
- **D-08:** `runId` format in logs: the raw UUID string (e.g. `"a1b2c3d4-..."`). No prefix, no truncation. Betterstack Telemetry's full-text search works on the full UUID.

### Betterstack Telemetry transport (OBS-02, OBS-06)

- **D-09:** Transport is constructed via `pino.transport({ targets: [...] })` at logger initialization in `bot/src/logger.ts`. The `@logtail/pino` target is added to the transport `targets[]` **only when `BETTERSTACK_SOURCE_TOKEN` is set AND `--dry-run` is NOT present**. Otherwise the target is omitted (transport may still have a single `pino/file` target for stderr).
- **D-10:** The stderr `pino.destination(2)` current behavior must remain — Betterstack is **additive**, not a replacement. Rationale: `journalctl` on the VPS must continue to show structured logs even if Betterstack network path fails. Both sinks get the same log stream.
- **D-11:** Dry-run detection: read `process.argv.includes("--dry-run")` inside `logger.ts` at module init (same flag parsing pattern as `index.ts`). Transport construction is then conditional on the boolean.
- **D-12:** Redaction additions to pino `redact.paths`: add `BETTERSTACK_SOURCE_TOKEN`, `BETTERSTACK_HEARTBEAT_URL`, `config.BETTERSTACK_SOURCE_TOKEN`, `config.BETTERSTACK_HEARTBEAT_URL`. The heartbeat URL is redacted because Betterstack monitor URLs contain an opaque ID token (e.g. `https://uptime.betterstack.com/api/v1/heartbeat/abc123xyz`) — exposure = unauthenticated liveness-spoofing. Redact both keys and potential bare-URL leaks by scanning strings (reuse existing `sanitizeValue` pattern).
- **D-13:** Transport options for `@logtail/pino`: `sourceToken: BETTERSTACK_SOURCE_TOKEN`, `options: { endpoint: 'https://in.logs.betterstack.com' }` (Betterstack's ingestion endpoint — research and confirm during plan-phase; may be region-dependent).

### `closeLogger(cb)` (OBS-05)

- **D-14:** New exported function in `bot/src/logger.ts`:
  ```ts
  export function closeLogger(cb: () => void): void { ... }
  ```
  Semantics: awaits the multi-transport worker thread to drain buffered logs, then invokes `cb`. Internally wraps `pino.transport(...)` worker's async-end via `logger.flush()` + transport `.end()` (exact API shape to be confirmed by researcher against `@logtail/pino` + `pino.transport` v10 docs).
- **D-15:** `bot/src/index.ts` `flushAndExit(code)` is updated to call `closeLogger(() => process.exit(code))` instead of `logger.flush(() => process.exit(code))`. Single point of change — all 6 existing `flushAndExit()` call sites remain identical.
- **D-16:** `closeLogger` is **non-throwing** — any internal error during transport drain is caught and logged to `console.error` as a last-resort escape hatch, then `cb` is invoked regardless. Loss of buffered logs must never prevent bot exit.
- **D-17:** Fallback timeout: if the transport worker does not drain within **5000ms (5s)**, `closeLogger` invokes `cb` anyway. Prevents hung exits on a dead Betterstack endpoint. Chosen to prioritize not dropping end-of-run log lines on a slow/degraded network over faster systemd exit latency (user pick 2026-04-23, DISC-02).

### Uptime heartbeat (OBS-03, OBS-04)

- **D-18:** Heartbeat HTTP call placement: immediately **after** `emitSummary(summary, startTime)` and **before** `flushAndExit(code)` in `bot/src/index.ts`. Emitting the summary log line first guarantees the run-complete log reaches Betterstack Telemetry before the heartbeat triggers any alert logic on the Betterstack side.
- **D-19:** Success vs failure routing: if `summary.systemicFailure` is present, POST (or GET) to `${BETTERSTACK_HEARTBEAT_URL}/fail`; otherwise to `${BETTERSTACK_HEARTBEAT_URL}` (no suffix). Uses Betterstack Uptime's convention (researcher to confirm exact method and suffix in plan-phase).
- **D-20:** Heartbeat HTTP method, timeout, and error handling implemented as a single helper function `sendHeartbeat(summary, config): Promise<void>` in a new file `bot/src/heartbeat.ts`. Uses native `fetch` with `AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS)`. Any error — network, timeout, non-2xx response — is caught, logged at `warn` level (never `error`, to avoid cascading Betterstack's own error alerts), and swallowed. The function returns `Promise<void>` and never throws.
- **D-21:** When `BETTERSTACK_HEARTBEAT_URL` is absent or `--dry-run` is active, `sendHeartbeat` is a no-op. Same conditional pattern as D-09. No "dry heartbeat" in dry-run mode.
- **D-22:** Heartbeat timeout default: **10000ms (10s)**. Configurable via `HEARTBEAT_TIMEOUT_MS` env var with zod validation. Chosen for tolerance over aggressive failure — Betterstack's `in.logs.betterstack.com` ingest can occasionally exceed 5s under load; 10s keeps the heartbeat silent in that window rather than log-spamming warns (user pick 2026-04-23, DISC-01).
- **D-23:** Heartbeat failure never cascades to `summary.systemicFailure` or the exit code — OBS-04 is a hard guarantee. A failed heartbeat is a monitoring-infra issue, not a bot-run issue.

### OBS-08 silent-list alert

- **D-24:** Alert rule is **configured in Betterstack's dashboard UI**, not in bot code. Bot code simply emits the `RunSummary` with accurate `itemsFetched` (renamed internally from `summary.items`; see D-25). Betterstack's Telemetry alert fires on the aggregation `count(runs where itemsFetched==0) >= 3` over a rolling window matching the timer cadence (~45 min for 3 consecutive 15-min runs).
- **D-25:** Rename `RunSummary.items` → `RunSummary.itemsFetched` for consistency with requirement text, dashboard query readability, and future-proofing. Update `emitSummary`, types, and all logger lines that reference `summary.items`. One-line type migration — low blast radius.
- **D-26:** Dashboard configuration documented in `deploy/RUNBOOK.md` §Betterstack with exact query syntax (or at least the Telemetry UI field values). Not checked into code.

### Config schema (zod)

- **D-27:** New env vars in `bot/src/config.ts`:
  - `BETTERSTACK_SOURCE_TOKEN`: `z.string().optional()` — when absent, Telemetry transport is skipped.
  - `BETTERSTACK_HEARTBEAT_URL`: `z.string().url().optional()` — when absent, heartbeat is skipped. Validated as URL shape when present.
  - `HEARTBEAT_TIMEOUT_MS`: `z.coerce.number().int().positive().default(10000)` — bounded timeout for heartbeat fetch (10s per D-22).
- **D-28:** All three vars are added to `sepolia.env.example` (Phase 7 stub template) as commented placeholders. Phase 7's `deploy/bootstrap.sh` stub template gets the same three keys appended (update the heredoc in bootstrap to include them so fresh VPSs get the full placeholder set — backward compatible with already-deployed VPSs since they already have non-clobber protection per Phase 7 D-19).

### Test strategy

- **D-29:** vitest unit tests:
  - `closeLogger` invokes callback within timeout even if transport never drains (simulate via fake transport).
  - `closeLogger` invokes callback immediately on successful drain.
  - `sendHeartbeat` returns without throwing on network error, timeout, and non-2xx response.
  - `sendHeartbeat` is a no-op when URL is absent or dry-run is true.
  - `sendHeartbeat` calls the `/fail` suffix URL when `summary.systemicFailure` is truthy.
  - zod config rejects non-URL `BETTERSTACK_HEARTBEAT_URL` values.
  - `runId` is a valid UUID v4 string format.
- **D-30:** No integration tests against live Betterstack — live verification is the 7-day burn-in itself (D-03).

### Dry-run semantics recap

- **D-31:** In `--dry-run`:
  - `runId` + `chainId` ARE generated and present in every log line (D-07).
  - `@logtail/pino` transport is NOT constructed (D-11).
  - `sendHeartbeat` is a no-op (D-21).
  - `closeLogger` still runs on exit (but only drains the stderr destination, which is synchronous).

### Claude's Discretion — resolved 2026-04-23

All three discretionary items picked by user on 2026-04-23:
- **DISC-01 → 10000ms** (tolerant) — folded into D-22 and D-27.
- **DISC-02 → 5000ms** — folded into D-17.
- **DISC-03 → confirmed** — rename `RunSummary.items` → `itemsFetched` proceeds per D-25.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and roadmap
- `.planning/REQUIREMENTS.md` §Observability (OBS-01..OBS-08) — the 8 crisp requirements this phase must satisfy
- `.planning/ROADMAP.md` §Phase 8 — goal statement and 5 success criteria (especially the runId/chainId filterability and the 7-day burn-in gate)
- `.planning/STATE.md` §Accumulated Context > Decisions (v1.2) — locks `@logtail/pino`, `closeLogger(cb)`, 7-day burn-in, 20min grace, email alerts

### Prior phases that Phase 8 modifies
- `.planning/phases/04-structured-logging/04-CONTEXT.md` — the original pino + stderr + redaction contract; Phase 8 extends this, does not replace it
- `.planning/phases/05-transaction-safety/05-CONTEXT.md` D-19/D-20 — the `systemicFailure` taxonomy that drives heartbeat `/fail` routing (D-19 above)
- `.planning/phases/07-packaging/07-CONTEXT.md` D-16..D-19 — sepolia.env secret delivery; Phase 8's three new env vars go through the same path without touching the Phase 7 stub-no-clobber rule

### Bot code to be extended
- `bot/src/logger.ts` — add multi-transport, `closeLogger`, new redact paths
- `bot/src/index.ts` — add `runId` generation at top of `main()`, wire `.child({ runId, chainId })`, call `sendHeartbeat` before `flushAndExit`, swap `logger.flush()` for `closeLogger()`
- `bot/src/config.ts` — add 3 new zod fields
- `bot/src/types.ts` — rename `RunSummary.items` → `itemsFetched` (D-25)
- `bot/src/heartbeat.ts` — NEW file, single-purpose HTTP ping helper

### Deployment artifacts to touch
- `deploy/bootstrap.sh` — append 3 new env var placeholders to the sepolia.env stub heredoc
- `deploy/RUNBOOK.md` — new §Betterstack (dashboard setup, alert rule config, grace period) + §Burn-in (7-day gate procedure)
- `deploy/ACCEPTANCE.md` — add a PKG-09 / OBS-equivalent section if a new acceptance item is introduced

### External library documentation (to be fetched by researcher during plan-phase)
- `@logtail/pino` — transport options, worker-thread semantics, flush/end API
- `pino` v10.3.x — `pino.transport({ targets })` multi-transport shape, async close behavior
- Betterstack Uptime heartbeat API — HTTP method (GET vs POST), suffix convention for `/fail`, expected response codes, grace period semantics

### Project-wide constraints
- `CLAUDE.md` §Bot hardening patterns — pino v10 flush is async (callback form), zod v4 bigint/coerce, systemic-vs-item failure policy, signal handlers set a flag

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `bot/src/logger.ts`: existing pino logger with `sanitizeValue`, `sanitizeObject`, `redact.paths`, `createChildLogger`, `reconfigureLogLevel`. Extend, don't replace. Add multi-transport targets and `closeLogger` alongside.
- `bot/src/index.ts`: existing `flushAndExit(code)` (line 14) — 6 call sites. Single point of replacement — swap `logger.flush` → `closeLogger`. Existing `emitSummary` (line 9) and summary emission flow is the heartbeat's attachment point.
- `bot/src/config.ts`: existing zod config pattern with `.default()`, `.optional()`, `.coerce.number()`, `.coerce.bigint()`, and redaction interaction. Extend the schema.
- `bot/src/types.ts`: `RunSummary` (line 64) — extend with rename (D-25). No new optional fields needed for Phase 8.
- `bot/test/chain.test.ts`: existing `makeReceipt`/`makeAction`/`makeIpfsResult` factory pattern for typed vitest mocks — reuse if heartbeat tests need to stub anything (they probably don't; plain `fetch` mock via vitest `vi.stubGlobal` is simpler).

### Established Patterns
- **Structured errors with `err` field:** existing `logger.error({ err: error }, "...")` pattern with `pino.stdSerializers.err`. Heartbeat failures log at `warn` level using the same shape.
- **Shutdown-flag pattern:** `ShutdownHolder` set by signal handlers, checked between actions. Phase 8 does not add new signal-handling — heartbeat runs between `emitSummary` and `flushAndExit`, outside the main action loop.
- **Conditional feature based on env presence:** `PINATA_JWT` flow (evidence upload) already guards on optional env var. Same pattern for `BETTERSTACK_SOURCE_TOKEN` and `BETTERSTACK_HEARTBEAT_URL`.
- **Dry-run gating:** `dryRun = process.argv.includes("--dry-run")` at top of `main()`. Extend to `logger.ts` module-init scope for transport gating.
- **Async-safe exit via callback:** `flushAndExit` is already the canonical pattern. `closeLogger` slots in without structural change.

### Integration Points
- `bot/src/index.ts:14-16` — `flushAndExit` definition; swap the inner call.
- `bot/src/index.ts:18-19` — top of `main()`, before config load; insert `const runId = crypto.randomUUID()` and re-root the logger via child.
- `bot/src/index.ts:138` — between `emitSummary(summary, startTime)` and `flushAndExit(...)`; call `await sendHeartbeat(summary, config)` (awaited, but bounded by D-22 timeout).
- `bot/src/logger.ts` — transport construction region (currently `pino(... , pino.destination(2))`); refactor to `pino.transport({ targets: [...] })` with conditional `@logtail/pino` target.

</code_context>

<specifics>
## Specific Ideas

- **"Observable from outside the VPS" is the whole point of this phase.** If we can't open Betterstack on a phone, see the last run, and know whether it succeeded without SSH'ing into the VPS, the phase has not landed. Every decision above serves that single test.
- **Burn-in is the acceptance gate, not a feature.** The 7-day Sepolia burn-in is how we validate Phases 4+5+6+7+8 together end-to-end in production-like conditions before touching Mainnet. Don't conflate "Phase 8 verification" with "burn-in complete."
- **Log lines and heartbeats are two independent signals.** Heartbeat says "the timer fired and the bot reached the end of main()." Log lines say "here is what happened during that run." Either can fail without the other — both failing simultaneously is the only pattern that should escalate to "bot is broken."

</specifics>

<deferred>
## Deferred Ideas

- **PagerDuty/Slack escalation** — explicitly not in v1.2 per D-04. Email-only alerts during burn-in + early Mainnet. Revisit in v1.3 once we have incident frequency data.
- **Synthetic burn-in check script** — could automate the "7+ clean heartbeats" verification via Betterstack API query. v1.2 keeps it manual (operator reads the Betterstack dashboard and ticks a checkbox in RUNBOOK). Automate in v1.3.
- **Logging to multiple observability vendors** — Betterstack only for v1.2. If vendor-diversification ever matters (unlikely at our scale), pino's multi-transport already supports adding targets.
- **Per-action log context** — currently each action emits a separate log line with `agentId` but not an `actionId`. Would help correlate upload + submit + receipt lines into a single action trace. Out of Phase 8 scope; track for v1.3 if the burn-in surfaces a debugging pain point.
- **Structured query saved searches in Betterstack** — could pre-populate "last 24h errors", "last 24h systemic failures", "last 7d runs grouped by exit code" saved queries. v1.2 RUNBOOK documents the raw queries; operators can save them manually. Revisit if query friction shows up.
- **Heartbeat health metrics** — tracking heartbeat send success/failure rate over time as a secondary signal. Out of scope; if it matters later, pino transport ships error counts automatically once we wire the warning logs.

</deferred>

---

*Phase: 08-observability*
*Context gathered: 2026-04-23 (non-interactive — Telegram MCP disconnect prevented interactive questioning; user to review Claude's Discretion items DISC-01, DISC-02, DISC-03 before `/gsd:plan-phase 8`)*
