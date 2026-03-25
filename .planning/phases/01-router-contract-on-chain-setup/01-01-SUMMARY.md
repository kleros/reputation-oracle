---
phase: 01-router-contract-on-chain-setup
plan: 01
subsystem: contracts
tags: [solidity, foundry, uups-proxy, openzeppelin, erc-8004]

# Dependency graph
requires: []
provides:
  - KlerosReputationRouter contract with UUPS proxy support
  - Pinned IReputationRegistry and IIdentityRegistry interfaces
  - Foundry project scaffold with OpenZeppelin v5.6.0
  - ABI for bot integration (Phase 2)
affects: [01-02, 02-bot-typescript-implementation]

# Tech tracking
tech-stack:
  added: [foundry, openzeppelin-contracts-upgradeable@v5.6.0, solidity-0.8.28]
  patterns: [uups-proxy, feedbacktype-enum-state-model, atomic-revoke-then-negative]

key-files:
  created:
    - contracts/src/KlerosReputationRouter.sol
    - contracts/src/interfaces/IReputationRegistry.sol
    - contracts/src/interfaces/IIdentityRegistry.sol
    - contracts/foundry.toml
    - contracts/remappings.txt
  modified: []

key-decisions:
  - "Removed __UUPSUpgradeable_init() call -- not present in OZ v5 UUPS"
  - "Tags use CLAUDE.md authoritative values: verified, removed, kleros-agent-registry"
  - "feedbackIndex typed as uint64 matching getLastIndex return type"

patterns-established:
  - "UUPS proxy: Initializable + UUPSUpgradeable + OwnableUpgradeable with _disableInitializers constructor"
  - "FeedbackType enum state model: None/Positive/Negative with per-agentId tracking"
  - "Atomic revoke-then-negative: submitNegativeFeedback handles both Positive and None states"
  - "Storage gap: uint256[50] at end of contract for upgrade safety"

requirements-completed: [ROUT-01, ROUT-02, ROUT-03, ROUT-04, ROUT-05, ROUT-06, ROUT-07, ROUT-08, ROUT-09]

# Metrics
duration: 4min
completed: 2026-03-25
---

# Phase 1 Plan 1: Router Contract Implementation Summary

**UUPS-upgradeable KlerosReputationRouter with FeedbackType enum state model, three feedback scenarios, and bot authorization against pinned ERC-8004 interfaces**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-25T01:11:50Z
- **Completed:** 2026-03-25T01:15:47Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Scaffolded Foundry project with OpenZeppelin v5.6.0 upgradeable contracts, solc 0.8.28, cancun EVM
- Created pinned IReputationRegistry and IIdentityRegistry interfaces matching deployed Sepolia contracts
- Implemented KlerosReputationRouter with all three scenarios: submitPositiveFeedback (+95), submitNegativeFeedback (atomic revoke-then-negative -95), revokeOnly
- FeedbackType enum (None/Positive/Negative) resolves re-registration after dispute (D-01/D-02)
- Bot authorization via onlyAuthorizedBot modifier with owner-managed setAuthorizedBot
- UUPS proxy pattern with storage gap for future upgrades

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold Foundry project with OpenZeppelin dependencies** - `284dd36` (chore)
2. **Task 2: Create pinned ERC-8004 interface files** - `fe6bd7b` (feat)
3. **Task 3: Implement KlerosReputationRouter contract** - `5e1e349` (feat)

## Files Created/Modified
- `contracts/foundry.toml` - Foundry config: solc 0.8.28, cancun EVM, OZ remappings, fork profile
- `contracts/remappings.txt` - @openzeppelin/contracts and contracts-upgradeable mappings
- `contracts/.gitignore` - Standard Foundry ignores (out/, cache/, broadcast/)
- `contracts/src/KlerosReputationRouter.sol` - Router implementation: UUPS proxy, 3 feedback scenarios, bot auth
- `contracts/src/interfaces/IReputationRegistry.sol` - Pinned ERC-8004 ReputationRegistry interface (giveFeedback, revokeFeedback, getLastIndex, getSummary, readFeedback)
- `contracts/src/interfaces/IIdentityRegistry.sol` - Pinned ERC-8004 IdentityRegistry interface (register, ownerOf)

## Decisions Made
- Removed `__UUPSUpgradeable_init()` from initializer -- OZ v5 UUPSUpgradeable does not have this function
- Used `uint64` for feedbackIndex mapping (matching getLastIndex return type) instead of uint256 from D-01 text
- Tags follow CLAUDE.md authoritative values (`"verified"`, `"removed"`, `"kleros-agent-registry"`) over PRD `"curate-verified"` / `"curate-removed"`
- Removed nested .git directory created by `forge init` to integrate contracts/ into parent repo

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed __UUPSUpgradeable_init() call**
- **Found during:** Task 3 (Router implementation)
- **Issue:** OpenZeppelin v5 UUPSUpgradeable does not expose a `__UUPSUpgradeable_init()` function, causing compilation failure
- **Fix:** Removed the call from initialize(); only `__Ownable_init(_owner)` needed
- **Files modified:** contracts/src/KlerosReputationRouter.sol
- **Verification:** forge build succeeds
- **Committed in:** 5e1e349

**2. [Rule 3 - Blocking] Removed nested .git from contracts/**
- **Found during:** Task 1 (Foundry scaffold)
- **Issue:** `forge init` creates its own git repo inside contracts/, preventing git add from parent repo
- **Fix:** Removed contracts/.git directory and all nested .git in lib/ submodules
- **Files modified:** N/A (git metadata only)
- **Verification:** git add contracts/ succeeds
- **Committed in:** 284dd36

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both fixes necessary for compilation and git integration. No scope creep.

## Issues Encountered
- `forge init --no-commit` flag does not exist in Foundry 1.4.4; default behavior already skips commit (fixed by using `forge init contracts` without flag)
- Forge lint note about unwrapped modifier logic (informational only, not an error)

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all contract functions are fully implemented with real logic.

## Next Phase Readiness
- Router contract ABI is ready for fork testing (Plan 01-02) and bot integration (Phase 2)
- forge build succeeds, storage layout verified via forge inspect
- Deploy script and fork tests are the next step (Plan 01-02)

## Self-Check: PASSED

All 5 created files verified on disk. All 3 task commits verified in git log.

---
*Phase: 01-router-contract-on-chain-setup*
*Completed: 2026-03-25*
