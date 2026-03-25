# Phase 1: Router Contract & On-Chain Setup - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Deploy an upgradeable Router contract (UUPS proxy) on Sepolia that handles all three feedback scenarios against the ERC-8004 ReputationRegistry. Register Kleros as an 8004 agent, configure the Router with registry addresses, and authorize the bot address. All on-chain infrastructure deployed and tested via fork tests.

</domain>

<decisions>
## Implementation Decisions

### Feedback State Model
- **D-01:** Use `FeedbackType` enum (`None`, `Positive`, `Negative`) instead of boolean `hasFeedback`. Mapping: `mapping(uint256 => FeedbackType) public feedbackType` + `mapping(uint256 => uint256) public feedbackIndex`.
- **D-02:** Diff logic becomes: Submitted + (None OR Negative) -> positive feedback. Absent + Positive -> revoke/negative. This cleanly handles re-registration after dispute (Pitfall 8 resolved).

### Revoke-Then-Negative Atomicity
- **D-03:** `submitNegativeFeedback` is a single atomic function that handles both paths: if `feedbackType == Positive`, revoke first then submit -95; if `feedbackType == None` (prior revoke succeeded but negative failed), just submit -95. Bot never calls revoke separately for Scenario 2 (Pitfall 3 resolved).
- **D-04:** `revokeOnly` remains a separate function for Scenario 3 (voluntary withdrawal) — no negative feedback needed.

### ERC-8004 Interface
- **D-05:** Obtain ReputationRegistry ABI from the 8004scan-skill:8004 spec, then verify against the actual deployed Sepolia contract. Pin to the deployed interface version.
- **D-06:** Prior PoC at `../erc8004-feedback-bot-fortunato/src/blockchain/abis/reputation-registry.json` provides a starting reference for the ABI. Verify before using.
- **D-07:** Verify whether `giveFeedback` returns the feedback index (Pitfall 4). If it does, use the return value. If not, use `getLastIndex` call after feedback submission.

### Testing Strategy
- **D-08:** Fork Sepolia for all Router tests (`forge test --fork-url`). Tests deploy the Router proxy against the real ReputationRegistry and IdentityRegistry on Sepolia.
- **D-09:** No mock registries — all tests prove real integration. This catches interface mismatches before deployment.

### Deploy Script
- **D-10:** Single orchestrator Foundry script (`Deploy.s.sol`) that runs all steps in sequence: deploy UUPS proxy -> register Kleros identity -> configure Router addresses -> authorize bot. Re-running skips completed steps via on-chain state checks.

### Claude's Discretion
- Contract naming (`KlerosReputationRouter` or similar)
- Storage gap size for UUPS proxy
- Event parameter design (ROUT-08) — include enough data for off-chain indexing
- OpenZeppelin import versions and specific upgrade patterns
- Foundry project structure (src/, test/, script/ layout)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Router Contract Spec
- `.planning/research/kleros-reputation-oracle-prd-v2.md` S11 — Full Router contract specification (functions, parameters, state, events)
- `.planning/research/kleros-reputation-oracle-prd-v2.md` S6 — Mapping logic, 3 scenarios, resolution strategies
- `.planning/research/kleros-reputation-oracle-prd-v2.md` S5 — Deployed addresses (ReputationRegistry, IdentityRegistry on Sepolia)

### ERC-8004 Protocol
- 8004scan-skill:8004 — ERC-8004 protocol deep-dive: feedback struct, trust labels, value scales, revocation
- `../erc8004-feedback-bot-fortunato/src/blockchain/abis/reputation-registry.json` — Prior PoC ReputationRegistry ABI (verify against deployed contract)
- `../erc8004-feedback-bot-fortunato/src/blockchain/abis/pgtcr.json` — PGTCR ABI reference (primarily for Phase 2)

### Pitfalls & Amendments
- `.planning/research/PITFALLS.md` — Domain pitfalls (Pitfalls 3, 4, 8, 10, 11 are Phase 1 relevant)
- `.planning/research/kleros-reputation-oracle-prd-v2-amendments.md` — PRD amendments from PoC review

### Identity & Setup
- `.planning/research/kleros-reputation-oracle-prd-v2.md` S14 — Kleros 8004 identity setup procedure

### Testing
- `.planning/research/kleros-reputation-oracle-prd-v2.md` S16 — Testing plan

### Technology Stack
- `.planning/research/STACK.md` — Technology rationale (Foundry, OpenZeppelin, Solidity version)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- No existing code — greenfield project. Only CLAUDE.md, LICENSE, README.md in repo.
- Prior PoC ABIs at `../erc8004-feedback-bot-fortunato/src/blockchain/abis/` can be referenced for interface verification.

### Established Patterns
- No established patterns yet — Phase 1 sets the foundation.
- CLAUDE.md specifies: Foundry for contracts, UUPS proxy (OpenZeppelin), Solidity ^0.8.20.

### Integration Points
- Router calls ReputationRegistry.giveFeedback(), ReputationRegistry.revokeFeedback(), and possibly getLastIndex().
- Router calls IdentityRegistry for Kleros agent registration (SETUP-02).
- Bot (Phase 2) will call Router's submitPositiveFeedback, submitNegativeFeedback, revokeOnly.
- Verification (Phase 3) reads ReputationRegistry.getSummary() to validate outcomes.

</code_context>

<specifics>
## Specific Ideas

- The `submitNegativeFeedback` function should be designed so the bot only ever needs one call for Scenario 2 — the Router internally handles "revoke if positive, then submit negative" vs "just submit negative if already revoked."
- Re-registration after dispute: history accumulates. Agent goes from -95 to +95 on re-registration. No revoke of old negative per KEY DECISION in PROJECT.md.

</specifics>

<deferred>
## Deferred Ideas

- pgtcrToAgentId on-chain mapping (Strategy C admin mapping) — Strategy A (key0 from subgraph) is primary per PROJECT.md. On-chain mapping adds complexity without PoC value.
- Pausable contract for key compromise circuit breaker — Pitfall 14, deferred to Phase 2 production hardening.
- Multi-list support — out of scope for v1, contract upgradeable for future via storage gaps.

</deferred>

---

*Phase: 01-router-contract-on-chain-setup*
*Context gathered: 2026-03-25*
