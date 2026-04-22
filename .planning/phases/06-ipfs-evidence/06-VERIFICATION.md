---
phase: 06-ipfs-evidence
verified: 2026-04-22T14:00:00Z
status: passed
score: 5/5
overrides_applied: 0
human_verification:
  - test: "Run bot with real PINATA_JWT against Sepolia — observe feedbackURI in tx calldata starts with ipfs://"
    expected: "Transaction calldata contains ipfs://Qm... URI; Pinata dashboard shows pinned item"
    why_human: "Requires live Sepolia RPC + funded wallet + real Pinata JWT; cannot simulate without external services"
  - test: "Run integration test: PINATA_JWT=<jwt> npx vitest run test/ipfs.integration.test.ts"
    expected: "Test passes: CID matches /^Qm[A-Za-z0-9]{44}$/, unpin returns 'OK'"
    why_human: "Requires a real Pinata JWT with pinJSONToIPFS and unpin scopes — developer must supply"
---

# Phase 6: IPFS Evidence Verification Report

**Phase Goal:** Feedback transactions reference IPFS-pinned evidence instead of inline data URIs
**Verified:** 2026-04-22T14:00:00Z
**Status:** passed (automated checks) / human_needed (live integration)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Bot uploads evidence JSON to Pinata and the resulting feedbackURI in the transaction starts with `ipfs://` | VERIFIED | `chain.ts:224` calls `uploadEvidenceToIPFS`; `chain.ts:233` calls `buildFeedbackURI(uploadResult.cid)` which returns `ipfs://${cid}` (`evidence.ts:77`). P1 test confirms writeContract receives ipfs:// URI. |
| 2 | The uploaded evidence JSON matches the kleros-reputation-oracle/v1 schema | VERIFIED | `EvidenceJson` interface (`types.ts:43-61`) has `schema: "kleros-reputation-oracle/v1"` literal. `buildPositiveEvidence` and `buildNegativeEvidence` set all required fields: `schema`, `agentRegistry`, `agentId`, `clientAddress`, `createdAt`, `value`, `valueDecimals`, `tag1`, `tag2`, `kleros.*`. `evidence.test.ts` confirms field values. |
| 3 | When a single Pinata upload fails, that item is skipped and logged; the rest of the batch proceeds normally | VERIFIED | `chain.ts:235-255`: upload failure increments `uploadsFailed++`, pushes `{status:"skip"}`, logs `ipfs-upload-failed` with `error_class`/`error_message`. P3 test: one auth failure + one success = skipped=1, txSent=1. |
| 4 | All IPFS uploads complete before any transaction is submitted (prepare/execute split) | VERIFIED | `chain.ts:151-276`: prepare pass loop builds all `PreparedAction[]` before `chain.ts:279` fetches nonce and `chain.ts:284` begins execute pass. No `writeContract` call appears in prepare pass. P4 test: 3 consecutive failures → `systemicFailure=pinata-unavailable`, `writeContract` never called. |
| 5 | Running the bot without PINATA_JWT configured skips items that need evidence upload and logs a warning | VERIFIED | `chain.ts:177-184`: `if (!config.PINATA_JWT)` branch emits `log.warn({..., reason: "PINATA_JWT not configured"}, "Skipping action — PINATA_JWT not configured")`, increments `skipped++`, pushes `{status:"skip"}`. S3 (revokeOnly) proceeds. P5 test: S1 skipped=1, S3 txSent=1, `uploadEvidenceToIPFS` not called. |

**Score:** 5/5 truths verified

### Deferred Items

None.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `bot/src/ipfs.ts` | Pinata upload module | VERIFIED | 141 LOC. Exports `uploadEvidenceToIPFS`, `PinataMetadata`, `PinataUploadResult`. 4-class error classification (auth/rate-limit/server/network). One retry for server/rate-limit. AbortController timeout. `clearTimeout` in both success and catch paths. `isDuplicate=true` treated as success. |
| `bot/src/evidence.ts` | `buildFeedbackURI(cid: string): string` | VERIFIED | Returns `` `ipfs://${cid}` `` at line 77. No base64 encoding. `buildPositiveEvidence` and `buildNegativeEvidence` unchanged. |
| `bot/src/config.ts` | PINATA_JWT and PINATA_TIMEOUT_MS in configSchema | VERIFIED | Line 17: `PINATA_JWT: z.string().optional()`. Line 18: `PINATA_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(30_000)`. Line 34: redaction extended to cover `PINATA_JWT`. |
| `bot/src/types.ts` | IPFS fields on ExecuteActionsResult and RunSummary | VERIFIED | Both interfaces have `uploadsAttempted?`, `uploadsSucceeded?`, `uploadsFailed?`, `orphanedCids?` (lines 73-76, 84-87). |
| `bot/src/chain.ts` | Prepare/execute split in executeActions | VERIFIED | `PreparedAction` type at lines 24-27. Prepare loop lines 152-274. Execute loop lines 284-482. All 6 non-empty return sites include `uploadsAttempted`. |
| `bot/src/index.ts` | Run summary IPFS wiring | VERIFIED | Lines 124-131: `result.uploadsAttempted !== undefined` guard maps counters to `summary`. `orphanedCids` mapped if non-empty. |
| `bot/test/ipfs.test.ts` | D-34 unit test coverage | VERIFIED | 10 test cases: Tests 1-2 (success + isDuplicate), 3-4 (auth 401/403), 5 (rate-limit 429), 6 (500 retry success), 7 (500 retry exhausted), 8 (AbortError), 9 (TypeError), 10 (call-count assertions). |
| `bot/test/chain.test.ts` | P1-P6 prepare/execute tests | VERIFIED | 6 new tests in `describe("executeActions — IPFS prepare/execute split")`. Module-level `vi.mock("../src/ipfs.js")`. Existing SC-1a/SC-1b/SC-2/SC-4 tests updated to use `mockConfigWithJwt`. |
| `bot/test/ipfs.integration.test.ts` | Gated real-Pinata test | VERIFIED | `test.skipIf(!process.env.PINATA_JWT)`. Unpin uses `.text()` not `.json()`. CID assert `/^Qm[A-Za-z0-9]{44}$/`. 30s timeout. Skips gracefully without JWT. |
| `bot/vitest.config.ts` | unstubGlobals: true | VERIFIED | `unstubGlobals: true`, `unstubEnvs: true`. |
| `bot/.env.example` | PINATA_JWT and PINATA_TIMEOUT_MS documented | VERIFIED | Lines 14-19: both entries present with comments matching existing style. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `bot/src/chain.ts` | `bot/src/ipfs.ts` | `uploadEvidenceToIPFS` import | WIRED | Line 16 import; line 224 call in prepare loop |
| `bot/src/chain.ts` | `bot/src/evidence.ts` | `buildFeedbackURI(cid)` call | WIRED | Line 15 import; line 233 call with CID from upload result |
| `bot/src/chain.ts` | `bot/src/config.ts` | `config.PINATA_JWT` check | WIRED | Line 177: `if (!config.PINATA_JWT)` |
| `bot/src/index.ts` | `bot/src/types.ts` | `RunSummary.uploadsAttempted` | WIRED | Lines 124-131 map `ExecuteActionsResult` IPFS fields to `RunSummary` |
| `bot/test/chain.test.ts` | `bot/src/ipfs.ts` | `vi.mock("../src/ipfs.js")` | WIRED | Line 1 module-level mock; line 16 import of mocked function |
| `bot/test/ipfs.integration.test.ts` | Pinata API | raw fetch POST | WIRED | Lines 22-32: direct fetch to `pinJSONToIPFS`; lines 51-59: DELETE unpin |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `chain.ts` (prepare pass) | `feedbackURI` | `uploadEvidenceToIPFS(evidence, metadata, jwt, timeoutMs)` → `.cid` → `buildFeedbackURI(cid)` | Yes — CID from Pinata response, not hardcoded | FLOWING |
| `chain.ts` (execute pass) | `feedbackURI` in writeContract args | `PreparedAction.feedbackURI` (from prepare pass) | Yes — never rebuilt; WR-01 preserved | FLOWING |
| `index.ts` | `summary.uploadsAttempted` | `result.uploadsAttempted` from `executeActions()` return | Yes — populated from real loop counters | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 81 unit tests pass | `cd bot && npx vitest run` | 81 passed, 1 skipped (integration) | PASS |
| TypeScript clean | `cd bot && npx tsc --noEmit` | 0 errors | PASS |
| Integration test skips without JWT | `cd bot && npx vitest run test/ipfs.integration.test.ts` | 1 skipped (counted as pass) | PASS |
| `buildFeedbackURI` returns ipfs:// | grep in evidence.ts | `return \`ipfs://${cid}\`` | PASS |
| `uploadEvidenceToIPFS` only in prepare pass | grep in chain.ts | 1 import + 1 call, both in prepare block (lines 16, 224) | PASS |
| `buildPositiveEvidence`/`buildNegativeEvidence` only in prepare pass | grep in chain.ts | Lines 191, 200 — both in prepare loop; none in execute loop | PASS |
| All systemic return sites include `uploadsAttempted` | grep chain.ts return sites | 6 post-empty-check returns all include `uploadsAttempted` (lines 163, 267, 408, 461, 476, 487) | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| IPFS-01 | 06-02, 06-03, 06-05 | Bot uploads evidence JSON to Pinata via REST API (native fetch, no SDK), returns ipfs:// CID | SATISFIED | `ipfs.ts` uses native `fetch` to POST to Pinata; returns `{cid, gatewayUrl, size, timestamp}`; `buildFeedbackURI` returns `ipfs://${cid}` |
| IPFS-02 | 06-03, 06-05 | Evidence follows existing kleros-reputation-oracle/v1 schema | SATISFIED | `EvidenceJson` interface + `buildPositiveEvidence`/`buildNegativeEvidence` produce all required schema fields; `schema: "kleros-reputation-oracle/v1"` literal enforced by TypeScript |
| IPFS-03 | 06-04 | IPFS upload failure skips the item (no fallback to data: URI); next run retries | SATISFIED | Upload failure pushes `{status:"skip"}`; no data: URI fallback anywhere in codebase; P3 test confirms batch continues |
| IPFS-04 | 06-04 | All evidence is uploaded (prepare phase) before any transactions are submitted (execute phase) | SATISFIED | Prepare loop (lines 152-276) completes before execute loop starts (line 284); nonce fetched only at execute pass start |
| IPFS-05 | 06-01, 06-04 | PINATA_JWT added to config as optional; when absent, IPFS features are disabled and items requiring evidence are skipped | SATISFIED | `PINATA_JWT: z.string().optional()` in configSchema; `!config.PINATA_JWT` check skips S1/S2 with warn log; S3 proceeds; P5 test validates |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `bot/src/evidence.ts` | 28 | `createdAt: new Date().toISOString()` | INFO | Called at evidence-build time in prepare pass (not execute pass), preserving WR-01 invariant. Not a stub — intentional behavior. |

No blockers found. The `new Date()` call in `buildPositiveEvidence`/`buildNegativeEvidence` is invoked once per action in the prepare pass (chain.ts lines 191, 200), satisfying WR-01. The execute pass never calls these functions.

### Human Verification Required

#### 1. Live Sepolia End-to-End Test

**Test:** Configure bot with real PINATA_JWT, real RPC, and funded wallet against Sepolia. Run bot against live PGTCR subgraph with pending items.
**Expected:** Transactions are submitted with calldata containing `ipfs://Qm...` URIs. Pinata dashboard shows pinned evidence JSON matching the kleros-reputation-oracle/v1 schema. `cdn.kleros.link/ipfs/<cid>` resolves to the evidence JSON.
**Why human:** Requires live Sepolia RPC, funded bot wallet (ETH for gas), real Pinata JWT, and active PGTCR items.

#### 2. Pinata Integration Test

**Test:** `PINATA_JWT=<real-jwt> cd bot && npx vitest run test/ipfs.integration.test.ts`
**Expected:** Test passes — CID matches `/^Qm[A-Za-z0-9]{44}$/`, unpin returns `"OK"`. Test completes within 30s.
**Why human:** Requires a Pinata JWT with `pinJSONToIPFS` AND `unpin` scopes (standard CI doesn't have this secret).

### Gaps Summary

No gaps found. All 5 observable truths are verified, all 11 artifacts are substantive and wired, all 5 requirement IDs (IPFS-01 through IPFS-05) are satisfied. The two human verification items require live external services (Sepolia, Pinata) and do not block automated validation.

**Key implementation quality notes:**
- WR-01 invariant preserved: evidence + createdAt captured once in prepare pass; execute pass never rebuilds it.
- Nonce fetched once at execute pass start (not prepare pass), consistent with zero on-chain calls in prepare.
- `orphanedCids` tracking: CIDs added on upload success, removed on confirmed tx. P6 test validates orphan accumulation during graceful shutdown.
- `consecutiveFailures` counter resets on success (D-18); 3-threshold escalates to `systemicFailure="pinata-unavailable"` (D-17).
- `retried` field in `ipfs-upload-failed` log computed from `errorClass` (not hardcoded), matching D-32.

---

_Verified: 2026-04-22T14:00:00Z_
_Verifier: Claude (gsd-verifier)_
