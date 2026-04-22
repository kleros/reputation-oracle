---
phase: 06-ipfs-evidence
plan: "04"
subsystem: bot
tags: [chain, ipfs, prepare-execute-split, pinata, evidence, tests]
dependency_graph:
  requires:
    - 06-01 (PINATA_JWT config, ExecuteActionsResult IPFS fields)
    - 06-02 (uploadEvidenceToIPFS, PinataMetadata)
    - 06-03 (buildFeedbackURI(cid) signature)
  provides:
    - executeActions() restructured with prepare/execute split
    - 6 new P1-P6 test cases for IPFS prepare/execute scenarios
  affects:
    - bot/src/chain.ts
    - bot/test/chain.test.ts
tech_stack:
  added: []
  patterns:
    - prepare/execute split (IPFS uploads before any on-chain txs)
    - PreparedAction internal discriminated union (ready | skip | no-ipfs)
    - consecutiveFailures counter with systemic escalation at 3 (D-17)
    - orphanedCids tracking: added on upload success, removed on tx confirm
    - retried computed from errorClass (not hardcoded) (D-32)
    - module-level vi.mock("../src/ipfs.js") for uploadEvidenceToIPFS
key_files:
  created: []
  modified:
    - bot/src/chain.ts
    - bot/test/chain.test.ts
decisions:
  - "WR-01 preserved: evidence and createdAt captured once in prepare pass; execute pass receives PreparedAction.feedbackURI — never calls buildPositiveEvidence/buildNegativeEvidence again"
  - "PreparedAction defined at module scope (not inside executeActions) for TypeScript narrowing clarity"
  - "nonce fetched at start of execute pass (not prepare pass) — prepare pass makes zero on-chain calls (RESEARCH.md Pitfall 8)"
  - "All systemic return sites (shutdown, pinata-unavailable, receipt_timeout, receipt_null, submission_failed) include IPFS counters and orphanedCids"
  - "Existing SC-1a/SC-1b/SC-2/SC-4 tests updated to use mockConfigWithJwt — required because S1/S2 are now skipped in prepare pass when PINATA_JWT absent"
metrics:
  duration_minutes: 15
  completed_date: "2026-04-22"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
requirements_satisfied:
  - IPFS-03
  - IPFS-04
  - IPFS-05
---

# Phase 6 Plan 04: chain.ts Prepare/Execute Split Summary

**One-liner:** Restructured `executeActions()` with a prepare pass (all IPFS uploads before any txs) and an execute pass (on-chain txs using pre-built `ipfs://` URIs), with 3-consecutive-failure escalation, shutdown-during-prepare support, and orphanedCids tracking.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Restructure executeActions() in chain.ts with prepare/execute split | aeb1541 | bot/src/chain.ts |
| 2 | Extend chain.test.ts with 6 prepare/execute split test cases | c966acd | bot/test/chain.test.ts |

## What Was Built

### Task 1 — chain.ts restructure

`executeActions()` restructured from a single loop into two sequential passes:

**Prepare pass** (new, before any on-chain txs):
- S3 `revokeOnly` actions: pushed as `{ status: "no-ipfs" }` — no upload needed
- PINATA_JWT absent: S1/S2 pushed as `{ status: "skip" }` with warn log; `skipped++` (D-26, IPFS-05)
- S1/S2 with JWT: evidence built once (`buildPositiveEvidence`/`buildNegativeEvidence`), metadata constructed (D-29), `uploadEvidenceToIPFS()` called, `feedbackURI = buildFeedbackURI(cid)` computed
- Upload success: pushed as `{ status: "ready", feedbackURI, evidence, cid }`; CID added to `orphanedCids`
- Upload failure: `skipped++`, pushed as `{ status: "skip" }`, `consecutiveFailures++`; resets to 0 on success (D-18)
- 3 consecutive failures: return `systemicFailure: "pinata-unavailable"` without entering execute pass (D-17)
- Shutdown check before each upload; return early if set (D-22)

**Execute pass** (restructured from old single loop):
- Skips `status: "skip"` entries (already counted)
- `feedbackURI` comes from `PreparedAction.feedbackURI` — NEVER rebuilt (WR-01)
- All existing gas estimation, writeContract, receipt logic preserved verbatim
- On tx success: CID removed from `orphanedCids` (it was successfully submitted on-chain)
- All return paths include `uploadsAttempted`, `uploadsSucceeded`, `uploadsFailed`, `orphanedCids`

New `PreparedAction` internal type (module scope, not exported):
```typescript
type PreparedAction =
  | { action: Action; status: "ready"; feedbackURI: string; evidence: EvidenceJson; cid: string }
  | { action: Action; status: "skip"; reason: string }
  | { action: Action; status: "no-ipfs" };
```

### Task 2 — chain.test.ts extensions

Added `vi.mock("../src/ipfs.js")` at module level (before imports) and `mockConfigWithJwt` const.

6 new P1-P6 tests in `describe("executeActions — IPFS prepare/execute split")`:
- **P1**: S1 happy path — `uploadEvidenceToIPFS` resolves, `writeContract` called, `txSent=1`
- **P2**: S3 revokeOnly — `uploadEvidenceToIPFS` NOT called, `writeContract` called, `txSent=1`
- **P3**: one upload fails, next succeeds — `skipped=1`, `txSent=1`, batch continues
- **P4**: 3 consecutive failures — `systemicFailure="pinata-unavailable"`, `writeContract` NOT called
- **P5**: PINATA_JWT absent — S1 skipped (`skipped=1`), S3 proceeds (`txSent=1`), no IPFS call
- **P6**: SIGTERM during prepare (shutdown set inside mock) — `writeContract` NOT called, `orphanedCids` contains orphaned CID

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated existing tests to use mockConfigWithJwt**

- **Found during:** Task 2 first test run after Task 1 restructure
- **Issue:** Existing tests SC-1a, SC-1b, SC-2, SC-4, and "submission_failed_non_revert" all use `mockConfig` (no PINATA_JWT) with `submitPositiveFeedback` actions. With the new prepare/execute split, S1/S2 actions are skipped in the prepare pass when PINATA_JWT is absent — meaning gas estimation is never reached. SC-1a expected `skipped=1, txSent=1` but got `skipped=2, txSent=0`. SC-2 and others similarly broken.
- **Fix:** Updated all 5 affected tests to use `mockConfigWithJwt` and added `vi.mocked(uploadEvidenceToIPFS).mockResolvedValueOnce(makeIpfsResult())` for each S1 action in the test. This is the correct behavior — these tests are testing gas estimation / receipt / writeContract failure scenarios, which require the IPFS prepare pass to succeed first.
- **Files modified:** `bot/test/chain.test.ts`
- **Commit:** c966acd

## Verification

```
pnpm exec tsc --noEmit              → 0 errors
pnpm exec vitest run test/chain.test.ts → 13/13 passed (7 existing + 6 new)
pnpm exec vitest run                → 81/81 passed (7 test files)
grep "PreparedAction" chain.ts      → type defined, used in prepare/execute
grep "buildPositiveEvidence" chain.ts → 3 lines (1 import + 2 calls in prepare pass only)
grep "TODO(06-04)" chain.ts         → no matches (inline data-URI workaround removed)
```

## Known Stubs

None. `executeActions()` is fully wired — real IPFS upload (`uploadEvidenceToIPFS`) called in prepare pass, real CID passed to `buildFeedbackURI`, real `ipfs://` URI used in on-chain tx calldata.

## Threat Surface Scan

No new network endpoints or auth paths introduced beyond the plan's threat model. The prepare pass calls `uploadEvidenceToIPFS()` which was already covered by T-06-02-* (outbound HTTPS to Pinata API). Mitigations confirmed:
- T-06-04-01 (WR-01 tampering): evidence built once in prepare pass, execute pass never rebuilds it — verified by P6 test and `grep buildPositiveEvidence` showing no calls in execute loop
- T-06-04-02 (DoS via consecutive failures): `consecutiveFailures` counter verified by P4 test
- T-06-04-03 (JWT disclosure): `config.PINATA_JWT` passed directly to `uploadEvidenceToIPFS()`, never logged

## Self-Check: PASSED

- bot/src/chain.ts — FOUND, contains PreparedAction, uploadEvidenceToIPFS, pinata-unavailable, orphanedCids
- bot/test/chain.test.ts — FOUND, contains vi.mock("../src/ipfs.js"), mockConfigWithJwt, P1-P6 tests
- Commit aeb1541 — confirmed in git log
- Commit c966acd — confirmed in git log
- 81/81 tests pass
- tsc --noEmit: 0 errors
