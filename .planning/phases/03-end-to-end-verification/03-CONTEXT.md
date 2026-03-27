# Phase 3: End-to-End Verification - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Prove the complete pipeline works on Sepolia: bot reads real subgraph items, executes real transactions against the deployed Router, and `getSummary()` returns correct ERC-8004 reputation values. Scenario 1 gets full E2E proof; Scenarios 2/3 are proven via fork tests only (pending real disputes on the PGTCR list).

</domain>

<decisions>
## Implementation Decisions

### Verification Approach
- **D-01:** Full pipeline proof: deploy Router (manual prerequisite), run bot against real Sepolia subgraph items, then run a Forge verification script (`Verify.s.sol`) that calls `getSummary()` for each affected agent and asserts expected values.
- **D-02:** Idempotency proof: after first bot run succeeds, run bot again in dry-run mode. Second run must show 0 actions, proving the stateless diff engine correctly detects that on-chain state already matches subgraph state.

### Deployment Prerequisite
- **D-03:** Router deployment is a manual prerequisite — user broadcasts `Deploy.s.sol` to Sepolia before Phase 3 begins, then provides the Router proxy address. Phase 3 does NOT include deployment automation.
- **D-04:** Bot wallet must have Sepolia ETH for gas. Deployer key and bot key are user-provided.

### Test Data Strategy
- **D-05:** Use the existing 6 valid Submitted items on the Sepolia PGTCR list for Scenario 1 verification. No need to create test items or simulate disputes.
- **D-06:** Scenarios 2 (Absent+Reject) and 3 (Absent+withdrawal) cannot be E2E-verified until real disputes occur on the PGTCR list. Fork tests are the proof for now.

### Verification Evidence
- **D-07:** A `Verify.s.sol` Forge script reads `getSummary()` for each agent the bot touched, prints results to console, and asserts expected values (count=1, value=95 for Scenario 1 agents).
- **D-08:** Console output from the bot run, dry-run (idempotency check), and Forge verification script is captured in a `03-VERIFICATION.md` report.

### Success Criteria Gating
- **D-09:** VER-01 (Scenario 1, +95) is marked as fully E2E-proven after bot run + Verify.s.sol passes.
- **D-10:** VER-02, VER-03, VER-04 are marked as "proven via fork tests, pending live E2E when disputes occur" — honest status, not blocked.

### Claude's Discretion
- Verify.s.sol structure and assertion patterns
- Verification report format and level of detail
- Whether to include gas cost estimates in the report

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Router Contract (deployed on Sepolia)
- `contracts/src/KlerosReputationRouter.sol` — Router implementation, function signatures, FeedbackType enum
- `contracts/src/interfaces/IReputationRegistry.sol` — `getSummary()` interface for verification assertions
- `contracts/script/Deploy.s.sol` — Deploy script (user runs manually as prerequisite)

### Existing Tests (proof patterns to follow)
- `contracts/test/KlerosReputationRouter.t.sol` — Fork tests that already verify all 3 scenarios with `getSummary()` assertions — Verify.s.sol follows the same assertion patterns

### Bot (what gets run)
- `bot/src/index.ts` — Main entry point, run with `npm run start` and `npm run start:dry-run`
- `bot/dry-run.txt` — Prior dry-run output showing 6 valid items and 4 computed actions

### Requirements
- `.planning/REQUIREMENTS.md` — VER-01 through VER-04 acceptance criteria

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `contracts/test/KlerosReputationRouter.t.sol` `_getSummary()` helper — pattern for calling `getSummary(agentId, [router], "", "")` and destructuring `(count, value)`
- `contracts/script/Deploy.s.sol` — Verify.s.sol can follow the same Script pattern with `vm.envAddress("ROUTER_PROXY_ADDRESS")`
- `bot/dry-run.txt` — shows the 4 agentIds (610, 1142, 1143, 1440) that will receive positive feedback

### Established Patterns
- Forge scripts use `vm.envString`/`vm.envAddress` for config, `console.log` for output
- Fork tests call `vm.createSelectFork(vm.envString("SEPOLIA_RPC_URL"))` for real Sepolia state

### Integration Points
- Verify.s.sol reads the same `ROUTER_PROXY_ADDRESS` and `SEPOLIA_RPC_URL` env vars as Deploy.s.sol
- Bot reads `ROUTER_ADDRESS` from `.env` — must match the deployed proxy address
- Verification connects bot output (which agentIds were acted on) to Forge assertions (getSummary for those agentIds)

</code_context>

<specifics>
## Specific Ideas

No specific requirements — standard verification approach using existing patterns from fork tests.

</specifics>

<deferred>
## Deferred Ideas

- Gas cost reporting for mainnet cost estimation — future concern
- Automated Scenarios 2/3 E2E testing when disputes exist — triggered by real PGTCR events
- CI integration for verification script — production hardening phase

</deferred>

---

*Phase: 03-end-to-end-verification*
*Context gathered: 2026-03-27*
