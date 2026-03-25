---
phase: 01-router-contract-on-chain-setup
plan: 03
subsystem: infra
tags: [foundry, solidity, deploy-script, uups-proxy, erc-8004, sepolia]

# Dependency graph
requires:
  - phase: 01-router-contract-on-chain-setup/01-01
    provides: KlerosReputationRouter contract + ERC-8004 interfaces
provides:
  - Idempotent Deploy.s.sol script for full on-chain setup
  - UUPS proxy deployment + Kleros identity registration + Router config + bot authorization
affects: [01-router-contract-on-chain-setup/01-02, 02-bot-typescript-off-chain, 03-verification]

# Tech tracking
tech-stack:
  added: [forge-std Script, ERC1967Proxy]
  patterns: [idempotent deploy script with on-chain state checks]

key-files:
  created:
    - contracts/script/Deploy.s.sol

key-decisions:
  - "Steps 2+3 combined check: register agent and set agentId together when klerosAgentId() == 0"
  - "Deployer wallet registers Kleros identity (not Router) to avoid self-feedback revert"
  - "ROUTER_PROXY_ADDRESS env var for idempotent re-runs after initial deployment"

patterns-established:
  - "Idempotent deploy: each step checks on-chain state before executing"
  - "Console logging with step numbers and SKIP messages for traceability"

requirements-completed: [SETUP-01, SETUP-02, SETUP-03, SETUP-04]

# Metrics
duration: 2min
completed: 2026-03-25
---

# Phase 1 Plan 03: Deploy Script Summary

**Idempotent Foundry deploy script deploying Router UUPS proxy, registering Kleros 8004 identity, configuring agentId, and authorizing bot in a single invocation**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-25T01:18:25Z
- **Completed:** 2026-03-25T01:20:11Z
- **Tasks:** 1 of 2 (Task 2 is human-verify checkpoint)
- **Files modified:** 1

## Accomplishments
- Created Deploy.s.sol implementing all four SETUP requirements (SETUP-01 through SETUP-04)
- All steps idempotent: proxy deployment skipped if ROUTER_PROXY_ADDRESS set, agent registration skipped if klerosAgentId != 0, bot auth skipped if already authorized
- Script compiles successfully with forge build

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement idempotent Deploy.s.sol with all setup steps** - `8b3ca5d` (feat)
2. **Task 2: Verify deploy script dry-run on Sepolia fork** - checkpoint:human-verify (non-blocking)

## Files Created/Modified
- `contracts/script/Deploy.s.sol` - Idempotent deploy + setup orchestrator script for Router proxy, Kleros identity, and bot authorization

## Decisions Made
- Combined Steps 2+3 into a single idempotency check: if `klerosAgentId() == 0`, both register on IdentityRegistry and configure the Router with the resulting agentId
- Deployer wallet (msg.sender) registers the Kleros agent on IdentityRegistry, not the Router contract, to avoid self-feedback revert (Pitfall 5)
- ROUTER_PROXY_ADDRESS env var enables safe re-runs by skipping proxy deployment
- Initialize Router with `klerosAgentId = 0` on first deploy, then set it after identity registration

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## Checkpoint: Human Verification Pending

Task 2 is a non-blocking human-verify checkpoint. The deploy script should be dry-run against Sepolia to verify all 4 steps execute correctly:

```bash
export SEPOLIA_RPC_URL="your-alchemy-or-infura-sepolia-url"
export BOT_ADDRESS="0x0000000000000000000000000000000000000001"
cd contracts
forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

## Next Phase Readiness
- Deploy script ready for dry-run and broadcast to Sepolia
- Full on-chain infrastructure can be deployed with a single forge script command
- Bot (Phase 2) will use the deployed Router proxy address and authorized bot wallet

---
*Phase: 01-router-contract-on-chain-setup*
*Completed: 2026-03-25*
