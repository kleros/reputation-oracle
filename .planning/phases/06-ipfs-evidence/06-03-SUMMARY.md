---
phase: 06-ipfs-evidence
plan: "03"
subsystem: bot
tags: [evidence, ipfs, refactor]
dependency_graph:
  requires: []
  provides: [buildFeedbackURI-cid-passthrough]
  affects: [bot/src/chain.ts]
tech_stack:
  added: []
  patterns: [ipfs-uri-passthrough]
key_files:
  created: []
  modified:
    - bot/src/evidence.ts
    - bot/test/evidence.test.ts
decisions:
  - "buildFeedbackURI accepts CID string, returns ipfs://<CID> — no base64 encoding (D-03)"
  - "EvidenceJson import retained in evidence.ts (still used by buildPositiveEvidence/buildNegativeEvidence)"
  - "EvidenceJson import removed from evidence.test.ts (no longer needed after test rewrite)"
metrics:
  duration_minutes: 5
  completed_date: "2026-04-22T12:19:58Z"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 2
requirements_satisfied:
  - IPFS-01
  - IPFS-02
---

# Phase 06 Plan 03: Update buildFeedbackURI to IPFS CID Passthrough — Summary

**One-liner:** Replace base64 data-URI encoding with `ipfs://<CID>` passthrough in `buildFeedbackURI`, breaking the API for Plan 06-04 to wire up.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Update buildFeedbackURI signature in evidence.ts | e25528e | bot/src/evidence.ts |
| 2 | Update evidence.test.ts to assert ipfs:// URIs | ce1ccca | bot/test/evidence.test.ts |

## What Changed

### bot/src/evidence.ts

`buildFeedbackURI` signature changed from `(evidence: EvidenceJson) => data:...` to `(cid: string) => ipfs://${cid}`. The base64 encoding path (`Buffer.from(json).toString("base64")`) is removed. JSDoc updated to reference D-03 and ipfs.ts upstream.

`buildPositiveEvidence`, `buildNegativeEvidence`, and `formatStake` are unchanged — evidence schema frozen per D-02.

### bot/test/evidence.test.ts

Both old `buildFeedbackURI` tests (data-URI shape assertion + base64 decode + JSON field checks) replaced with two new tests asserting `ipfs://` URI shape and exact output. Unused `import type { EvidenceJson }` removed. All 8 tests pass (2 new + 6 unchanged: buildPositiveEvidence, buildNegativeEvidence, 4× formatStake precision).

## Verification

```
pnpm exec vitest run test/evidence.test.ts
Test Files  1 passed (1)
      Tests  8 passed (8)
```

TypeScript errors from `chain.ts` (two call sites still passing `EvidenceJson` instead of `string`) are expected and will be fixed in Plan 06-04.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. `buildFeedbackURI` is now a pure passthrough — no stub values.

## Threat Flags

None. No new network endpoints, auth paths, or trust-boundary changes introduced.

## Self-Check: PASSED

- [x] bot/src/evidence.ts exists and contains `(cid: string): string` signature
- [x] bot/test/evidence.test.ts exists and contains `ipfs://QmTestCID123` assertion
- [x] Commit e25528e exists
- [x] Commit ce1ccca exists
- [x] 8/8 tests pass
