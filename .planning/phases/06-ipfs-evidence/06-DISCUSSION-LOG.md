# Phase 6: IPFS Evidence - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 06-ipfs-evidence
**Areas discussed:** Upload failure policy, SIGTERM during prepare pass, Testing strategy, Operator visibility

---

## Pre-discussion Corrections (from /gsd:list-phase-assumptions round)

Before formal discussion, user corrected five initial assumptions:

| Assumption | User correction |
|------------|-----------------|
| `PINATA_GATEWAY` env var needed | Not needed. Use hardcoded Kleros CDN `https://cdn.kleros.link/ipfs/`. |
| Scenario 3 (revoke-only) might or might not upload | Scenario 3 skips IPFS entirely — `revokeFeedback` takes no URI. |
| Pinata metadata `name` — confirm? | Confirmed: include structured name. |
| `createdAt` timestamp handling | Preserve Phase 5 WR-01 invariant: build once in prepare, reuse in execute. |
| Upload concurrency (serial vs parallel) | Serial. |

User also asked to clarify: "Instead of fetching from Pinata IPFS, we want to use our Kleros CDN." Claude flagged ambiguity between gateway-for-reading vs on-chain-URI-form. ROADMAP SC-1 ("feedbackURI starts with `ipfs://`") resolves: Kleros CDN is gateway URL for logs/operator UX; on-chain stays `ipfs://<CID>`.

---

## Upload failure policy

### Q1: Pinata upload timeout

| Option | Description | Selected |
|--------|-------------|----------|
| 30 seconds (Recommended) | Generous for slow networks; total prepare ~30s × items worst case; matches TX_RECEIPT_TIMEOUT_MS style. | ✓ |
| 15 seconds | Faster failure; risks false negatives. | |
| 60 seconds | Very generous; matches pino flush timeout. | |

**User's choice:** 30 seconds (Recommended)

### Q2: Retry on transient errors within a single upload

| Option | Description | Selected |
|--------|-------------|----------|
| No retry — fail fast (Recommended) | Matches Phase 5 writeContract discipline. | |
| Retry 3× with exponential backoff | Matches Phase 5 gas-estimation pattern. | |
| Retry once on 5xx only | 4xx immediate skip (deterministic); 5xx one retry (blip case). | ✓ |

**User's choice:** Retry once on 5xx only
**Notes:** User chose the middle ground — simpler than full Phase 5 retry, more resilient than zero retries.

### Q3: Systemic escalation after N consecutive failures

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, after 3 consecutive failures (Recommended) | Prevents wasted gas on dead Pinata; exits 1; scheduler re-runs. | ✓ |
| No — always skip-and-continue | Per-item only; operator may miss outage. | |
| Yes, but only on auth error first | Auth-specific short-circuit. | |

**User's choice:** Yes, after 3 consecutive failures (Recommended)

### Q4: Pinata error classification depth

| Option | Description | Selected |
|--------|-------------|----------|
| 4 classes: auth, rate-limit, server, network (Recommended) | Aligns with Phase 5's isRevertError/isTransientError split; enables targeted alerting. | ✓ |
| 2 classes: transient vs permanent | Simpler; loses alerting granularity. | |
| No classification — log raw | Simplest. | |

**User's choice:** 4 classes: auth, rate-limit, server, network (Recommended)

---

## SIGTERM during prepare pass

### Q1: SIGTERM during prepare behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Abort uploads, skip execute entirely (Recommended) | Check shutdown flag between uploads; orphaned CIDs acceptable (content-addressed, idempotent). | ✓ |
| Finish all uploads, then execute what's ready | Not graceful under 30s systemd stop-timeout. | |
| Finish current upload, execute already-uploaded, skip rest | Complex partial progress. | |

**User's choice:** Abort uploads, skip execute entirely (Recommended)

### Q2: SIGTERM during execute behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — Phase 5 behavior unchanged (Recommended) | Clean break between actions; re-upload next run yields same CID. | ✓ |
| Track prepared-but-unsent items in run summary | Adds orphanedCIDs: [] field. | |

**User's choice:** Yes — Phase 5 behavior unchanged (Recommended)
**Notes:** Option 2 is adopted as a supplementary observability decision, not replacing option 1.

### Q3: Orphaned CID logging

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — include orphaned CIDs in run summary (Recommended) | Run summary gets orphanedCIDs field; cheap visibility. | ✓ |
| No — silently accept orphaning | Less log noise. | |

**User's choice:** Yes — include orphaned CIDs in run summary (Recommended)

---

## Testing strategy

### Q1: Unit-test coverage for bot/src/ipfs.ts

| Option | Description | Selected |
|--------|-------------|----------|
| Mock fetch via vi.mock() with full error-class coverage (Recommended) | Covers all 4 classes + retry branches + timeout. | ✓ |
| msw (Mock Service Worker) | Realistic but adds 2MB dev dep. | |
| Hand-rolled fetch mock as setup fixture | Simple vi.fn() spy; harder to test retry state. | |

**User's choice:** Mock fetch via vi.mock() with full error-class coverage (Recommended)

### Q2: Real-Pinata integration test

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, skipped without PINATA_JWT (Recommended) | test.skipIf; uploads throwaway + unpins. | ✓ |
| No — mock-only is sufficient | Boundary covered by contract mocks. | |
| Yes, and run in CI | Full E2E; requires managed JWT + cleanup. | |

**User's choice:** Yes, skipped without PINATA_JWT (Recommended)

### Q3: chain.test.ts updates

| Option | Description | Selected |
|--------|-------------|----------|
| Mock uploadEvidenceToIPFS, test prepare/execute interaction (Recommended) | Extend existing; covers S1/S2/S3, failures, PINATA_JWT absent. | ✓ |
| New prepare.test.ts for prepare pass | Cleaner separation; risks duplication. | |

**User's choice:** Mock uploadEvidenceToIPFS, test prepare/execute interaction (Recommended)

### Q4: E2E/fork test relevance

| Option | Description | Selected |
|--------|-------------|----------|
| Run Phase 3 E2E with PINATA_JWT set (Recommended) | One-time manual UAT on Sepolia post-implementation. | ✓ |
| Skip E2E — unit + integration sufficient | Misses config-wiring bugs. | |

**User's choice:** Run Phase 3 E2E with PINATA_JWT set (Recommended)

---

## Operator visibility

### Q1: Pinata metadata depth

| Option | Description | Selected |
|--------|-------------|----------|
| name + keyvalues (agentId, chainId, pgtcrItemId, scenario) (Recommended) | Searchable in Pinata dashboard; tiny cost. | ✓ |
| name only | Minimal breadcrumb. | |
| name + keyvalues + cidVersion: 1 | Opt into modern CIDv1 (base32). | |

**User's choice:** name + keyvalues (Recommended)
**Notes:** Stays on Pinata default CIDv0 for v1.1; CIDv1 deferred.

### Q2: Per-upload success log line

| Option | Description | Selected |
|--------|-------------|----------|
| CID + size + duration_ms + gateway_url (Recommended) | Full operator click-through + performance metrics. | ✓ |
| CID only | Minimal. | |
| CID + gateway_url only | Skip perf metrics. | |

**User's choice:** CID + size + duration_ms + gateway_url (Recommended)

### Q3: Run summary IPFS fields

| Option | Description | Selected |
|--------|-------------|----------|
| uploads_attempted, uploads_succeeded, uploads_failed, orphaned_cids[] (Recommended) | Quantifies IPFS work in existing LOG-03 summary shape. | ✓ |
| Only uploads_succeeded count | Minimal. | |
| Full per-upload array | Large payload; redundant with per-upload logs. | |

**User's choice:** uploads_attempted, uploads_succeeded, uploads_failed, orphaned_cids[] (Recommended)

### Q4: Failure log detail

| Option | Description | Selected |
|--------|-------------|----------|
| error_class + agentId + pgtcrItemId + scenario + actionIndex (Recommended) | Full context for operator debug; redacted Pinata body. | ✓ |
| Minimal — error message + agentId | Lean; operator derives rest from context. | |

**User's choice:** error_class + agentId + pgtcrItemId + scenario + actionIndex (Recommended)

---

## User clarification request

After the four areas completed, user asked: *"Remind how do you plan to update to IPFS? without Pinata SDK?"*

Claude provided a concrete walkthrough:
- Native `fetch` against `POST https://api.pinata.cloud/pinning/pinJSONToIPFS` with Bearer JWT
- ~60 LOC implementation including `classifyPinataHttpError` and `classifyFetchError`
- `AbortController` for timeout (Node 22 native)
- Response shape `{ IpfsHash, PinSize, Timestamp }` → `ipfs://${IpfsHash}` on-chain
- Node 22 provides `fetch`, `AbortController`, `URL`, `JSON`, `Buffer` all natively
- SDK would have added 230+ transitive deps for features we don't need (multipart, file uploads, CID verification, group management)

User then confirmed: "Yes, write CONTEXT.md."

## Claude's Discretion

- Control-flow structure of prepare/execute split (single function + two loops vs extracted helpers).
- Implementation details of error-classification helpers (enum vs literal union, exported vs module-private).
- Exact retry backoff delay for the single 5xx retry (~1s suggested, planner decides).
- Env var name for timeout (`PINATA_TIMEOUT_MS` preferred).

## Deferred Ideas

- CIDv1 opt-in
- Pinata groups for operational organization
- `PINATA_GATEWAY` env var (configurable gateway)
- CID verification after upload
- Per-upload correlation IDs
- `p-retry` dependency
- Pin rotation / unpin of revoked CIDs
- Exponential backoff on single retry
- Progressive failure thresholds per error class
