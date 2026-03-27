# Roadmap: Kleros Reputation Oracle

## Overview

Deliver a working Kleros Reputation Oracle on Sepolia: a Router contract that encodes all feedback logic, a stateless bot that diffs subgraph state against on-chain state and executes the reconciliation, and end-to-end proof that all three scenarios produce correct ERC-8004 reputation via `getSummary()`. Contract first (everything depends on the ABI), then bot (codes against the deployed Router), then verification (proves the system works).

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Router Contract & On-Chain Setup** - Deploy upgradeable Router with all 3 scenario functions, register Kleros 8004 identity, configure bot authorization
- [x] **Phase 2: Stateless Bot** - Build the diff engine that reads subgraph + Router state, computes actions, and executes feedback transactions (completed 2026-03-26)
- [ ] **Phase 3: End-to-End Verification** - Prove all three scenarios produce correct reputation on Sepolia via getSummary()

## Phase Details

### Phase 1: Router Contract & On-Chain Setup
**Goal**: All on-chain infrastructure is deployed, configured, and tested -- Router contract handles all three feedback scenarios, Kleros identity is registered, and bot address is authorized
**Depends on**: Nothing (first phase)
**Requirements**: ROUT-01, ROUT-02, ROUT-03, ROUT-04, ROUT-05, ROUT-06, ROUT-07, ROUT-08, ROUT-09, ROUT-10, SETUP-01, SETUP-02, SETUP-03, SETUP-04
**Success Criteria** (what must be TRUE):
  1. Router is deployed on Sepolia as a UUPS proxy and can be called via its proxy address
  2. Calling `submitPositiveFeedback` creates a +95 feedback entry on the ReputationRegistry (verified via direct Registry read)
  3. Calling `submitNegativeFeedback` revokes the prior positive and creates a -95 entry (not an average of +95 and -95)
  4. Calling `revokeOnly` removes existing feedback without creating new entries
  5. Kleros is registered as an 8004 agent and the Router is configured with the correct klerosAgentId, registry addresses, and authorized bot
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md -- Foundry scaffold, ERC-8004 interfaces, Router contract implementation (ROUT-01 through ROUT-09)
- [ ] 01-02-PLAN.md -- Fork test suite covering all 3 scenarios and edge cases (ROUT-10)
- [ ] 01-03-PLAN.md -- Idempotent deploy script with identity registration and bot authorization (SETUP-01 through SETUP-04)

### Phase 2: Stateless Bot
**Goal**: A one-shot TypeScript bot reads PGTCR subgraph state and Router on-chain state, computes the minimum set of reconciliation actions, and executes them against the deployed Router
**Depends on**: Phase 1
**Requirements**: BOT-01, BOT-02, BOT-03, BOT-04, BOT-05, BOT-06, BOT-07, BOT-08, BOT-09
**Success Criteria** (what must be TRUE):
  1. Running the bot against a PGTCR list with Submitted items and no prior feedback produces giveFeedback transactions (Scenario 1)
  2. Running the bot against a PGTCR list with Absent+Reject items that have prior feedback produces revoke-then-negative transactions (Scenario 2)
  3. Running the bot in dry-run mode prints planned actions to stdout without submitting any transactions
  4. Bot exits with code 0 after successful execution and non-zero on failure, with no daemon loop
  5. Malformed subgraph items are logged and skipped without crashing the run
**Plans**: 4 plans

Plans:
- [x] 02-01-PLAN.md -- Project scaffold, types, Router ABI, config, validation, evidence (BOT-04, BOT-05, BOT-06, BOT-09)
- [x] 02-02-PLAN.md -- TDD computeActions() pure diff engine for all 3 scenarios (BOT-03)
- [x] 02-03-PLAN.md -- Subgraph client with cursor pagination, chain reader with Multicall3 (BOT-01, BOT-02)
- [x] 02-04-PLAN.md -- Index.ts orchestrator with dry-run support and exit codes (BOT-07, BOT-08)

### Phase 3: End-to-End Verification
**Goal**: All three scenarios are proven correct on Sepolia -- the complete pipeline from PGTCR curation event to ERC-8004 reputation is verified via getSummary()
**Depends on**: Phase 1, Phase 2
**Requirements**: VER-01, VER-02, VER-03, VER-04
**Success Criteria** (what must be TRUE):
  1. After a verified agent (Scenario 1), `getSummary(agentId, [router], "", "")` returns count=1, value=95
  2. After a disputed removal (Scenario 2), `getSummary(agentId, [router], "", "")` returns count=1, value=-95
  3. After a voluntary withdrawal (Scenario 3), `getSummary(agentId, [router], "", "")` returns count=0
  4. Tag filtering via getSummary with tag1="verified" vs "removed" returns correctly filtered results
**Plans**: 2 plans

Plans:
- [x] 03-01-PLAN.md -- Verify.s.sol Forge script for getSummary assertions and tag filtering (VER-01, VER-02, VER-03, VER-04)
- [ ] 03-02-PLAN.md -- E2E execution: deploy Router, run bot, verify results, capture evidence report (VER-01, VER-02, VER-03, VER-04)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Router Contract & On-Chain Setup | 1/3 | In Progress|  |
| 2. Stateless Bot | 4/4 | Complete | 2026-03-26 |
| 3. End-to-End Verification | 0/2 | Not started | - |
