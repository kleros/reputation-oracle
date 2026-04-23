# Feature Landscape: v1.1 Production Hardening

**Domain:** Ethereum bot production hardening (IPFS evidence, tx safety, structured logging)
**Researched:** 2026-03-30
**Scope:** NEW features only -- v1.0 core (diff engine, subgraph reads, Router calls) already shipped

## Table Stakes

Features that any production Ethereum bot must have. Missing = operational risk.

| Feature | Why Expected | Complexity | Req | Dependencies |
|---------|--------------|------------|-----|--------------|
| Structured JSON logging | Console.log is unparseable by log aggregators; debugging production issues requires structured context (txHash, agentId, action type, durations) | Low | PROD-01 | pino; touches every file with console.log |
| Balance preflight check | Bot that sends txs with insufficient ETH wastes gas on reverts and produces confusing errors | Low | TXSAFE-03 | `publicClient.getBalance()`; runs before action loop in `chain.ts` |
| Graceful SIGTERM/SIGINT shutdown | Schedulers (cron, k8s, systemd) send SIGTERM; bot must finish current tx, not leave nonce gaps or half-executed batches | Low | TXSAFE-04 | Signal handler in `index.ts`; `isShuttingDown` flag checked in action loop |
| Dropped/null receipt handling | RPC nodes drop txs (mempool eviction, reorgs); bot must log tx hash and exit cleanly so next run re-diffs | Low | TXSAFE-02 | Already uses `waitForTransactionReceipt` with timeout; add explicit null/timeout error path |
| IPFS evidence upload (Pinata) | Data URIs in calldata are expensive (gas), not human-browsable, and don't match ecosystem norms (IPFS CIDs are standard for on-chain metadata) | Medium | IPFS-01, IPFS-02 | `pinata` npm package; new `ipfs.ts` module; config additions (PINATA_JWT, PINATA_GATEWAY) |
| Per-item IPFS failure isolation | One failed IPFS upload must not block other items; skip that item, log error, continue | Low | IPFS-03 | try/catch in evidence upload path; already have skip-on-validation-failure pattern |

## Differentiators

Features that go beyond minimum viable production. Not expected, but improve operational confidence.

| Feature | Value Proposition | Complexity | Req | Dependencies |
|---------|-------------------|------------|-----|--------------|
| Gas estimation with retry | Transient RPC errors during gas estimation are recoverable; retrying 2-3 times with backoff prevents unnecessary run failures | Low | TXSAFE-01 | Retry wrapper around `estimateGas`; viem already surfaces estimation errors distinctly |
| Run summary log | Single JSON object at end of run: items fetched, actions computed, txs sent, txs succeeded, errors, duration | Low | -- | Logger; computed from existing counters |
| Correlation IDs per action | Each action gets a unique ID logged across IPFS upload, tx submission, and receipt -- enables tracing a single feedback through all stages | Low | -- | UUID or incrementing counter; threaded through logger child |
| Log-level configuration | Allow LOG_LEVEL env var (debug/info/warn/error) for adjustable verbosity without code changes | Low | -- | pino built-in; config.ts addition |

## Anti-Features

Features to explicitly NOT build for v1.1.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Transaction retry/resubmission | TXSAFE-01 explicitly says "transaction submission NOT retryable" -- resubmitting risks double-execution; stateless re-diff on next run handles it safely | Log tx hash, exit; next run re-diffs |
| IPFS pinning queue / async upload | Over-engineering for a one-shot bot that processes <100 items; synchronous upload-then-submit is simpler and correct | Sequential: upload evidence, get CID, submit tx |
| Pretty-print logging in production | pino-pretty adds overhead, defeats structured logging purpose | Use pino-pretty only in dev via `LOG_PRETTY=true` |
| Health check HTTP endpoint | Bot is one-shot, not a server; no HTTP listener to health-check | Use exit code (0/1) for monitoring; PROD-02 is exit-code reporting |
| Nonce management retry | Complex nonce recovery (stuck tx replacement, nonce gap filling) is daemon-mode complexity | Stop on failure, next run gets fresh nonce from chain |
| IPFS gateway fallback (multiple providers) | Pinata is the upload target; reading back is not needed by the bot | Single provider; if Pinata is down, skip items per IPFS-03 |
| Pausable contract upgrade | PROD-03 mentions this but it's a contract change, not a bot feature; separate milestone | Defer to contract-focused milestone |
| Key rotation docs | PROD-03 also mentions this; it's documentation, not code | Defer or handle as standalone doc task |

## Feature Dependencies

```
                   pino (structured logging)
                   |
                   v
   config.ts additions -----> PINATA_JWT, PINATA_GATEWAY, LOG_LEVEL, MIN_BALANCE_WEI
                   |
          +--------+--------+
          |        |        |
          v        v        v
   ipfs.ts    chain.ts    index.ts
   (upload)   (balance    (SIGTERM handler,
              preflight,   run summary,
              receipt      log init)
              handling,
              gas retry)
```

Dependency chain:
- Structured logging should land FIRST -- all other features produce log output that benefits from structure
- Config additions (new env vars) should land WITH or BEFORE the features that consume them
- IPFS upload is independent of tx safety -- no ordering constraint between them
- Balance preflight and SIGTERM are independent of each other

## Requirement Coverage

| Requirement | Feature | Status |
|-------------|---------|--------|
| TXSAFE-01 | Gas estimation retry (differentiator) | Planned |
| TXSAFE-02 | Dropped receipt handling (table stakes) | Planned |
| TXSAFE-03 | Balance preflight (table stakes) | Planned |
| TXSAFE-04 | SIGTERM graceful shutdown (table stakes) | Planned |
| IPFS-01 | Pinata upload (table stakes) | Planned |
| IPFS-02 | Evidence schema v1 (already implemented in evidence.ts) | Exists -- just needs IPFS URI instead of data: URI |
| IPFS-03 | Per-item failure isolation (table stakes) | Planned |
| PROD-01 | Structured JSON logging (table stakes) | Planned |
| PROD-02 | Exit code reporting + run summary (differentiator) | Planned |
| PROD-03 | Key rotation + Pausable | Deferred -- contract change + docs, not bot code |

## MVP Recommendation

### Must-have (all table stakes):
1. **Structured logging (pino)** -- foundation for all other features; touches every file
2. **Balance preflight** -- prevents wasted gas; trivial to implement
3. **SIGTERM/SIGINT handler** -- required for any scheduled/containerized bot
4. **Dropped receipt handling** -- explicit error path for null receipts
5. **IPFS evidence upload** -- replaces data: URI with IPFS CID; medium complexity
6. **Per-item IPFS failure isolation** -- skip failed uploads, don't block run

### Should-have (differentiators):
7. **Gas estimation retry** -- simple retry wrapper, prevents transient RPC failures
8. **Run summary log** -- single JSON object summarizing the entire run
9. **Log-level config** -- trivial with pino, high operational value

### Defer:
- PROD-03 (Pausable contract, key rotation docs) -- separate scope
- Correlation IDs -- nice-to-have, can add later without breaking changes

## Implementation Notes

### IPFS Evidence (Medium complexity)
- Current: `buildFeedbackURI()` in `evidence.ts` returns `data:application/json;base64,...` inline
- Target: new `uploadEvidence()` returns `ipfs://<CID>` after Pinata upload
- Package: `pinata` (latest SDK from PinataCloud/pinata, replaces deprecated `@pinata/sdk` and `pinata-web3`)
- New module: `bot/src/ipfs.ts` with `uploadJSON(evidence: EvidenceJson): Promise<string>`
- Fallback: if PINATA_JWT not configured, keep data: URI behavior (backwards compatible for local dev)
- Config: add optional `PINATA_JWT` and `PINATA_GATEWAY` to zod schema
- Evidence schema already correct in `evidence.ts` (IPFS-02 satisfied) -- only the URI transport changes
- `chain.ts` executeActions loop changes: call `uploadEvidence()` before each tx, catch failure per IPFS-03

### Transaction Safety (Low complexity each)
- **Balance check** (TXSAFE-03): `publicClient.getBalance()` vs `MIN_BALANCE_WEI` env var (default 0.01 ETH) before action loop; exit with clear error if below threshold
- **SIGTERM** (TXSAFE-04): `process.on('SIGTERM', ...)` and `process.on('SIGINT', ...)` set `isShuttingDown` flag; action loop in `executeActions` checks flag before each tx, logs "shutdown requested, N actions remaining", breaks cleanly
- **Receipt handling** (TXSAFE-02): catch `waitForTransactionReceipt` timeout/null explicitly; log tx hash at warn level so operator can investigate; throw with context (hash, action type, agentId) so next run re-diffs
- **Gas retry** (TXSAFE-01): wrap gas estimation in 3-attempt retry with 1s/2s/4s exponential backoff; transaction submission itself is NEVER retried (explicit design constraint)

### Structured Logging (Low complexity, wide surface area)
- Package: `pino` (fastest Node.js JSON logger; zero deps; native TS types)
- New module: `bot/src/logger.ts` -- creates root logger, exports factory
- Replace all `console.log` / `console.error` calls with `logger.info()` / `logger.error()`
- Child loggers for context: `logger.child({ agentId, action })` per action in executeActions loop
- Dev mode: `pino-pretty` as devDependency, activated via `LOG_PRETTY=true` env var
- Log levels: pino built-in (trace/debug/info/warn/error/fatal), controlled by `LOG_LEVEL` env var
- Estimated files touched: index.ts, chain.ts, subgraph.ts, validation.ts, config.ts, diff.ts + new logger.ts + new ipfs.ts
- Run summary: logger.info at end of main() with `{ itemsFetched, actionsComputed, txsSent, txsSucceeded, errors, durationMs }`

## Sources

- [Pinata SDK (pinata)](https://github.com/PinataCloud/pinata) -- latest SDK, replacement for pinata-web3
- [Pinata Docs - Uploading Files](https://docs.pinata.cloud/files/uploading-files)
- [Pino Logger](https://github.com/pinojs/pino) -- structured JSON logging for Node.js
- [Pino Logger Guide (SigNoz)](https://signoz.io/guides/pino-logger/) -- production patterns and benchmarks
- [Viem waitForTransactionReceipt](https://viem.sh/docs/actions/public/waitForTransactionReceipt.html) -- retry/timeout config
- [Node.js Graceful Shutdown patterns](https://dev.to/superiqbal7/graceful-shutdown-in-nodejs-handling-stranger-danger-29jo)
- [Production Graceful Shutdown (2026)](https://oneuptime.com/blog/post/2026-01-06-nodejs-graceful-shutdown-handler/view)

---
*Feature research for: v1.1 Production Hardening (IPFS evidence, tx safety, structured logging)*
*Researched: 2026-03-30*
