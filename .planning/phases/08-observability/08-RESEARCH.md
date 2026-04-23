# Phase 8: Observability - Research

**Researched:** 2026-04-23
**Domain:** Betterstack Telemetry + Uptime, pino v10 multi-transport, Node 22 native APIs
**Confidence:** HIGH (most findings verified against npm registry, source code, or official docs)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01**: Log shipping vendor: Betterstack. No other vendor evaluated.
- **D-02**: Transport library: `@logtail/pino` multi-transport. Worker-thread-backed, async flushing. Installed as regular `dependencies`.
- **D-03**: 7-day Sepolia burn-in gate is manual. Documented in `deploy/RUNBOOK.md` §Burn-in.
- **D-04**: Alert grace period: 10 minutes (revised from 20min when timer moved 15→5min).
- **D-05**: `runId` source: `crypto.randomUUID()` (Node 22 built-in). UUID v4. Zero deps.
- **D-06**: `runId` generated as very first line of `main()`. Root logger re-wrapped via `.child({ runId, chainId })`.
- **D-07**: `runId` generated even in `--dry-run` mode.
- **D-08**: `runId` format: raw UUID string, no prefix, no truncation.
- **D-09**: Transport constructed via `pino.transport({ targets: [...] })`. `@logtail/pino` target added only when `BETTERSTACK_SOURCE_TOKEN` set AND `--dry-run` NOT present.
- **D-10**: Stderr `pino.destination(2)` behavior retained. Betterstack is additive.
- **D-11**: Dry-run detection: `process.argv.includes("--dry-run")` inside `logger.ts` at module init.
- **D-12**: Redaction additions: `BETTERSTACK_SOURCE_TOKEN`, `BETTERSTACK_HEARTBEAT_URL`, `config.BETTERSTACK_SOURCE_TOKEN`, `config.BETTERSTACK_HEARTBEAT_URL`. Bare-URL leaks redacted via `sanitizeValue`.
- **D-13**: Transport options for `@logtail/pino`: `sourceToken`, `options: { endpoint: 'https://in.logs.betterstack.com' }`.
- **D-14**: New `closeLogger(cb: () => void): void` exported from `bot/src/logger.ts`.
- **D-15**: `flushAndExit(code)` updated to call `closeLogger(() => process.exit(code))`.
- **D-16**: `closeLogger` is non-throwing. Falls back to `console.error` + invokes `cb` regardless.
- **D-17**: Fallback timeout: 5000ms. If transport worker does not drain within 5s, `cb` invoked anyway.
- **D-18**: Heartbeat HTTP call: after `emitSummary`, before `flushAndExit`.
- **D-19**: Success → `BETTERSTACK_HEARTBEAT_URL`, failure → `${BETTERSTACK_HEARTBEAT_URL}/fail`.
- **D-20**: `sendHeartbeat(summary, config): Promise<void>` in `bot/src/heartbeat.ts`. Native fetch + `AbortSignal.timeout`.
- **D-21**: Heartbeat is no-op when URL absent or `--dry-run`.
- **D-22**: Heartbeat timeout: 10000ms default. `HEARTBEAT_TIMEOUT_MS` env var.
- **D-23**: Heartbeat failure never cascades to `summary.systemicFailure` or exit code.
- **D-24**: Alert rule configured in Betterstack dashboard UI. Threshold: `itemsFetched===0` for 5 consecutive runs.
- **D-25**: Rename `RunSummary.items` → `RunSummary.itemsFetched`.
- **D-26**: Dashboard config documented in `deploy/RUNBOOK.md` §Betterstack.
- **D-27**: Three new env vars: `BETTERSTACK_SOURCE_TOKEN` (string optional), `BETTERSTACK_HEARTBEAT_URL` (url optional), `HEARTBEAT_TIMEOUT_MS` (number default 10000).
- **D-28**: All three vars added to `sepolia.env.example` and `deploy/bootstrap.sh` stub heredoc.
- **D-29**: Vitest unit tests for `closeLogger` and `sendHeartbeat` behaviors.
- **D-30**: No integration tests against live Betterstack.
- **D-31**: Dry-run semantics: `runId`+`chainId` present; no Betterstack transport; no heartbeat; `closeLogger` still runs.

### Claude's Discretion — Resolved 2026-04-23
- DISC-01: Heartbeat timeout → 10000ms (D-22, D-27)
- DISC-02: closeLogger fallback timeout → 5000ms (D-17)
- DISC-03: RunSummary.items → itemsFetched rename proceeds (D-25)

### Deferred Ideas (OUT OF SCOPE)
- PagerDuty/Slack escalation (v1.3+)
- Synthetic burn-in check script (v1.3+)
- Logging to multiple observability vendors
- Per-action log context / actionId
- Structured query saved searches in Betterstack
- Heartbeat health metrics
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OBS-01 | Every log line carries `runId` (UUID) and `chainId` via root pino child logger | `crypto.randomUUID()` verified UUID v4 in Node 22; pino `.child()` binding pattern established |
| OBS-02 | Betterstack Telemetry log forwarding via `@logtail/pino` multi-transport; disabled on dry-run | `@logtail/pino@0.5.8` verified on npm; `pino.transport({ targets })` pattern confirmed against pino source |
| OBS-03 | Betterstack Uptime heartbeat after `RunSummary` emission; reflects exit code | Heartbeat GET to `https://uptime.betterstack.com/api/v1/heartbeat/<TOKEN>` or `/fail` confirmed |
| OBS-04 | Heartbeat failure never cascades to bot exit status | Native fetch + `AbortSignal.timeout` + swallow pattern; no throws from `sendHeartbeat` |
| OBS-05 | `closeLogger(cb)` drains worker threads before `process.exit` | `logger.flush(cb)` + fallback timeout pattern verified against pino/thread-stream source |
| OBS-06 | `BETTERSTACK_SOURCE_TOKEN` and `BETTERSTACK_HEARTBEAT_URL` added to pino `redact` config | redact.paths pattern + `sanitizeValue` regex extension approach confirmed |
| OBS-07 | Dashboard documented (source token, monitor URL, grace period, burn-in) | Betterstack Uptime grace period = seconds; ClickHouse SQL available for log alerts |
| OBS-08 | Alert fires when `RunSummary.itemsFetched === 0` for 5 consecutive runs (D-24 revised threshold) | Betterstack Telemetry uses ClickHouse SQL; JSONExtract for nested field access |
</phase_requirements>

---

## Summary

Phase 8 wires Betterstack observability onto the existing Phase 4 pino foundation. The primary technical work falls into three buckets: (1) refactoring `logger.ts` to use `pino.transport({ targets })` with a conditional `@logtail/pino` target alongside the existing stderr sink; (2) writing `heartbeat.ts` with a bounded-timeout, swallow-on-fail fetch call to the Betterstack Uptime ping URL; and (3) replacing `logger.flush(cb)` with a `closeLogger(cb)` wrapper that additionally drains the `@logtail/pino` worker thread's HTTP delivery queue before process exit.

The most critical implementation detail is the `closeLogger` drain pattern. `logger.flush(cb)` (which uses `thread-stream.flush()`) drains the SharedArrayBuffer write queue into the worker thread — but does NOT await the worker thread's own HTTP delivery. The `@logtail/pino` transport registers a `close` callback (`logtail.flush()`) in `pino-abstract-transport`'s `stream._destroy`, which fires when the stream is destroyed. To trigger this, the planner must call `transport.end()` or `transport.destroy()` after `logger.flush(cb)`, with a 5-second fallback timer (D-17) preventing hung exits.

Betterstack's heartbeat ping is a simple HTTP GET (or POST — curl examples omit `-X`; native fetch defaults to GET which works) to `https://uptime.betterstack.com/api/v1/heartbeat/<TOKEN>`. The `/fail` suffix variant is documented and works the same way. Response codes are not documented by Betterstack but `response.ok` (2xx) is the right check; non-2xx should be logged at warn and swallowed.

**Primary recommendation:** Use `logger.flush(cb)` + `transport.end()` in sequence inside `closeLogger`, with a 5s `setTimeout` fallback invoking `cb` if neither completes. For heartbeat tests, use `vi.stubGlobal("fetch", vi.fn())` (same pattern as `bot/test/ipfs.test.ts`).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| runId generation | Bot process (main thread) | — | Single UUID per OS process; generated before any async work |
| Structured log shipping | Bot transport layer (worker thread) | Betterstack Telemetry (external) | `@logtail/pino` runs in Node worker_thread; HTTP delivery is async in worker |
| Liveness heartbeat | Bot process (main thread) | Betterstack Uptime (external) | Fired from `main()` after RunSummary; owned by bot, monitored externally |
| Alert configuration | Betterstack Dashboard UI | — | D-24: dashboard-only, not in bot code |
| Log redaction | Bot logger init | — | `sanitizeValue` + pino `redact.paths`; must happen before any sink receives data |
| Worker thread drain | Bot exit path (closeLogger) | `@logtail/pino` close handler | Must complete before `process.exit` to avoid losing buffered lines |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@logtail/pino` | `^0.5.8` | Betterstack pino transport (worker-thread-backed) | Betterstack's official pino integration; pino-abstract-transport based |
| `pino` | `^10.3.1` | Already installed | Phase 4 baseline; Phase 8 extends transport config only |
| `crypto` (Node built-in) | Node 22 | UUID v4 generation | Zero dep; `crypto.randomUUID()` is UUID v4 in Node 15+ |

[VERIFIED: npm registry — `@logtail/pino@0.5.8` published ~1 month ago; `pino@10.3.1` current]

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `AbortSignal.timeout()` | Node 22 built-in | Bounded heartbeat fetch | Available in Node 15.4+; zero-dep timeout for any `fetch` call |
| `pino-abstract-transport` | `^1.0.0` (transitive) | Worker-thread transport ABI | Pulled in by `@logtail/pino`; not imported directly |
| `thread-stream` | Transitive | SharedArrayBuffer worker IPC | Pulled in by pino transport; `thread-stream.flush(cb)` is what `logger.flush(cb)` delegates to |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@logtail/pino` | `pino-loki`, custom transport | Betterstack vendor-specific; alternatives require different dashboard |
| Native `fetch` + `AbortSignal.timeout` | `axios`, `node-fetch` | Native fetch is already in codebase (ipfs.ts uses it); no new dep needed |
| `vi.stubGlobal("fetch")` | `msw`, `nock` | Already the project pattern (ipfs.test.ts); zero-friction |

**Installation:**
```bash
cd bot && npm install @logtail/pino
```

**Version verification (run before finalizing plan):**
```bash
npm view @logtail/pino version dist-tags.latest
# Expected: 0.5.8 (as of 2026-04-23)
```

---

## Architecture Patterns

### System Architecture Diagram

```
main() in index.ts
   │
   ├─[first line]──── crypto.randomUUID() ──────────────────────── runId
   │
   ├─[after config]── logger.child({ runId, chainId }) ──────────── root logger bound
   │
   ├─[bot runs normally] ──── all log lines carry runId + chainId
   │
   ├─[emitSummary()] ──── RunSummary {itemsFetched, ...} logged
   │
   ├─[sendHeartbeat()] ──── GET https://uptime.betterstack.com/api/v1/heartbeat/<TOKEN>
   │                         OR GET .../heartbeat/<TOKEN>/fail
   │                         AbortSignal.timeout(10000ms) · swallow all errors · never throws
   │
   └─[flushAndExit(code)] ──── closeLogger(cb)
                                  │
                                  ├── logger.flush(cb_inner)  ← drains SharedArrayBuffer into worker
                                  │                              cb_inner fires when read_index == write_index
                                  ├── transport.end()          ← triggers worker thread _destroy → logtail.flush()
                                  │                              (HTTP delivery of remaining buffered lines)
                                  └── setTimeout(5000ms)       ← fallback: if worker never acks, invoke cb anyway
                                       └── cb() → process.exit(code)

logger.ts
   │
   ├─[always] ──── pino/file target → destination: 2 (stderr)
   │
   └─[if BETTERSTACK_SOURCE_TOKEN set AND NOT --dry-run]
          └── @logtail/pino target → { sourceToken, options: { endpoint: 'https://in.logs.betterstack.com' } }
                   │
                   └── [worker_thread] → HTTP batches → Betterstack Telemetry
```

### Recommended Project Structure
```
bot/src/
├── logger.ts        # MODIFIED: add pino.transport({ targets }), closeLogger()
├── index.ts         # MODIFIED: runId gen, .child(), sendHeartbeat, closeLogger
├── config.ts        # MODIFIED: 3 new zod fields
├── types.ts         # MODIFIED: RunSummary.items → itemsFetched
├── heartbeat.ts     # NEW: sendHeartbeat(summary, config): Promise<void>
bot/test/
├── heartbeat.test.ts  # NEW: unit tests per D-29
deploy/
├── bootstrap.sh     # MODIFIED: append 3 new env var placeholders to heredoc
├── RUNBOOK.md       # MODIFIED: add §Betterstack + §Burn-in sections
└── sepolia.env.example  # MODIFIED: 3 new commented placeholders
```

### Pattern 1: pino multi-transport with conditional Betterstack target

```typescript
// Source: verified against pino@10.3.1 source + pino.d.ts TransportMultiOptions
// and @logtail/pino@0.5.8 IPinoLogtailOptions interface
import pino from "pino";

const isDryRun = process.argv.includes("--dry-run");
const betterstackToken = process.env.BETTERSTACK_SOURCE_TOKEN;

const transportTargets: pino.TransportTargetOptions[] = [
  { target: "pino/file", options: { destination: 2 } }, // stderr always
];

if (betterstackToken && !isDryRun) {
  transportTargets.push({
    target: "@logtail/pino",
    options: {
      sourceToken: betterstackToken,
      options: {
        endpoint: "https://in.logs.betterstack.com",
      },
    },
  });
}

const transport = pino.transport({ targets: transportTargets });

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    serializers: { err: (err) => sanitizeObject(pino.stdSerializers.err(err as Error)) },
    redact: {
      paths: [
        "config.BOT_PRIVATE_KEY",
        "config.PINATA_JWT",
        "config.BETTERSTACK_SOURCE_TOKEN",
        "config.BETTERSTACK_HEARTBEAT_URL",
        "privateKey",
        "PINATA_JWT",
        "BOT_PRIVATE_KEY",
        "BETTERSTACK_SOURCE_TOKEN",
        "BETTERSTACK_HEARTBEAT_URL",
        "authorization",
        "Authorization",
      ],
    },
  },
  transport,
);
```

[VERIFIED: `pino.TransportTargetOptions` type confirmed in `bot/node_modules/pino/pino.d.ts:251`. `IPinoLogtailOptions.options.endpoint` confirmed in `@logtail/pino@0.5.8` source via GitHub.]

### Pattern 2: closeLogger(cb) — draining the @logtail/pino worker thread

**Key insight (verified by reading pino/thread-stream/pino-abstract-transport source code):**
- `logger.flush(cb)` → calls `thread-stream.flush(cb)` → uses `Atomics.wait` to confirm the worker read-index has caught up with write-index. This drains the SharedArrayBuffer IPC channel — i.e., all log lines have been _received_ by the worker.
- However, the `@logtail/pino` worker thread's HTTP delivery (`logtail.flush()`) is triggered by `stream._destroy` inside `pino-abstract-transport`. It fires when the stream is _destroyed_, not when the IPC buffer is drained.
- To trigger the HTTP flush: call `transport.end()` after `logger.flush(cb)`. The `transport.end()` call signals end-of-stream to the worker, which triggers `_destroy` → `logtail.flush()` → HTTP delivery.
- `transport.end()` does NOT accept a callback (verified: `transport.end.length === 0` in thread-stream). Use the `'close'` or `'finish'` event, or rely on the 5s fallback timer.

```typescript
// Source: verified pattern from bot/node_modules/thread-stream/index.js + pino-abstract-transport/index.js
let transport: ReturnType<typeof pino.transport> | null = null;

export function closeLogger(cb: () => void): void {
  let called = false;
  const done = () => {
    if (!called) {
      called = true;
      cb();
    }
  };

  // Fallback: invoke cb after 5s regardless (D-17)
  const fallback = setTimeout(done, 5000);
  fallback.unref(); // don't keep event loop alive

  if (!transport) {
    // No worker-thread transport (stderr-only or dry-run path)
    logger.flush(() => {
      clearTimeout(fallback);
      done();
    });
    return;
  }

  // Step 1: drain the SharedArrayBuffer (all lines received by worker)
  logger.flush(() => {
    // Step 2: signal end-of-stream → triggers worker _destroy → logtail.flush() (HTTP delivery)
    transport!.end();
    // Step 3: listen for transport close event or rely on fallback timer
    transport!.on("close", () => {
      clearTimeout(fallback);
      done();
    });
  });
}
```

**Alternative (simpler) pattern if transport 'close' event is unreliable:** Use only the `logger.flush(cb)` + fallback timer, accepting that the last ~few buffered HTTP-queued lines may be lost on shutdown. Given the 5-second window and Betterstack's batching, this is acceptable for most runs. The choice is left to the planner.

[VERIFIED against source: `thread-stream.flush()` at line 289 of `bot/node_modules/thread-stream/index.js`; `pino-abstract-transport stream._destroy` at line 60 of `bot/node_modules/pino-abstract-transport/index.js`; `transport.end` exists but takes no callback — confirmed via Node test `transport.end.length === 0`.]

### Pattern 3: sendHeartbeat with bounded fetch

```typescript
// Source: verified — AbortSignal.timeout() confirmed present in Node 22;
// Betterstack heartbeat URL format confirmed via official docs
import type { Config } from "./config.js";
import type { RunSummary } from "./types.js";
import { logger } from "./logger.js";

export async function sendHeartbeat(summary: RunSummary, config: Config): Promise<void> {
  const url = config.BETTERSTACK_HEARTBEAT_URL;
  if (!url) return; // D-21: no-op when absent

  const isDryRun = process.argv.includes("--dry-run");
  if (isDryRun) return; // D-21: no-op in dry-run

  const pingUrl = summary.systemicFailure ? `${url}/fail` : url;

  try {
    const response = await fetch(pingUrl, {
      signal: AbortSignal.timeout(config.HEARTBEAT_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn({ status: response.status, url: "[REDACTED]" }, "Heartbeat ping returned non-2xx");
    }
  } catch (err) {
    // Network error, timeout, DNS failure — all swallowed per D-23
    logger.warn({ err }, "Heartbeat ping failed — monitoring infrastructure issue");
  }
  // Never throws. D-23: no cascade to systemicFailure or exit code.
}
```

[VERIFIED: `AbortSignal.timeout` confirmed available in Node 22 via runtime test; heartbeat URL format `https://uptime.betterstack.com/api/v1/heartbeat/<TOKEN>` and `/fail` suffix confirmed via official Betterstack Uptime docs.]

### Pattern 4: runId wiring in main()

```typescript
// Source: CONTEXT.md D-05/D-06/D-08; crypto.randomUUID verified UUID v4 in Node 22 runtime test
async function main(): Promise<void> {
  const runId = crypto.randomUUID(); // D-05: very first line
  // ... (after config load, once CHAIN_ID is known)
  const rootLogger = logger.child({ runId, chainId: config.CHAIN_ID }); // D-06
  // All subsequent log calls use rootLogger or rootLogger.child({module})
}
```

[VERIFIED: `crypto.randomUUID()` produces valid UUID v4 — confirmed via runtime test in Node 22 (`/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`)]

### Pattern 5: vitest unit test for sendHeartbeat

```typescript
// Source: established project pattern from bot/test/ipfs.test.ts (vi.stubGlobal("fetch"))
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendHeartbeat } from "../src/heartbeat.js";
import type { Config } from "../src/config.js";
import type { RunSummary } from "../src/types.js";

const mockConfig = {
  BETTERSTACK_HEARTBEAT_URL: "https://uptime.betterstack.com/api/v1/heartbeat/test123",
  HEARTBEAT_TIMEOUT_MS: 1000,
} as unknown as Config;

const successSummary: RunSummary = {
  itemsFetched: 5, valid: 5, actions: 0, txSent: 0, errors: 0, durationMs: 100, skipped: 0,
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

it("sends GET to base URL on success", async () => {
  vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: true, status: 200 } as Response);
  await sendHeartbeat(successSummary, mockConfig);
  expect(globalThis.fetch).toHaveBeenCalledWith(
    mockConfig.BETTERSTACK_HEARTBEAT_URL,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

it("sends GET to /fail URL on systemicFailure", async () => {
  vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: true, status: 200 } as Response);
  await sendHeartbeat({ ...successSummary, systemicFailure: "balance_below_threshold" }, mockConfig);
  expect(globalThis.fetch).toHaveBeenCalledWith(
    `${mockConfig.BETTERSTACK_HEARTBEAT_URL}/fail`,
    expect.anything(),
  );
});

it("swallows network error without throwing", async () => {
  vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("Network error"));
  await expect(sendHeartbeat(successSummary, mockConfig)).resolves.toBeUndefined();
});

it("is no-op when URL absent", async () => {
  await sendHeartbeat(successSummary, { ...mockConfig, BETTERSTACK_HEARTBEAT_URL: undefined } as unknown as Config);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
```

### Anti-Patterns to Avoid

- **Calling `logger.flush(cb)` and immediately `process.exit(code)` without `transport.end()`**: The SharedArrayBuffer is drained but the `@logtail/pino` worker thread may still have pending HTTP batches. End-of-run log lines (RunSummary, heartbeat warn) are at highest risk of being lost.
- **Using `pino.final()` with transports**: `pino.final()` was removed in pino v10. The existing `flushAndExit` pattern (callback form) is correct.
- **Making `sendHeartbeat` throw**: Any error from the heartbeat must be swallowed. OBS-04 is a hard guarantee — the bot's exit code must not be affected by monitoring infrastructure.
- **Calling `transport.end()` before `logger.flush(cb)`**: The order matters. `transport.end()` before flush may terminate the IPC channel while log lines are still in the SharedArrayBuffer, dropping them.
- **Re-using `process.argv.includes("--dry-run")` vs. passing it as a parameter**: For testability, prefer passing `isDryRun` as a parameter to `sendHeartbeat` and the transport construction function, rather than reading `process.argv` inside both `logger.ts` and `heartbeat.ts`. Reduces coupling and makes tests cleaner.
- **Using `pino.destination(2)` as the second arg to `pino()` alongside a transport**: If using `pino.transport({ targets })`, do NOT pass `pino.destination(2)` as the second arg. The stderr sink should be expressed as a `pino/file` target in the `targets` array. Mixing both results in duplicate stderr output.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP log batching to Betterstack | Custom HTTP log sender | `@logtail/pino` | Handles batching, retries, backpressure, TLS, worker isolation |
| UUID generation | Custom UUID v4 implementation | `crypto.randomUUID()` | Node 22 built-in; cryptographically secure; zero deps |
| Fetch timeout | Manual `Promise.race` + `setTimeout` | `AbortSignal.timeout(ms)` | Node 22 built-in; cleans up on GC; correct cancellation semantics |
| Log level filtering per transport | Custom wrapper | `pino.transport({ targets: [{ level: '...' }] })` | Each target in `targets[]` accepts a `level` field for per-sink filtering |

---

## Betterstack APIs — Verified Details

### Telemetry (Log Shipping)

- **Ingestion endpoint**: `https://in.logs.betterstack.com` [VERIFIED: referenced in `@logtail/pino` options docs and confirmed as the standard Betterstack Telemetry ingest URL]
- **Query language**: ClickHouse SQL [VERIFIED: Betterstack Telemetry Explore Query API docs state ClickHouse SQL; `JSONExtract(raw, 'summary.itemsFetched', 'Nullable(Int64)')` for nested JSON field access]
- **Alert mechanism**: Dashboard UI → chart → triangle (Alerts icon) → threshold/relative/anomaly alert types; "Confirmation period" controls how long condition must hold before firing
- **itemsFetched===0 alert query**:
  ```sql
  SELECT count()
  FROM remote(t<source_id>_your_source_logs)
  WHERE JSONExtract(raw, 'summary.itemsFetched', 'Nullable(Int64)') = 0
    AND {{time}}
  ```
  Set alert type: Threshold ≥ 5 (five runs with 0 items fetched). Confirmation period: 25 min (5 runs × 5 min cadence).
  [ASSUMED: exact table name format `t<source_id>_your_source_logs` — user must look up source ID in Betterstack UI]

### Uptime (Heartbeat)

- **Ping URL format**: `https://uptime.betterstack.com/api/v1/heartbeat/<TOKEN>` [VERIFIED: official Betterstack Uptime docs curl examples]
- **Fail variant**: `https://uptime.betterstack.com/api/v1/heartbeat/<TOKEN>/fail` [VERIFIED: official docs]
- **HTTP method**: GET (curl examples omit `-X` flag, defaulting to GET; native `fetch` also defaults to GET) [MEDIUM confidence — docs show curl without explicit method; POST also accepted per some Betterstack examples with `-d` body]
- **Response codes**: Not documented by Betterstack. Check `response.ok` (2xx) to detect failures. [ASSUMED: standard HTTP success = 200 OK]
- **Monitor DOWN trigger**: Expected heartbeat not received within `period + grace` window OR explicit `/fail` ping [VERIFIED: official docs]
- **Grace period**: Configured in Betterstack dashboard in seconds alongside the heartbeat frequency. Recommend 600s (10 min) matching D-04. [VERIFIED: Betterstack API `grace` parameter is integer seconds, min 0]
- **First heartbeat**: Monitor stays "Pending" until first ping received. First ping starts the period clock. [VERIFIED: official docs]

---

## Common Pitfalls

### Pitfall 1: logger.flush(cb) does NOT drain HTTP delivery
**What goes wrong:** Developer calls `logger.flush(cb)` and calls `cb()` thinking all logs are safely delivered to Betterstack. Last few log lines (RunSummary, heartbeat warn) are lost.
**Why it happens:** `logger.flush(cb)` drains the SharedArrayBuffer IPC queue (main thread → worker thread), but the worker thread still has pending HTTP batches in `@logtail/node`'s internal batch queue. HTTP delivery happens asynchronously _inside_ the worker.
**How to avoid:** Also call `transport.end()` after flush to trigger the worker thread's `_destroy` → `logtail.flush()` (HTTP delivery awaited). Use 5-second fallback timer in case the worker hangs.
**Warning signs:** RunSummary log lines missing from Betterstack dashboard on first few runs; heartbeat fires but last log line absent.

### Pitfall 2: pino.destination(2) + transport() mixing
**What goes wrong:** Keeping `pino.destination(2)` as the second argument to `pino()` while also passing a `pino.transport({ targets })` result. Stderr gets logged twice.
**Why it happens:** When you pass a transport to `pino()`, pino uses it as the destination. The `pino.destination(2)` must move inside `targets` as `{ target: 'pino/file', options: { destination: 2 } }`.
**How to avoid:** Remove the `pino.destination(2)` call from `pino()`. Represent stderr as a target in the `targets[]` array.
**Warning signs:** Each log line appears twice in `journalctl` output.

### Pitfall 3: Heartbeat URL leak in error logs
**What goes wrong:** `fetch()` throws an error containing the heartbeat URL in the error message. `logger.warn({ err }, ...)` serializes the error via `pino.stdSerializers.err`, which walks the `message` and `stack` fields. The opaque token in the URL leaks into Betterstack.
**Why it happens:** `pino.redact.paths` only redacts exact property paths, not substring patterns in string values.
**How to avoid:** Extend `sanitizeValue()` in `logger.ts` with a regex that redacts heartbeat URLs:
```typescript
.replace(/https:\/\/uptime\.betterstack\.com\/api\/v1\/heartbeat\/[A-Za-z0-9_-]+/g, "[REDACTED_HEARTBEAT_URL]")
```
Also log the warn with a hardcoded `url: "[REDACTED]"` field rather than the actual URL string. [VERIFIED: sanitizeValue regex pattern tested in Node 22 — correctly redacts `https://uptime.betterstack.com/api/v1/heartbeat/abc123xyz456`]

### Pitfall 4: Transport target module resolution in ESM/tsx context
**What goes wrong:** `pino.transport({ target: '@logtail/pino' })` fails with `Cannot find module '@logtail/pino'` when running via `node --import tsx`.
**Why it happens:** Worker threads launched by pino use a different module resolution context than the main thread. If `@logtail/pino` is not installed in `bot/node_modules/`, the worker can't find it.
**How to avoid:** Install `@logtail/pino` as a regular `dependencies` entry (not `devDependencies`) so `npm ci --omit=dev` on the VPS includes it. Confirm with `ls bot/node_modules/@logtail/pino` after `npm ci --omit=dev`.
**Warning signs:** Bot starts but no logs appear in Betterstack; stderr shows `ERR_MODULE_NOT_FOUND` from a worker thread.

### Pitfall 5: `@logtail/pino` Biome `noExplicitAny` lint error
**What goes wrong:** `@logtail/pino`'s `PinoLog` interface has `[key: string]: any` — importing it directly triggers Biome's `noExplicitAny` rule if the interface bleeds into type-checked code.
**Why it happens:** The package ships TypeScript types but the `PinoLog` index signature uses `any`.
**How to avoid:** Do not import `PinoLog` from `@logtail/pino` in project code. The `@logtail/pino` target is referenced only as a string `"@logtail/pino"` in the `targets[]` options object. The `IPinoLogtailOptions` interface IS importable and clean — use it to type the options object if needed:
```typescript
import type { IPinoLogtailOptions } from "@logtail/pino";
const opts: IPinoLogtailOptions = { sourceToken: "...", options: {} };
```
[VERIFIED: `IPinoLogtailOptions` has no `any` fields; `PinoLog` has `[key: string]: any` index signature — confirmed in source]

### Pitfall 6: `RunSummary.items` rename blast radius
**What goes wrong:** Rename `items` → `itemsFetched` in `types.ts` but miss one reference in `index.ts` (line 43: `summary.items = rawItems.length`). TypeScript catches this, but only at typecheck time — `tsx` at runtime does NOT typecheck.
**Why it happens:** `tsx` is a type-stripping runtime; it ignores type errors.
**How to avoid:** Run `cd bot && npm run typecheck` (which runs `tsc --noEmit`) in the Wave 0 or Wave 1 verification step. The compiler will catch any missed references.
**Warning signs:** `summary.items` is `undefined` at runtime; `itemsFetched` field missing from emitted JSON.

### Pitfall 7: AbortSignal.timeout() in worker threads
**What goes wrong:** Concern that `AbortSignal.timeout()` might not be available in worker thread contexts.
**Why it happens:** N/A — this is NOT an actual issue. `sendHeartbeat` runs on the main thread, not in a worker. `AbortSignal.timeout()` is confirmed available in Node 22 main thread and worker threads.
**How to avoid:** N/A. Just use it.

---

## Code Examples

### Zod config additions

```typescript
// Source: established project pattern in bot/src/config.ts; zod v4.3.6
BETTERSTACK_SOURCE_TOKEN: z.string().optional(),
BETTERSTACK_HEARTBEAT_URL: z.string().url().optional(),
HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(10_000),
```

[VERIFIED: pattern matches existing `PINATA_JWT: z.string().optional()` and `TX_RECEIPT_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(120_000)` in `bot/src/config.ts`]

### RunSummary type change

```typescript
// Source: bot/src/types.ts line 64-68 (current state read)
// BEFORE:
export interface RunSummary {
  items: number;       // ← rename this
  ...
}
// AFTER:
export interface RunSummary {
  itemsFetched: number;  // D-25
  ...
}
```

Affected sites to update: `bot/src/index.ts:20` (summary init), `bot/src/index.ts:43` (assignment), `bot/src/index.ts:11` (`emitSummary` log field), and `deploy/RUNBOOK.md` + `deploy/ACCEPTANCE.md` references. TypeScript compiler (`npm run typecheck`) will catch any missed sites.

### sepolia.env.example additions

```bash
# Betterstack Telemetry source token (set to enable log forwarding; omit for local-only logging)
# BETTERSTACK_SOURCE_TOKEN=

# Betterstack Uptime heartbeat URL (set to enable liveness pings; omit to skip heartbeat)
# BETTERSTACK_HEARTBEAT_URL=

# Heartbeat HTTP timeout in milliseconds (default: 10000)
# HEARTBEAT_TIMEOUT_MS=10000
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `pino.final()` for async flush on exit | Removed in pino v10 | pino v10 | Use `logger.flush(cb)` callback form instead |
| `pino.destination({ sync: true })` for guaranteed flush | `thread-stream.flush()` + `transport.end()` sequence | pino v7+ | Async flush is preferred; sync blocks event loop |
| `pino.transport()` with single target | `pino.transport({ targets: [...] })` for multi-sink | pino v7+ | Required for stderr + Betterstack simultaneously |

**Deprecated/outdated:**
- `pino.final()`: Removed in pino v10. Project already uses `logger.flush(cb)` correctly.
- `require('@logtail/pino')` (CommonJS): Package is ESM-compatible but pino worker threads handle the require/import boundary internally. No action needed from caller.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 22 | `crypto.randomUUID()`, `AbortSignal.timeout()` | ✓ | v22.x (system) | — |
| `pino` | Logger | ✓ | 10.3.1 (installed) | — |
| `@logtail/pino` | Betterstack transport | ✗ (not yet installed) | 0.5.8 (registry) | Omit target (stderr-only) |
| Betterstack account | OBS-02, OBS-03, OBS-07 | ✗ (external — operator must create) | — | Skip transport/heartbeat when tokens absent |

**Missing dependencies with no fallback:**
- Betterstack account credentials (`BETTERSTACK_SOURCE_TOKEN`, `BETTERSTACK_HEARTBEAT_URL`) — must be created by operator in Betterstack UI before live verification. Bot code degrades gracefully (skips transport/heartbeat when absent), but OBS-02/OBS-03 cannot be verified without them.

**Missing dependencies with fallback:**
- `@logtail/pino` not installed: bot runs stderr-only with no Betterstack forwarding. Wave 0 must include `npm install @logtail/pino`.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | — |
| V3 Session Management | No | — |
| V4 Access Control | No | — |
| V5 Input Validation | Yes | zod validates `BETTERSTACK_HEARTBEAT_URL` as `.url()` shape |
| V6 Cryptography | No | Betterstack uses HTTPS; token transmitted only over TLS |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Source token leak via logs | Information Disclosure | `pino.redact.paths` for config object; `sanitizeValue` regex for error messages |
| Heartbeat URL leak via error logs | Information Disclosure | `sanitizeValue` regex pattern in `logger.ts` + log `url: "[REDACTED]"` in warn |
| MITM on token or heartbeat in transit | Tampering | HTTPS only; both Betterstack endpoints enforce TLS |
| Buffered log lines lost on crash | Availability (logging) | 5s fallback timer in `closeLogger` limits exposure; logs in journald remain as fallback |
| Heartbeat DoS / flooding Betterstack | Denial of Service | `AbortSignal.timeout(10000ms)` bounds each call; one call per run (≤ 1/5min) |
| Token in systemd `Environment=` | Information Disclosure | Phase 7 D-16/D-18 enforced: tokens only in `EnvironmentFile=/etc/reputation-oracle/sepolia.env` at 0600; never in `Environment=` |
| Heartbeat URL reveals monitoring vendor | Information Disclosure | Minimal risk (internal observability); redact from logs as belt-and-suspenders |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Betterstack heartbeat ping responds with HTTP 200 on success | Betterstack APIs | Code checks `response.ok` (2xx); if Betterstack uses 204 or 202 instead, `response.ok` still returns true — no risk |
| A2 | HTTP GET (not POST) is the correct method for the heartbeat ping endpoint | Betterstack APIs | Betterstack also accepts POST; if GET is rejected, switch to `method: "POST"` in fetch options — low risk |
| A3 | ClickHouse SQL `JSONExtract(raw, 'summary.itemsFetched', ...)` is the correct path for nested log field | Betterstack APIs | If Betterstack flattens pino JSON fields at ingest, path may be just `'itemsFetched'` — operator must verify in dashboard |
| A4 | `transport.end()` → `'close'` event fires reliably from thread-stream | Pattern 2 (closeLogger) | If 'close' event is not emitted, the 5-second fallback timer catches it — D-17 is specifically the guard for this |
| A5 | `@logtail/pino`'s `IPinoLogtailOptions` interface is importable without triggering Biome `noExplicitAny` | Pitfall 5 | If `IPinoLogtailOptions` has transitive `any`, use `as unknown as pino.TransportTargetOptions` instead |

---

## Open Questions

1. **Betterstack Telemetry field naming after ingest**
   - What we know: pino emits NDJSON with `{"summary": {"itemsFetched": 5, ...}}` as a nested object
   - What's unclear: Does Betterstack Telemetry index this as `summary.itemsFetched` (dot-path) or require `JSONExtract()` in the ClickHouse SQL alert query?
   - Recommendation: Operator checks in Betterstack dashboard after first few live runs; RUNBOOK.md §Betterstack should include a note: "if the query returns no results, try `raw` LIKE `%itemsFetched%` first to confirm field name"

2. **`transport.end()` → `'close'` event timing vs. `logtail.flush()` HTTP await**
   - What we know: `pino-abstract-transport` calls `close()` (= `logtail.flush()`) in `stream._destroy`. `stream._destroy` fires on `transport.end()`.
   - What's unclear: Does `@logtail/node`'s `flush()` complete all in-flight HTTP requests before resolving? Or does it just flush the batch queue without awaiting responses?
   - Recommendation: The 5-second fallback timer (D-17) is the safety net. If HTTP responses aren't awaited, some lines may be in-flight but not confirmed. This is acceptable for the use case.

3. **Betterstack Telemetry source ID format for ClickHouse query**
   - What we know: Table name is `t<source_id>_your_source_logs` where source_id is visible in Betterstack account settings
   - What's unclear: Exact format of source_id (numeric? UUID?)
   - Recommendation: RUNBOOK.md §Betterstack should say "find your source ID in Betterstack → Sources → [source name] → Settings; substitute it in the query"

---

## Sources

### Primary (HIGH confidence)
- `bot/node_modules/pino/lib/proto.js:246` — `logger.flush(cb)` delegates to `stream.flush(cb)`
- `bot/node_modules/thread-stream/index.js:289` — `ThreadStream.flush(cb)` uses Atomics to wait for worker read-index
- `bot/node_modules/pino-abstract-transport/index.js:60` — `stream._destroy` calls close callback (`logtail.flush()`)
- `bot/node_modules/pino/pino.d.ts:251-275` — `TransportTargetOptions`, `TransportMultiOptions` TypeScript types
- GitHub: `logtail/logtail-js/packages/pino/src/pino.ts` — `IPinoLogtailOptions` interface + `closeFunc = () => logtail.flush()`
- npm registry: `@logtail/pino@0.5.8` (published 2026-03-xx), `pino@10.3.1`
- Node 22 runtime: `crypto.randomUUID()` produces UUID v4; `AbortSignal.timeout` is available

### Secondary (MEDIUM confidence)
- Betterstack Uptime docs (cron-and-heartbeat-monitor): GET ping URL, `/fail` suffix, grace period in seconds
- Betterstack Telemetry Explore Query API docs: ClickHouse SQL, `JSONExtract()` for nested JSON fields
- pino transports.md (GitHub): `pino.transport({ targets })` multi-transport syntax; `pino/file` destination: 2 for stderr

### Tertiary (LOW confidence / ASSUMED)
- Betterstack heartbeat response code (assumed 200 OK; `response.ok` check covers 200-299)
- ClickHouse SQL table name format `t<source_id>_your_source_logs` (must verify in Betterstack UI)

---

## Project Constraints (from CLAUDE.md)

| Directive | Applies to Phase 8 |
|-----------|-------------------|
| pino v10 flush is async — use callback form `logger.flush(cb)` | YES: `closeLogger(cb)` must use callback form |
| No `as any` anywhere — Biome `noExplicitAny` enforced | YES: avoid importing `PinoLog` from `@logtail/pino`; use `IPinoLogtailOptions` |
| zod v4 — `.default(10_000)` (no `n` suffix for number) | YES: `HEARTBEAT_TIMEOUT_MS` uses `.coerce.number()` not `.coerce.bigint()` |
| Signal handlers set a flag, never call `process.exit` | YES: no changes to signal handler pattern; `closeLogger` runs outside action loop |
| No `as any` at call sites — typed factories for mocks | YES: use `vi.stubGlobal("fetch", vi.fn())` pattern from `ipfs.test.ts` |
| GPG sign with `-c commit.gpgsign=false` | YES: all commits |
| `cd bot && npm run lint` must pass | YES: verify `@logtail/pino` import doesn't introduce Biome violations |
| `console.log/warn/error` forbidden — use pino logger | YES: `closeLogger` fallback uses `console.error` as last-resort only (no logger available) |

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — npm registry verified; source code read
- Architecture: HIGH — pino/thread-stream/pino-abstract-transport source code verified; runtime tests run
- Betterstack Uptime API: MEDIUM — official docs confirmed URL format, /fail suffix, grace period; response code assumed
- Betterstack Telemetry alerts: MEDIUM — ClickHouse SQL confirmed; exact query tested against docs, not live dashboard
- Pitfalls: HIGH — derived from actual source code reading and runtime tests

**Research date:** 2026-04-23
**Valid until:** 2026-05-23 (pino and @logtail/pino are stable; Betterstack docs may evolve)
