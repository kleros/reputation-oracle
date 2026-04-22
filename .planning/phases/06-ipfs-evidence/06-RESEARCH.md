# Phase 6: IPFS Evidence - Research

**Researched:** 2026-04-21
**Domain:** Pinata REST API, Node 22 native fetch, AbortController, pino v10 redaction, vitest v4 fetch mocking
**Confidence:** HIGH (API shape), MEDIUM (error body details, rate limits), LOW (CDN propagation timing)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
See 06-CONTEXT.md `<decisions>` — 37 locked decisions (D-01 through D-37). All are carried verbatim. Key ones impacting implementation:
- D-06: native fetch only, no SDK
- D-09: serial uploads, no Promise.allSettled
- D-10: CIDv0 default (Pinata default)
- D-14: 30s AbortController timeout; `PINATA_TIMEOUT_MS` env var
- D-15: one retry on 5xx only; 4xx and network = immediate skip
- D-17: 3 consecutive failures = systemic escalation (`"pinata-unavailable"`)
- D-22: shutdown flag checked between uploads; in-flight fetch aborted via AbortController
- D-25: `PINATA_JWT: z.string().optional()` (no default)
- D-27: pino redaction extended to cover `PINATA_JWT`

### Claude's Discretion
- Control-flow structure of prepare/execute split (one function with two loops, or helpers)
- `classifyPinataHttpError` / `classifyFetchError` implementation shape (enum vs string literals)
- Retry backoff delay for single 5xx retry (D-CONTEXT suggests 1s)
- Whether `ipfs.ts` exports classify helpers or keeps them module-private

### Deferred Ideas (OUT OF SCOPE)
- CIDv1 opt-in
- Pinata groups
- `PINATA_GATEWAY` env var
- CID verification after upload
- Per-upload correlation IDs
- `p-retry` or retry libraries
- Pin rotation / unpin of old CIDs on revocation
- Exponential backoff on upload retry
- Progressive failure thresholds per error class
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| IPFS-01 | Bot uploads evidence JSON to Pinata via REST API (native fetch, no SDK), returns ipfs:// CID | Pinata REST API shape fully documented below |
| IPFS-02 | Evidence follows existing kleros-reputation-oracle/v1 schema | Schema frozen in Phase 2; `buildPositiveEvidence` / `buildNegativeEvidence` unchanged |
| IPFS-03 | IPFS upload failure skips the item (no fallback to data: URI); next run retries | Failure classification taxonomy documented below |
| IPFS-04 | All evidence uploaded (prepare phase) before any transactions submitted (execute phase) | chain.ts split pattern documented; WR-01 invariant analysis below |
| IPFS-05 | PINATA_JWT optional; when absent, IPFS features disabled, items requiring evidence skipped | Config pattern from existing `TX_RECEIPT_TIMEOUT_MS` applies directly |
</phase_requirements>

---

## Summary

Phase 6 adds a `bot/src/ipfs.ts` module (~60 LOC) and restructures `executeActions()` in `chain.ts` into a two-pass prepare/execute pattern. The Pinata `pinJSONToIPFS` REST endpoint is straightforward: POST JSON, get `{ IpfsHash, PinSize, Timestamp, isDuplicate }` back. Auth is Bearer JWT. Errors come back as JSON `{ error: string }` on 4xx and plain text or JSON on 5xx. Rate limits are 60 req/min (free plan) to 100 req/s (enterprise) — serial uploads at bot's typical batch size (0-2 actions) will never approach any plan's limit. Node 22 native fetch + AbortController is clean: timeout produces `DOMException [AbortError]` with `err.name === "AbortError"`, network failure produces `TypeError`. The existing codebase patterns (Phase 5 `ShutdownHolder`, Phase 4 pino redaction, zod optional with no default) extend cleanly. The only meaningful gap is that the Pinata unpin endpoint returns plain-text `"OK"` on success, not JSON — the integration test cleanup must NOT call `.json()` on the unpin response.

**Primary recommendation:** Implement `ipfs.ts` as a single file with `uploadEvidenceToIPFS()` function, four error classes via string literals, one 5xx retry with `await delay(1000)`, and AbortController scoped per call. Extend `executeActions()` with a prepare loop before the existing execute loop. All other patterns follow Phase 5 conventions exactly.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Evidence JSON construction | Bot (TypeScript) | — | `buildPositiveEvidence` / `buildNegativeEvidence` — frozen in Phase 2, unchanged |
| IPFS upload (Pinata) | Bot — prepare pass | — | External HTTP call before any on-chain state change |
| feedbackURI composition | Bot — prepare pass | — | `ipfs://${cid}` constructed from upload response |
| Transaction submission | Bot — execute pass | — | Uses pre-built feedbackURI from prepare pass |
| On-chain evidence storage | Router contract | — | feedbackURI stored in `giveFeedback` / `revokeFeedback` calldata |
| Evidence retrieval (read) | Kleros CDN gateway | Pinata node | `cdn.kleros.link/ipfs/<CID>` — out of bot scope |

---

## Pinata API Reference

### pinJSONToIPFS Endpoint

**Endpoint:** `POST https://api.pinata.cloud/pinning/pinJSONToIPFS`
**Auth:** `Authorization: Bearer <PINATA_JWT>`
**Content-Type:** `application/json`

[VERIFIED: docs.pinata.cloud/api-reference/endpoint/ipfs/pin-json-to-ipfs]

#### Request Body

```json
{
  "pinataContent": { /* any valid JSON object — this is what gets hashed and pinned */ },
  "pinataMetadata": {
    "name": "kro-v1/11155111/123/0xabc...",
    "keyvalues": {
      "agentId": "123",
      "chainId": "11155111",
      "pgtcrItemId": "0xabc...",
      "scenario": "verified"
    }
  },
  "pinataOptions": {
    "cidVersion": 0
  }
}
```

Field notes:
- `pinataContent` (required): the evidence JSON object — NOT stringified, passed as a plain object
- `pinataMetadata.name` (optional string): displayed in Pinata dashboard; D-29 format `"kro-v1/{chainId}/{agentId}/{pgtcrItemId}"`
- `pinataMetadata.keyvalues` (optional object): up to 10 key-value pairs [CITED: docs.pinata.cloud]; values must be strings or numbers [ASSUMED — exact type constraints unconfirmed]; no documented per-value character limit found
- `pinataOptions.cidVersion` (optional, 0 or 1): defaults to 0 (CIDv0, `Qm...` prefix) if omitted [VERIFIED: Pinata-SDK README]

#### Response Body (200 OK)

```json
{
  "IpfsHash": "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
  "PinSize": 4321,
  "Timestamp": "2026-04-21T12:00:00.000Z",
  "isDuplicate": false
}
```

Field notes [VERIFIED: Pinata-SDK README + docs]:
- `IpfsHash`: CIDv0 string starting with `Qm` (46 chars) when using default `cidVersion: 0`. Use this directly to construct `ipfs://${IpfsHash}` and `https://cdn.kleros.link/ipfs/${IpfsHash}`
- `PinSize`: integer, bytes of pinned content — log as `size` per D-31
- `Timestamp`: ISO 8601 string — useful for logging, not needed on-chain
- `isDuplicate`: boolean — `true` when the exact same content was already pinned. The `IpfsHash` is still valid and usable. No special handling needed — idempotent by content addressing

**IPFS content addressing invariant:** If the same evidence JSON is uploaded twice (e.g., after shutdown mid-prepare + re-run), Pinata returns the same `IpfsHash` with `isDuplicate: true`. The CID is correct and the pin is already live. This makes "orphaned CID" re-upload safe and idempotent.

#### Error Response Shape

[MEDIUM confidence — verified from SDK issues + community reports, not official docs page]

Pinata 4xx errors return JSON:
```json
{ "error": "string describing the problem" }
```

Known examples:
- 400: `{ "error": "Unexpected field" }` or `{ "error": "Invalid pinataContent" }`
- 401: `{ "error": "IPFS pinning cancelled: Unauthorized" }` or similar
- 403: `{ "error": "Forbidden" }` — key scope insufficient
- 429: `{ "error": "RATE_LIMIT_EXCEEDED" }` (exact text unconfirmed [ASSUMED])

5xx errors may return JSON or plain text — treat any non-2xx as error regardless of body parseability.

**Safe error body parsing pattern:**
```typescript
let errorBody = "(non-JSON body)";
try {
  const json = await response.json() as { error?: string };
  errorBody = json.error ?? JSON.stringify(json);
} catch {
  errorBody = await response.text().catch(() => "(unreadable body)");
}
```
Truncate to 500 chars before logging (D-21). Never log the full body without truncation — it could theoretically contain credential-adjacent information.

#### Rate Limits

[VERIFIED: docs.pinata.cloud/account-management/limits]

| Plan | Limit |
|------|-------|
| Free | 60 requests/minute |
| Picnic | 250 requests/minute |
| Fiesta | 500 requests/minute |
| Enterprise | 100 requests/second |

- pinJSONToIPFS max content: **10 MB** per upload (evidence JSON is < 1 KB, no concern)
- No `Retry-After` header documented [ASSUMED — not in docs]
- At serial upload, bot runs 0-2 uploads per invocation, far below any plan's limit
- 429 = rate-limit; D-15 treats it as retry-eligible (same as 5xx class)

#### JWT Scope Requirements

[VERIFIED: pinata.cloud scoped API keys blog post]

Granular per-endpoint scopes available:
- `pinJSONToIPFS: true` — required for uploads
- `unpin: true` — required for integration test cleanup only

**Minimal bot JWT:** create with `pinJSONToIPFS: true`, `unpin: false`.
**Integration test JWT:** create with both `pinJSONToIPFS: true` AND `unpin: true`.

A single JWT can hold multiple scope permissions — no need for separate tokens.

---

### Unpin Endpoint (Integration Test Only)

**Endpoint:** `DELETE https://api.pinata.cloud/pinning/unpin/{CID}`
**Auth:** `Authorization: Bearer <PINATA_JWT>` (requires `unpin: true` scope)
**Response (200 OK):** `Content-Type: text/plain`, body = `"OK"` (plain string, NOT JSON)
**Response errors:** status code only, body unspecified in docs [ASSUMED — handle any non-200 as failure]

[VERIFIED: docs.pinata.cloud/api-reference/endpoint/ipfs/unpin-file]

**CRITICAL PITFALL:** Do NOT call `.json()` on the unpin response — it will throw a parse error. Check `response.ok`, then call `.text()` if you need to confirm the `"OK"` string.

```typescript
// Correct unpin call pattern
const res = await fetch(`https://api.pinata.cloud/pinning/unpin/${cid}`, {
  method: "DELETE",
  headers: { Authorization: `Bearer ${jwt}` },
});
if (!res.ok) throw new Error(`Unpin failed: ${res.status}`);
// response body is "OK" (text/plain) — do not call .json()
```

---

## Node 22 Fetch Patterns

### AbortController + fetch

[VERIFIED: MDN AbortSignal docs + multiple authoritative sources]

```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

try {
  const response = await fetch(url, {
    method: "POST",
    headers: { ... },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  clearTimeout(timeoutId);
  // handle response
} catch (err) {
  clearTimeout(timeoutId);
  // classify error — see taxonomy below
}
```

### Error Taxonomy (Fetch Failures)

[VERIFIED: MDN + AppSignal 2025 guide]

| Error Name | `err.name` | Cause | D-20 class |
|-----------|-----------|-------|------------|
| `DOMException [AbortError]` | `"AbortError"` | `controller.abort()` called (our timeout) | `network` |
| `DOMException [TimeoutError]` | `"TimeoutError"` | `AbortSignal.timeout()` static helper | not used — we use manual AbortController |
| `TypeError` | `"TypeError"` | DNS failure, connection refused, ECONNREFUSED | `network` |
| `TypeError` | `"TypeError"` | Invalid URL, non-HTTP scheme | `network` |

**Key distinction:** `AbortError` (timeout we imposed) vs `TypeError` (network-level failure). Both map to D-20 `network` error class — no retry for either per D-15.

**`abort()` is synchronous** — it sets `signal.aborted = true` immediately and fires the abort event; the pending `fetch()` promise then rejects asynchronously with `AbortError`.

### Error Classification Implementation

```typescript
type PinataErrorClass = "auth" | "rate-limit" | "server" | "network";

function classifyHttpStatus(status: number): PinataErrorClass {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate-limit";
  if (status >= 500) return "server";
  return "network"; // unexpected 4xx — treat as non-retryable
}

function classifyFetchError(err: unknown): PinataErrorClass {
  if (err instanceof Error) {
    if (err.name === "AbortError") return "network"; // timeout
    if (err.name === "TypeError") return "network";  // DNS / connection
  }
  return "network";
}
```

### Retry Logic (Single 5xx Retry)

D-15 allows one retry for `server` and `rate-limit` class errors. Network and auth errors do not retry.

```typescript
async function uploadWithRetry(
  url: string,
  body: object,
  jwt: string,
  timeoutMs: number,
): Promise<PinataResponse> {
  const MAX_RETRIES = 1; // 5xx + rate-limit only
  let lastErr: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await fetchWithTimeout(url, body, jwt, timeoutMs);
      return result; // success
    } catch (err) {
      lastErr = err;
      const cls = isPinataError(err) ? err.errorClass : "network";
      if (cls !== "server" && cls !== "rate-limit") throw err; // no retry
      if (attempt < MAX_RETRIES) await delay(1000);
    }
  }
  throw lastErr;
}
```

This matches `tx.ts::estimateGasWithRetry` pattern: loop up to N+1 attempts, delay between, throw last error after exhaustion.

---

## Existing Codebase Patterns

### 1. WR-01 Invariant — Evidence Built Once (chain.ts:141-157)

Current Phase 5 code builds evidence objects inside the gas-estimate block at line 149-176, then reuses the already-built `feedbackURI` at writeContract (line 223, 230). The comment at line 142 says: "Build evidence and feedbackURI ONCE per action so gas estimate and writeContract use identical calldata (WR-01 — avoids createdAt timestamp drift)."

**Phase 6 extends this invariant to the prepare pass.** The prepare loop captures `createdAt` once per action by calling `buildPositiveEvidence()` / `buildNegativeEvidence()` during the prepare pass. The resulting `evidence` object (with a fixed `createdAt`) is uploaded to Pinata. The returned `cid` is stored alongside the already-built `evidence` object. The execute pass reuses both — it does NOT call `buildPositiveEvidence()` again. The `feedbackURI` = `ipfs://${cid}` is composed once in the prepare pass and reused in the execute pass.

**Concrete change:** The evidence-building code at chain.ts:149-191 moves into the prepare pass. The execute pass receives a `PreparedAction` type that carries `{action, feedbackURI?, evidence?}`.

### 2. ShutdownHolder Pattern (index.ts:23, chain.ts:132-137)

```typescript
// index.ts — already present
const shutdownHolder: ShutdownHolder = { shutdown: false };
process.on("SIGTERM", () => { shutdownHolder.shutdown = true; });
process.on("SIGINT", () => { shutdownHolder.shutdown = true; });

// chain.ts — already present
if (shutdownHolder.shutdown) {
  log.info("Shutdown requested, skipping remaining actions");
  break;
}
```

Phase 6 adds the same check at the top of each prepare-pass iteration. Per D-22, when shutdown fires during the prepare pass, the in-flight `fetch()` is aborted via the per-upload `AbortController`. The `AbortError` is caught, logged, and the prepare loop exits. Execute pass is not entered.

Pattern:
```typescript
// In prepare loop, per-item:
if (shutdownHolder.shutdown) break;

const controller = new AbortController();
// store controller so signal handler can abort it if needed
// ... OR: simply check the flag before each fetch; if set, don't start the fetch
```

D-22 says "abort any in-flight upload via its AbortController" — this means the controller must be accessible when the signal fires. Since signals are asynchronous events that fire between event loop ticks, the simplest implementation is:
- If `shutdownHolder.shutdown` is already `true` before starting a fetch, skip it entirely
- If the signal fires while a fetch is in-flight (awaited), the `fetch()` will complete normally (signal handlers only set the flag; they don't call `controller.abort()`)

The CONTEXT.md text says "abort any in-flight upload via its AbortController" — this implies the signal handler needs a reference to the current controller. The planner should decide: either wire the controller reference into the signal handler (complex), or accept that the current in-flight fetch completes before the shutdown check fires (simpler, consistent with Phase 5 behavior for on-chain txs).

**Recommendation for planner:** Accept that the in-flight upload completes (or times out) before shutdown takes effect — consistent with Phase 5's "finish current action" behavior. The complexity of aborting a mid-flight fetch is not worth it for a 30s max timeout. After the in-flight fetch resolves (success or failure), the next loop iteration checks `shutdownHolder.shutdown` and exits.

### 3. ExecuteActionsResult (types.ts:76-80)

Current shape:
```typescript
export interface ExecuteActionsResult {
  skipped: number;
  txSent: number;
  systemicFailure?: string; // reason code from D-19 taxonomy
}
```

Phase 6 adds:
- New item-skip reason: `"ipfs-upload-failed"` (for the existing `reason` log field in D-18 taxonomy)
- New systemic reason: `"pinata-unavailable"` (for `systemicFailure` field, D-17)
- New optional array: `orphaned_cids?: string[]` (D-24, for run summary)
- New counters in `RunSummary`: `uploads_attempted`, `uploads_succeeded`, `uploads_failed` (D-33)

The `systemicFailure?: string` field type is already wide enough — no interface change needed for the reason string itself. Add `orphaned_cids` to `RunSummary` only (D-33).

### 4. Pino Redaction (logger.ts:29-38)

Current redact paths already include `"PINATA_JWT"` and `"Authorization"`:
```typescript
redact: {
  paths: [
    "config.BOT_PRIVATE_KEY",
    "config.PINATA_JWT",   // already present!
    "privateKey",
    "PINATA_JWT",           // already present!
    "BOT_PRIVATE_KEY",
    "authorization",
    "Authorization",
  ],
},
```

**Key finding:** `PINATA_JWT` redaction is ALREADY implemented in `logger.ts`. No changes needed to logger.ts for the JWT itself.

The `sanitizeObject` function (logger.ts:7-17) handles nested JWT redaction via `Bearer [A-Za-z0-9._-]+` regex applied recursively. This covers error message strings that might contain `Bearer <JWT>`.

**Config.ts pattern** (for `PINATA_JWT` in zod validation error):
```typescript
// config.ts:28-32 — existing pattern
const safeIssues = result.error.issues.map((issue) => ({
  path: issue.path,
  message: issue.message,
  ...(issue.path.includes("BOT_PRIVATE_KEY") ? { received: "[REDACTED]" } : {}),
}));
```
Extend to also check `issue.path.includes("PINATA_JWT")`.

### 5. Zod Optional Config (config.ts)

Pattern from Phase 5 (`TX_RECEIPT_TIMEOUT_MS`):
```typescript
TX_RECEIPT_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(120_000),
MIN_BALANCE_WEI: z.coerce.bigint().optional().default(5_000_000_000_000_000n),
```

For Phase 6 additions:
```typescript
PINATA_JWT: z.string().optional(),                                    // no default — absence is valid state
PINATA_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(30_000),
```

`PINATA_JWT: z.string().optional()` with NO default means `config.PINATA_JWT` is `string | undefined`. All upload code checks `if (!config.PINATA_JWT)` at the start of the prepare pass.

### 6. tx.ts delay Helper

```typescript
// tx.ts:67-69 — already defined, reusable
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

This is module-private. `ipfs.ts` either re-defines its own identical helper (2 lines, no shared dep needed), or the planner exports it from `tx.ts`. Given `ipfs.ts` is standalone, re-defining locally is cleaner.

---

## Testing Patterns

### Fetch Mocking in Vitest v4

[VERIFIED: vitest.dev/guide/mocking/globals]

**Recommended pattern — `vi.stubGlobal` with `unstubGlobals: true` in config:**

```typescript
// vitest.config.ts (or vitest section in vite.config.ts)
// No separate config file exists — vitest runs via package.json "test": "vitest run"
// Add vitest config inline or create vitest.config.ts
export default {
  test: {
    unstubGlobals: true,  // auto-restore after each test
  }
}
```

**In test files:**
```typescript
import { vi, describe, it, expect, beforeEach } from "vitest";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

it("returns CID on success", async () => {
  vi.mocked(globalThis.fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      IpfsHash: "QmTestHash123",
      PinSize: 100,
      Timestamp: "2026-04-21T00:00:00Z",
      isDuplicate: false,
    }),
  } as unknown as Response);

  const result = await uploadEvidenceToIPFS(mockEvidence, mockMetadata, "test-jwt", 5000);
  expect(result.cid).toBe("QmTestHash123");
});
```

**Alternative — assign directly (no config needed):**
```typescript
globalThis.fetch = vi.fn();
// In afterEach: vi.restoreAllMocks() only restores spies, not stubs
// Manual cleanup: globalThis.fetch = originalFetch
```

**Preferred approach:** `vi.stubGlobal` with `unstubGlobals: true` — cleanest, auto-restores between tests.

**Pitfall:** vitest v4 + jsdom environment has a known issue with AbortController fetch (GitHub issue #8374). The bot uses `environment: "node"` (default for vitest without jsdom config), so this issue does NOT apply.

### Module Mock Pattern for ipfs.ts in chain.test.ts

Per D-36, `chain.test.ts` should mock `bot/src/ipfs.ts` at module level:

```typescript
vi.mock("../src/ipfs.js", () => ({
  uploadEvidenceToIPFS: vi.fn(),
}));

// In test:
import { uploadEvidenceToIPFS } from "../src/ipfs.js";

vi.mocked(uploadEvidenceToIPFS).mockResolvedValueOnce({
  cid: "QmTestHash123",
  gatewayUrl: "https://cdn.kleros.link/ipfs/QmTestHash123",
});
```

The `.js` extension is required for Node16 module resolution (tsconfig.json `"moduleResolution": "Node16"`).

### Integration Test Cleanup (D-35)

```typescript
// bot/test/ipfs.integration.test.ts
import { test, expect } from "vitest";

test.skipIf(!process.env.PINATA_JWT)("uploads and unpins throwaway JSON", async () => {
  const jwt = process.env.PINATA_JWT!;

  // Upload
  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pinataContent: { test: true, ts: Date.now() },
      pinataMetadata: { name: "kro-integration-test-throwaway" },
    }),
  });
  expect(res.ok).toBe(true);
  const { IpfsHash } = await res.json() as { IpfsHash: string };
  expect(IpfsHash).toMatch(/^Qm/);

  // Cleanup — CRITICAL: response is text/plain "OK", not JSON
  const unpinRes = await fetch(`https://api.pinata.cloud/pinning/unpin/${IpfsHash}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${jwt}` },
  });
  expect(unpinRes.ok).toBe(true);
  const body = await unpinRes.text(); // NOT .json()
  expect(body).toBe("OK");
});
```

No retry needed for unpin in the test — if it fails, the pin stays but the test still passed its assertion. Manual cleanup via Pinata dashboard is fine for orphaned test pins.

### D-34 Unit Test Coverage Matrix

| Test Case | Input | Expected |
|-----------|-------|----------|
| 200 success | ok=true, IpfsHash present | returns `{cid, gatewayUrl}` |
| 200 isDuplicate=true | ok=true, isDuplicate=true | same as success — use the CID |
| 401 auth error | status=401 | throws with `errorClass: "auth"` |
| 403 auth error | status=403 | throws with `errorClass: "auth"` |
| 429 rate-limit | status=429 | throws with `errorClass: "rate-limit"` |
| 500 server error (first call) | status=500 | retries once |
| 500 server error (both calls) | status=500 twice | throws with `errorClass: "server"` after 1 retry |
| 200 after 500 retry | status=500 then 200 | returns CID (retry succeeded) |
| AbortError timeout | fetch rejects AbortError | throws with `errorClass: "network"` |
| TypeError DNS failure | fetch rejects TypeError | throws with `errorClass: "network"` |

---

## Common Pitfalls

### Pitfall 1: Calling `.json()` on Unpin Response
**What goes wrong:** `unpinResponse.json()` throws a SyntaxError because the body is `"OK"` (plain text).
**Why it happens:** Pinata documents the success response as text/plain, not application/json.
**How to avoid:** Always use `.text()` for the unpin response. Only call `.json()` on `pinJSONToIPFS` responses.
**Warning signs:** `SyntaxError: Unexpected token O in JSON at position 0`

### Pitfall 2: AbortController Not Cleared on Success
**What goes wrong:** `setTimeout` ID leaks; in long-running processes (not applicable here since bot is one-shot, but relevant for tests) the timer fires after the test completes.
**How to avoid:** Always `clearTimeout(timeoutId)` in both success and catch paths.
**Warning signs:** Test teardown warnings about async operations completing after test ends.

### Pitfall 3: Re-building Evidence in Execute Pass
**What goes wrong:** `new Date().toISOString()` is called again in the execute pass, producing a different `createdAt` than what was uploaded to IPFS. The on-chain `feedbackURI` points to a JSON with a different timestamp than what's actually stored at that CID.
**Why it happens:** Forgetting the WR-01 invariant when restructuring the two-pass flow.
**How to avoid:** Explicitly assert in code review: the `evidence` object built in the prepare pass is the only source of truth. The execute pass receives `PreparedAction = { action, evidence, feedbackURI }` and never calls `buildPositiveEvidence()` / `buildNegativeEvidence()`.
**Warning signs:** `isDuplicate: false` on re-runs when the item hasn't changed — means a new object was built with a new timestamp, producing a different CID.

### Pitfall 4: Logging Full Pinata Error Body Without Truncation
**What goes wrong:** Pinata's auth error responses occasionally include request metadata (though not confirmed to echo the JWT itself). Logging the full body at warn/error level is a security hygiene issue.
**How to avoid:** Truncate error body to 500 chars (D-21). The existing `sanitizeObject` in logger.ts already strips `Bearer <token>` patterns from strings, providing defense-in-depth.
**Warning signs:** Error log lines > 500 chars from Pinata responses.

### Pitfall 5: Treating `isDuplicate: true` as an Error
**What goes wrong:** Bot exits with error or skips the action when Pinata returns `isDuplicate: true` on re-upload.
**Why it happens:** Re-run after a prepare-pass shutdown produces the same content hash; Pinata signals it's already pinned.
**How to avoid:** Accept `isDuplicate: true` as a success — the CID is valid, the pin is active. Log it at debug level.

### Pitfall 6: IPFS Propagation Delay to cdn.kleros.link
**What goes wrong:** Operator clicks the `gateway_url` from the log immediately after upload; `cdn.kleros.link` returns 404.
**Why it happens:** IPFS gateways have eventual consistency — the CID may not be discoverable by other nodes until Pinata propagates it. The Kleros CDN is a gateway layered over Pinata pinning; propagation delay is typically seconds to minutes.
**How to avoid:** Gateway URL in logs is for operator convenience only, not for bot verification. CID verification after upload is explicitly out of scope (REQUIREMENTS.md). Operators should wait ~30s after upload before checking the gateway URL.
**Warning signs:** Intermittent 404s on `cdn.kleros.link/ipfs/<CID>` immediately after upload succeed log.

### Pitfall 7: Consecutive-Failure Counter Not Reset Across Prepare Iterations
**What goes wrong:** A successful upload doesn't reset the counter; 3rd failure (even after 2 successes in between) triggers systemic escalation.
**How to avoid:** Per D-18 — explicitly reset the counter to 0 on each successful upload. The counter is a `let consecutiveFailures = 0` initialized before the prepare loop.

### Pitfall 8: Nonce Tracking During Prepare/Execute Split
**What goes wrong:** The nonce counter from the execute pass uses the pre-prepare nonce. This is fine if the prepare pass makes no on-chain calls (which it doesn't — uploads are pure HTTP), but must be verified.
**How to avoid:** Nonce is fetched once at the start of the execute pass (same as current code). The prepare pass has no effect on nonce. No change needed to nonce management.

### Pitfall 9: vitest Module Resolution — `.js` Extension
**What goes wrong:** `vi.mock("../src/ipfs")` without the `.js` extension fails in Node16 module resolution.
**How to avoid:** Use `vi.mock("../src/ipfs.js")` — matching the existing `chain.test.ts` pattern for all local imports.
**Warning signs:** `ERR_MODULE_NOT_FOUND` in tests.

### Pitfall 10: `PINATA_JWT` Already in logger.ts Redact Paths
**What goes wrong:** Planner adds `PINATA_JWT` to logger.ts redact paths again, creating a duplicate.
**How to avoid:** `logger.ts` already has `"PINATA_JWT"` and `"config.PINATA_JWT"` in `redact.paths`. No change needed to logger.ts for basic JWT path redaction. Only config.ts needs updating for zod validation error messages.

---

## Decisions Validated

| D-ID | Decision | Research Finding |
|------|----------|-----------------|
| D-05 | New `bot/src/ipfs.ts` module | Validated: clean separation, ~60 LOC |
| D-06 | Native fetch, no SDK | Validated: SDK adds 230+ deps for one HTTP call; native fetch covers full API surface |
| D-07 | Request body shape `{pinataContent, pinataMetadata}` | VERIFIED: matches official docs exactly |
| D-08 | Response fields `{IpfsHash, PinSize, Timestamp}` | VERIFIED: SDK README + official docs; also `isDuplicate` (handle as success) |
| D-10 | CIDv0 default (`Qm...` prefix) | VERIFIED: Pinata default omits `cidVersion` or uses `0`; returns `Qm...` CID |
| D-14 | AbortController 30s timeout | VERIFIED: Node 22 AbortController + fetch works cleanly; AbortError via `err.name === "AbortError"` |
| D-15 | One retry on 5xx/429; no retry on 4xx/network | VERIFIED: 4xx are deterministic (auth/bad request); network errors ambiguous |
| D-17 | 3 consecutive = systemic | VALIDATED: pattern matches Phase 5 differentiated policy |
| D-20 | Four error classes: auth/rate-limit/server/network | VERIFIED: maps to HTTP 401+403 / 429 / 5xx / fetch throw |
| D-22 | Shutdown: abort in-flight fetch | CLARIFIED: simplest approach is "let current fetch complete, check flag before next" — consistent with Phase 5 |
| D-25 | `PINATA_JWT: z.string().optional()` | VERIFIED: matches existing config.ts optional pattern |
| D-27 | Pino redaction for PINATA_JWT | VERIFIED: already present in logger.ts; config.ts needs minor extension |
| D-29 | Metadata shape with keyvalues | VERIFIED: Pinata supports up to 10 keyvalues; our D-29 uses 4 |
| D-35 | Integration test: upload + unpin cleanup | VERIFIED: unpin response is text/plain "OK"; must use `.text()` not `.json()` |

---

## Planner Notes

### Risk 1: Shutdown + In-flight Fetch (D-22 Clarification)
CONTEXT.md D-22 says "abort any in-flight upload via its AbortController." The simplest safe implementation is: check `shutdownHolder.shutdown` before starting each fetch; do not wire the controller into the signal handler. This gives behavior identical to Phase 5 ("finish current action, then check"). The planner should decide whether to implement the more complex "abort the in-flight fetch" variant. **Recommendation: use the simpler pre-fetch check. The 30s AbortController timeout already handles runaway uploads.**

### Risk 2: PreparedAction Type Design
The prepare/execute split requires a new internal type (not exported, used only within `executeActions`). Something like:
```typescript
type PreparedAction =
  | { action: Action; status: "ready"; feedbackURI: string; evidence: EvidenceJson; cid: string }
  | { action: Action; status: "skip"; reason: string }
  | { action: Action; status: "no-ipfs" }; // Scenario 3 (revokeOnly)
```
This is Claude's Discretion (CONTEXT.md) — the planner should define this type. It is internal to `chain.ts` (or extracted to a `chain.types.ts` if preferred).

### Risk 3: Vitest Config File May Need Creation
The bot has no `vitest.config.ts` or `vitest.config.js`. The `unstubGlobals: true` option requires a config file (or `vitest.workspace.ts`). Wave 0 of the plan should include creating a minimal vitest config. Alternatively, test files can use `afterEach(() => vi.unstubAllGlobals())` without a config file.

### Risk 4: `ipfs.ts` Export Shape
The function signature specified in D-05: `uploadEvidenceToIPFS(evidence, metadata, jwt, timeoutMs)`. The return type should be `Promise<{ cid: string; gatewayUrl: string; size: number; timestamp: string }>`. This should be formalized in `types.ts` or `ipfs.ts` for the chain.ts callers. Planner should define the return type explicitly.

### Risk 5: Orphaned CIDs in Run Summary (D-24)
`orphaned_cids: string[]` in the run summary requires `RunSummary` in `types.ts` to be extended. This is a NEW field not currently in `RunSummary`. The planner must add it to both `RunSummary` (for the summary JSON shape) and wire it from `executeActions()` → caller (`index.ts` emitSummary).

### Risk 6: keyvalues Value Types (ASSUMED)
Pinata documents `keyvalues` as an object with no explicit type constraint on values. Community evidence suggests strings and numbers both work, but the D-29 decision already uses strings throughout (`agentId.toString()`, `chainId.toString()`) which avoids any type ambiguity.

### Risk 7: `.env.example` Update
Phase 5 added `TX_RECEIPT_TIMEOUT_MS` and `MIN_BALANCE_WEI` to `.env.example`. Phase 6 adds `PINATA_JWT` and `PINATA_TIMEOUT_MS`. The planner should include a Wave 0 task to update `.env.example`.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 6 has no new external tool dependencies beyond Node 22 native fetch (already available). Pinata is a remote SaaS API; no local service needed. The `PINATA_JWT` secret is validated at runtime.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.2 |
| Config file | none — runs via `vitest run` in package.json scripts |
| Quick run command | `cd bot && npm test -- ipfs` |
| Full suite command | `cd bot && npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| IPFS-01 | Upload to Pinata returns ipfs:// CID | unit | `npm test -- ipfs.test` | No — Wave 0 creates `bot/test/ipfs.test.ts` |
| IPFS-02 | Evidence matches v1 schema | unit | `npm test -- evidence` | Yes — extend `bot/test/evidence.test.ts` if exists |
| IPFS-03 | Upload failure skips item, batch continues | unit | `npm test -- chain.test` | Yes — extend `bot/test/chain.test.ts` |
| IPFS-04 | All uploads before any txs | unit | `npm test -- chain.test` | Yes — extend `bot/test/chain.test.ts` |
| IPFS-05 | Absent JWT skips S1/S2, S3 proceeds | unit | `npm test -- chain.test` | Yes — extend `bot/test/chain.test.ts` |

### Wave 0 Gaps
- [ ] `bot/test/ipfs.test.ts` — new file, covers D-34 matrix (10 test cases)
- [ ] `bot/test/ipfs.integration.test.ts` — new file, covers D-35 (gated by `PINATA_JWT` env)
- [ ] Vitest config for `unstubGlobals: true` — either `bot/vitest.config.ts` or per-file `afterEach(() => vi.unstubAllGlobals())`

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Not applicable to bot |
| V3 Session Management | No | Bot is one-shot, no sessions |
| V4 Access Control | No | Bot uses single service account |
| V5 Input Validation | Yes | `zod` schema validates all env vars including PINATA_JWT |
| V6 Cryptography | No | No cryptographic operations in Phase 6 |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| JWT leakage in logs | Information Disclosure | pino redact paths already cover `PINATA_JWT` and `Authorization`; `sanitizeObject` regex covers Bearer tokens in error strings |
| JWT leakage in Pinata error body | Information Disclosure | Truncate error bodies to 500 chars (D-21); pino sanitizeObject catches `Bearer <token>` patterns |
| Evidence timestamp drift (WR-01) | Tampering | Capture `createdAt` once in prepare pass, never call `new Date()` in execute pass |
| Orphaned pins | Availability (cost) | Acceptable per CONTEXT.md — same CID on re-upload, negligible cost; D-24 logs CIDs |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Pinata 4xx error body is JSON `{ "error": string }` | Pinata API Reference | Error parsing code would throw; add try/catch with `.text()` fallback (already recommended in pattern above) |
| A2 | Pinata 429 response does NOT include a `Retry-After` header | Pinata API Reference | If present, we could respect it; current design ignores it — 1s fixed delay is conservative |
| A3 | `keyvalues` string values have no documented length cap | Pinata API Reference | D-29 values are short (e.g., `"11155111"`, `"0xabc..."`) — unlikely to hit any limit |
| A4 | `cdn.kleros.link` is a Pinata-pinned gateway (not independent IPFS node) | CDN Propagation | If not, propagation delay could be longer; no bot behavior changes |
| A5 | Pinata does not echo the Authorization header in error response bodies | Security | If wrong, pino sanitizeObject regex (`Bearer [A-Za-z0-9._-]+`) already redacts it; defense-in-depth is in place |

---

## Sources

### Primary (HIGH confidence)
- `docs.pinata.cloud/api-reference/endpoint/ipfs/pin-json-to-ipfs` — pinJSONToIPFS endpoint schema
- `docs.pinata.cloud/api-reference/endpoint/ipfs/unpin-file` — unpin endpoint (DELETE, returns text/plain "OK")
- `docs.pinata.cloud/account-management/limits` — rate limits table (60/min free, 100/s enterprise)
- `github.com/PinataCloud/Pinata-SDK/README.md` — response shape `{IpfsHash, PinSize, Timestamp, isDuplicate}`, cidVersion option
- MDN AbortSignal docs — AbortError name, TypeError distinction
- `vitest.dev/guide/mocking/globals` — vi.stubGlobal pattern
- `/Users/jaybuidl/project/kleros/reputation-oracle/bot/src/logger.ts` — PINATA_JWT already in redact paths
- `/Users/jaybuidl/project/kleros/reputation-oracle/bot/src/chain.ts` — WR-01 invariant location (lines 141-157)
- `/Users/jaybuidl/project/kleros/reputation-oracle/bot/src/types.ts` — ExecuteActionsResult, RunSummary shapes

### Secondary (MEDIUM confidence)
- `docs.pinata.cloud/account-management/api-keys` — scoped key concept (pinJSONToIPFS + unpin granular)
- `pinata.cloud/blog/how-to-use-scoped-api-keys-with-ipfs-app-development/` — scope list
- AppSignal 2025 AbortController guide — AbortError vs TypeError vs TimeoutError taxonomy
- GitHub Pinata-SDK issue #84 — 400 error body shape `{ "error": "..." }`

### Tertiary (LOW confidence — marked [ASSUMED] above)
- Pinata 4xx body format (not in official API docs, inferred from SDK issues)
- `Retry-After` header absence (not documented either way)
- keyvalues string length constraints (not documented)
- cdn.kleros.link gateway architecture / propagation timing

---

## Metadata

**Confidence breakdown:**
- Pinata request/response shape: HIGH — verified via official docs + SDK README
- Error body format: MEDIUM — inferred from GitHub issues, not official docs
- Rate limits: HIGH — verified via official docs
- Node 22 AbortController patterns: HIGH — verified via MDN + 2025 guides
- Pino redaction: HIGH — read live source code confirming PINATA_JWT already present
- vitest fetch mocking: HIGH — verified via official vitest docs
- Unpin endpoint: HIGH — verified via official docs (text/plain response confirmed)
- CDN propagation timing: LOW — no authoritative source found for cdn.kleros.link specifics

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (Pinata API is stable; vitest v4 API is stable)
