# Phase 6: IPFS Evidence - Pattern Map

**Mapped:** 2026-04-21
**Files analyzed:** 8 (3 new, 5 modified)
**Analogs found:** 8 / 8

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `bot/src/ipfs.ts` | service | request-response (HTTP) | `bot/src/tx.ts` | role-match (boundary module: HTTP not on-chain) |
| `bot/src/evidence.ts` | utility | transform | `bot/src/evidence.ts` (self) | exact (signature change only) |
| `bot/src/chain.ts` | service | request-response | `bot/src/chain.ts` (self) | exact (restructure only) |
| `bot/src/config.ts` | config | — | `bot/src/config.ts` (self) | exact (additive only) |
| `bot/src/logger.ts` | config | — | `bot/src/logger.ts` (self) | exact (verify-only, already done) |
| `bot/src/types.ts` | model | — | `bot/src/types.ts` (self) | exact (additive only) |
| `bot/test/ipfs.test.ts` | test | — | `bot/test/tx.test.ts` | role-match (boundary module unit test) |
| `bot/test/ipfs.integration.test.ts` | test | — | `bot/test/chain.test.ts` | partial-match (gated integration test shape) |
| `bot/vitest.config.ts` | config | — | none exists | no analog |

---

## Integration Points

```
bot/src/index.ts
  └─ imports: executeActions() from chain.ts
               RunSummary, ExecuteActionsResult from types.ts
               flushAndExit() (local)

bot/src/chain.ts  [MODIFIED — prepare/execute split]
  └─ imports: uploadEvidenceToIPFS() from ipfs.ts  [NEW IMPORT]
              buildPositiveEvidence(), buildNegativeEvidence() from evidence.ts
              buildFeedbackURI() from evidence.ts  [signature changes]
              Config from config.ts  [reads PINATA_JWT, PINATA_TIMEOUT_MS]
              Action, ExecuteActionsResult, ShutdownHolder from types.ts

bot/src/ipfs.ts  [NEW]
  └─ imports: EvidenceJson from types.ts
              createChildLogger() from logger.ts
  └─ exports: uploadEvidenceToIPFS()
              PinataUploadResult  (return type, may be inline or re-exported)

bot/src/evidence.ts  [MODIFIED — buildFeedbackURI signature]
  └─ exports: buildFeedbackURI(cid: string) => `ipfs://${cid}`  (was: evidence object)
              buildPositiveEvidence()  [unchanged]
              buildNegativeEvidence()  [unchanged]

bot/src/config.ts  [MODIFIED — two new fields]
  └─ exports: Config  [widens with PINATA_JWT?, PINATA_TIMEOUT_MS]

bot/src/types.ts  [MODIFIED — three new fields/reasons]
  └─ exports: ExecuteActionsResult  [adds orphaned_cids?]
              RunSummary  [adds uploads_attempted, uploads_succeeded, uploads_failed, orphaned_cids]
              (item-skip reason "ipfs-upload-failed" is a string literal, no enum to update)
              (systemic reason "pinata-unavailable" likewise — string field in systemicFailure?)
```

---

## Pattern Assignments

### `bot/src/ipfs.ts` (new service, request-response/HTTP)

**Analog:** `bot/src/tx.ts`

**Rationale:** Both are boundary modules that wrap an external call (tx.ts: on-chain via viem; ipfs.ts: off-chain via native fetch), expose a single public async function, classify errors, and implement a retry loop that mirrors the same structural shape: attempt loop → classify → retry or rethrow → exhausted → throw lastError.

**Imports pattern** — copy from `bot/src/tx.ts` lines 1-11, substitute `fetch` for viem:

```typescript
import { createChildLogger } from "./logger.js";
import type { EvidenceJson } from "./types.js";

const log = createChildLogger("ipfs");

const PINATA_PIN_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS";
const KLEROS_GATEWAY = "https://cdn.kleros.link/ipfs/";
const MAX_RETRIES = 1; // one retry on server/rate-limit only
const RETRY_DELAY_MS = 1000;
```

**Error classification pattern** — mirror shape of `bot/src/tx.ts::isRevertError` / `isTransientError` (lines 53-65), but for HTTP:

```typescript
// bot/src/tx.ts lines 53-65 (analog — viem walk pattern)
export function isRevertError(err: unknown): boolean {
  if (!(err instanceof BaseError)) return false;
  return err.walk((e) => e instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError;
}

export function isTransientError(err: unknown): boolean {
  if (!(err instanceof BaseError)) return false;
  const inner = err.walk((e) => e instanceof HttpRequestError || e instanceof TimeoutError);
  return inner instanceof HttpRequestError || inner instanceof TimeoutError;
}

// Phase 6 analog — HTTP equivalent (module-private, string literals per D-20):
type PinataErrorClass = "auth" | "rate-limit" | "server" | "network";

function classifyHttpStatus(status: number): PinataErrorClass {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate-limit";
  if (status >= 500) return "server";
  return "network"; // unexpected 4xx
}

function classifyFetchError(err: unknown): PinataErrorClass {
  if (err instanceof Error) {
    if (err.name === "AbortError") return "network"; // timeout we imposed
    if (err.name === "TypeError") return "network";  // DNS / connection
  }
  return "network";
}
```

**Retry loop pattern** — copy from `bot/src/tx.ts::estimateGasWithRetry` (lines 23-47), simplify to 1 retry, HTTP instead of RPC:

```typescript
// bot/src/tx.ts lines 23-47 (the retry template):
export async function estimateGasWithRetry(
  publicClient: PublicClient,
  params: EstimateContractGasParameters,
): Promise<bigint> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await publicClient.estimateContractGas(params);
    } catch (err) {
      lastError = err;
      if (isRevertError(err)) {
        throw err; // immediate — no retry for reverts
      }
      if (!isTransientError(err)) {
        throw err; // fail fast on unexpected non-transient errors (WR-03)
      }
      if (attempt < MAX_ATTEMPTS) {
        log.debug({ attempt, delayMs: BASE_DELAY_MS * 2 ** (attempt - 1) }, "Gas estimation failed, retrying");
        await delay(BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    }
  }
  throw lastError; // exhausted — caller classifies and skips
}

// Phase 6 analog structure (for uploadEvidenceToIPFS):
export async function uploadEvidenceToIPFS(
  evidence: EvidenceJson,
  metadata: PinataMetadata,  // { name, keyvalues }
  jwt: string,
  timeoutMs: number,
): Promise<{ cid: string; gatewayUrl: string; size: number; timestamp: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(PINATA_PIN_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pinataContent: evidence, pinataMetadata: metadata }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorClass = classifyHttpStatus(response.status);
        let errorBody = "(non-JSON body)";
        try {
          const json = await response.json() as { error?: string };
          errorBody = (json.error ?? JSON.stringify(json)).slice(0, 500);
        } catch {
          errorBody = (await response.text().catch(() => "(unreadable body)")).slice(0, 500);
        }
        const err = Object.assign(new Error(`Pinata ${response.status}: ${errorBody}`), { errorClass });
        throw err;
      }

      const { IpfsHash, PinSize, Timestamp } = await response.json() as {
        IpfsHash: string; PinSize: number; Timestamp: string; isDuplicate?: boolean;
      };
      return { cid: IpfsHash, gatewayUrl: `${KLEROS_GATEWAY}${IpfsHash}`, size: PinSize, timestamp: Timestamp };
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;
      const errorClass = (err as { errorClass?: PinataErrorClass }).errorClass ?? classifyFetchError(err);
      if (errorClass !== "server" && errorClass !== "rate-limit") throw err; // no retry
      if (attempt < MAX_RETRIES) {
        log.debug({ attempt, errorClass }, "Pinata upload failed, retrying");
        await delay(RETRY_DELAY_MS);
      }
    }
  }
  throw lastError;
}
```

**`delay` helper** — defined module-private, identical to tx.ts line 67-69:

```typescript
// bot/src/tx.ts lines 67-69 (copy verbatim):
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

**Deviation from analog:** tx.ts uses viem `err.walk()` for error classification because viem wraps errors in nested `BaseError` chains. ipfs.ts deals with plain `Error` objects from native fetch and HTTP status codes — no `.walk()` needed, use `err.name` and HTTP status directly.

---

### `bot/src/evidence.ts` (utility, transform — signature change only)

**Analog:** `bot/src/evidence.ts` (self — minimal change)

**Current `buildFeedbackURI` implementation** (lines 75-79):

```typescript
// bot/src/evidence.ts lines 75-79 — CURRENT (to be replaced):
export function buildFeedbackURI(evidence: EvidenceJson): string {
  const json = JSON.stringify(evidence);
  const base64 = Buffer.from(json).toString("base64");
  return `data:application/json;base64,${base64}`;
}
```

**New implementation:**

```typescript
// Phase 6 replacement — signature changes to accept CID string:
export function buildFeedbackURI(cid: string): string {
  return `ipfs://${cid}`;
}
```

**Deviation from analog:** The old function accepts an `EvidenceJson` object (builds URI from content). The new function accepts a `string` CID (URI is just the scheme + CID). The evidence encoding responsibility moves entirely to the Pinata upload in `ipfs.ts`.

**Test impact:** `bot/test/evidence.test.ts` has two tests for `buildFeedbackURI` (lines 14-68) that test the `data:` URI shape. Both tests must be rewritten to assert `ipfs://<cid>` output. The test at line 36 (`uri.toMatch(/^data:application\/json;base64,/)`) becomes `expect(buildFeedbackURI("QmTestCID")).toBe("ipfs://QmTestCID")`.

---

### `bot/src/chain.ts` (service, restructure — prepare/execute split)

**Analog:** `bot/src/chain.ts` (self — internal restructure)

**Current `executeActions` structure** (lines 109-320) — single loop over actions, builds evidence + calls gas estimate + submits tx sequentially per action:

```typescript
// bot/src/chain.ts lines 109-116 — function signature (unchanged):
export async function executeActions(
  walletClient: WalletClient,
  publicClient: PublicClient,
  actions: Action[],
  config: Config,
  shutdownHolder: ShutdownHolder,
): Promise<ExecuteActionsResult>

// bot/src/chain.ts lines 116-118 — result accumulators (extend with upload counters):
let skipped = 0;
let txSent = 0;
// Phase 6 adds:
// let uploadsAttempted = 0;
// let uploadsSucceeded = 0;
// let uploadsFailed = 0;
// let consecutiveFailures = 0;
// const orphanedCids: string[] = [];
```

**WR-01 invariant site** (lines 141-191) — the block that builds evidence once and reuses it. This entire block MOVES to the prepare pass:

```typescript
// bot/src/chain.ts lines 141-157 — WR-01 invariant comment + evidence build (MOVES to prepare pass):
// Step 1: Gas estimation with retry (D-08/D-09/D-10)
// Build evidence and feedbackURI ONCE per action so gas estimate and writeContract
// use identical calldata (WR-01 — avoids createdAt timestamp drift between the two calls).
let gasEstimate: bigint;
let gasParams: EstimateContractGasParameters;
let feedbackURI: string | undefined;

if (action.type === "submitPositiveFeedback") {
  const evidence = buildPositiveEvidence({
    agentId: action.agentId,
    pgtcrItemId: action.pgtcrItemId,
    pgtcrAddress: config.PGTCR_ADDRESS,
    routerAddress: config.ROUTER_ADDRESS,
    chainId: config.CHAIN_ID,
    stake: action.item.stake,
  });
  feedbackURI = buildFeedbackURI(evidence);
  // ...
}
```

**Shutdown flag pattern** (lines 133-137) — copy to prepare-pass loop:

```typescript
// bot/src/chain.ts lines 133-137 — shutdown check (replicate at top of prepare loop):
if (shutdownHolder.shutdown) {
  log.info("Shutdown requested, skipping remaining actions");
  break;
}
```

**Systemic failure return pattern** (lines 266-268) — copy for `pinata-unavailable`:

```typescript
// bot/src/chain.ts lines 266-268 — systemic failure return (template for pinata-unavailable):
return { skipped, txSent, systemicFailure: "submission_failed_non_revert" };
// Phase 6 equivalent:
return { skipped, txSent, systemicFailure: "pinata-unavailable", orphanedCids };
```

**Item-skip + continue pattern** (lines 206-211) — copy for ipfs-upload-failed:

```typescript
// bot/src/chain.ts lines 196-211 — item skip + continue (template for upload failure):
const reason = isRevertError(err) ? "gas_estimation_reverted" : "gas_estimation_exhausted";
log.warn(
  {
    action: action.type,
    agentId: agentIdStr,
    reason,
    ...(reason === "gas_estimation_exhausted" ? { attempts: 3 } : {}),
    lastError: err instanceof Error ? err.message : String(err),
  },
  "Action skipped",
);
skipped++;
continue;
// Phase 6 analog for upload failure:
// log.warn({ error_class, agentId: agentIdStr, pgtcrItemId, scenario, actionIndex, retried }, "ipfs-upload-failed");
// skipped++;
// (mark PreparedAction as { status: "skip", reason: "ipfs-upload-failed" })
```

**New `PreparedAction` internal type** (not exported — used only within `executeActions` or its helpers):

```typescript
// Internal to chain.ts — planner defines this shape:
type PreparedAction =
  | { action: Action; status: "ready"; feedbackURI: string; evidence: EvidenceJson; cid: string }
  | { action: Action; status: "skip"; reason: string }
  | { action: Action; status: "no-ipfs" }; // Scenario 3 (revokeOnly — no URI needed)
```

**Deviation from analog:** Current `executeActions` is one loop. Phase 6 adds a prepare loop before the execute loop. The evidence-build block (lines 148-191) moves from the execute loop into the prepare loop. The execute loop receives `PreparedAction` instances instead of raw `Action` objects.

---

### `bot/src/config.ts` (config — additive only)

**Analog:** `bot/src/config.ts` (self)

**Existing optional fields pattern** (lines 14-17) — template for two new fields:

```typescript
// bot/src/config.ts lines 14-17 — existing optional config pattern:
LOG_LEVEL: z.string().optional().default("info"),
TX_RECEIPT_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(120_000),
MIN_BALANCE_WEI: z.coerce.bigint().optional().default(5_000_000_000_000_000n),

// Phase 6 additions (insert after MIN_BALANCE_WEI):
PINATA_JWT: z.string().optional(),                                         // no default — absence is a valid state (D-25)
PINATA_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(30_000),  // D-14
```

**Redaction pattern** (lines 28-33) — extend to cover PINATA_JWT:

```typescript
// bot/src/config.ts lines 28-33 — existing BOT_PRIVATE_KEY redaction:
const safeIssues = result.error.issues.map((issue) => ({
  path: issue.path,
  message: issue.message,
  // Never log the actual private key value
  ...(issue.path.includes("BOT_PRIVATE_KEY") ? { received: "[REDACTED]" } : {}),
}));

// Phase 6: extend the conditional to also cover PINATA_JWT:
...(issue.path.includes("BOT_PRIVATE_KEY") || issue.path.includes("PINATA_JWT") ? { received: "[REDACTED]" } : {}),
```

---

### `bot/src/logger.ts` (config — verify only, no changes needed)

**Finding:** `PINATA_JWT` is **already present** in `redact.paths` (lines 33-34):

```typescript
// bot/src/logger.ts lines 29-39 — current redact paths (NO CHANGE NEEDED):
redact: {
  paths: [
    "config.BOT_PRIVATE_KEY",
    "config.PINATA_JWT",   // already present
    "privateKey",
    "PINATA_JWT",           // already present
    "BOT_PRIVATE_KEY",
    "authorization",
    "Authorization",
  ],
},
```

The `sanitizeObject` function (lines 3-18) already handles Bearer token regex in error message strings. No changes required to logger.ts.

---

### `bot/src/types.ts` (model — additive only)

**Analog:** `bot/src/types.ts` (self)

**Current `ExecuteActionsResult`** (lines 76-80):

```typescript
// bot/src/types.ts lines 76-80 — current shape:
export interface ExecuteActionsResult {
  skipped: number;
  txSent: number;
  systemicFailure?: string; // reason code from D-19 taxonomy; absent on success
}

// Phase 6: add orphanedCids field:
export interface ExecuteActionsResult {
  skipped: number;
  txSent: number;
  systemicFailure?: string;
  orphanedCids?: string[]; // CIDs uploaded but not submitted (D-24)
}
```

**Current `RunSummary`** (lines 63-73):

```typescript
// bot/src/types.ts lines 63-73 — current shape:
export interface RunSummary {
  items: number;
  valid: number;
  actions: number;
  txSent: number;
  errors: number;
  durationMs: number;
  skipped: number;
  systemicFailure?: string;
}

// Phase 6: add upload counters and orphaned CIDs (D-33):
export interface RunSummary {
  items: number;
  valid: number;
  actions: number;
  txSent: number;
  errors: number;
  durationMs: number;
  skipped: number;
  systemicFailure?: string;
  uploadsAttempted?: number;   // absent when PINATA_JWT not configured (D-33)
  uploadsSucceeded?: number;
  uploadsFailed?: number;
  orphanedCids?: string[];     // D-24
}
```

The string literals `"ipfs-upload-failed"` and `"pinata-unavailable"` are used directly in `log.warn`/`log.error` and the `systemicFailure` field — no enum to update.

---

### `bot/test/ipfs.test.ts` (new test — unit, fetch mock)

**Analog:** `bot/test/tx.test.ts`

**Rationale:** tx.test.ts is the closest test for a boundary module (tests a single public function with retry logic, uses vitest mocks, covers all error classification branches). The describe/it structure and mock factory pattern match exactly.

**Import pattern** — copy from `bot/test/tx.test.ts` lines 1-8, substitute fetch for viem:

```typescript
// bot/test/tx.test.ts lines 1-8 (analog):
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  HttpRequestError,
  type PublicClient,
} from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { estimateGasWithRetry, isRevertError, isTransientError } from "../src/tx.js";

// Phase 6 analog — ipfs.test.ts:
import { beforeEach, describe, expect, it, vi } from "vitest";
import { uploadEvidenceToIPFS } from "../src/ipfs.js";
import type { EvidenceJson } from "../src/types.js";
```

**Global fetch stub pattern** — no analog exists yet; use `vi.stubGlobal` per RESEARCH.md:

```typescript
// In ipfs.test.ts — no current codebase analog; use RESEARCH.md pattern:
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
// No vitest.config.ts exists yet — add afterEach cleanup:
afterEach(() => {
  vi.unstubAllGlobals();
});
```

**Mock response factory pattern** — copy factory style from `bot/test/chain.test.ts` lines 29-56:

```typescript
// bot/test/chain.test.ts lines 29-36 (factory pattern — replicate in ipfs.test.ts):
function makeMockPublicClient() {
  return {
    estimateContractGas: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
    getBalance: vi.fn(),
    getTransactionCount: vi.fn().mockResolvedValue(0),
  } as unknown as PublicClient;
}

// Phase 6 analog:
function makeSuccessResponse(ipfsHash = "QmTestHash123"): Response {
  return {
    ok: true,
    json: async () => ({
      IpfsHash: ipfsHash,
      PinSize: 100,
      Timestamp: "2026-04-21T00:00:00Z",
      isDuplicate: false,
    }),
  } as unknown as Response;
}

function makeErrorResponse(status: number, body = { error: "test error" }): Response {
  return {
    ok: false,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}
```

**Describe/it test structure** — copy from `bot/test/tx.test.ts` lines 28-108:

```typescript
// bot/test/tx.test.ts lines 28-32 (top-level describe — mirror for ipfs.test.ts):
describe("estimateGasWithRetry", () => {
  let mockPublicClient: Pick<PublicClient, "estimateContractGas">;
  const dummyParams = { ... };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // ...
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns gas estimate on first success", async () => { ... });
  it("retries on HttpRequestError and succeeds on 3rd attempt", async () => { ... });
  // ...
});

// Phase 6 mirror:
describe("uploadEvidenceToIPFS", () => {
  const mockEvidence: EvidenceJson = { ... };
  const mockMetadata = { name: "kro-v1/11155111/1/0xabc", keyvalues: { agentId: "1", chainId: "11155111", pgtcrItemId: "0xabc", scenario: "verified" } };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // D-34 matrix tests follow (see RESEARCH.md §D-34 coverage matrix):
  it("returns cid and gatewayUrl on success", async () => { ... });
  it("treats isDuplicate=true as success", async () => { ... });
  it("throws with errorClass=auth on 401", async () => { ... });
  it("throws with errorClass=auth on 403", async () => { ... });
  it("throws with errorClass=rate-limit on 429", async () => { ... });
  it("retries once on 500, returns cid on success", async () => { ... });
  it("throws with errorClass=server after 500 retry exhausted", async () => { ... });
  it("throws with errorClass=network on AbortError (timeout)", async () => { ... });
  it("throws with errorClass=network on TypeError (DNS failure)", async () => { ... });
});
```

**Fake timers + retry pattern** — copy from `bot/test/tx.test.ts` lines 59-69:

```typescript
// bot/test/tx.test.ts lines 59-69 (fake timers for retry delay — replicate):
it("retries on HttpRequestError and succeeds on 3rd attempt", async () => {
  vi.mocked(mockPublicClient.estimateContractGas)
    .mockRejectedValueOnce(makeHttpError())
    .mockRejectedValueOnce(makeHttpError())
    .mockResolvedValueOnce(42000n);
  const promise = estimateGasWithRetry(mockPublicClient as PublicClient, dummyParams);
  await vi.runAllTimersAsync();
  const result = await promise;
  // ...
});

// Phase 6 analog (for 500 retry):
it("retries once on 500, returns cid on success", async () => {
  vi.mocked(globalThis.fetch)
    .mockResolvedValueOnce(makeErrorResponse(500))
    .mockResolvedValueOnce(makeSuccessResponse());
  const promise = uploadEvidenceToIPFS(mockEvidence, mockMetadata, "test-jwt", 5000);
  await vi.runAllTimersAsync();
  const result = await promise;
  expect(result.cid).toBe("QmTestHash123");
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);
});
```

---

### `bot/test/ipfs.integration.test.ts` (new test — gated integration)

**Analog:** No existing integration test in codebase. Structure taken directly from RESEARCH.md §"Integration Test Cleanup (D-35)".

**Key pattern — `test.skipIf` gate:**

```typescript
// Pattern from RESEARCH.md (no codebase analog):
import { test, expect } from "vitest";

test.skipIf(!process.env.PINATA_JWT)("uploads and unpins throwaway JSON", async () => {
  const jwt = process.env.PINATA_JWT!;
  // ... upload + assert CID format + unpin via DELETE
});
```

**Critical pitfall to encode in the test:** The unpin response is `text/plain "OK"` — must use `.text()` not `.json()` (RESEARCH.md §Pitfall 1).

---

### `bot/test/chain.test.ts` (existing test — extend for prepare/execute split)

**Analog:** `bot/test/chain.test.ts` (self — additive)

**Module mock pattern for ipfs.ts** — copy vi.mock from chain.test.ts style (lines 1-12), extend:

```typescript
// bot/test/chain.test.ts lines 1-12 (existing import style):
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  HttpRequestError,
  type PublicClient,
  WaitForTransactionReceiptTimeoutError,
  type WalletClient,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeActions } from "../src/chain.js";

// Phase 6: add module-level mock for ipfs.ts before imports:
vi.mock("../src/ipfs.js", () => ({
  uploadEvidenceToIPFS: vi.fn(),
}));
// And add the import:
import { uploadEvidenceToIPFS } from "../src/ipfs.js";
```

**Mock config extension** (lines 15-25) — add PINATA_JWT field:

```typescript
// bot/test/chain.test.ts lines 15-25 (existing mockConfig):
const mockConfig = {
  CHAIN_ID: 11155111,
  RPC_URL: "http://localhost:8545",
  ROUTER_ADDRESS: "0x0000000000000000000000000000000000000001",
  PGTCR_ADDRESS: "0x0000000000000000000000000000000000000002",
  SUBGRAPH_URL: "http://subgraph.example.com",
  BOT_PRIVATE_KEY: "0x" + "a".repeat(64),
  LOG_LEVEL: "silent",
  TX_RECEIPT_TIMEOUT_MS: 5000,
  MIN_BALANCE_WEI: 5_000_000_000_000_000n,
} as unknown as Config;

// Phase 6 extension:
const mockConfigWithJwt = {
  ...mockConfig,
  PINATA_JWT: "test-jwt",
  PINATA_TIMEOUT_MS: 5000,
} as unknown as Config;
// mockConfig (without PINATA_JWT) remains for D-26 absent-JWT tests
```

**New test cases to add** (per D-36):

```typescript
// Add inside describe("executeActions — differentiated failure policy"):

it("P1: S1 happy path — uploads to IPFS then submits tx", async () => {
  vi.mocked(uploadEvidenceToIPFS).mockResolvedValueOnce({ cid: "QmTest", gatewayUrl: "...", size: 100, timestamp: "..." });
  vi.mocked(publicClient.estimateContractGas).mockResolvedValueOnce(21000n);
  vi.mocked(walletClient.writeContract).mockResolvedValueOnce("0xhash" as `0x${string}`);
  vi.mocked(publicClient.waitForTransactionReceipt).mockResolvedValueOnce({ status: "success" } as any);
  const result = await executeActions(walletClient, publicClient, [makeAction()], mockConfigWithJwt, shutdownHolder);
  expect(uploadEvidenceToIPFS).toHaveBeenCalledTimes(1);
  expect(result.txSent).toBe(1);
});

it("P2: S3 (revokeOnly) — no IPFS call, tx proceeds", async () => {
  const action: Action = { type: "revokeOnly", agentId: 1n, item: makeItem() };
  vi.mocked(publicClient.estimateContractGas).mockResolvedValueOnce(21000n);
  vi.mocked(walletClient.writeContract).mockResolvedValueOnce("0xhash" as `0x${string}`);
  vi.mocked(publicClient.waitForTransactionReceipt).mockResolvedValueOnce({ status: "success" } as any);
  const result = await executeActions(walletClient, publicClient, [action], mockConfigWithJwt, shutdownHolder);
  expect(uploadEvidenceToIPFS).not.toHaveBeenCalled();
  expect(result.txSent).toBe(1);
});

it("P3: upload failure skips item, batch continues to next action", async () => {
  const action1 = makeAction(1n);
  const action2 = makeAction(2n);
  vi.mocked(uploadEvidenceToIPFS)
    .mockRejectedValueOnce(Object.assign(new Error("auth"), { errorClass: "auth" }))
    .mockResolvedValueOnce({ cid: "QmTest2", gatewayUrl: "...", size: 100, timestamp: "..." });
  vi.mocked(publicClient.estimateContractGas).mockResolvedValueOnce(21000n);
  vi.mocked(walletClient.writeContract).mockResolvedValueOnce("0xhash2" as `0x${string}`);
  vi.mocked(publicClient.waitForTransactionReceipt).mockResolvedValueOnce({ status: "success" } as any);
  const result = await executeActions(walletClient, publicClient, [action1, action2], mockConfigWithJwt, shutdownHolder);
  expect(result.skipped).toBe(1);
  expect(result.txSent).toBe(1);
});

it("P4: 3 consecutive upload failures → systemicFailure=pinata-unavailable", async () => {
  const [a1, a2, a3] = [makeAction(1n), makeAction(2n), makeAction(3n)];
  vi.mocked(uploadEvidenceToIPFS).mockRejectedValue(Object.assign(new Error("server"), { errorClass: "server" }));
  const result = await executeActions(walletClient, publicClient, [a1, a2, a3], mockConfigWithJwt, shutdownHolder);
  expect(result.systemicFailure).toBe("pinata-unavailable");
  expect(uploadEvidenceToIPFS).toHaveBeenCalledTimes(3);
  expect(walletClient.writeContract).not.toHaveBeenCalled();
});

it("P5: PINATA_JWT absent → S1/S2 skipped, S3 proceeds", async () => {
  const s1: Action = makeAction(1n);
  const s3: Action = { type: "revokeOnly", agentId: 2n, item: makeItem({ agentId: 2n }) };
  vi.mocked(publicClient.estimateContractGas).mockResolvedValueOnce(21000n);
  vi.mocked(walletClient.writeContract).mockResolvedValueOnce("0xhash" as `0x${string}`);
  vi.mocked(publicClient.waitForTransactionReceipt).mockResolvedValueOnce({ status: "success" } as any);
  const result = await executeActions(walletClient, publicClient, [s1, s3], mockConfig, shutdownHolder); // mockConfig has no PINATA_JWT
  expect(uploadEvidenceToIPFS).not.toHaveBeenCalled();
  expect(result.skipped).toBe(1); // s1 skipped
  expect(result.txSent).toBe(1);  // s3 sent
});

it("P6: SIGTERM during prepare → exit 0 without execute pass", async () => {
  vi.mocked(uploadEvidenceToIPFS).mockImplementationOnce(async () => {
    shutdownHolder.shutdown = true;
    return { cid: "QmTest", gatewayUrl: "...", size: 100, timestamp: "..." };
  });
  const result = await executeActions(walletClient, publicClient, [makeAction(1n), makeAction(2n)], mockConfigWithJwt, shutdownHolder);
  expect(walletClient.writeContract).not.toHaveBeenCalled();
  expect(result.systemicFailure).toBeUndefined();
});
```

---

### `bot/vitest.config.ts` (new config — no codebase analog)

No existing vitest.config.ts. Two options (planner decides):

**Option A — Create `bot/vitest.config.ts`** (cleanest, applies project-wide):

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    unstubGlobals: true,
  },
});
```

**Option B — Per-file cleanup without config** (no new file, add to each test):

```typescript
afterEach(() => {
  vi.unstubAllGlobals();
});
```

Option A is preferred — one line, applies to all future tests. The package.json `"test": "vitest run"` already discovers the config automatically.

---

## Shared Patterns

### Pino Structured Logging (Phase 4 baseline)
**Source:** `bot/src/chain.ts` lines 197-210 and `bot/src/logger.ts::createChildLogger`
**Apply to:** All new log calls in `ipfs.ts` and modified `chain.ts`

```typescript
// Pattern: context object first, message string second. Top-level keys (not nested).
// Success log (D-31):
log.info({ cid, size, duration_ms, gateway_url, agentId, pgtcrItemId, scenario }, "ipfs-upload-ok");

// Failure log (D-32):
log.warn({ error_class, error_message, agentId, pgtcrItemId, scenario, actionIndex, retried }, "ipfs-upload-failed");

// Module logger creation (copy from any src file):
const log = createChildLogger("ipfs");  // module name in every log line
```

### AbortController Timeout (Node 22 native)
**Source:** RESEARCH.md §"AbortController + fetch" (no existing codebase analog)
**Apply to:** `bot/src/ipfs.ts::uploadEvidenceToIPFS`

```typescript
// MUST clearTimeout in both success and catch paths (RESEARCH.md Pitfall 2):
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
try {
  const response = await fetch(url, { signal: controller.signal, ... });
  clearTimeout(timeoutId);
  // ...
} catch (err) {
  clearTimeout(timeoutId);
  // ...
}
```

### Zod Optional Config
**Source:** `bot/src/config.ts` lines 14-17
**Apply to:** `PINATA_JWT` and `PINATA_TIMEOUT_MS` additions

```typescript
// Existing pattern (lines 14-17):
TX_RECEIPT_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(120_000),
MIN_BALANCE_WEI: z.coerce.bigint().optional().default(5_000_000_000_000_000n),
// Phase 6 follows same pattern but PINATA_JWT has NO default:
PINATA_JWT: z.string().optional(),
PINATA_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(30_000),
```

### `.env.example` Update
**Source:** `bot/.env.example` lines 7-12
**Apply to:** Phase 6 adds two new commented fields

```bash
# Existing Phase 5 pattern (lines 7-12):
# TX_RECEIPT_TIMEOUT_MS: Receipt wait timeout in ms. Default: 120000 (L1). L2 deployments: use 30000.
# TX_RECEIPT_TIMEOUT_MS=120000

# MIN_BALANCE_WEI: Minimum wallet balance in wei before aborting. Default: 5000000000000000 (0.005 ETH).
# MIN_BALANCE_WEI=5000000000000000

# Phase 6 additions (same comment style):
# PINATA_JWT: Pinata API JWT for IPFS evidence upload. When absent, Scenario 1/2 actions are skipped.
# PINATA_JWT=

# PINATA_TIMEOUT_MS: Pinata upload timeout in ms. Default: 30000.
# PINATA_TIMEOUT_MS=30000
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `bot/vitest.config.ts` | config | — | No vitest config file exists; vitest runs via `npm test` with zero config |
| `bot/test/ipfs.integration.test.ts` | test | — | No integration tests exist in the codebase; structure from RESEARCH.md only |

---

## Deviations Summary

| File | What Deviates | Why |
|------|--------------|-----|
| `ipfs.ts` vs `tx.ts` | Error classification uses `err.name` and HTTP status codes, not `err.walk()` | Native fetch returns plain `Error` objects, not viem's nested `BaseError` chain |
| `ipfs.ts` vs `tx.ts` | MAX_RETRIES = 1 (not 3), no exponential backoff | One retry is all that's needed per D-15; no p-retry library per REQUIREMENTS |
| `evidence.ts` | `buildFeedbackURI` signature changes from `(evidence: EvidenceJson)` to `(cid: string)` | URI transport changes from data: to ipfs://, encoding now done by Pinata upload |
| `chain.ts` | Two loops instead of one | IPFS-04: all uploads before any transactions |
| `chain.test.ts` | Needs `vi.mock("../src/ipfs.js")` at module level | New import means new mock boundary |

---

## Metadata

**Analog search scope:** `bot/src/*.ts`, `bot/test/*.ts`
**Files scanned:** 12 source files (all bot/src/ + all bot/test/)
**Pattern extraction date:** 2026-04-21

---

## PATTERN MAPPING COMPLETE

**Phase:** 6 - IPFS Evidence
**Files classified:** 9 (3 new files, 5 modified files, 1 new config)
**Analogs found:** 7 / 9 (2 have no codebase analog)

### Coverage
- Files with exact analog (self-modification): 5 (`evidence.ts`, `chain.ts`, `config.ts`, `logger.ts`, `types.ts`)
- Files with role-match analog: 2 (`ipfs.ts` → `tx.ts`; `ipfs.test.ts` → `tx.test.ts`)
- Files with no analog: 2 (`vitest.config.ts`, `ipfs.integration.test.ts`)

### Key Patterns Identified
- `ipfs.ts` mirrors `tx.ts` structurally: single public function, attempt loop, classify-or-rethrow, module-private `delay()`, module-private classifier functions
- Error classification in `ipfs.ts` uses `err.name` string checks (not viem's `err.walk()`), mirroring the shape but not the mechanism of `tx.ts::isRevertError/isTransientError`
- Prepare/execute split in `chain.ts` follows existing single-loop structure extended with a new prepend loop; `PreparedAction` internal type carries pre-built evidence + CID into execute loop
- WR-01 invariant (evidence built once, `createdAt` captured once) is preserved by moving the evidence-build block from execute loop to prepare loop
- PINATA_JWT absent: S1/S2 actions skip at start of prepare pass (one warn log per action), S3 passes through to execute loop unchanged
- `logger.ts` already has `PINATA_JWT` in redact.paths — no changes required

### File Created
`/Users/jaybuidl/project/kleros/reputation-oracle/.planning/phases/06-ipfs-evidence/06-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can reference analog patterns and concrete code excerpts in PLAN.md files.
