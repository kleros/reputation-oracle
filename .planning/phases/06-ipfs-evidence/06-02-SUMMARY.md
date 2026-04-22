---
phase: 06-ipfs-evidence
plan: "02"
subsystem: bot
tags: [ipfs, pinata, upload, error-classification, unit-tests, vitest-config]
dependency_graph:
  requires: []
  provides:
    - bot/src/ipfs.ts (uploadEvidenceToIPFS function)
    - bot/test/ipfs.test.ts (D-34 unit test coverage)
    - bot/vitest.config.ts (unstubGlobals/unstubEnvs)
  affects:
    - bot/src/chain.ts (will import uploadEvidenceToIPFS in plan 06-04)
tech_stack:
  added: []
  patterns:
    - native fetch with AbortController timeout
    - 4-class HTTP error classification (auth/rate-limit/server/network)
    - one-retry loop for server/rate-limit errors
    - vi.stubGlobal("fetch") with Promise.all rejection pattern
    - vitest unstubGlobals for automatic global cleanup
key_files:
  created:
    - bot/src/ipfs.ts
    - bot/test/ipfs.test.ts
    - bot/vitest.config.ts
  modified: []
decisions:
  - "Used Object.assign to augment AbortError/TypeError with errorClass before re-throwing — required for test assertions on error.errorClass"
  - "Promise.all([expect(...).rejects, vi.runAllTimersAsync()]) pattern for all rejection tests — prevents unhandled rejection warnings in vitest 4"
  - "unstubEnvs: true added alongside unstubGlobals — future-proofs for integration test that stubs PINATA_JWT"
metrics:
  duration_minutes: 12
  completed_date: "2026-04-22"
  tasks_completed: 3
  tasks_total: 3
  files_created: 3
  files_modified: 0
---

# Phase 6 Plan 02: Pinata Upload Module Summary

**One-liner:** Native-fetch Pinata upload module with 4-class error classification, one-retry on server/rate-limit, AbortController timeout, and full D-34 unit test coverage.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Create bot/src/ipfs.ts — Pinata upload module | `426272c` | bot/src/ipfs.ts |
| 2 | Create bot/test/ipfs.test.ts — D-34 unit test matrix | `c52969d` | bot/test/ipfs.test.ts |
| 3 | Create bot/vitest.config.ts with unstubGlobals | `7cec727` | bot/vitest.config.ts |

## What Was Built

`bot/src/ipfs.ts` — 141 LOC, single exported function `uploadEvidenceToIPFS(evidence, metadata, jwt, timeoutMs)`:
- Posts evidence JSON to `https://api.pinata.cloud/pinning/pinJSONToIPFS` via native fetch
- AbortController timeout (configurable `timeoutMs` param, caller passes `PINATA_TIMEOUT_MS`)
- 4-class error classification: `auth` (401/403 no-retry), `rate-limit` (429 one-retry), `server` (5xx one-retry), `network` (AbortError/TypeError no-retry)
- `isDuplicate=true` treated as success — same CID returned unchanged
- Error body truncated to 500 chars before logging (D-21)
- clearTimeout in both success and catch paths (RESEARCH Pitfall 2)
- Exports `PinataMetadata` and `PinataUploadResult` interfaces
- Pino structured logging: `ipfs-upload-ok` at info (D-31)

`bot/test/ipfs.test.ts` — 205 LOC, 10 test cases covering all D-34 scenarios:
- Tests 1-2: success + isDuplicate=true
- Tests 3-4: 401/403 auth errors (1 fetch call each)
- Test 5: 429 rate-limit exhausted after 1 retry (2 fetch calls)
- Tests 6-7: 500 retry-succeeds / 500 retry-exhausted
- Tests 8-9: AbortError / TypeError network errors
- Test 10: call-count assertion for non-retry paths

`bot/vitest.config.ts` — minimal config with `unstubGlobals: true` and `unstubEnvs: true`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] AbortError/TypeError not augmented with errorClass before re-throw**
- **Found during:** Task 2 first test run — Tests 8 and 9 failed
- **Issue:** When fetch rejects with AbortError or TypeError, the catch block classified them as "network" but re-threw the original error object without adding `errorClass` to it. HTTP errors were augmented via `Object.assign` at throw-site, but native fetch errors were not.
- **Fix:** Added `Object.assign(err as object, { errorClass })` in catch block when `errorClass` is not already present on the error.
- **Files modified:** bot/src/ipfs.ts
- **Commit:** included in `426272c` (fix applied before committing after test run)

**2. [Rule 1 - Bug] Unhandled rejection warnings for immediate-throw tests**
- **Found during:** Task 2 first test run — 6 unhandled rejection warnings
- **Issue:** Tests 3, 4, 8, 9 used `await vi.runAllTimersAsync()` then `await expect(promise).rejects` sequentially. For non-retry errors (no delay involved), the promise rejects synchronously during timer advancement, making the rejection unhandled by the time `await expect(...).rejects` runs.
- **Fix:** Switched all rejection tests (3, 4, 5, 7, 8, 9, 10) to use `Promise.all([expect(...).rejects, vi.runAllTimersAsync()])` pattern — same as tx.test.ts line 84-87 template. This ensures the rejection handler is attached before any async execution.
- **Files modified:** bot/test/ipfs.test.ts
- **Commit:** `c52969d`

## Verification Results

```
vitest run test/ipfs.test.ts  → 10/10 passed
vitest run                    → 75/75 passed (7 test files)
tsc --noEmit                  → 0 errors
grep KLEROS_GATEWAY            → const KLEROS_GATEWAY = "https://cdn.kleros.link/ipfs/"
grep clearTimeout | wc -l      → 2
```

## Known Stubs

None. `uploadEvidenceToIPFS` is fully implemented; no placeholder data flows to any output.

## Threat Surface Scan

No new network endpoints or auth paths beyond what the plan's threat model already covers. `bot/src/ipfs.ts` introduces one outbound HTTPS call (Pinata API) already enumerated in T-06-02-01 through T-06-02-05. Mitigations applied:
- JWT in Authorization header, covered by `pino redact.paths` (`PINATA_JWT`, `Authorization`)
- Error body truncated to 500 chars (T-06-02-02)
- AbortController 30s cap enforced by caller-supplied `timeoutMs` (T-06-02-03)

## Self-Check: PASSED

- `bot/src/ipfs.ts` — FOUND
- `bot/test/ipfs.test.ts` — FOUND
- `bot/vitest.config.ts` — FOUND
- Commit `426272c` — FOUND
- Commit `c52969d` — FOUND
- Commit `7cec727` — FOUND
