# Milestones

## v1.0 Kleros Reputation Oracle (Shipped: 2026-03-27)

**Phases completed:** 3 phases, 9 plans, 18 tasks

**Key accomplishments:**

- UUPS-upgradeable KlerosReputationRouter with FeedbackType enum state model, three feedback scenarios, and bot authorization against pinned ERC-8004 interfaces
- 17 Foundry fork tests proving all 3 Router scenarios (positive/negative/revoke) plus re-registration, auth guards, and state edge cases against real Sepolia ReputationRegistry
- Idempotent Foundry deploy script deploying Router UUPS proxy, registering Kleros 8004 identity, configuring agentId, and authorizing bot in a single invocation
- Bot scaffold with typed modules: Zod config validation, CAIP-10 item validation, and data-URI evidence builder -- 27 tests passing
- Pure computeActions() function implementing all 3 business scenarios via TDD with 15 test assertions
- Subgraph cursor-paginated client and Multicall3-batched chain reader with sequential tx executor
- One-shot bot entry point wiring config, subgraph, validation, Multicall3, diff, and execution with --dry-run flag and process exit codes
- Forge verification script asserting getSummary values (count, value, tag filtering) for bot-touched Scenario 1 agents
- Live Sepolia E2E: bot submitted 4 positive feedback txs, Verify.s.sol confirmed getSummary(count=1, value=95) for all agents, second dry-run proved idempotency (0 actions)

---

## v1.1 Production Hardening (Shipped: 2026-04-22)

**Phases completed:** 3 phases, 11 plans
**Timeline:** 2026-03-30 → 2026-04-22 (24 days)
**Test baseline:** 81 bot unit tests + 1 gated integration test (skipped without PINATA_JWT); 17 Foundry fork tests unchanged

**Key accomplishments:**

- pino v10 structured JSON logging to stderr with secret redaction across nested error causes, child loggers, callback-form async flush, and a `RunSummary` line emitted on every exit path — replacing all 24 console.* call sites
- Differentiated transaction failure taxonomy in `executeActions()`: per-item skip vs systemic stop, gas-estimation retry with 3-attempt exponential backoff, `writeContract` never retried, nonce increments after every mined tx (including reverts), null/timed-out receipt handling
- SIGTERM/SIGINT graceful shutdown wired via flag-only signal handlers + main-loop checkpoints; wallet balance preflight aborts before any tx attempt
- `bot/src/ipfs.ts` native-fetch Pinata upload with 4-class error taxonomy (auth / network / server / rate-limit), AbortController timeout, 1 retry on server/rate-limit only — zero new dependencies
- Prepare/execute split in `executeActions()`: all IPFS uploads complete before any on-chain tx; 3-consecutive-failure systemic escalation prevents wasted gas; `orphanedCids` tracking surfaces manual-unpin candidates when a tx fails after CID was pinned
- `buildFeedbackURI(cid)` now returns `ipfs://CID` passthrough (replacing base64 data-URI); `RunSummary` exposes `uploadsAttempted/Succeeded/Failed/orphanedCids` for observability
- Gated integration test (`test.skipIf(!process.env.PINATA_JWT)`) validates the real Pinata API contract end-to-end with upload + assert-CID + unpin
- 7 code-review findings resolved across phases 5 and 6 (CR-01 nonce-after-revert, WR-01 evidence lifecycle, WR-01 upload duration, plus 4 others); 2 advisory Info findings deferred as documented tech debt

**Known deferred items at close:**

- `06-SECURITY.md` threat-mitigation audit not run (security_enforcement=true gate bypassed at milestone close)
- `v1.1-MILESTONE-AUDIT.md` not generated before close
- IN-01: dead `?? 30_000` fallback in `chain.ts` (advisory, no runtime impact)
- IN-02: `parseInt(disputeId)` precision loss above 2^53 (theoretical; far above current Kleros dispute counts)

---
