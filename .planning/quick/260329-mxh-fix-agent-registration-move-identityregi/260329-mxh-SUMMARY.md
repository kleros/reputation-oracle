---
phase: quick-260329-mxh
plan: 01
subsystem: contracts
tags: [solidity, uups-upgrade, identity-registry, erc721-receiver]
dependency_graph:
  requires: []
  provides: [registerAgent-function, upgrade-script, erc721-receiver]
  affects: [deploy-flow, proxy-upgrade]
tech_stack:
  added: [IERC721Receiver]
  patterns: [onERC721Received-for-safeMint]
key_files:
  created:
    - contracts/script/Upgrade.s.sol
  modified:
    - contracts/src/KlerosReputationRouter.sol
    - contracts/script/Deploy.s.sol
    - contracts/test/KlerosReputationRouter.t.sol
decisions:
  - registerAgent() internally sets klerosAgentId (atomic, not two-step)
  - Added AgentRegistered event for deployment verification
  - Implemented IERC721Receiver since IdentityRegistry uses safeMint
metrics:
  duration: 4min
  completed: "2026-03-29T17:06:44Z"
  tasks: 2
  files: 4
---

# Quick Task 260329-mxh: Fix Agent Registration Summary

Add registerAgent() to KlerosReputationRouter so Router contract owns agentId on IdentityRegistry, with UUPS upgrade script and IERC721Receiver for safeMint compatibility.

## What Changed

### Task 1: Add registerAgent() to Router + update Deploy.s.sol + create Upgrade.s.sol
**Commit:** `6ecd1b4`

- Added `registerAgent(string calldata agentURI) external onlyOwner returns (uint256)` to Router
- Added `AgentRegistered(uint256 indexed agentId, string agentURI)` event
- Updated Deploy.s.sol: step 2 now calls `router.registerAgent()` instead of `IIdentityRegistry.register()` + `setKlerosAgentId()` -- step 3 eliminated
- Created Upgrade.s.sol for UUPS proxy upgrades with state verification logging

### Task 2: Fork tests + ERC721Receiver fix
**Commit:** `b74b5b1`

- Added 5 fork tests: registerAgent sets klerosAgentId, Router is ownerOf, event emitted, non-owner reverts, upgrade preserves state
- Added `IERC721Receiver` implementation to Router (IdentityRegistry uses `_safeMint`, requires `onERC721Received`)
- All 22 tests pass (17 existing + 5 new), zero regressions
- Storage layout verified unchanged (slots 0-5 + gap[50])

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added IERC721Receiver to Router**
- **Found during:** Task 2 (TDD RED phase)
- **Issue:** IdentityRegistry.register() uses ERC-721 `_safeMint` which calls `onERC721Received` on the recipient. Router contract reverted with `ERC721InvalidReceiver`.
- **Fix:** Added `IERC721Receiver` interface + `onERC721Received()` implementation to KlerosReputationRouter
- **Files modified:** contracts/src/KlerosReputationRouter.sol
- **Commit:** `b74b5b1`

## Verification

1. `forge build` -- compiles without errors
2. `forge test --fork-url $SEPOLIA_RPC_URL -vv` -- all 22 tests pass
3. `forge inspect KlerosReputationRouter storageLayout` -- slots 0-5 + gap unchanged

## Known Stubs

None.
