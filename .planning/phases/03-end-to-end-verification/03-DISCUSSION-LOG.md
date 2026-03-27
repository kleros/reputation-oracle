# Phase 3: End-to-End Verification - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-27
**Phase:** 03-end-to-end-verification
**Areas discussed:** Verification approach, Deployment prerequisite, Test data strategy, Verification evidence, Idempotency proof, Success criteria gating

---

## Verification Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Bot live run + Forge verify | Deploy Router, run bot against real subgraph, then Forge script asserts getSummary() values | ✓ |
| Bot live run + manual check | Deploy Router, run bot, manually call getSummary() via cast | |
| Forge-only orchestration | Single Forge script that deploys, submits feedback, verifies — no bot involved | |

**User's choice:** Bot live run + Forge verify
**Notes:** Full pipeline proof — proves bot→Router→Registry→getSummary() works end-to-end.

---

## Deployment Prerequisite

| Option | Description | Selected |
|--------|-------------|----------|
| Deploy as Phase 3 step 1 | Phase 3 starts by broadcasting Deploy.s.sol | |
| Deploy manually before Phase 3 | User deploys, provides proxy address | ✓ |
| Use a mock/fork Router | Skip live deployment, run on Sepolia fork | |

**User's choice:** Deploy manually before Phase 3
**Notes:** User controls deployment, provides proxy address. Phase 3 focuses purely on verification.

---

## Test Data Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Use existing items for Scenario 1, skip 2/3 | Run bot against 6 real Submitted items. Scenarios 2/3 proven by fork tests only. | ✓ |
| Create test items on PGTCR | Register items, challenge/remove to create all 3 states | |
| Simulate via direct Router calls | After bot Scenario 1, manually call submitNegativeFeedback/revokeOnly | |

**User's choice:** Use existing items for Scenario 1, skip 2/3 for now
**Notes:** Pragmatic — Scenario 1 gets full E2E proof, Scenarios 2/3 already proven by fork tests.

---

## Verification Evidence

| Option | Description | Selected |
|--------|-------------|----------|
| Forge verification script + console output | Verify.s.sol reads getSummary(), asserts values, output in VERIFICATION.md | ✓ |
| Bot logs + cast calls | Manual cast calls, results pasted into doc | |
| Automated test suite | vitest integration test running bot + checking getSummary() | |

**User's choice:** Forge verification script + console output
**Notes:** Verify.s.sol follows same assertion patterns as existing fork tests.

---

## Idempotency Proof

| Option | Description | Selected |
|--------|-------------|----------|
| Run bot twice, assert 0 actions on second run | After first run, dry-run shows 0 actions | ✓ |
| Just document as expected behavior | Note idempotency without proving it | |

**User's choice:** Run bot twice, assert 0 actions on second run
**Notes:** Proves stateless diff design works correctly in practice.

---

## Success Criteria Gating

| Option | Description | Selected |
|--------|-------------|----------|
| VER-01 proven, VER-02/03/04 fork-tested only | Honest status — full E2E for Scenario 1, fork tests for 2/3 | ✓ |
| Mark all VER-* as proven | Fork tests + Scenario 1 E2E is sufficient | |
| Block until all VER-* live-proven | Wait for real disputes — could block indefinitely | |

**User's choice:** VER-01 proven, VER-02/03/04 fork-tested only
**Notes:** Honest status. VER-02/03/04 pending live E2E when disputes occur on PGTCR list.

---

## Deferred Ideas

- Gas cost reporting for mainnet cost estimation
- Automated Scenarios 2/3 E2E testing when disputes exist
- CI integration for verification script
