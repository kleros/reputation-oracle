---
phase: quick-260424-1pi
plan: "01"
subsystem: bot/evidence
tags: [ipfs, evidence, types, tdd]
dependency_graph:
  requires: []
  provides: [EvidenceJson.text field populated in both builders]
  affects: [bot/src/types.ts, bot/src/evidence.ts, bot/test/evidence.test.ts]
tech_stack:
  added: []
  patterns: [TDD red-green, template literals for human-readable fields]
key_files:
  modified:
    - bot/src/types.ts
    - bot/src/evidence.ts
    - bot/test/evidence.test.ts
decisions:
  - text field placed between tag2 and kleros block — human-readable fields grouped together before structured kleros block
  - disputeId used as raw string in text (not parseInt) — preserves original ID in message per plan spec
  - formatStake() reused in positive text — consistent formatting, no new logic
metrics:
  duration: ~5 minutes
  completed: "2026-04-24T00:17:00Z"
  tasks_completed: 1
  files_modified: 3
---

# Phase quick-260424-1pi Plan 01: Add text field to EvidenceJson Summary

**One-liner:** Added `text: string` field to `EvidenceJson` with human-readable collateralization/removal sentences populated by both evidence builders.

## What Was Built

`EvidenceJson.text` is now present in every IPFS evidence document produced by the bot. Consumers browsing IPFS evidence JSON see plain English instead of raw numbers and tags.

- **Positive:** `"Agent 42 is actively collateralized in the Kleros Verified Agents Registry (0x...) with 0.002 WETH staked. No active disputes."`
- **Negative (dispute):** `"Agent 42 was removed from the Kleros Verified Agents Registry (0x...) after Kleros dispute #1234. Challenger prevailed."`
- **Negative (voluntary):** `"Agent 42 was removed from the Kleros Verified Agents Registry (0x...)."`

Schema version remains `kleros-reputation-oracle/v1` — no version bump needed for additive field.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add text field to EvidenceJson and both builders | cdb6c2c | types.ts, evidence.ts, evidence.test.ts |

## TDD Gate Compliance

- RED: 3 new tests added, all failing (text field undefined) — confirmed before implementation
- GREEN: Implementation added, all 101 tests pass (3 new + 98 existing)
- REFACTOR: Not needed — implementation clean on first pass

## Deviations from Plan

None — plan executed exactly as written.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries. The `text` field is constructed from already-validated on-chain params (agentId, pgtcrAddress, disputeId) — no new attack surface per T-1pi-01.

## Self-Check: PASSED

- `bot/src/types.ts` modified: FOUND
- `bot/src/evidence.ts` modified: FOUND
- `bot/test/evidence.test.ts` modified: FOUND
- Commit `cdb6c2c` exists: FOUND
- All 101 tests pass, 0 Biome findings
