---
phase: 02-stateless-bot
plan: 03
subsystem: bot
tags: [viem, multicall3, graphql-request, subgraph, cursor-pagination]

requires:
  - phase: 02-stateless-bot/01
    provides: types (RawSubgraphItem, FeedbackType, Action), config (Config), evidence builders, Router ABI
provides:
  - fetchAllItems() subgraph client with id_gt cursor pagination
  - readRouterStates() via Multicall3-batched feedbackType reads
  - createViemPublicClient/createViemWalletClient factory functions
  - executeActions() sequential tx executor with nonce management
affects: [02-stateless-bot/02, 02-stateless-bot/04]

tech-stack:
  added: []
  patterns: [cursor-pagination-id_gt, multicall3-batch-reads, sequential-nonce-tx]

key-files:
  created:
    - bot/src/subgraph.ts
    - bot/src/chain.ts
  modified: []

key-decisions:
  - "batchSize 1024*200 bytes for Multicall3 (Pitfall 7: bytes not call count)"
  - "Failed multicall reads default to FeedbackType.None (conservative: triggers positive for Submitted)"
  - "executeActions throws on reverted receipt (D-10: stop on first failure)"

patterns-established:
  - "Cursor pagination: id_gt with entity id field, never itemID or skip"
  - "Chain client factories: buildChain helper shared between public and wallet clients"

requirements-completed: [BOT-01, BOT-02]

duration: 4min
completed: 2026-03-26
---

# Phase 02 Plan 03: Data Fetching Layer Summary

**Subgraph cursor-paginated client and Multicall3-batched chain reader with sequential tx executor**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-26T14:30:22Z
- **Completed:** 2026-03-26T14:34:19Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Subgraph client fetches all PGTCR items via id_gt cursor pagination (never skip)
- Chain reader batches feedbackType reads via viem multicall with correct byte-based batchSize
- Transaction executor handles sequential nonce management with stop-on-first-failure

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement subgraph client with cursor pagination** - `51e6543` (feat)
2. **Task 2: Implement chain reader with Multicall3 and client factories** - `13d2ef9` (feat)

## Files Created/Modified
- `bot/src/subgraph.ts` - GraphQL subgraph client with id_gt cursor pagination, fetches all items including Absent
- `bot/src/chain.ts` - Viem client factories, Multicall3 feedbackType reader, sequential tx executor

## Decisions Made
- batchSize set to 1024*200 (bytes, not call count) per Pitfall 7 from research
- Failed multicall reads default to FeedbackType.None -- conservative approach that correctly triggers positive feedback for Submitted items
- executeActions throws Error on reverted receipt rather than process.exit, letting caller handle cleanup

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Biome import sorting required reordering imports in chain.ts (auto-fixed with biome check --write)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- subgraph.ts and chain.ts ready to wire into computeActions() (Plan 02) and orchestrator (Plan 04)
- Both modules type-check cleanly and pass biome linting

## Self-Check: PASSED

- All files exist: bot/src/subgraph.ts, bot/src/chain.ts, 02-03-SUMMARY.md
- All commits exist: 51e6543, 13d2ef9

---
*Phase: 02-stateless-bot*
*Completed: 2026-03-26*
