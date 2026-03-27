# Phase 3: End-to-End Verification Report

**Date:** 2026-03-27
**Network:** Sepolia (chainId 11155111)
**Router Proxy:** 0x9ad77EBB8c1c206168B5838eF8cbeC82cEA7c30a
**Router Implementation:** 0x4c4D73c14f567Bf8848f77d5adBd6a726DC1d1d5
**Owner:** 0x82695B1FFA1e446b636247e44c2aAFd3Fe2CD426
**Kleros Agent ID:** 2295

## Deployment Verification

Router deployed via `Deploy.s.sol --broadcast` on Sepolia:

| Transaction | Type | Contract | Hash |
|-------------|------|----------|------|
| Implementation deploy | CREATE | KlerosReputationRouter | `0x9624547b...5445f687` |
| Proxy deploy | CREATE | ERC1967Proxy | `0x0912c860...1c27398` |
| 8004 identity register | CALL | IdentityRegistry | `0x9bb5bdfa...322f3753` |
| Set Kleros agent ID | CALL | Router proxy | `0xbd64e3fd...3318c45d` |
| Set authorized bot | CALL | Router proxy | `0xffe48a65...e32820fe` |

On-chain verification:

```
$ cast call 0x9ad77EBB8c1c206168B5838eF8cbeC82cEA7c30a "owner()" --rpc-url $SEPOLIA_RPC_URL
0x00000000000000000000000082695b1ffa1e446b636247e44c2aafd3fe2cd426
```

## VER-01: Scenario 1 -- Positive Feedback

**Status:** PASS (E2E proven on Sepolia)

### Bot Live Run

Bot successfully executed 4 `submitPositiveFeedback` transactions for agents 610, 1142, 1143, 1440 on Router `0x9ad77EBB8c1c206168B5838eF8cbeC82cEA7c30a`.

### Bot Dry-Run Output (pre-live-run)

The bot correctly identified 4 agents requiring positive feedback from 6 valid subgraph items:

```
> kleros-reputation-bot@0.1.0 start:dry-run
> node --env-file=.env --import tsx src/index.ts --dry-run

Kleros Reputation Bot starting (chainId=11155111, dryRun=true)
Fetched 9 items from subgraph
Fetched 9 raw items from subgraph
6 valid items (3 skipped)
Reading Router state for 6 agents via Multicall3
Read router states for 6 agents
Computed 4 actions
[
  { "type": "submitPositiveFeedback", "agentId": "1143", ... },
  { "type": "submitPositiveFeedback", "agentId": "610", ... },
  { "type": "submitPositiveFeedback", "agentId": "1440", ... },
  { "type": "submitPositiveFeedback", "agentId": "1142", ... }
]
Dry run complete: 4 actions would be executed
```

Target agents: 610, 1142, 1143, 1440 (all Scenario 1: Submitted items without existing feedback).

### Verify.s.sol Output (post-bot-run -- E2E proof)

After bot submitted live transactions, Verify.s.sol confirms all 4 agents have correct on-chain state:

```
== Logs ==
  === Kleros Reputation Oracle -- Verification ===
  Router: 0x9ad77EBB8c1c206168B5838eF8cbeC82cEA7c30a
  Verifying 4 agents...

  Agent 610:
    getSummary("", ""):         count=1, value=95
      [PASS]
    getSummary("verified", ""): count=1, value=95
      [PASS]
    getSummary("removed", ""):  count=0, value=0
      [PASS]
    Router feedbackType: Positive
      [PASS]

  Agent 1142:
    getSummary("", ""):         count=1, value=95
      [PASS]
    getSummary("verified", ""): count=1, value=95
      [PASS]
    getSummary("removed", ""):  count=0, value=0
      [PASS]
    Router feedbackType: Positive
      [PASS]

  Agent 1143:
    getSummary("", ""):         count=1, value=95
      [PASS]
    getSummary("verified", ""): count=1, value=95
      [PASS]
    getSummary("removed", ""):  count=0, value=0
      [PASS]
    Router feedbackType: Positive
      [PASS]

  Agent 1440:
    getSummary("", ""):         count=1, value=95
      [PASS]
    getSummary("verified", ""): count=1, value=95
      [PASS]
    getSummary("removed", ""):  count=0, value=0
      [PASS]
    Router feedbackType: Positive
      [PASS]

  === All 28 assertions passed ===
```

All 28 assertions passed: getSummary returns count=1, value=95 for each agent with unfiltered and "verified" tag queries, count=0 for "removed" tag, and Router tracks FeedbackType.Positive.

### Idempotency Proof (D-02)

**Status:** PASS

Second dry-run after bot live run confirms 0 actions -- stateless diff engine correctly detects on-chain state matches subgraph state:

```
Dry run complete: 0 actions would be executed
```

This proves the bot is idempotent: re-running produces no duplicate transactions.

## VER-02: Scenario 2 -- Negative Feedback (Fork Test Proven)

**Status:** PASS (fork tests) | Pending live E2E (no disputed items on PGTCR list yet)

Per D-10, proven via `test_submitNegativeFeedback_revokesPositiveThenSubmitsNegative` in KlerosReputationRouter.t.sol.
Asserts: count=1, value=-95 after revoke-then-negative sequence.

Also verified: `test_submitNegativeFeedback_fromNoneState` for direct negative feedback.

## VER-03: Scenario 3 -- Revoke Only (Fork Test Proven)

**Status:** PASS (fork tests) | Pending live E2E (no voluntary withdrawals on PGTCR list yet)

Per D-10, proven via `test_revokeOnly_removesPositiveFeedback` in KlerosReputationRouter.t.sol.
Asserts: count=0 after revocation of positive feedback.

## VER-04: Tag Filtering

**Status:** PASS (E2E proven on Sepolia)

Verify.s.sol confirms tag filtering works on live Sepolia state for all 4 agents:
- `getSummary(agentId, [router], "verified", "")` returns count=1, value=95
- `getSummary(agentId, [router], "removed", "")` returns count=0, value=0

See Verify.s.sol output in VER-01 above -- tag assertions are part of the 28 passing assertions.
Fork tests additionally confirm tag values ("verified" for positive, "removed" for negative) are correctly set in Router.

## Fork Test Results (All 17 Pass)

```
Ran 17 tests for test/KlerosReputationRouter.t.sol:KlerosReputationRouterTest
[PASS] test_reRegistration_afterNegative_allowsNewPositive() (gas: 554456)
[PASS] test_removeAuthorizedBot() (gas: 445421)
[PASS] test_revert_doubleNegative() (gas: 451829)
[PASS] test_revert_doublePositive() (gas: 357844)
[PASS] test_revert_revokeWhenNegative() (gas: 356515)
[PASS] test_revert_revokeWithoutPositive() (gas: 121370)
[PASS] test_revert_unauthorizedBot_revokeOnly() (gas: 118771)
[PASS] test_revert_unauthorizedBot_submitNegative() (gas: 119298)
[PASS] test_revert_unauthorizedBot_submitPositive() (gas: 119577)
[PASS] test_revokeOnly_emitsEvent() (gas: 324444)
[PASS] test_revokeOnly_removesPositiveFeedback() (gas: 333965)
[PASS] test_setAuthorizedBot_emitsEvent() (gas: 47042)
[PASS] test_setAuthorizedBot_onlyOwner() (gas: 21346)
[PASS] test_submitNegativeFeedback_fromNoneState() (gas: 367350)
[PASS] test_submitNegativeFeedback_revokesPositiveThenSubmitsNegative() (gas: 462742)
[PASS] test_submitPositiveFeedback_createsPositiveEntry() (gas: 370109)
[PASS] test_submitPositiveFeedback_emitsEvent() (gas: 356075)
Suite result: ok. 17 passed; 0 failed; 0 skipped; finished in 2.59s (11.04s CPU time)

Ran 1 test suite in 2.82s (2.59s CPU time): 17 tests passed, 0 failed, 0 skipped (17 total tests)
```

## Summary

| Requirement | Status | Evidence |
|-------------|--------|----------|
| VER-01 | PASS (E2E) | Bot live run + Verify.s.sol: 28 assertions passed |
| VER-02 | PASS (fork) | `test_submitNegativeFeedback_revokesPositiveThenSubmitsNegative` |
| VER-03 | PASS (fork) | `test_revokeOnly_removesPositiveFeedback` |
| VER-04 | PASS (E2E) | Verify.s.sol tag filtering: verified=1, removed=0 |
| D-02 | PASS | Idempotency: second dry-run shows 0 actions |

### What's Proven

- Router correctly deployed to Sepolia via UUPS proxy
- 8004 identity registered (agentId 2295)
- Bot correctly computes and executes 4 submitPositiveFeedback actions from real subgraph data
- On-chain getSummary returns count=1, value=95 for all 4 agents (Verify.s.sol, 28 assertions)
- Tag filtering: "verified" returns count=1, "removed" returns count=0 (VER-04, E2E)
- Idempotency: second dry-run produces 0 actions (D-02)
- All 3 scenarios (positive, negative, revoke) pass fork tests against real Sepolia state (17/17)
- Full pipeline proven: Subgraph -> Bot -> Router -> ReputationRegistry -> getSummary

### Remaining (not blocking)

- VER-02 live E2E: requires a disputed item on the PGTCR list (none exist yet)
- VER-03 live E2E: requires a voluntary withdrawal from the PGTCR list (none exist yet)
- Both are proven via fork tests per D-10
