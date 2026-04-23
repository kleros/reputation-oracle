# Project Research Summary

**Project:** Kleros Reputation Oracle v1.1 Production Hardening
**Domain:** Ethereum oracle bot -- IPFS evidence, transaction safety, structured logging
**Researched:** 2026-03-30
**Confidence:** HIGH

## Executive Summary

v1.1 hardens the shipped v1.0 bot for production use. Three capabilities are added: IPFS evidence upload (replacing inline data: URIs with Pinata-pinned CIDs), transaction safety (gas estimation retry, balance preflight, SIGTERM handling, receipt timeout handling), and structured JSON logging (replacing console.log with machine-parseable NDJSON output). The existing stateless diff architecture is unchanged -- all work is additive, modifying the execute phase and cross-cutting logging concerns.

The recommended approach is dependency-minimal: only one new production dependency (pino for logging), zero new dependencies for IPFS (native fetch to Pinata REST API), and zero for transaction safety (viem built-ins + custom retry wrapper). The architecture introduces two new modules (ipfs.ts, tx.ts) and one cross-cutting module (logger.ts), with chain.ts and index.ts as the primary modification targets.

The highest-risk area is IPFS upload inside the transaction loop. Pinata calls are network-dependent and rate-limited; inserting them into a nonce-managed sequential loop creates cascading failure modes. The mitigation is a prepare/execute split: upload all evidence before executing any transactions. Secondary risks are secret leakage in structured logs (Pinata JWT, private key in nested error objects) and retry logic turning the one-shot bot into a long-running process. Both are addressed by design constraints documented below.

## Key Findings

### Stack Additions

One production dependency, one dev dependency. Everything else uses existing packages or Node.js built-ins.

| Package | Version | Purpose | Rationale |
|---------|---------|---------|-----------|
| pino | ^10.3 | Structured JSON logging | JSON-native, child loggers, redaction, 5x faster than winston |
| pino-pretty | ^14.0 (dev) | Human-readable dev logs | Transforms NDJSON to colorized output during development |

**No SDK for Pinata** -- native `fetch()` to `POST /pinning/pinJSONToIPFS` is sufficient for a single-endpoint use case. The `pinata` npm package pulls 230+ transitive dependencies for what is one HTTP call.

**No retry library** -- exponential backoff is ~15 lines of code. `p-retry` is unnecessary.

**Config additions:** `PINATA_JWT` (optional), `LOG_LEVEL` (optional, default: info).

**Conflict resolution:** STACK.md recommends pino. ARCHITECTURE.md suggests a 30-line custom logger. Recommendation: **use pino**. The redaction feature alone (needed for Pitfall 2/11 -- secret leakage) justifies the dependency. Child loggers for per-action context and `pino.final()` for shutdown flushing are production necessities that would be reimplemented poorly in a custom solution. Write logs to stderr to preserve stdout for dry-run output.

### Feature Table Stakes

**Must have (all planned for v1.1):**
1. Structured JSON logging (pino) -- foundation; all other features depend on it
2. IPFS evidence upload via Pinata -- replaces gas-expensive data: URIs with ipfs:// CIDs
3. Per-item IPFS failure isolation -- skip failed uploads, do not block the run
4. Balance preflight check -- prevent wasted gas on empty wallet
5. SIGTERM/SIGINT graceful shutdown -- required for cron/k8s/systemd schedulers
6. Dropped/null receipt handling -- explicit error path for tx ambiguity

**Should have (differentiators):**
7. Gas estimation with retry (3 attempts, exponential backoff)
8. Run summary log (single JSON object at exit: items, actions, txs, errors, duration)
9. Log-level configuration via env var

**Defer:**
- PROD-03 (Pausable contract upgrade, key rotation docs) -- contract scope, not bot
- Correlation IDs per action -- nice-to-have, no breaking change to add later
- CID verification after upload -- propagation delay is inherent, not a v1.1 blocker

### Architecture Changes

**New modules:**

| Module | Responsibility |
|--------|---------------|
| `bot/src/logger.ts` | pino instance creation, stderr destination, error serializer with secret scrubbing |
| `bot/src/ipfs.ts` | `pinToIPFS(evidence, jwt): Promise<string>` -- single Pinata API call, returns `ipfs://<CID>` |
| `bot/src/tx.ts` | `estimateGas()` (retryable), `submitTx()` (not retryable), `waitForReceipt()`, `checkBalance()` |

**Modified modules:**

| Module | Change |
|--------|--------|
| `config.ts` | Add PINATA_JWT (optional), LOG_LEVEL (optional) to zod schema |
| `chain.ts` | executeActions() refactored: prepare/execute split, uses ipfs.ts + tx.ts, checks shutdown flag |
| `index.ts` | SIGTERM/SIGINT handler registration, logger init, balance preflight call, run summary |
| All modules | Replace console.log/error with logger calls |

**Key architectural decision:** The execute phase splits into prepare (upload all evidence) then execute (submit all txs). This prevents IPFS failures from corrupting the nonce-managed transaction loop.

### Watch Out For

1. **IPFS upload in tx loop** (Critical) -- Pinata calls inside the nonce-managed loop cause cascading failures. Prevention: prepare/execute split. Upload all CIDs first, then execute transactions with pre-resolved URIs.

2. **Secret leakage in structured logs** (Critical) -- Pinata JWT and private key appear in nested error cause chains. Prevention: pino custom error serializer that regex-strips `Bearer` tokens and 64-char hex strings. Test by intentionally triggering errors.

3. **SIGTERM during tx execution** (Critical) -- Signal arrives after writeContract but before receipt. Prevention: boolean flag checked between actions, not AbortController. Finish current tx, then exit. Hard timeout (15s) as safety net.

4. **Pinata rate limits as silent timeouts** (Moderate) -- Free tier throttles rather than rejects after ~200 req/min. Prevention: 5s per-upload timeout, 30s total prepare-phase budget, circuit breaker after 3 consecutive failures.

5. **Retry budget explosion** (Moderate) -- Individual retries compound across 50+ actions into 10+ minute runs. Prevention: global execution budget (120s). Circuit breaker for Pinata. Scheduler mutual exclusion.

## Implications for Roadmap

### Phase 1: Structured Logging

**Rationale:** Foundation dependency -- every other feature produces log output. Must land first.
**Delivers:** pino logger with stderr output, secret redaction, child loggers, LOG_LEVEL config. All console.log/error calls replaced.
**Addresses:** PROD-01 (structured logging), log-level config, dry-run stdout preservation
**Avoids:** Pitfall 2 (JWT in logs), Pitfall 6 (stdout/stderr separation), Pitfall 11 (nested redaction), Pitfall 14 (pino flush on shutdown)

### Phase 2: Transaction Safety

**Rationale:** Independent of IPFS. Addresses operational risks that exist today (v1.0 has no SIGTERM handling, no balance check, no gas retry).
**Delivers:** tx.ts module (estimateGas with retry, submitTx without retry, waitForReceipt with configurable timeout), balance preflight in index.ts, SIGTERM/SIGINT handlers, run summary log
**Addresses:** TXSAFE-01 through TXSAFE-04, PROD-02 (exit codes)
**Avoids:** Pitfall 3 (SIGTERM mid-tx), Pitfall 4 (state change revert via simulateContract), Pitfall 8 (receipt timeout), Pitfall 9 (stale balance), Pitfall 10 (retry budget)

### Phase 3: IPFS Evidence Upload

**Rationale:** Depends on logger (Phase 1) for structured error reporting. Benefits from tx.ts (Phase 2) patterns but is not blocked by it. Most complex new feature -- benefits from established patterns.
**Delivers:** ipfs.ts module, prepare/execute split in chain.ts, IPFS-first with data: URI fallback, per-item failure isolation
**Addresses:** IPFS-01 (Pinata upload), IPFS-02 (evidence schema), IPFS-03 (failure isolation)
**Avoids:** Pitfall 1 (upload in tx loop), Pitfall 5 (rate limit timeout), Pitfall 13 (CID format -- pin to v1 API), Pitfall 15 (CID non-determinism -- accept variance)

### Phase 4: Integration Testing and Hardening

**Rationale:** All features converge in chain.ts executeActions(). End-to-end verification against anvil fork with Pinata test JWT.
**Delivers:** Integration tests covering SIGTERM mid-batch, Pinata failure fallback, balance exhaustion mid-batch, receipt timeout handling
**Addresses:** Cross-cutting quality assurance
**Avoids:** Pitfall 10 (verifies global execution budget works end-to-end)

### Phase Ordering Rationale

- Logging first because it is imported by every module -- changing it later means rebasing all other work
- Transaction safety before IPFS because it addresses existing v1.0 operational gaps (higher urgency) and establishes patterns (retry, signal handling) reused by IPFS
- IPFS last among feature phases because it is the only one with an external service dependency (Pinata) and benefits from the retry/circuit-breaker patterns established in Phase 2
- Phases 2 and 3 could theoretically parallelize (independent modules) but sequential is safer given they both modify chain.ts executeActions()

### Research Flags

**Needs deeper research during planning:**
- Phase 3 (IPFS): Pinata rate limit behavior on the specific plan tier. Test whether v1 API returns CIDv0 or CIDv1 with `cidVersion: 1` option. Verify gateway retrieval latency.

**Standard patterns (skip research-phase):**
- Phase 1 (Logging): pino setup is well-documented, no unknowns
- Phase 2 (Tx Safety): viem patterns are established, retry wrapper is trivial
- Phase 4 (Integration): test patterns follow existing vitest + anvil setup

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Minimal additions (1 prod dep). All evaluated against alternatives with clear rationale. |
| Features | HIGH | Scope is well-bounded. Clear table stakes vs differentiators. Anti-features explicitly documented. |
| Architecture | HIGH | Small codebase, well-understood. New modules have clear boundaries. Prepare/execute split is the key insight. |
| Pitfalls | MEDIUM-HIGH | Critical pitfalls (1, 2, 3) are high confidence. Rate limit behavior (5) and CID propagation (7) depend on Pinata's specific tier. |

**Overall confidence:** HIGH

### Gaps to Address

- **Pinata plan tier limits:** Free tier allows ~200 req/min. If the bot processes >200 items per run, need paid tier or batching strategy. Validate during Phase 3 planning.
- **pino vs custom logger:** STACK.md and ARCHITECTURE.md disagree. This summary recommends pino. Confirm during Phase 1 requirements.
- **Prepare/execute split granularity:** Should revoke-only actions (Scenario 3, no evidence needed) execute immediately or wait for the full prepare phase? Likely: execute immediately since they have no IPFS dependency.
- **Receipt timeout default:** 60s (current) vs 120s (recommended for L1) vs configurable. Decide during Phase 2 requirements.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `bot/src/*.ts` -- direct code reading
- [Pinata REST API docs](https://docs.pinata.cloud/api-reference/endpoint/ipfs/pin-json-to-ipfs) -- pinJSONToIPFS endpoint
- [pino npm](https://www.npmjs.com/package/pino) -- v10.3, structured logging
- [viem docs](https://viem.sh/docs/actions/wallet/sendTransaction.html) -- tx lifecycle, gas estimation

### Secondary (MEDIUM confidence)
- [Pinata rate limits](https://docs.pinata.cloud/account-management/limits) -- tier-specific behavior
- [Node.js graceful shutdown patterns](https://oneuptime.com/blog/post/2026-01-06-nodejs-graceful-shutdown-handler/view) -- SIGTERM handling
- [Pino vs Winston benchmarks](https://betterstack.com/community/guides/scaling-nodejs/pino-vs-winston/) -- performance comparison

---
*Research completed: 2026-03-30*
*Ready for roadmap: yes*
