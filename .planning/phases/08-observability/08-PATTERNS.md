# Phase 8: Observability - Pattern Map

**Mapped:** 2026-04-23
**Files analyzed:** 10 (7 modify, 2 new, 1 new-or-modify)
**Analogs found:** 10 / 10

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `bot/src/logger.ts` | utility | request-response | `bot/src/logger.ts` (self) | exact — extend in place |
| `bot/src/index.ts` | controller | request-response | `bot/src/index.ts` (self) | exact — extend in place |
| `bot/src/config.ts` | config | — | `bot/src/config.ts` (self) | exact — extend zod schema |
| `bot/src/types.ts` | model | — | `bot/src/types.ts` (self) | exact — rename one field |
| `bot/src/heartbeat.ts` | utility | request-response | `bot/src/ipfs.ts` | role-match — same "optional HTTP call, swallow on fail, no-op when creds absent" shape |
| `bot/test/heartbeat.test.ts` | test | — | `bot/test/ipfs.test.ts` | exact — `vi.stubGlobal("fetch")` pattern |
| `bot/test/logger.test.ts` | test | — | `bot/test/config.test.ts` | role-match — unit test for a pure module export |
| `deploy/bootstrap.sh` | config | — | `deploy/bootstrap.sh` (self) | exact — extend heredoc at line 103-126 |
| `deploy/RUNBOOK.md` | config | — | `deploy/RUNBOOK.md` (self) | exact — append new sections |
| `bot/package.json` | config | — | `bot/package.json` (self) | exact — add one `dependencies` entry |

---

## Pattern Assignments

### `bot/src/logger.ts` (utility — extend in place)

**Analog:** self (`bot/src/logger.ts`)

**Current shape** (lines 1-52, full file):
```typescript
import pino from "pino";

function sanitizeValue(value: string): string {
    return value.replace(/0x[0-9a-fA-F]{64}/gi, "[REDACTED_KEY]").replace(/Bearer [A-Za-z0-9._-]+/g, "Bearer [REDACTED]");
}
// ...
export const logger = pino(
    { level: ..., serializers: { err: ... }, redact: { paths: [...] } },
    pino.destination(2),  // ← THIS SECOND ARG MUST BE REPLACED
);
export function createChildLogger(module: string) { return logger.child({ module }); }
export function reconfigureLogLevel(level: string): void { logger.level = level; }
```

**What changes:**

1. Move stderr sink from `pino.destination(2)` second-arg into a `targets[]` entry — mixing both produces duplicate stderr output (RESEARCH.md Pitfall 2).

2. Add `@logtail/pino` target conditionally (D-09, D-11):
```typescript
// Pattern: RESEARCH.md §Pattern 1 — verified against pino@10.3.1 + @logtail/pino@0.5.8
const isDryRun = process.argv.includes("--dry-run");  // D-11: module-init scope
const betterstackToken = process.env.BETTERSTACK_SOURCE_TOKEN;

const transportTargets: pino.TransportTargetOptions[] = [
    { target: "pino/file", options: { destination: 2 } },  // stderr always (D-10)
];

if (betterstackToken && !isDryRun) {
    transportTargets.push({
        target: "@logtail/pino",
        options: {
            sourceToken: betterstackToken,
            options: { endpoint: "https://in.logs.betterstack.com" },
        },
    });
}

const transport = pino.transport({ targets: transportTargets });
// transport is module-level so closeLogger() can reference it
```

3. Extend `redact.paths` (D-12):
```typescript
redact: {
    paths: [
        "config.BOT_PRIVATE_KEY",
        "config.PINATA_JWT",
        "config.BETTERSTACK_SOURCE_TOKEN",    // NEW D-12
        "config.BETTERSTACK_HEARTBEAT_URL",   // NEW D-12
        "privateKey",
        "PINATA_JWT",
        "BOT_PRIVATE_KEY",
        "BETTERSTACK_SOURCE_TOKEN",           // NEW D-12
        "BETTERSTACK_HEARTBEAT_URL",          // NEW D-12
        "authorization",
        "Authorization",
    ],
},
```

4. Extend `sanitizeValue` with heartbeat URL regex (D-12, RESEARCH.md Pitfall 3):
```typescript
function sanitizeValue(value: string): string {
    return value
        .replace(/0x[0-9a-fA-F]{64}/gi, "[REDACTED_KEY]")
        .replace(/Bearer [A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
        .replace(                                           // NEW D-12
            /https:\/\/uptime\.betterstack\.com\/api\/v1\/heartbeat\/[A-Za-z0-9_-]+/g,
            "[REDACTED_HEARTBEAT_URL]",
        );
}
```

5. Add exported `closeLogger` function (D-14, D-16, D-17):
```typescript
// module-level transport reference so closeLogger can call transport.end()
let transport: ReturnType<typeof pino.transport> | null = null;

export function closeLogger(cb: () => void): void {
    // D-16: non-throwing; console.error as last-resort escape hatch
    let called = false;
    const done = () => {
        if (!called) { called = true; cb(); }
    };

    // D-17: 5-second fallback timer — prevents hung exits on dead Betterstack endpoint
    const fallback = setTimeout(done, 5000);
    fallback.unref(); // don't keep event loop alive

    if (!transport) {
        // stderr-only or dry-run path — logger.flush() is synchronous-ish
        logger.flush(() => { clearTimeout(fallback); done(); });
        return;
    }

    // Step 1: drain SharedArrayBuffer (all lines received by worker thread)
    logger.flush(() => {
        // Step 2: signal end-of-stream → triggers worker _destroy → logtail.flush() HTTP delivery
        transport!.end();
        // Step 3: wait for transport close event (or rely on fallback timer — D-17)
        transport!.on("close", () => { clearTimeout(fallback); done(); });
    });
}
```

**Key constraint:** `transport.end()` takes no callback (verified: `transport.end.length === 0` in thread-stream). Use the `'close'` event or the 5s fallback. Never call `transport.end()` BEFORE `logger.flush(cb)` — IPC channel closes while lines are still in SharedArrayBuffer.

---

### `bot/src/index.ts` (controller — extend in place)

**Analog:** self (`bot/src/index.ts`)

**Three integration points:**

**Point 1 — `flushAndExit` (lines 14-16), swap `logger.flush` → `closeLogger`:**
```typescript
// BEFORE:
function flushAndExit(code: number): void {
    logger.flush(() => process.exit(code));
}

// AFTER (D-15):
import { closeLogger } from "./logger.js";
function flushAndExit(code: number): void {
    closeLogger(() => process.exit(code));
}
// All 6 existing call sites unchanged.
```

**Point 2 — top of `main()` (lines 18-20), insert `runId` and re-root logger:**
```typescript
// BEFORE:
async function main(): Promise<void> {
    const startTime = Date.now();
    const summary: RunSummary = { items: 0, ... };

// AFTER (D-05, D-06, D-07, D-08):
async function main(): Promise<void> {
    const runId = crypto.randomUUID(); // D-05: very first line; UUID v4, no deps
    const startTime = Date.now();
    // summary now uses itemsFetched (D-25):
    const summary: RunSummary = { itemsFetched: 0, ... };
    // ...after config load, once CHAIN_ID is available:
    // logger = rootLogger.child({ runId, chainId: config.CHAIN_ID }); // D-06
    // All subsequent log calls use the child logger.
```

**Point 3 — after `emitSummary`, before `flushAndExit` (line 138), insert heartbeat:**
```typescript
// Established pattern for conditional optional feature:
// see existing PINATA_JWT guard in chain.ts — same "if creds present, do thing" shape

emitSummary(summary, startTime);
await sendHeartbeat(summary, config);  // D-18: after summary, before exit; D-23: never throws
flushAndExit(summary.systemicFailure ? 1 : 0);
```

**Also update `summary.items` → `summary.itemsFetched` (D-25):**
- Line 20: `{ items: 0, ... }` → `{ itemsFetched: 0, ... }`
- Line 43: `summary.items = rawItems.length` → `summary.itemsFetched = rawItems.length`
- Line 11 (`emitSummary`): `logger.info({ summary }, "Run complete")` — field name change is transparent since `summary` is logged as object; verify with `npm run typecheck`.

---

### `bot/src/config.ts` (config — extend zod schema)

**Analog:** self (`bot/src/config.ts`)

**Existing optional field patterns to copy** (lines 15-18):
```typescript
// Existing analogs (copy these patterns):
LOG_LEVEL: z.string().optional().default("info"),
TX_RECEIPT_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(120_000),
PINATA_JWT: z.string().optional(),
PINATA_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(30_000),
```

**New fields to add after `PINATA_TIMEOUT_MS` (D-27):**
```typescript
// Source: RESEARCH.md §Code Examples — zod v4.3.6
BETTERSTACK_SOURCE_TOKEN: z.string().optional(),
BETTERSTACK_HEARTBEAT_URL: z.string().url().optional(),
HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(10_000),
```

Note: `BETTERSTACK_HEARTBEAT_URL` uses `.url()` validator (zod validates shape when present). `HEARTBEAT_TIMEOUT_MS` uses `.coerce.number()` not `.coerce.bigint()` — it's milliseconds, not a uint256.

---

### `bot/src/types.ts` (model — rename one field)

**Analog:** self (`bot/src/types.ts`)

**Current `RunSummary` (lines 63-77):**
```typescript
export interface RunSummary {
    items: number;         // ← rename to itemsFetched (D-25)
    valid: number;
    actions: number;
    txSent: number;
    errors: number;
    durationMs: number;
    skipped: number;
    systemicFailure?: string;
    uploadsAttempted?: number;
    uploadsSucceeded?: number;
    uploadsFailed?: number;
    orphanedCids?: string[];
}
```

**After rename (D-25):**
```typescript
export interface RunSummary {
    itemsFetched: number;  // D-25: renamed from items for dashboard query readability
    // ... all other fields unchanged
}
```

Blast radius: `bot/src/index.ts` lines 20 and 43. TypeScript compiler (`npm run typecheck`) catches all missed sites — run it in Wave 0 verification.

---

### `bot/src/heartbeat.ts` (NEW utility — request-response)

**Analog:** `bot/src/ipfs.ts`

The analog pattern is "optional HTTP call to external service with bounded timeout, no-op when credentials absent, swallow on failure." Key differences: heartbeat is simpler (no retry, no response body), uses `AbortSignal.timeout()` instead of `AbortController` + `setTimeout`, and logs at `warn` (not `error`) on failure.

**Imports pattern** — copy from `bot/src/ipfs.ts` lines 1-4:
```typescript
import { createChildLogger } from "./logger.js";
import type { Config } from "./config.js";
import type { RunSummary } from "./types.js";
```
Note: heartbeat uses module-level logger directly (not `createChildLogger`) since it's a leaf utility — consistent with `ipfs.ts:4` style but even simpler.

**No-op guard pattern** — copy from `ipfs.ts` guard shape, adapted (D-21):
```typescript
// Analog: PINATA_JWT guard in chain.ts — "if creds absent, return early"
export async function sendHeartbeat(summary: RunSummary, config: Config): Promise<void> {
    const url = config.BETTERSTACK_HEARTBEAT_URL;
    if (!url) return;  // D-21: no-op when absent

    const isDryRun = process.argv.includes("--dry-run");
    if (isDryRun) return;  // D-21: no-op in dry-run
```

**Core fetch pattern with AbortSignal.timeout** (D-20, D-22):
```typescript
    // D-19: success → base URL, failure → /fail suffix
    const pingUrl = summary.systemicFailure ? `${url}/fail` : url;

    try {
        const response = await fetch(pingUrl, {
            signal: AbortSignal.timeout(config.HEARTBEAT_TIMEOUT_MS),
            // GET is the default method — Betterstack docs confirm GET works
        });
        if (!response.ok) {
            // D-12: never log the actual URL — contains opaque token
            logger.warn({ status: response.status, url: "[REDACTED]" }, "Heartbeat ping returned non-2xx");
        }
    } catch (err) {
        // Network error, timeout, DNS failure — all swallowed per D-23
        // Log at warn (not error) to avoid cascading Betterstack alert logic (D-20)
        logger.warn({ err }, "Heartbeat ping failed — monitoring infrastructure issue");
    }
    // Never throws. D-23: no cascade to systemicFailure or exit code.
}
```

**Key difference from ipfs.ts:** `ipfs.ts` uses `AbortController` + manual `setTimeout`; heartbeat uses `AbortSignal.timeout(ms)` (Node 22 built-in, zero deps). `ipfs.ts` retries and throws; heartbeat never retries and never throws.

---

### `bot/test/heartbeat.test.ts` (NEW test)

**Analog:** `bot/test/ipfs.test.ts`

**Full established test scaffold pattern** (lines 1-10 of ipfs.test.ts):
```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadEvidenceToIPFS } from "../src/ipfs.js";  // ← swap for sendHeartbeat

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());  // project-established pattern (ipfs.test.ts:68)
});

afterEach(() => {
    // vi.unstubGlobals runs automatically via bot/vitest.config.ts (unstubGlobals: true)
});
```

**Mock response factory pattern** (lines 6-25 of ipfs.test.ts):
```typescript
// For heartbeat: simpler factories — no body needed, just ok + status
function makeOkResponse(): Response {
    return { ok: true, status: 200 } as unknown as Response;
}
function makeErrorResponse(status: number): Response {
    return { ok: false, status } as unknown as Response;
}
```

**Test shape pattern** (lines 77-86, 158-168 of ipfs.test.ts):
```typescript
it("description (Test N)", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(makeOkResponse());
    await sendHeartbeat(successSummary, mockConfig);
    expect(globalThis.fetch).toHaveBeenCalledWith(
        expectedUrl,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
});

it("swallows network error without throwing", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("Network error"));
    await expect(sendHeartbeat(successSummary, mockConfig)).resolves.toBeUndefined();
});
```

**Note on fake timers:** `ipfs.test.ts` uses `vi.useFakeTimers()` because it tests `setTimeout`-based retry delay. `heartbeat.test.ts` does NOT need fake timers — `AbortSignal.timeout()` is not a real timer in vitest's fake timer model and heartbeat has no retry delay. Standard async/await is sufficient.

**D-29 test cases to implement:**
1. Sends GET to base URL when `summary.systemicFailure` is absent
2. Sends GET to `/fail` URL when `summary.systemicFailure` is truthy
3. Swallows network error (returns `undefined`, does not throw)
4. Swallows timeout error (`AbortError`)
5. Swallows non-2xx response (200 not ok — returns `undefined`, logs warn)
6. No-op when `BETTERSTACK_HEARTBEAT_URL` is absent (fetch never called)
7. No-op when `--dry-run` in `process.argv` (fetch never called)

---

### `bot/test/logger.test.ts` (NEW test — does not exist yet)

**Analog:** `bot/test/config.test.ts`

`config.test.ts` is the closest analog — pure module import, no fetch mocking, tests exported functions in isolation.

**Scaffold pattern** (lines 1-3 of config.test.ts):
```typescript
import { describe, expect, it, vi } from "vitest";
import { closeLogger } from "../src/logger.js";
```

**D-29 test cases for `closeLogger`:**
1. Invokes callback immediately when transport is null (stderr-only path)
2. Invokes callback within 5-second fallback even if transport never emits `'close'` event
3. Invokes callback after transport emits `'close'` event (successful drain)

**Testing `closeLogger` requires stubbing the internal transport.** Since `transport` is module-scoped in `logger.ts`, tests need to either: (a) reset the module between tests (`vi.resetModules()`), or (b) expose a test-only setter. Pattern (a) is preferred — consistent with `config.test.ts` which imports the module fresh each test via `configSchema` (no state). The planner should decide the exact approach; the simpler alternative is to just test the `done()` deduplication guard and timeout semantics with a fake transport object.

---

### `deploy/bootstrap.sh` (config — extend heredoc)

**Analog:** self (`deploy/bootstrap.sh`)

**Heredoc region to extend** (lines 103-126):
```bash
# Current Phase 8 placeholder section already present at lines 122-125:
# ── Phase 8: Observability (fill after Betterstack setup) ───────────────────
# BETTERSTACK_SOURCE_TOKEN=
# BETTERSTACK_HEARTBEAT_TOKEN=    ← WRONG NAME — must be BETTERSTACK_HEARTBEAT_URL

# Required correction + addition:
# ── Phase 8: Observability (fill after Betterstack setup) ───────────────────
# BETTERSTACK_SOURCE_TOKEN=
# BETTERSTACK_HEARTBEAT_URL=
# HEARTBEAT_TIMEOUT_MS=10000
```

Note: the bootstrap.sh heredoc already has a Phase 8 stub block (lines 122-125) but uses `BETTERSTACK_HEARTBEAT_TOKEN` (wrong name) and is missing `HEARTBEAT_TIMEOUT_MS`. The fix is to correct the key name and add the third var — not a net-new heredoc section.

**Heredoc idempotency pattern** (lines 99-100): the entire block is inside `if [ ! -f /etc/reputation-oracle/sepolia.env ]` — already-deployed VPSs keep their existing file (no clobber per Phase 7 D-19). The correction only affects fresh deployments.

---

### `deploy/RUNBOOK.md` (config — append sections)

**Analog:** self (`deploy/RUNBOOK.md`)

**Existing section structure** (lines 1-19): numbered sections with H2 headers, H3 sub-sections, code blocks for commands.

**Pattern to follow** — existing §8 Troubleshooting format:
```markdown
## N. Section Name

**Prerequisites:** ...

### Sub-section

```bash
# command
```

Narrative text. **Bold** for emphasis.
```

**New sections to append:**
- `## 9. Betterstack Setup` — source token creation, heartbeat monitor creation, grace period config (600s = 10 min per D-04), alert rule for `itemsFetched===0` × 5 consecutive runs with ClickHouse SQL query
- `## 10. Burn-in Gate Procedure` — 7-day Sepolia gate (D-03): what to check in Betterstack dashboard before Phase 9 Mainnet cutover, checklist items, operator sign-off format

---

### `bot/package.json` (config — add one dependency)

**Analog:** self (`bot/package.json`)

**Existing `dependencies` block** (lines 17-23):
```json
"dependencies": {
    "graphql-request": "^7.4.0",
    "pino": "^10.3.1",
    "tsx": "^4.21.0",
    "viem": "^2.47.0",
    "zod": "^4.3.6"
}
```

**After change** — add `@logtail/pino` to `dependencies` (NOT `devDependencies`) so `npm ci --omit=dev` on the VPS includes it (RESEARCH.md Pitfall 4):
```json
"dependencies": {
    "@logtail/pino": "^0.5.8",
    "graphql-request": "^7.4.0",
    "pino": "^10.3.1",
    "tsx": "^4.21.0",
    "viem": "^2.47.0",
    "zod": "^4.3.6"
}
```

Run `cd bot && npm install @logtail/pino` to install and update `package-lock.json`.

---

## Shared Patterns

### Optional feature gate on env var presence
**Source:** `bot/src/config.ts` + `bot/src/ipfs.ts` (PINATA_JWT guard in chain.ts)
**Apply to:** `heartbeat.ts`, `logger.ts` transport construction
```typescript
// Pattern: early return when optional credential absent
const url = config.BETTERSTACK_HEARTBEAT_URL;
if (!url) return;  // no-op when not configured
```

### Structured error logging with `err` field
**Source:** `bot/src/index.ts` lines 145, `bot/src/ipfs.ts` line 113
**Apply to:** `heartbeat.ts` warn call, `closeLogger` console.error fallback
```typescript
// Established shape — pino.stdSerializers.err walks via serializers in logger config
logger.warn({ err }, "Heartbeat ping failed — monitoring infrastructure issue");
// D-16: last-resort only (logger may not be available):
console.error("[closeLogger] transport drain failed:", err);
```

### Dry-run detection
**Source:** `bot/src/index.ts` line 33
**Apply to:** `heartbeat.ts` (D-21), `logger.ts` transport gating (D-11)
```typescript
// Identical flag detection in both places — no shared constant, consistent with existing style
const isDryRun = process.argv.includes("--dry-run");
```

### Zod optional with numeric default
**Source:** `bot/src/config.ts` lines 15-18
**Apply to:** `HEARTBEAT_TIMEOUT_MS` field in config.ts
```typescript
// Exact analog: TX_RECEIPT_TIMEOUT_MS pattern
TX_RECEIPT_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(120_000),
// New field uses same pattern:
HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(10_000),
```

### vi.stubGlobal fetch mock
**Source:** `bot/test/ipfs.test.ts` lines 68-69
**Apply to:** `bot/test/heartbeat.test.ts`
```typescript
// Project-canonical fetch mock pattern — auto-cleaned by vitest.config.ts (unstubGlobals: true)
beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
});
```

---

## No Analog Found

All files have a close analog. No gaps.

---

## Critical Implementation Notes for Planner

1. **`pino.destination(2)` removal is load-bearing:** The existing second arg to `pino()` in `logger.ts` must be removed when switching to `pino.transport({ targets })`. Keeping both = duplicate stderr lines (RESEARCH.md Pitfall 2).

2. **`transport` must be module-level:** `closeLogger` needs to call `transport.end()` and listen for `transport.on("close", ...)`. The `transport` variable must be declared at module scope (not inside the `pino()` call).

3. **`logger.flush` → `closeLogger` is the only change in `flushAndExit`:** All 6 call sites in `index.ts` remain identical — single point of change at lines 14-16.

4. **`RunSummary.items` rename has 3 sites in `index.ts`:** lines 20 (init), 43 (assignment), 11 (emitSummary log object). `npm run typecheck` catches any missed site.

5. **`heartbeat.ts` logger import:** Import `logger` from `./logger.js` (the root logger, not `createChildLogger`) — heartbeat is a leaf utility called once per run, no module-specific child needed.

6. **bootstrap.sh heredoc has wrong placeholder name:** Line 124 has `BETTERSTACK_HEARTBEAT_TOKEN=` but the correct env var is `BETTERSTACK_HEARTBEAT_URL=`. Fix the typo and add `HEARTBEAT_TIMEOUT_MS=10000` on the next line.

7. **Biome `noExplicitAny` guard:** Do NOT import `PinoLog` from `@logtail/pino` — its index signature triggers Biome. Use only the string `"@logtail/pino"` as the `target` field. If typing the options object, `IPinoLogtailOptions` is clean (RESEARCH.md Pitfall 5).

---

## Metadata

**Analog search scope:** `bot/src/`, `bot/test/`, `deploy/`
**Files scanned:** 12 source files
**Pattern extraction date:** 2026-04-23
