# Phase 1: Router Contract & On-Chain Setup - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-25
**Phase:** 01-Router Contract & On-Chain Setup
**Areas discussed:** Feedback state model, Revoke-then-negative atomicity, ERC-8004 interface, Testing strategy, Deploy script sequence

---

## Feedback State Model

| Option | Description | Selected |
|--------|-------------|----------|
| FeedbackType enum | enum FeedbackType { None, Positive, Negative }. Cleanly handles re-registration. | :heavy_check_mark: |
| Boolean + separate negative flag | Keep hasFeedback boolean, add isNegative boolean. More storage but simpler to read. | |
| You decide | Claude picks during implementation. | |

**User's choice:** FeedbackType enum
**Notes:** Resolves Pitfall 8 (re-registration state model blocker). Diff logic: Submitted + (None OR Negative) -> positive, Absent + Positive -> revoke/negative.

---

## Revoke-Then-Negative Atomicity

| Option | Description | Selected |
|--------|-------------|----------|
| Single atomic function | submitNegativeFeedback does revoke-if-needed + negative in one tx. Handles both has/no-has cases. | :heavy_check_mark: |
| Separate revoke + negative calls | Keep as separate bot calls. Simpler Router, but bot must handle partial failure. | |
| You decide | Claude picks during implementation. | |

**User's choice:** Single atomic function
**Notes:** Resolves Pitfall 3 (non-atomic revoke-then-negative blocker). Bot only ever calls submitNegativeFeedback for Scenario 2.

---

## ERC-8004 Interface

| Option | Description | Selected |
|--------|-------------|----------|
| 8004 skill + deployed contract | Use 8004scan-skill:8004 for spec, verify against deployed Sepolia contract ABI. | :heavy_check_mark: |
| PRD section 11 only | Use interface from PRD S11, assume it's accurate. | |
| You decide | Claude researches during planning. | |

**User's choice:** 8004 skill + deployed contract
**Notes:** User pointed to prior PoC at `../erc8004-feedback-bot-fortunato/src/blockchain/abis/` which has both `reputation-registry.json` and `pgtcr.json`. Added as canonical reference.

---

## Testing Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Fork Sepolia | forge test --fork-url against Sepolia with real registries. | :heavy_check_mark: |
| Mock registries locally | Deploy mock contracts in test setup. Faster but no integration proof. | |
| Both: unit + fork | Unit tests with mocks + fork tests for integration. Two suites. | |

**User's choice:** Fork Sepolia
**Notes:** No mock registries. All tests prove real integration against deployed ReputationRegistry and IdentityRegistry.

---

## Deploy Script Sequence

| Option | Description | Selected |
|--------|-------------|----------|
| Single orchestrator script | One Deploy.s.sol running all steps in order. Re-runs skip completed steps. | :heavy_check_mark: |
| Separate scripts per step | Individual scripts per setup step. More flexible, more files. | |
| You decide | Claude picks during planning. | |

**User's choice:** Single orchestrator script
**Notes:** All four SETUP requirements handled in one script: deploy proxy -> register identity -> configure -> authorize bot.

---

## Claude's Discretion

- Contract naming
- Storage gap size
- Event parameter design
- OpenZeppelin import versions
- Foundry project structure

## Deferred Ideas

- pgtcrToAgentId on-chain mapping (Strategy C) — Strategy A is primary
- Pausable contract for key compromise — Phase 2 production hardening
- Multi-list support — future upgrade, storage gaps reserved
