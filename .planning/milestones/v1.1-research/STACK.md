# Stack Research

**Domain:** Oracle bot (subgraph -> on-chain reputation) + Solidity Router contract
**Researched:** 2026-03-30 (v1.1 additions), 2026-03-24 (v1.0 baseline)
**Confidence:** HIGH

## v1.0 Baseline (validated, do not change)

| Technology | Version | Purpose |
|------------|---------|---------|
| TypeScript | ^5.7 | Bot language |
| Node.js | 22 LTS | Runtime (native `--env-file`, stable fetch) |
| viem | ^2.47 | Ethereum client, Multicall3 |
| zod | ^4.3 | Config validation |
| graphql-request | ^7.4 | Subgraph queries |
| tsx | ^4.21 | TypeScript execution |
| vitest | ^4.1 | Bot tests |
| Biome.js | ^2.4 | Lint + format |
| Solidity | ^0.8.20 | Router contract |
| Foundry | latest | Contract dev/test/deploy |
| OpenZeppelin | ^5.6 | UUPS proxy |

---

## v1.1 Stack Additions

Three new capabilities: IPFS evidence upload, transaction safety, structured logging.

### 1. IPFS Evidence Upload: Native fetch to Pinata REST API (no SDK)

| Decision | Value |
|----------|-------|
| Approach | Direct `fetch()` to Pinata REST API |
| Package | **None** -- use Node.js 22 native fetch |
| Auth | JWT bearer token via `Authorization: Bearer <PINATA_JWT>` header |
| Endpoint | `POST https://api.pinata.cloud/pinning/pinJSONToIPFS` |
| CID version | 1 (via `pinataOptions.cidVersion: 1`) |
| Gateway | `https://gateway.pinata.cloud/ipfs/{cid}` for feedbackURI |

**Why no SDK:** The `pinata` npm package (v2.5.5) is a 230+ dependency tree for what is a single POST request. The bot only needs `pinJSONToIPFS` -- one endpoint, one JSON body, one response. Node.js 22 native `fetch()` handles this with zero dependencies. The evidence JSON is <2KB; no streaming, no file uploads, no multipart needed.

**API contract:**

```typescript
// Request
const response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.PINATA_JWT}`,
  },
  body: JSON.stringify({
    pinataOptions: { cidVersion: 1 },
    pinataMetadata: { name: `kleros-reputation-${agentId}.json` },
    pinataContent: evidenceJson,
  }),
});

// Response (200 OK)
interface PinataResponse {
  IpfsHash: string;   // CID v1 hash
  PinSize: number;    // bytes
  Timestamp: string;  // ISO 8601
  isDuplicate: boolean;
}
```

**feedbackURI format:** `ipfs://{IpfsHash}` (standard IPFS URI scheme, not gateway URL -- the on-chain data should be gateway-agnostic).

**Fallback:** If Pinata upload fails, fall back to current `data:application/json;base64,...` URI. Evidence is still on-chain (in calldata), just not pinned to IPFS. Log a warning but don't block the transaction.

**Config additions (zod):**

| Env var | Required | Purpose |
|---------|----------|---------|
| `PINATA_JWT` | No (optional) | Pinata API JWT. If absent, use data: URI fallback |
| `PINATA_GATEWAY` | No | Custom gateway domain. Default: `gateway.pinata.cloud` |

**Confidence:** HIGH -- Pinata REST API is stable, well-documented, and the `pinJSONToIPFS` endpoint has been unchanged since 2020.

### 2. Transaction Safety: viem built-in patterns + custom retry wrapper

| Concern | Solution | Package |
|---------|----------|---------|
| Gas estimation | viem `writeContract` auto-estimates; add 20% buffer via `gas` param | viem (existing) |
| Nonce management | Already sequential with manual nonce increment (current code) | viem (existing) |
| Receipt polling | viem `waitForTransactionReceipt` with `timeout` (current code) | viem (existing) |
| Dropped/replaced tx | `waitForTransactionReceipt` with `retryCount` + `pollingInterval` params | viem (existing) |
| Balance preflight | `publicClient.getBalance()` check before first tx in batch | viem (existing) |
| Retry on RPC error | Custom wrapper with exponential backoff for transient errors | **No new dep** |
| SIGTERM shutdown | `AbortController` + `process.on('SIGTERM')` | Node.js built-in |

**No new packages needed.** viem already provides all the primitives. The gap is a retry wrapper and signal handling -- both achievable with native Node.js.

**Retry pattern:**

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts: number; baseDelay: number; signal?: AbortSignal }
): Promise<T> {
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    opts.signal?.throwIfAborted();
    try {
      return await fn();
    } catch (error) {
      if (attempt === opts.maxAttempts) throw error;
      if (!isTransientError(error)) throw error;
      const delay = opts.baseDelay * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

function isTransientError(error: unknown): boolean {
  // RPC rate limit, network timeout, 429/502/503 status
  const msg = error instanceof Error ? error.message : String(error);
  return /timeout|rate.limit|429|502|503|ECONNRESET|ETIMEDOUT/i.test(msg);
}
```

**Gas buffer pattern:**

```typescript
const estimatedGas = await publicClient.estimateContractGas({ ... });
const gasWithBuffer = (estimatedGas * 120n) / 100n; // 20% buffer
await walletClient.writeContract({ ..., gas: gasWithBuffer });
```

**Balance preflight:**

```typescript
const balance = await publicClient.getBalance({ address: account.address });
if (balance < minRequired) {
  throw new Error(`Insufficient balance: ${balance} < ${minRequired}`);
}
```

**Confidence:** HIGH -- these are standard viem patterns, no new dependencies.

### 3. Structured JSON Logging: pino

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| pino | ^10.3 | Structured JSON logger | 5x faster than winston, JSON by default, child loggers for context, 0 config for machine-readable output |
| pino-pretty | ^14.0 | Dev-mode human-readable output | Transforms JSON to colorized text during development only |

**Why pino over alternatives:**

| Option | Verdict | Reason |
|--------|---------|--------|
| pino | **Use this** | JSON by default, minimal overhead, child loggers for per-action context, widely adopted in Node.js ecosystem |
| winston | No | Heavier, more config, transport-based architecture is overkill for a one-shot bot |
| console.log | No (current) | No structured fields, no levels, no machine-parseable output, no context propagation |
| Node.js console with JSON.stringify | No | Manual, no levels, no child loggers, no timestamp format control |

**Integration pattern:**

```typescript
import pino from "pino";

// Production: JSON to stdout. Dev: pipe to pino-pretty
const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  // Redact sensitive config
  redact: ["config.BOT_PRIVATE_KEY", "config.PINATA_JWT"],
});

// Child logger per action for context
const actionLog = logger.child({ agentId: 123n.toString(), action: "submitPositiveFeedback" });
actionLog.info({ txHash: "0x..." }, "transaction confirmed");

// Error with structured context
logger.error({ err, agentId: 123n.toString() }, "transaction reverted");
```

**pino handles BigInt:** pino does NOT serialize BigInt natively. Convert to string before logging: `agentId: action.agentId.toString()`. This is a minor but important detail.

**Config additions:**

| Env var | Required | Default | Purpose |
|---------|----------|---------|---------|
| `LOG_LEVEL` | No | `info` | pino log level: trace/debug/info/warn/error/fatal |

**Dev script update:**

```json
{
  "start:dev": "node --env-file=.env --import tsx src/index.ts | npx pino-pretty"
}
```

**Confidence:** HIGH -- pino v10 is the current stable release, actively maintained, well-documented.

### 4. SIGTERM/SIGINT Graceful Shutdown: Node.js built-in

| Concern | Solution |
|---------|----------|
| Signal registration | `process.on('SIGTERM', handler)` + `process.on('SIGINT', handler)` |
| Abort in-flight work | `AbortController` with signal passed to retry wrapper and fetch calls |
| Cleanup | Log final state, flush pino (`logger.flush()`), then `process.exit(0)` |

**No new packages.** Node.js 22 has mature `AbortController` support across all async APIs.

**Pattern:**

```typescript
const controller = new AbortController();

process.on("SIGTERM", () => {
  logger.warn("SIGTERM received, aborting after current action...");
  controller.abort();
});
process.on("SIGINT", () => {
  logger.warn("SIGINT received, aborting after current action...");
  controller.abort();
});

// Pass signal to executeActions loop
for (const action of actions) {
  controller.signal.throwIfAborted(); // Check before each tx
  await executeAction(action, { signal: controller.signal });
}
```

**Key detail:** Registering SIGINT listener disables Node.js default exit-on-Ctrl+C behavior. Must explicitly call `process.exit()` in the catch handler.

**Confidence:** HIGH -- standard Node.js patterns, no dependencies.

---

## Summary of v1.1 Dependencies

### New production dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| pino | ^10.3 | Structured JSON logging |

### New dev dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| pino-pretty | ^14.0 | Human-readable dev logs |

### Installation

```bash
# New production dep
npm install pino

# New dev dep
npm install -D pino-pretty
```

**Total new dependencies: 1 production, 1 dev.** Pinata uses native fetch. Transaction safety uses viem built-ins. Signal handling uses Node.js built-ins. Only logging requires a new package.

---

## v1.1 Config Schema Update

Full config after v1.1 additions:

| Env var | Type | Required | Source |
|---------|------|----------|--------|
| `RPC_URL` | string | Yes | v1.0 |
| `BOT_PRIVATE_KEY` | hex string | Yes | v1.0 |
| `ROUTER_ADDRESS` | address | Yes | v1.0 |
| `PGTCR_ADDRESS` | address | Yes | v1.0 |
| `SUBGRAPH_URL` | url | Yes | v1.0 |
| `CHAIN_ID` | number | Yes | v1.0 |
| `PINATA_JWT` | string | No | v1.1 -- enables IPFS upload; if absent, falls back to data: URI |
| `LOG_LEVEL` | enum | No (default: info) | v1.1 -- pino log level |

---

## Integration Points with Existing Code

### evidence.ts

Current `buildFeedbackURI()` returns `data:` URI. v1.1 adds `uploadToIPFS()` that calls Pinata API and returns `ipfs://{cid}`. The `buildFeedbackURI` function becomes async with IPFS-first, data-URI-fallback.

### chain.ts

Current `executeActions()` has sequential nonce management. v1.1 wraps each `writeContract` call with retry logic, adds gas estimation buffer, and checks `AbortSignal` between actions.

### index.ts

Current entry point uses `console.log`. v1.1 replaces all `console.log/error` with pino logger, adds signal handlers at startup, passes `AbortController.signal` through the execution pipeline.

### config.ts

Current zod schema validates env vars. v1.1 adds optional `PINATA_JWT` (with redaction) and `LOG_LEVEL` fields.

---

## What NOT to Add

| Avoid | Why |
|-------|-----|
| `pinata` npm package | Massive dependency tree for a single POST request; native fetch is sufficient |
| `winston` | Heavier than pino, transport architecture is overkill for one-shot bot |
| `bunyan` | Unmaintained since 2021 |
| `node-fetch` | Node.js 22 has native fetch |
| `retry` / `p-retry` npm | Simple exponential backoff is ~15 lines; no package needed |
| `@pinata/sdk` (old) | Deprecated, last published 3 years ago |
| Any daemon/process manager | Bot is one-shot; external scheduler handles invocation |

---

## Alternatives Considered (v1.1 specific)

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| IPFS pinning | Native fetch to Pinata API | `pinata` SDK v2.5 | Single POST doesn't justify 230+ dep tree |
| IPFS pinning | Pinata | web3.storage | Pinata simpler API, better uptime, no w3up client setup |
| IPFS pinning | Pinata | Infura IPFS | Infura IPFS is being deprecated |
| Logging | pino ^10.3 | winston ^3 | pino 5x faster, JSON-native, less config |
| Logging | pino ^10.3 | structured console.log | No levels, no child loggers, no redaction |
| Retry | Custom 15-line wrapper | `p-retry` | Trivial logic, not worth a dependency |
| Signal handling | Node.js AbortController | `stoppable` / `terminus` | Those are for HTTP servers, not one-shot bots |

---

## Sources

- [Pinata Docs - Pin JSON to IPFS](https://docs.pinata.cloud/api-reference/endpoint/ipfs/pin-json-to-ipfs) -- REST API contract, auth headers, response format
- [Pinata Docs - SDK Getting Started](https://docs.pinata.cloud/sdk/getting-started) -- SDK evaluated and rejected for this use case
- [pino npm](https://www.npmjs.com/package/pino) -- v10.3.1, last published Jan 2026
- [pino GitHub](https://github.com/pinojs/pino) -- JSON logger, child loggers, redaction
- [Pino Logger Guide 2026 - SigNoz](https://signoz.io/guides/pino-logger/) -- pino vs winston benchmarks
- [viem sendTransaction docs](https://viem.sh/docs/actions/wallet/sendTransaction.html) -- gas, nonce, retry params
- [viem nonce discussion #1338](https://github.com/wevm/viem/discussions/1338) -- parallel nonce management patterns
- [Node.js Process docs](https://nodejs.org/api/process.html) -- SIGTERM/SIGINT signal handling
- [AbortController in Node.js - AppSignal](https://blog.appsignal.com/2025/02/12/managing-asynchronous-operations-in-nodejs-with-abortcontroller.html) -- AbortController patterns

---
*Stack research for: Kleros Reputation Oracle v1.1 Production Hardening*
*Researched: 2026-03-30*
