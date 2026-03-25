---
phase: 01-router-contract-on-chain-setup
plan: 02
subsystem: testing
tags: [foundry, forge, fork-test, solidity, erc-8004, sepolia]

# Dependency graph
requires:
  - phase: 01-router-contract-on-chain-setup
    plan: 01
    provides: KlerosReputationRouter contract, IReputationRegistry and IIdentityRegistry interfaces
provides:
  - Fork test suite (17 tests) proving all 3 scenarios against real Sepolia ReputationRegistry
  - Edge case coverage for authorization, double-submit guards, re-registration
affects: [01-03, 02-bot-stateless-diff-engine, 03-end-to-end-verification]

# Tech tracking
tech-stack:
  added: []
  patterns: [forge fork testing against real Sepolia contracts, getSummary verification pattern]

key-files:
  created:
    - contracts/test/KlerosReputationRouter.t.sol
  modified: []

key-decisions:
  - "Used publicnode Sepolia RPC (ethereum-sepolia-rpc.publicnode.com) since rpc.sepolia.org returns 522"
  - "Each test registers a fresh agent via _registerTestAgent() to avoid state pollution"
  - "getSummary with empty tags used as primary verification method (proves real ERC-8004 integration)"

patterns-established:
  - "Fork test pattern: vm.createSelectFork + ERC1967Proxy deployment + real registry verification"
  - "Helper pattern: _routerArray(), _registerTestAgent(), _getSummary() for DRY test code"

requirements-completed: [ROUT-10]

# Metrics
duration: 4min
completed: 2026-03-25
---

# Phase 1 Plan 2: Fork Test Suite Summary

**17 Foundry fork tests proving all 3 Router scenarios (positive/negative/revoke) plus re-registration, auth guards, and state edge cases against real Sepolia ReputationRegistry**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-25T01:18:18Z
- **Completed:** 2026-03-25T01:22:01Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- All 3 business scenarios verified via getSummary on real Sepolia ReputationRegistry
- Scenario 2 proven atomic: revoke-then-negative produces value=-95 (not average of +95/-95=0)
- Re-registration after dispute works: Negative -> Positive transition succeeds (history accumulates)
- 17 tests total, all passing against forked Sepolia

## Task Commits

Each task was committed atomically:

1. **Task 1: Fork test setUp with proxy deployment and agent registration** - `1bbf1e6` (test)
2. **Task 2: All scenario tests and edge case tests** - `cfb501a` (test)

## Files Created/Modified
- `contracts/test/KlerosReputationRouter.t.sol` - Fork test suite: setUp deploys Router proxy against real Sepolia registries, registers test agents, 17 test functions covering scenarios 1-3, re-registration, auth, state guards, owner management

## Decisions Made
- Used `https://ethereum-sepolia-rpc.publicnode.com` as Sepolia RPC since `rpc.sepolia.org` returns HTTP 522 (confirmed in research)
- Each test gets a fresh agent via `_registerTestAgent()` to prevent state pollution between tests
- getSummary with empty tags (no tag filtering) used as primary verification -- proves real ERC-8004 integration end-to-end
- Re-registration test asserts count=2 (negative + new positive both active), confirming history accumulation per project decision

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `SEPOLIA_RPC_URL` environment variable not set in execution environment. Used public RPC `ethereum-sepolia-rpc.publicnode.com` for test verification. Users must set `SEPOLIA_RPC_URL` to run fork tests.

## User Setup Required

Users must set `SEPOLIA_RPC_URL` environment variable to run fork tests:
```bash
export SEPOLIA_RPC_URL="https://ethereum-sepolia-rpc.publicnode.com"
# Or use a private RPC (Alchemy/Infura) for reliability
```

## Next Phase Readiness
- Router contract fully tested against real Sepolia -- ready for deployment (Plan 01-03)
- Test suite can be re-run with `SEPOLIA_RPC_URL=<url> forge test -vv` in contracts/
- All 3 scenarios proven correct via getSummary verification

## Self-Check: PASSED

- [x] contracts/test/KlerosReputationRouter.t.sol exists
- [x] 01-02-SUMMARY.md exists
- [x] Commit 1bbf1e6 (Task 1) found
- [x] Commit cfb501a (Task 2) found

---
*Phase: 01-router-contract-on-chain-setup*
*Completed: 2026-03-25*
