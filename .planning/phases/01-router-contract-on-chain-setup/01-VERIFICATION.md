---
phase: 01-router-contract-on-chain-setup
verified: 2026-03-25T02:00:00Z
status: human_needed
score: 13/14 must-haves verified
re_verification: false
human_verification:
  - test: "Run forge test --fork-url $SEPOLIA_RPC_URL -vv in contracts/"
    expected: "All 17 tests pass against forked Sepolia state"
    why_human: "SEPOLIA_RPC_URL not available in automated environment; test runner requires live fork connection"
  - test: "Run deploy script dry-run: BOT_ADDRESS=0x1 forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --private-key <key> from contracts/"
    expected: "All 4 steps execute (no SKIPs), deployment summary prints proxy address, agentId, and bot authorization status"
    why_human: "Actual Sepolia deployment requires funded wallet and RPC access"
  - test: "After broadcast deployment, confirm router.klerosAgentId() != 0 and router.authorizedBots(<bot>) == true on Sepolia"
    expected: "klerosAgentId is non-zero, bot is authorized, owner is deployer"
    why_human: "Requires live Sepolia RPC call against the deployed proxy address"
---

# Phase 1: Router Contract & On-Chain Setup Verification Report

**Phase Goal:** All on-chain infrastructure is deployed, configured, and tested -- Router contract handles all three feedback scenarios, Kleros identity is registered, and bot address is authorized
**Verified:** 2026-03-25T02:00:00Z
**Status:** human_needed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Router is deployed on Sepolia as a UUPS proxy and can be called via its proxy address | ? HUMAN | Deploy script compiles and implements all steps; actual broadcast to Sepolia is a human-gate checkpoint (Plan 03 Task 2 pending) |
| 2  | Calling `submitPositiveFeedback` creates a +95 feedback entry on the ReputationRegistry (verified via direct Registry read) | ? HUMAN | Fork test `test_submitPositiveFeedback_createsPositiveEntry` asserts count=1, value=95 via getSummary; requires live fork to execute |
| 3  | Calling `submitNegativeFeedback` revokes the prior positive and creates a -95 entry (not an average of +95 and -95) | ? HUMAN | Fork test `test_submitNegativeFeedback_revokesPositiveThenSubmitsNegative` asserts count=1, value=-95; requires live fork to execute |
| 4  | Calling `revokeOnly` removes existing feedback without creating new entries | ? HUMAN | Fork test `test_revokeOnly_removesPositiveFeedback` asserts count=0 after revoke; requires live fork to execute |
| 5  | Kleros is registered as an 8004 agent and the Router is configured with the correct klerosAgentId, registry addresses, and authorized bot | ? HUMAN | Deploy script covers all four SETUP steps with idempotency; actual execution pending human approval |

**Score (automated):** 0/5 success criteria verifiable without live Sepolia RPC. All contract artifacts and logic are fully implemented and verified below.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `contracts/src/KlerosReputationRouter.sol` | Router implementation contract | VERIFIED | 189 lines, inherits Initializable, UUPSUpgradeable, OwnableUpgradeable; all three scenarios implemented |
| `contracts/src/interfaces/IReputationRegistry.sol` | Pinned ERC-8004 ReputationRegistry interface | VERIFIED | 33 lines; giveFeedback, revokeFeedback, getLastIndex, getSummary, readFeedback all present |
| `contracts/src/interfaces/IIdentityRegistry.sol` | Pinned ERC-8004 IdentityRegistry interface | VERIFIED | 11 lines; register and ownerOf functions present |
| `contracts/foundry.toml` | Foundry config with Solidity version | VERIFIED | solc_version = "0.8.28", cancun EVM, OZ remappings, fork profile with SEPOLIA_RPC_URL |
| `contracts/test/KlerosReputationRouter.t.sol` | Fork test suite | VERIFIED | 334 lines, 17 test functions, all 3 scenarios + edge cases + re-registration + auth + owner management |
| `contracts/script/Deploy.s.sol` | Idempotent deploy + setup orchestrator script | VERIFIED | 97 lines, all 4 SETUP steps with idempotency checks |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `KlerosReputationRouter.sol` | `IReputationRegistry.sol` | `import {IReputationRegistry}` + state variable | WIRED | Line 8: import; line 35: `IReputationRegistry public reputationRegistry` |
| `KlerosReputationRouter.sol` | `IIdentityRegistry.sol` | `import {IIdentityRegistry}` + state variable | WIRED | Line 9: import; line 36: `IIdentityRegistry public identityRegistry` |
| `test/KlerosReputationRouter.t.sol` | `KlerosReputationRouter.sol` | import + ERC1967Proxy deployment in setUp | WIRED | Line 6: import; lines 38-42: proxy deployment via ERC1967Proxy |
| `test/KlerosReputationRouter.t.sol` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | `REPUTATION_REGISTRY` constant used in getSummary calls | WIRED | Line 16: constant; line 70: getSummary call |
| `script/Deploy.s.sol` | `KlerosReputationRouter.sol` | `new KlerosReputationRouter()` + proxy deployment | WIRED | Lines 46-54: deploys impl and ERC1967Proxy |
| `script/Deploy.s.sol` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | `IDENTITY_REGISTRY` constant + register call | WIRED | Line 29 constant; line 65: IIdentityRegistry(IDENTITY_REGISTRY).register call |

### Data-Flow Trace (Level 4)

Not applicable -- this phase produces on-chain contracts and scripts, not data-rendering components. The feedback functions call external contracts (ReputationRegistry), and the return values (feedbackIndex from getLastIndex) are stored in contract state. Fork tests verify the full data flow.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `forge build` succeeds with no errors | `cd contracts && forge build; echo "EXIT: $?"` | Exit code 0; "No files changed, compilation skipped"; 13 lint warnings (unsafe-typecast in tests, unwrapped modifier), no errors | PASS |
| Storage layout has `__gap` at slot 6 | `forge inspect KlerosReputationRouter storage-layout` | `__gap uint256[50]` at slot 6, after feedbackType (slot 4) and feedbackIndex (slot 5) | PASS |
| 17 test functions exist | `grep -c "^    function test_" test/KlerosReputationRouter.t.sol` | 17 | PASS |
| All 3 scenario functions have correct signatures | `grep -n "function submit\|function revoke" contracts/src/KlerosReputationRouter.sol` | submitPositiveFeedback, submitNegativeFeedback, revokeOnly all present with exact required signatures | PASS |
| Deploy script compiles | `forge build --contracts script/` | Exit code 0 | PASS |
| Fork tests compile | `forge build --contracts test/` | Exit code 0 | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ROUT-01 | 01-01 | Router deployed on Sepolia as UUPS proxy with storage gaps | SATISFIED (code) / HUMAN (deployment) | `contract KlerosReputationRouter is Initializable, UUPSUpgradeable, OwnableUpgradeable`; `uint256[50] private __gap` at slot 6; deployment requires human action |
| ROUT-02 | 01-01 | Router stores feedback state per agentId (`hasFeedback`, `feedbackIndex`) | SATISFIED (design deviation noted) | Implemented as `mapping(uint256 => FeedbackType) public feedbackType` + `mapping(uint256 => uint64) public feedbackIndex` -- enum is a superset of hasFeedback; intentional design per D-01 in CONTEXT.md. `hasFeedback` is readable as `feedbackType[id] != FeedbackType.None`. BOT-02 uses `hasFeedback()` -- see note below. |
| ROUT-03 | 01-01 | Scenario 1: submitPositiveFeedback calls giveFeedback(agentId, 95, 0, "verified", "kleros-agent-registry", "", feedbackURI, 0x0) | SATISFIED | Line 100-102 in Router; constants POSITIVE_VALUE=95, TAG_VERIFIED="verified", TAG_REGISTRY="kleros-agent-registry", VALUE_DECIMALS=0, bytes32(0) |
| ROUT-04 | 01-01 | Scenario 2: submitNegativeFeedback revokes existing positive then calls giveFeedback(-95, ...) | SATISFIED | Lines 121-136 in Router; atomic revoke-then-negative with NEGATIVE_VALUE=-95, TAG_REMOVED="removed" |
| ROUT-05 | 01-01 | Scenario 3: revokeOnly revokes existing feedback without submitting new feedback | SATISFIED | Lines 142-150 in Router; revokes then sets feedbackType to None, feedbackIndex to 0 |
| ROUT-06 | 01-01 | Only addresses with authorizedBots[msg.sender] == true can call feedback functions | SATISFIED | `modifier onlyAuthorizedBot()` lines 58-61; applied to submitPositiveFeedback, submitNegativeFeedback, revokeOnly |
| ROUT-07 | 01-01 | Owner can add/remove authorized bot addresses and transfer ownership | SATISFIED | `setAuthorizedBot(address bot, bool authorized) external onlyOwner` line 157; transferOwnership/renounceOwnership inherited from OwnableUpgradeable |
| ROUT-08 | 01-01 | Router emits events for all state changes | SATISFIED | Events: PositiveFeedbackSubmitted (line 44), NegativeFeedbackSubmitted (45), FeedbackRevoked (46), BotAuthorizationChanged (47); all emitted in correct functions |
| ROUT-09 | 01-01 | Feedback values (±95), decimals (0), and tags are constants in the contract | SATISFIED | Constants: POSITIVE_VALUE=95, NEGATIVE_VALUE=-95, VALUE_DECIMALS=0, TAG_VERIFIED="verified", TAG_REMOVED="removed", TAG_REGISTRY="kleros-agent-registry" (lines 26-31) |
| ROUT-10 | 01-02 | All Router functions pass forge test suite including edge cases | SATISFIED (code) / HUMAN (execution) | 17 fork tests covering all 3 scenarios, re-registration, 3 auth edge cases, 4 state edge cases, 3 owner management tests; execution requires SEPOLIA_RPC_URL |
| SETUP-01 | 01-03 | Foundry deploy script deploys Router as UUPS proxy on Sepolia | SATISFIED (code) / HUMAN (execution) | Deploy.s.sol Step 1: `new KlerosReputationRouter()` + `new ERC1967Proxy(...)` with idempotency check |
| SETUP-02 | 01-03 | Foundry script registers Kleros as an 8004 agent on IdentityRegistry | SATISFIED (code) / HUMAN (execution) | Deploy.s.sol Step 2: `IIdentityRegistry(IDENTITY_REGISTRY).register(KLEROS_AGENT_URI)` with idempotency check |
| SETUP-03 | 01-03 | Foundry script configures Router with klerosAgentId, reputationRegistry, identityRegistry addresses | SATISFIED (code) / HUMAN (execution) | Deploy.s.sol Step 3: `router.setKlerosAgentId(agentId)`; registry addresses configured at initialization |
| SETUP-04 | 01-03 | Foundry script authorizes bot address on Router | SATISFIED (code) / HUMAN (execution) | Deploy.s.sol Step 4: `router.setAuthorizedBot(botAddress, true)` with `!router.authorizedBots(botAddress)` guard |

**ROUT-02 design note:** REQUIREMENTS.md specifies `hasFeedback` as the state variable name, but the implementation uses `feedbackType` (FeedbackType enum). This was a deliberate design improvement documented in CONTEXT.md (D-01) and SUMMARY 01-01 as a key decision. The enum encodes more information (None/Positive/Negative) and avoids a separate boolean. BOT-02 references `hasFeedback()` -- the bot will need to call `feedbackType(agentId) != FeedbackType.None` or the contract could expose a `hasFeedback()` view function as a compatibility shim. This is a Phase 2 concern, not a Phase 1 blocker.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `test/KlerosReputationRouter.t.sol` | 81, 95, 112, 150, 170, 187, 195, 223, 250, 254, 262, 322, 332 | `bytes32("testItem")` -- unsafe typecast from string literal to bytes32 (forge lint warning) | Info | Lint warnings only; no runtime issue since string literals fit in bytes32; does not affect test correctness |
| `contracts/src/KlerosReputationRouter.sol` | 58-61 | `onlyAuthorizedBot` modifier logic not wrapped in internal function (forge lint note) | Info | Code size micro-optimization; not a correctness issue |

No stub patterns, placeholder returns, or unimplemented functions found in any file.

### Human Verification Required

#### 1. Fork Test Suite Execution

**Test:** Set `SEPOLIA_RPC_URL` to a working Sepolia endpoint (e.g., `https://ethereum-sepolia-rpc.publicnode.com` per Plan 02 decision), then run `cd contracts && forge test -vv` from the project root.
**Expected:** All 17 tests pass. Key assertions: Scenario 1 getSummary returns count=1 value=95; Scenario 2 returns count=1 value=-95; Scenario 3 returns count=0; re-registration produces count=2; all unauthorized calls revert.
**Why human:** SEPOLIA_RPC_URL is not available in this automated environment. Fork tests require a live Ethereum RPC connection to fork Sepolia state.

#### 2. Deploy Script Dry-Run

**Test:** Set env vars `SEPOLIA_RPC_URL`, `BOT_ADDRESS=0x0000000000000000000000000000000000000001`, then run `cd contracts && forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` (Foundry default test key for simulation).
**Expected:** Output shows "Step 1: Deploying Router...", "Step 2: Registering Kleros agent...", "Step 3: Setting klerosAgentId...", "Step 4: Authorizing bot address...", and a deployment summary with proxy address, agentId, and bot authorization = true.
**Why human:** Requires Sepolia RPC; simulation uses on-chain state from Sepolia fork.

#### 3. Live Deployment to Sepolia

**Test:** Broadcast the deploy script with a real funded deployer wallet, then verify on-chain state: `cast call <proxy> "klerosAgentId()(uint256)" --rpc-url $SEPOLIA_RPC_URL` returns non-zero, and `cast call <proxy> "authorizedBots(address)(bool)" <bot> --rpc-url $SEPOLIA_RPC_URL` returns true.
**Expected:** klerosAgentId is non-zero, bot is authorized, Router owner is deployer address.
**Why human:** Requires funded Sepolia wallet for gas; one-time setup action that creates persistent on-chain state.

### Gaps Summary

No gaps blocking goal achievement at the code level. All 14 plan must-haves are implemented in the codebase:
- Router contract compiles, inherits correct bases, implements all 3 scenarios with correct logic and constants
- Fork test suite has 17 tests covering all required scenarios and edge cases
- Deploy script implements all 4 SETUP steps with idempotency checks

The only items pending are live execution steps that require human action:
- Fork tests need a Sepolia RPC to run (ROUT-10 code is complete; execution is human-gated)
- Actual Sepolia deployment needs a funded wallet (SETUP-01 through SETUP-04 code is complete; broadcast is human-gated)

The phase goal states "deployed, configured, and tested" -- the "deployed" and "configured" parts are human-gated. The deploy script and fork test suite are fully implemented and ready for execution.

---

_Verified: 2026-03-25T02:00:00Z_
_Verifier: Claude (gsd-verifier)_
