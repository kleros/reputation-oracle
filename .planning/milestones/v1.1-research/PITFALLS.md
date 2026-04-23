# Domain Pitfalls

**Domain:** Subgraph-to-chain oracle / PGTCR-to-ERC-8004 reputation bridge
**Researched:** 2026-03-30
**Overall confidence:** MEDIUM-HIGH

> **Scope:** v1.1 pitfalls for adding IPFS evidence (Pinata), transaction safety hardening, and structured JSON logging to the existing stateless bot. v1.0 pitfalls retained where still applicable.

---

## Critical Pitfalls

Mistakes that cause rewrites, stuck state, or incorrect reputation data.

### Pitfall 1: IPFS Upload Inside the Transaction Loop Creates Cascading Failures

**What goes wrong:** The current `executeActions` loop in `chain.ts` builds evidence and feedbackURI inline (lines 122-131, 141-159). If Pinata replaces `buildFeedbackURI` as the evidence source, IPFS uploads happen mid-transaction-loop. Pinata returns a 429 rate limit after the 3rd upload, but nonce has already incremented twice. The remaining actions are blocked. Worse: if the upload timeout is long (Pinata's default is 30s), the RPC may drop the pending nonce slot, causing the next transaction to fail with a nonce gap.

**Why it happens:** The current architecture couples evidence construction with transaction execution. Moving from synchronous `data:` URI (zero latency, zero failure) to async HTTP upload (network-dependent, rate-limited) inside a nonce-managed loop is a category change the code structure does not accommodate.

**Consequences:** Partial action execution. Nonce desync. Wasted gas on confirmed transactions that will be followed by orphaned actions. Next run re-diffs and handles the rest, but ETH is wasted and reputation updates are delayed.

**Prevention:**
- Split into two phases: (1) prepare phase uploads ALL evidence to Pinata, producing a `Map<agentId, ipfsCID>`, (2) execute phase uses pre-resolved CIDs. If any upload fails in prepare phase, skip that action entirely -- do not enter the execute phase for it.
- The prepare phase is idempotent: re-uploading identical JSON to Pinata returns the same CID (content-addressed). No harm in duplicate uploads.
- Revoke-only actions (Scenario 3) need no IPFS upload. These should execute even when Pinata is down.

**Detection:** Log upload duration and success/failure count. Alert if prepare phase takes >30s total (indicates rate limiting or gateway issues).

**Phase:** v1.1 IPFS Evidence phase. Restructure the main flow before integrating Pinata.

---

### Pitfall 2: Pinata JWT/API Key Logged in Error Messages

**What goes wrong:** Pinata SDK or raw `fetch` calls throw errors that include the request headers (including `Authorization: Bearer <JWT>`). The bot's catch block logs the full error object. The JWT appears in stdout, CI logs, or monitoring dashboards. On a shared CI runner or log aggregation service, the key is now compromised.

**Why it happens:** Node.js `Error` objects from HTTP libraries often include the request config. `console.error(error)` or `JSON.stringify(error)` serializes everything. The current `config.ts` already redacts `BOT_PRIVATE_KEY` in validation errors (line 27), but there is no equivalent protection for Pinata credentials at the logging layer.

**Consequences:** Pinata API key compromise. Attacker can pin arbitrary content under the account, exhaust quotas, or use the gateway for abuse.

**Prevention:**
- Add `PINATA_JWT` to the config schema with the same redaction treatment as `BOT_PRIVATE_KEY`.
- In the structured logger, register a redaction list: `["PINATA_JWT", "BOT_PRIVATE_KEY", "Authorization"]`. Pino supports `redact: { paths: [...] }` natively.
- Never log raw HTTP error objects. Extract `status`, `statusText`, and a safe message substring.
- In error serializers, strip headers from error cause chains.

**Detection:** Grep logs for `eyJ` (JWT prefix) or `0x` followed by 64 hex chars. Automate as a CI check on log output during dry-run tests.

**Phase:** v1.1 Structured Logging phase (must land before or simultaneously with IPFS Evidence phase).

---

### Pitfall 3: SIGTERM During Transaction Execution Leaves Nonce in Limbo

**What goes wrong:** The bot is run by a cron scheduler (systemd timer, Kubernetes CronJob, GitHub Actions). The scheduler sends SIGTERM when the job exceeds its timeout. If SIGTERM arrives after `walletClient.writeContract` returns a tx hash but before `waitForTransactionReceipt` completes, the process exits. The transaction may or may not land on-chain. The nonce was incremented locally but the bot has no record of what happened. Next run: nonce from `getTransactionCount("pending")` depends on whether the tx landed. If it did, the diff is stale (action already executed). If it didn't, the pending nonce slot may be occupied by a ghost tx that eventually lands or is dropped.

**Why it happens:** `process.exit(0)` in the current `main().then(() => process.exit(0))` (index.ts line 64) fires immediately. No signal handler exists. Node.js default SIGTERM behavior is to terminate without running cleanup.

**Consequences:** Transaction ambiguity. Could lead to duplicate feedback (double +95 if the tx silently landed) or skipped negative feedback (if Scenario 2's revoke landed but negative didn't).

**Prevention:**
- Register `process.on('SIGTERM', ...)` and `process.on('SIGINT', ...)` that set a `shuttingDown` flag.
- Check `shuttingDown` before each iteration of the action loop. If true, do NOT start the next transaction. Exit after the current transaction confirms or times out.
- The key insight: for a one-shot bot, "graceful shutdown" means "finish the current transaction, then stop." NOT "cancel everything." A half-executed revoke+negative is worse than completing the current tx and stopping.
- Set a hard timeout on the signal handler (e.g., 15s). If the current tx receipt doesn't arrive within that window, `process.exit(1)` and let the next run sort it out via stateless diff.
- Do NOT call `process.exit()` inside the signal handler while an async operation is in-flight. Set the flag and let the main loop exit naturally.

**Detection:** Log when SIGTERM is received and what phase the bot is in (prepare, execute, done). If "execute" is logged with SIGTERM, the next run should be manually inspected.

**Phase:** v1.1 Transaction Safety phase.

---

### Pitfall 4: Gas Estimation Succeeds But Transaction Reverts Due to State Change

**What goes wrong:** The bot estimates gas for `submitPositiveFeedback(agentId, ...)`. Between estimation and submission, another actor (a second bot instance, a manual admin call, or a front-running MEV bot) calls the Router for the same agentId. The Router's state changes (e.g., feedback already submitted). The transaction reverts on-chain, consuming gas. The bot's `receipt.status === "reverted"` check catches it, but the nonce is consumed and the gas is wasted.

**Why it happens:** Gas estimation uses `eth_estimateGas` which simulates against current state. By the time the transaction is mined (next block or later), state may have changed. This is fundamental to Ethereum, not a bug. But for a bot that batches multiple actions with sequential nonces, one revert stops the entire remaining batch (current `D-10` stop-on-first-failure behavior).

**Consequences:** Wasted gas + entire remaining batch skipped. If the revert was on a revoke action (Scenario 2/3), the negative feedback for all subsequent agents in the batch is delayed until the next run.

**Prevention:**
- Use `simulateContract` (viem) before `writeContract` to catch state-change reverts before spending gas. This is a free `eth_call`, not an on-chain tx.
- If simulation fails, skip that action and continue with the next one (soft failure) instead of stopping the entire batch. Modify the `D-10` rule: stop on nonce/gas errors (infrastructure), continue on revert errors (state).
- For the Router specifically: make `submitPositiveFeedback` idempotent -- if feedback already exists for this agentId, return success (no-op) instead of reverting. This is a contract-level fix that eliminates the race condition entirely.
- If running multiple bot instances (future scaling), use a mutex or leader election. For v1.1, document that only one bot instance should run per Router.

**Detection:** Track revert reasons. If `feedbackAlreadyExists` appears, the race condition occurred. If `insufficientGas`, it's an estimation error.

**Phase:** v1.1 Transaction Safety phase. Simulation check is the bot-side fix; idempotent Router is a contract-side enhancement for later.

---

### Pitfall 5: Pinata Rate Limits Silently Degrade to Timeout

**What goes wrong:** Pinata's free tier allows ~200 requests per minute. The bot processes 50 actions, each uploading evidence JSON. Uploads 1-30 succeed in ~500ms. Uploads 31-50 start timing out at 30s each instead of returning 429. The bot spends 10+ minutes in the prepare phase. The cron scheduler's timeout fires, sends SIGTERM, and the bot is killed before executing any transactions.

**Why it happens:** Pinata's rate limiter behavior varies by plan and endpoint. The `/pinning/pinJSONToIPFS` endpoint may throttle rather than reject. The Pinata SDK's default timeout is generous. Without explicit timeouts on the bot side, "rate limited" manifests as "very slow" rather than "error."

**Consequences:** No transactions execute. The entire run is wasted. From the scheduler's perspective, the bot timed out -- indistinguishable from a hanging process.

**Prevention:**
- Set an explicit per-upload timeout (5s for a small JSON payload; these are <1KB).
- Set a total prepare-phase budget (e.g., 30s for all uploads combined). If exceeded, proceed with whatever CIDs were obtained and skip the rest.
- Track consecutive upload failures. After 3 consecutive failures, stop trying and proceed to execute phase with available CIDs only.
- Use Pinata's v2 API (`/v3/files`) which has clearer rate limit headers (`X-RateLimit-Remaining`, `Retry-After`). Parse these headers to detect rate limiting proactively.
- Consider batching: upload all evidence as a single directory/car file if Pinata supports it, reducing request count from N to 1.

**Detection:** Log per-upload latency. Any upload >3s for a <1KB JSON should trigger a warning. Total prepare-phase duration >30s should be an error-level log.

**Phase:** v1.1 IPFS Evidence phase.

---

## Moderate Pitfalls

### Pitfall 6: Structured Logging Breaks Dry-Run JSON Output

**What goes wrong:** The current dry-run mode (index.ts lines 39-48) prints actions as `JSON.stringify` to stdout. If structured logging replaces `console.log` with a JSON logger (e.g., Pino), dry-run output becomes interleaved with log lines -- both are JSON, but with different schemas. Downstream tools that parse dry-run output (`jq .`, monitoring scripts) break because they encounter log objects mixed with action objects.

**Why it happens:** Pino writes to stdout by default. The dry-run action dump also writes to stdout. Both are JSON. A `jq` pipe sees `{"level":30,"msg":"Fetched 10 items"}` followed by `[{"type":"submitPositiveFeedback",...}]` and fails to parse.

**Consequences:** Dry-run mode becomes unusable for automation. Operators cannot pipe dry-run output to `jq` or feed it to monitoring dashboards.

**Prevention:**
- Write structured logs to stderr. Pino supports `pino({ transport: { target: 'pino/file', options: { destination: 2 } } })` for stderr output.
- Reserve stdout exclusively for dry-run action output (when `--dry-run` flag is set).
- Alternatively: when `--dry-run` is active, suppress all log output except the final JSON dump. Use `logger.level = 'silent'` during dry-run.
- Test dry-run output with `node bot.js --dry-run 2>/dev/null | jq .` in CI to verify stdout is clean JSON.

**Detection:** CI test that runs dry-run and pipes stdout through `jq`. If jq exits non-zero, the log/output separation is broken.

**Phase:** v1.1 Structured Logging phase. Must be designed before implementing -- retrofitting stderr separation is harder.

---

### Pitfall 7: CID Verification Skipped -- Pinata Returns Success But Content Not Retrievable

**What goes wrong:** Pinata's `pinJSONToIPFS` returns `{ IpfsHash: "Qm..." }`. The bot stores this CID and passes it as `feedbackURI` to the Router. The Router stores it on-chain. But the content is not actually retrievable from any IPFS gateway for minutes (pinning propagation delay) or ever (Pinata internal error where the pin was recorded but data wasn't stored). The on-chain `feedbackURI` points to nothing.

**Why it happens:** IPFS pinning is eventually consistent. A successful API response means "we accepted the pin request," not "the content is globally available." Pinata's dedicated gateway may serve it immediately, but public gateways (`ipfs.io`, `dweb.link`) may not have it for 30-60 seconds, or at all if Pinata's internal replication failed.

**Consequences:** On-chain reputation feedback references unretrievable evidence. Consumers calling `feedbackURI` get 404 or timeout. The reputation signal exists but is unverifiable. For a system built on verifiability (Kleros disputes), this undermines the evidence chain.

**Prevention:**
- After uploading, verify the CID is retrievable from Pinata's dedicated gateway before using it on-chain. A simple `HEAD` request to `https://<gateway>.mypinata.cloud/ipfs/<CID>` with a 5s timeout.
- If verification fails, compute the CID locally from the JSON content (using `multiformats` or `ipfs-unixfs`) and compare with Pinata's returned CID. If they match, the content is correct -- propagation is just slow. Proceed anyway, since the content will eventually be available.
- If CIDs don't match, something is wrong. Skip that action.
- For the v1.1 scope: accept that propagation delay is inherent. The evidence JSON is small (<1KB) and deterministic. The CID can be independently verified by any consumer who reconstructs the JSON from on-chain data. Document this as a known property, not a bug.

**Detection:** Monitor 8004scan or a gateway probe for CID availability post-transaction.

**Phase:** v1.1 IPFS Evidence phase (verification is a nice-to-have, not a blocker).

---

### Pitfall 8: Receipt Polling Timeout Treated as Transaction Failure

**What goes wrong:** `waitForTransactionReceipt` in `chain.ts` (line 176) has a 60s timeout. On Ethereum mainnet during congestion, a transaction with a low `maxFeePerGas` may not be included for several minutes. The 60s timeout fires. The bot catches the timeout error. The current code throws, which halts the batch. But the transaction is still in the mempool and may land in 2 minutes.

**Why it happens:** The timeout on `waitForTransactionReceipt` is a local timeout, not a chain-level rejection. The transaction is valid and submitted -- it's just not yet included. The bot interprets "no receipt in 60s" as "failed" when it actually means "pending."

**Consequences:** Same as Pitfall 3 (SIGTERM): transaction ambiguity. The next run may see the tx landed (diff is clean) or it may not have landed yet (diff resubmits, potentially with a nonce conflict).

**Prevention:**
- Increase receipt timeout for mainnet (300s is reasonable; average block time is 12s, but congestion can cause 10+ block delays).
- Before treating a timeout as failure, check `eth_getTransactionByHash`. If it returns non-null, the tx is still pending -- log a warning and exit cleanly (exit code 0 or a distinct "pending" exit code). The next run's diff handles the outcome.
- For L2s (Arbitrum, Base -- future targets), receipt timeout can be lower (30s) because block times are faster and finality is quicker.
- Implement a configurable `TX_RECEIPT_TIMEOUT` env var. Default: 120s for L1, 30s for L2.

**Detection:** Log the tx hash and "receipt timeout" distinctly from "tx reverted." These are operationally different events requiring different responses.

**Phase:** v1.1 Transaction Safety phase.

---

### Pitfall 9: Balance Preflight Check Stale by Execution Time

**What goes wrong:** The bot checks ETH balance at startup. Balance is sufficient. During the action loop, each tx consumes gas. By action 8 of 10, the balance is insufficient. The transaction reverts with "insufficient funds," which the stop-on-failure logic catches. But 7 transactions already consumed gas for partial work.

**Why it happens:** Single balance check at startup doesn't account for cumulative gas cost of the batch. Gas prices can also spike between the preflight check and later transactions.

**Consequences:** Partial execution. ETH wasted on 7 transactions that will need complementary actions (the remaining 3) on the next run.

**Prevention:**
- Estimate total gas cost for the full batch before executing. Use `estimateContractGas` for each action, sum them, multiply by current `gasPrice` * 1.5 (safety margin). Compare against balance.
- If balance is insufficient for the full batch, execute only the first N actions that fit within the budget. Prioritize revocations (Scenario 2/3) over positive feedback (Scenario 1) since revocations are time-sensitive (disputed agents carrying positive reputation).
- Or simpler: check balance before each transaction, not just at startup. The overhead is one `eth_getBalance` call per action -- negligible compared to the transaction itself.

**Detection:** Log remaining balance after each transaction. Alert if balance drops below a threshold (e.g., 2x average action gas cost).

**Phase:** v1.1 Transaction Safety phase.

---

### Pitfall 10: Retry Logic Turns One-Shot Bot Into Long-Running Process

**What goes wrong:** The developer adds retry logic for Pinata uploads (3 retries with exponential backoff: 1s, 2s, 4s) and for RPC calls (3 retries: 2s, 4s, 8s). With 50 actions, each potentially hitting both IPFS and RPC retries, the worst case is 50 * (4s IPFS retries + 8s RPC retries) = 10 minutes. The "one-shot" bot now runs for 10+ minutes, violating the architecture constraint (CLAUDE.md: "No daemon mode. One-shot run, external scheduler invokes").

**Why it happens:** Each individual retry seems reasonable (3 attempts, short backoff). But retries multiply across the number of actions. The total execution time is unbounded if the action count grows.

**Consequences:** Scheduler timeout kills the bot. Or worse: the next cron tick fires a second instance while the first is still running. Two bots compete for the same nonce, causing all the nonce collision issues from v1.0 Pitfall 2.

**Prevention:**
- Set a global execution budget (e.g., 120s total). Track elapsed time. After the budget is exhausted, stop executing new actions and exit cleanly.
- Limit retries to infrastructure calls (RPC connection refused, DNS failure) not business logic failures (tx reverted, IPFS content rejected). Business failures should fail fast.
- Use circuit breaker pattern: after 3 consecutive IPFS failures, disable IPFS for the rest of the run (fall back to `data:` URI or skip evidence).
- The scheduler should enforce mutual exclusion (e.g., flock, PID file, or Kubernetes Job with `concurrencyPolicy: Forbid`) to prevent overlapping runs.

**Detection:** Log total execution time at exit. Alert if it exceeds 50% of the scheduler interval.

**Phase:** v1.1 Transaction Safety phase (execution budget). v1.1 IPFS Evidence phase (circuit breaker for Pinata).

---

### Pitfall 11: Pino Redaction Paths Don't Cover Nested Error Causes

**What goes wrong:** Pino's `redact: { paths: ['BOT_PRIVATE_KEY'] }` only works on top-level log object properties. An error thrown by viem includes the full transaction request in `error.cause.request.params`, which contains the private key as part of the account context. The error serializer passes this through unredacted because the path is deeply nested (`err.cause.request.params[0].from` or similar).

**Why it happens:** Pino's redaction uses fast-redact which operates on explicitly listed paths. It cannot wildcard into arbitrary nesting depths. viem's error objects are deeply nested with cause chains.

**Consequences:** Private key or Pinata JWT appears in structured logs when errors occur -- exactly when logs are most scrutinized.

**Prevention:**
- Use Pino's custom serializer for errors: `serializers: { err: (err) => sanitize(err) }` where `sanitize` recursively strips known sensitive patterns.
- Strip `Authorization` headers from any HTTP error: regex-replace `Bearer [A-Za-z0-9._-]+` with `Bearer [REDACTED]`.
- Strip hex strings matching private key pattern: replace `/0x[0-9a-f]{64}/gi` with `[REDACTED_KEY]` in serialized error output.
- Test by intentionally triggering errors with known keys and grepping the log output for the key material.

**Detection:** CI test that triggers an RPC error and greps structured log output for `BOT_PRIVATE_KEY` value and `PINATA_JWT` value.

**Phase:** v1.1 Structured Logging phase.

---

## Minor Pitfalls

### Pitfall 12: Log Level Defaults Hide Important Warnings in Production

**What goes wrong:** Developer sets default log level to `"info"` for production and `"debug"` for development. During a production incident, `debug`-level messages that would explain the failure (e.g., "Pinata returned 429 on attempt 2 of 3") are not emitted. Operator restarts with `LOG_LEVEL=debug`, but the issue is intermittent and doesn't reproduce.

**Prevention:**
- Default to `"info"` but log all retry attempts at `"warn"` level, not `"debug"`. Retries are operational signals, not debugging noise.
- Log phase transitions at `"info"`: "prepare phase started", "prepare phase complete (45 CIDs)", "execute phase started", "execute phase complete (45 txs)".
- Log individual actions at `"debug"`: per-agentId details, per-upload timing.
- Make `LOG_LEVEL` configurable via env var. Add it to the zod config schema.

**Phase:** v1.1 Structured Logging phase.

---

### Pitfall 13: IPFS CID Format Mismatch Between Pinata v1 and v3 API

**What goes wrong:** Pinata's v1 API (`/pinning/pinJSONToIPFS`) returns CIDv0 format (`Qm...`, base58). Pinata's v3 API (`/v3/files`) returns CIDv1 format (`bafy...`, base32). The Router contract stores the CID as a string in `feedbackURI`. If the bot switches between API versions (e.g., during a Pinata migration), the same evidence content gets different CID strings. On-chain, these look like different evidence, even though the underlying content is identical.

**Prevention:**
- Pin to one API version. Use v1 (`/pinning/pinJSONToIPFS`) for simplicity -- it's stable and returns CIDv0 which is more widely supported by gateways.
- If using v3, normalize CIDs to CIDv1 base32 consistently. Use `CID.parse(hash).toV1().toString()` from the `multiformats` package.
- Document the CID format in the evidence schema spec so consumers know what to expect.
- For `feedbackURI`, use the full IPFS URI format: `ipfs://<CID>` (not gateway URL). This is gateway-agnostic and follows IPFS conventions.

**Phase:** v1.1 IPFS Evidence phase.

---

### Pitfall 14: process.exit() in Signal Handler Skips Pino's Async Flush

**What goes wrong:** Pino buffers log output for performance (especially with `pino.destination()`). The SIGTERM handler calls `process.exit(0)`. Pino's buffer hasn't flushed. The last 5-10 log lines (including the "shutting down" message and final tx status) are lost.

**Prevention:**
- Call `logger.flush()` (synchronous) before `process.exit()`.
- Or use `pino.final(logger, handler)` which provides a final logger that flushes synchronously.
- Or use `pino({ destination: 1 })` with `sync: true` in the signal handler context (performance penalty only at shutdown, which is acceptable).

**Phase:** v1.1 Structured Logging phase.

---

### Pitfall 15: Evidence JSON Differs Between Runs for Same Item, Breaking CID Determinism

**What goes wrong:** `buildPositiveEvidence` includes `createdAt: new Date().toISOString()` (evidence.ts line 28). Each run produces a different timestamp, therefore a different CID. If the bot uploads evidence in the prepare phase but fails before executing transactions, the next run uploads again with a new timestamp, producing a different CID. The Pinata account accumulates duplicate pins (same content, different CIDs) for every failed run.

**Prevention:**
- For CID determinism: use a stable timestamp. Options: (a) use the PGTCR item's `submissionTime` from the subgraph, (b) use the block timestamp of the subgraph's latest indexed block, (c) omit `createdAt` from the JSON used for CID computation and add it as metadata only.
- For pin accumulation: Pinata charges by storage. Duplicate pins of <1KB JSON are negligible cost, but cluttered. Use `pinata.unpin(oldCID)` as part of cleanup, or accept the clutter for simplicity.
- The better fix: accept that CIDs will vary per run. The feedbackURI is informational (evidence for the on-chain feedback), not a content-addressed identity. Duplicate pins are an acceptable cost.

**Phase:** v1.1 IPFS Evidence phase (decide on timestamp strategy early).

---

## Retained v1.0 Pitfalls (Still Applicable)

The following v1.0 pitfalls remain relevant and are not superseded by v1.1 work:

| v1.0 Pitfall | Status | v1.1 Relevance |
|---|---|---|
| Pitfall 1: Subgraph Indexing Lag | Still applies | Unchanged -- no v1.1 work affects subgraph reads |
| Pitfall 2: Nonce Collision on Partial Failure | **Partially addressed** by v1.1 tx safety | SIGTERM handling (new Pitfall 3) and receipt timeout (new Pitfall 8) refine this |
| Pitfall 3: Revoke-Then-Negative Non-Atomic | Still applies | v1.1 tx safety should add simulation (new Pitfall 4) but atomicity gap remains |
| Pitfall 5: Disputed Status Intermediate | Still applies | Informational -- no v1.1 change |
| Pitfall 6: IPFS Upload Blocks Run | **Superseded** by new Pitfall 1 | v1.1 IPFS phase directly addresses this with prepare/execute split |
| Pitfall 7: Multicall3 Batch Size | Still applies | Unchanged |
| Pitfall 8: Re-registration State | Still applies | Unchanged |
| Pitfall 9: Pagination Cursor | Still applies | Unchanged |
| Pitfall 10: Proxy Storage Collision | Still applies | Unchanged |
| Pitfall 14: Key Compromise | **Extended** by new Pitfall 2 | Now includes Pinata JWT as a credential to protect |

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|---|---|---|
| IPFS Evidence (Pinata) | Pitfall 1 (upload in tx loop), Pitfall 5 (rate limit timeout), Pitfall 7 (CID not retrievable), Pitfall 13 (CID format), Pitfall 15 (CID non-determinism) | Prepare/execute split. Per-upload timeout (5s). Pin to v1 API. Accept CID variance. |
| Transaction Safety | Pitfall 3 (SIGTERM mid-tx), Pitfall 4 (state change revert), Pitfall 8 (receipt timeout), Pitfall 9 (balance preflight), Pitfall 10 (retry budget) | Signal handler with flag. simulateContract before write. Configurable receipt timeout. Cumulative gas estimate. Global execution budget. |
| Structured Logging | Pitfall 2 (JWT in logs), Pitfall 6 (stdout/stderr separation), Pitfall 11 (nested redaction), Pitfall 12 (log level defaults), Pitfall 14 (pino flush) | Pino with stderr destination. Custom error serializer. Regex-based secret scrubbing. pino.final for shutdown. |
| Integration (cross-cutting) | Pitfall 10 (one-shot becomes long-running) | Global execution budget. Circuit breaker for Pinata. Scheduler mutual exclusion. |

---

## Sources

- Codebase analysis: `bot/src/chain.ts`, `bot/src/evidence.ts`, `bot/src/index.ts`, `bot/src/config.ts`
- v1.0 pitfalls: `.planning/research/PITFALLS.md` (2026-03-24)
- [Pinata API Limits](https://docs.pinata.cloud/account-management/limits)
- [Pinata Rate Limit Issue](https://github.com/ipfs/ipfs-webui/issues/1900)
- [Node.js Graceful Shutdown Guide](https://oneuptime.com/blog/post/2026-01-06-nodejs-graceful-shutdown-handler/view)
- [Node.js SIGTERM and Kubernetes](https://blog.risingstack.com/graceful-shutdown-node-js-kubernetes/)
- [Pino Logger Guide](https://signoz.io/guides/pino-logger/)
- [Pino vs Winston](https://betterstack.com/community/guides/scaling-nodejs/pino-vs-winston/)
- [viem Gas Estimation Discussion](https://github.com/wevm/viem/discussions/862)
- [Sensitive Data in Logs](https://www.dash0.com/faq/the-top-5-best-node-js-and-javascript-logging-frameworks-in-2025-a-complete-guide)

**Confidence note:** Pitfalls 1, 3, 6, 8, 10 are HIGH confidence (well-known patterns, verified against this codebase). Pitfalls 2, 4, 5, 11 are MEDIUM-HIGH confidence (common patterns, specific interaction with this codebase analyzed). Pitfalls 7, 9, 12-15 are MEDIUM confidence (operational concerns, severity depends on deployment context).
