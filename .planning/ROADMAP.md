# Roadmap: Kleros Reputation Oracle

## Milestones

- ✅ **v1.0 Kleros Reputation Oracle** — Phases 1-3 (shipped 2026-03-27)
- 🚧 **v1.1 Production Hardening** — Phases 4-6 (in progress)

## Phases

<details>
<summary>v1.0 Kleros Reputation Oracle (Phases 1-3) — SHIPPED 2026-03-27</summary>

- [x] Phase 1: Router Contract & On-Chain Setup (3/3 plans) — UUPS proxy, 3 scenarios, fork tests, deploy script
- [x] Phase 2: Stateless Bot (4/4 plans) — diff engine, subgraph client, Multicall3, dry-run — completed 2026-03-26
- [x] Phase 3: End-to-End Verification (2/2 plans) — Verify.s.sol, live E2E on Sepolia — completed 2026-03-27

Full details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

### v1.1 Production Hardening (In Progress)

**Milestone Goal:** Make the bot production-ready with structured logging, transaction safety, and IPFS evidence upload.

- [ ] **Phase 4: Structured Logging** - pino logger with JSON output, secret redaction, and run summary
- [ ] **Phase 5: Transaction Safety** - Gas retry, balance preflight, receipt handling, graceful shutdown
- [ ] **Phase 6: IPFS Evidence** - Pinata upload with prepare/execute split and failure isolation

## Phase Details

### Phase 4: Structured Logging
**Goal**: Bot produces machine-parseable structured output for monitoring and debugging
**Depends on**: Phase 3 (v1.0 complete)
**Requirements**: LOG-01, LOG-02, LOG-03, LOG-04, LOG-05
**Success Criteria** (what must be TRUE):
  1. Running the bot produces NDJSON log lines on stderr; stdout remains clean for --dry-run output
  2. Intentionally triggering an RPC error with a private key in the cause chain produces log output with the key redacted
  3. Every bot run ends with a single summary JSON line containing items found, actions computed, txs sent, errors, and duration
  4. Setting LOG_LEVEL=debug produces more output than the default; LOG_LEVEL=warn suppresses info lines
**Plans**: 2 plans

Plans:
- [ ] 04-01-PLAN.md — Logger module, pino deps, config LOG_LEVEL, RunSummary type
- [ ] 04-02-PLAN.md — Migrate all console calls to structured logger, add run summary

### Phase 5: Transaction Safety
**Goal**: Bot handles transaction failures, wallet depletion, and process signals without leaving ambiguous state
**Depends on**: Phase 4
**Requirements**: TXSAFE-01, TXSAFE-02, TXSAFE-03, TXSAFE-04
**Success Criteria** (what must be TRUE):
  1. Gas estimation failure on a transaction triggers up to 3 retries with backoff before skipping; the transaction itself is never re-submitted
  2. A null or timed-out receipt is logged with its tx hash and the bot exits with a non-zero code; next run re-diffs and picks up the action
  3. Running the bot with an empty wallet exits immediately with a clear "insufficient balance" error before any transaction attempt
  4. Sending SIGTERM while the bot is mid-batch finishes the current transaction, skips remaining actions, and exits cleanly with a summary log
**Plans**: 2 plans

Plans:
- [ ] 04-01-PLAN.md — Logger module, pino deps, config LOG_LEVEL, RunSummary type
- [ ] 04-02-PLAN.md — Migrate all console calls to structured logger, add run summary

### Phase 6: IPFS Evidence
**Goal**: Feedback transactions reference IPFS-pinned evidence instead of inline data URIs
**Depends on**: Phase 4, Phase 5
**Requirements**: IPFS-01, IPFS-02, IPFS-03, IPFS-04, IPFS-05
**Success Criteria** (what must be TRUE):
  1. Bot uploads evidence JSON to Pinata and the resulting feedbackURI in the transaction starts with ipfs://
  2. The uploaded evidence JSON matches the kleros-reputation-oracle/v1 schema
  3. When a single Pinata upload fails, that item is skipped and logged; the rest of the batch proceeds normally
  4. All IPFS uploads complete before any transaction is submitted (prepare/execute split)
  5. Running the bot without PINATA_JWT configured skips items that need evidence upload and logs a warning
**Plans**: 2 plans

Plans:
- [ ] 04-01-PLAN.md — Logger module, pino deps, config LOG_LEVEL, RunSummary type
- [ ] 04-02-PLAN.md — Migrate all console calls to structured logger, add run summary

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Router Contract & On-Chain Setup | v1.0 | 3/3 | Complete | 2026-03-25 |
| 2. Stateless Bot | v1.0 | 4/4 | Complete | 2026-03-26 |
| 3. End-to-End Verification | v1.0 | 2/2 | Complete | 2026-03-27 |
| 1000. Upgrade bot deps | — | 2/2 | Complete | 2026-03-27 |
| 4. Structured Logging | v1.1 | 0/2 | Planned | - |
| 5. Transaction Safety | v1.1 | 0/? | Not started | - |
| 6. IPFS Evidence | v1.1 | 0/? | Not started | - |

### Phase 1000: Upgrade bot dependencies to latest majors

**Goal:** Upgrade zod v3->v4, Biome.js v1->v2, vitest v3->v4. Aligns with other Kleros projects already on these versions.
**Depends on:** v1.0 complete
**Requirements:** UPG-01 (zod v4), UPG-02 (vitest v4), UPG-03 (Biome v2)
**Plans:** 2/2 plans complete

Plans:
- [x] 1000-01-PLAN.md — Upgrade zod v4 + vitest v4 (zero code changes) — completed 2026-03-27
- [x] 1000-02-PLAN.md — Upgrade Biome v2 (config migration + lint fixes) + update CLAUDE.md

## Backlog

_(empty)_
