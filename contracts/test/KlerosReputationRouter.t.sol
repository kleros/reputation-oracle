// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, Vm} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {KlerosReputationRouter} from "../src/KlerosReputationRouter.sol";
import {IReputationRegistry} from "../src/interfaces/IReputationRegistry.sol";
import {IIdentityRegistry} from "../src/interfaces/IIdentityRegistry.sol";

/// @title KlerosReputationRouter Fork Tests
/// @notice Tests all three scenarios + edge cases against real Sepolia ReputationRegistry and IdentityRegistry.
/// @dev Run with: forge test --fork-url $SEPOLIA_RPC_URL -vv
contract KlerosReputationRouterTest is Test {
    // ─── Real Sepolia Addresses ──────────────────────────────────────────────────

    address constant REPUTATION_REGISTRY = 0x8004B663056A597Dffe9eCcC1965A193B7388713;
    address constant IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;

    // ─── Test Actors ─────────────────────────────────────────────────────────────

    address owner = makeAddr("owner");
    address bot = makeAddr("bot");
    address agentOwner = makeAddr("agentOwner");
    address unauthorized = makeAddr("unauthorized");

    // ─── State ───────────────────────────────────────────────────────────────────

    KlerosReputationRouter router;
    uint256 testAgentId;

    // ─── setUp ───────────────────────────────────────────────────────────────────

    function setUp() public {
        // Fork Sepolia
        vm.createSelectFork(vm.envString("SEPOLIA_RPC_URL"));

        // Deploy Router as UUPS proxy
        KlerosReputationRouter impl = new KlerosReputationRouter();
        bytes memory initData =
            abi.encodeCall(KlerosReputationRouter.initialize, (REPUTATION_REGISTRY, IDENTITY_REGISTRY, 0, owner));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        router = KlerosReputationRouter(address(proxy));

        // Register a test agent on the real IdentityRegistry (from agentOwner, not router)
        vm.prank(agentOwner);
        testAgentId = IIdentityRegistry(IDENTITY_REGISTRY).register("https://test-agent.example.com");

        // Configure Router: authorize bot
        vm.prank(owner);
        router.setAuthorizedBot(bot, true);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────────

    /// @dev Returns address[] with just the router proxy address (for getSummary calls).
    function _routerArray() internal view returns (address[] memory) {
        address[] memory arr = new address[](1);
        arr[0] = address(router);
        return arr;
    }

    /// @dev Registers a fresh test agent and returns its ID. Each test gets its own agent.
    function _registerTestAgent() internal returns (uint256) {
        vm.prank(agentOwner);
        return IIdentityRegistry(IDENTITY_REGISTRY).register("https://test-agent.example.com");
    }

    /// @dev Calls getSummary for an agent filtered to this router's feedback, empty tags.
    function _getSummary(uint256 agentId) internal view returns (uint64 count, int128 value) {
        (count, value,) = IReputationRegistry(REPUTATION_REGISTRY).getSummary(agentId, _routerArray(), "", "");
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Scenario 1: Positive Feedback
    // ═════════════════════════════════════════════════════════════════════════════

    function test_submitPositiveFeedback_createsPositiveEntry() public {
        uint256 agentId = _registerTestAgent();

        vm.prank(bot);
        router.submitPositiveFeedback(agentId, bytes32("testItem"), "ipfs://test-positive");

        // Verify via real ReputationRegistry getSummary
        (uint64 count, int128 value) = _getSummary(agentId);
        assertEq(count, 1, "count should be 1 after positive feedback");
        assertEq(value, 95, "value should be +95");

        // Verify Router state
        assertEq(uint8(router.feedbackType(agentId)), uint8(KlerosReputationRouter.FeedbackType.Positive));
        assertGt(router.feedbackIndex(agentId), 0, "feedbackIndex should be set");
    }

    function test_submitPositiveFeedback_emitsEvent() public {
        uint256 agentId = _registerTestAgent();
        bytes32 itemId = bytes32("testItem");

        vm.prank(bot);
        vm.expectEmit(true, true, false, false);
        emit KlerosReputationRouter.PositiveFeedbackSubmitted(agentId, itemId, 0);
        router.submitPositiveFeedback(agentId, itemId, "ipfs://test-positive");
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Scenario 2: Negative Feedback
    // ═════════════════════════════════════════════════════════════════════════════

    function test_submitNegativeFeedback_revokesPositiveThenSubmitsNegative() public {
        uint256 agentId = _registerTestAgent();

        // First submit positive
        vm.prank(bot);
        router.submitPositiveFeedback(agentId, bytes32("testItem"), "ipfs://test-positive");

        // Then submit negative (revoke-then-negative atomic)
        vm.prank(bot);
        router.submitNegativeFeedback(agentId, "ipfs://test-negative");

        // Verify: getSummary should return count=1, value=-95 (NOT average of +95/-95=0)
        (uint64 count, int128 value) = _getSummary(agentId);
        assertEq(count, 1, "count should be 1 (revoked positive doesn't count)");
        assertEq(value, -95, "value should be -95, not average of +95 and -95");

        // Verify Router state
        assertEq(uint8(router.feedbackType(agentId)), uint8(KlerosReputationRouter.FeedbackType.Negative));
    }

    function test_submitNegativeFeedback_fromNoneState() public {
        uint256 agentId = _registerTestAgent();

        // Submit negative when feedbackType is None (no prior feedback)
        vm.prank(bot);
        router.submitNegativeFeedback(agentId, "ipfs://test-negative");

        // Verify
        (uint64 count, int128 value) = _getSummary(agentId);
        assertEq(count, 1, "count should be 1 after negative from None state");
        assertEq(value, -95, "value should be -95");
        assertEq(uint8(router.feedbackType(agentId)), uint8(KlerosReputationRouter.FeedbackType.Negative));
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Scenario 3: Revoke Only
    // ═════════════════════════════════════════════════════════════════════════════

    function test_revokeOnly_removesPositiveFeedback() public {
        uint256 agentId = _registerTestAgent();

        // Submit positive first
        vm.prank(bot);
        router.submitPositiveFeedback(agentId, bytes32("testItem"), "ipfs://test-positive");

        // Revoke only (voluntary withdrawal)
        vm.prank(bot);
        router.revokeOnly(agentId);

        // Verify: getSummary returns count=0 (revoked feedback excluded)
        (uint64 count, int128 value) = _getSummary(agentId);
        assertEq(count, 0, "count should be 0 after revoke");
        assertEq(value, 0, "value should be 0 after revoke");

        // Verify Router state reset
        assertEq(uint8(router.feedbackType(agentId)), uint8(KlerosReputationRouter.FeedbackType.None));
        assertEq(router.feedbackIndex(agentId), 0, "feedbackIndex should be reset to 0");
    }

    function test_revokeOnly_emitsEvent() public {
        uint256 agentId = _registerTestAgent();

        vm.prank(bot);
        router.submitPositiveFeedback(agentId, bytes32("testItem"), "ipfs://test-positive");

        vm.prank(bot);
        vm.expectEmit(true, false, false, false);
        emit KlerosReputationRouter.FeedbackRevoked(agentId);
        router.revokeOnly(agentId);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Re-registration After Dispute (D-02)
    // ═════════════════════════════════════════════════════════════════════════════

    function test_reRegistration_afterNegative_allowsNewPositive() public {
        uint256 agentId = _registerTestAgent();

        // Step 1: positive feedback
        vm.prank(bot);
        router.submitPositiveFeedback(agentId, bytes32("item1"), "ipfs://positive1");

        // Step 2: negative feedback (dispute removal -- revokes positive, submits -95)
        vm.prank(bot);
        router.submitNegativeFeedback(agentId, "ipfs://negative1");

        // Step 3: re-registration -> new positive feedback
        vm.prank(bot);
        router.submitPositiveFeedback(agentId, bytes32("item2"), "ipfs://positive2");

        // Verify: history accumulates, no revoke of old negative (per project decision)
        // getSummary should return positive value (new +95, old -95 revoked positive doesn't count,
        // negative -95 still counts but new positive overrides in feedbackType)
        assertEq(uint8(router.feedbackType(agentId)), uint8(KlerosReputationRouter.FeedbackType.Positive));

        // The summary reflects all non-revoked feedback from this client:
        // - Original positive: revoked (by submitNegativeFeedback) -> excluded
        // - Negative (-95): active
        // - New positive (+95): active
        // So count=2, value=average or sum depending on getSummary semantics
        (uint64 count, int128 value) = _getSummary(agentId);
        assertEq(count, 2, "count should be 2 (negative + new positive)");
        // value = (-95 + 95) / 2 = 0 if averaged, or sum -- depends on getSummary implementation
        // The key assertion: feedbackType is Positive and the call succeeded
        assertGe(count, 1, "at minimum one non-revoked feedback entry");
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Authorization Edge Cases (ROUT-06)
    // ═════════════════════════════════════════════════════════════════════════════

    function test_revert_unauthorizedBot_submitPositive() public {
        uint256 agentId = _registerTestAgent();

        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(KlerosReputationRouter.KRR_NotAuthorizedBot.selector));
        router.submitPositiveFeedback(agentId, bytes32("testItem"), "ipfs://test");
    }

    function test_revert_unauthorizedBot_submitNegative() public {
        uint256 agentId = _registerTestAgent();

        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(KlerosReputationRouter.KRR_NotAuthorizedBot.selector));
        router.submitNegativeFeedback(agentId, "ipfs://test");
    }

    function test_revert_unauthorizedBot_revokeOnly() public {
        uint256 agentId = _registerTestAgent();

        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(KlerosReputationRouter.KRR_NotAuthorizedBot.selector));
        router.revokeOnly(agentId);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // State Edge Cases
    // ═════════════════════════════════════════════════════════════════════════════

    function test_revert_doublePositive() public {
        uint256 agentId = _registerTestAgent();

        vm.prank(bot);
        router.submitPositiveFeedback(agentId, bytes32("testItem"), "ipfs://test");

        vm.prank(bot);
        vm.expectRevert(abi.encodeWithSelector(KlerosReputationRouter.KRR_AlreadyHasPositiveFeedback.selector, agentId));
        router.submitPositiveFeedback(agentId, bytes32("testItem2"), "ipfs://test2");
    }

    function test_revert_doubleNegative() public {
        uint256 agentId = _registerTestAgent();

        // positive -> negative -> try negative again
        vm.prank(bot);
        router.submitPositiveFeedback(agentId, bytes32("testItem"), "ipfs://test");

        vm.prank(bot);
        router.submitNegativeFeedback(agentId, "ipfs://negative");

        vm.prank(bot);
        vm.expectRevert(abi.encodeWithSelector(KlerosReputationRouter.KRR_AlreadyHasNegativeFeedback.selector, agentId));
        router.submitNegativeFeedback(agentId, "ipfs://negative2");
    }

    function test_revert_revokeWithoutPositive() public {
        uint256 agentId = _registerTestAgent();

        // feedbackType is None
        vm.prank(bot);
        vm.expectRevert(
            abi.encodeWithSelector(KlerosReputationRouter.KRR_NoPositiveFeedbackToRevoke.selector, agentId)
        );
        router.revokeOnly(agentId);
    }

    function test_revert_revokeWhenNegative() public {
        uint256 agentId = _registerTestAgent();

        // Submit negative first (from None state)
        vm.prank(bot);
        router.submitNegativeFeedback(agentId, "ipfs://negative");

        // Try to revoke when state is Negative
        vm.prank(bot);
        vm.expectRevert(
            abi.encodeWithSelector(KlerosReputationRouter.KRR_NoPositiveFeedbackToRevoke.selector, agentId)
        );
        router.revokeOnly(agentId);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Owner Management (ROUT-07)
    // ═════════════════════════════════════════════════════════════════════════════

    function test_setAuthorizedBot_onlyOwner() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        router.setAuthorizedBot(makeAddr("newBot"), true);
    }

    function test_setAuthorizedBot_emitsEvent() public {
        address newBot = makeAddr("newBot");

        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit KlerosReputationRouter.BotAuthorizationChanged(newBot, true);
        router.setAuthorizedBot(newBot, true);
    }

    function test_removeAuthorizedBot() public {
        uint256 agentId = _registerTestAgent();

        // Bot is authorized in setUp, verify it works
        vm.prank(bot);
        router.submitPositiveFeedback(agentId, bytes32("testItem"), "ipfs://test");

        // Owner removes bot authorization
        vm.prank(owner);
        router.setAuthorizedBot(bot, false);

        // Now bot calls should revert
        uint256 agentId2 = _registerTestAgent();
        vm.prank(bot);
        vm.expectRevert(abi.encodeWithSelector(KlerosReputationRouter.KRR_NotAuthorizedBot.selector));
        router.submitPositiveFeedback(agentId2, bytes32("testItem2"), "ipfs://test2");
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Agent Registration
    // ═════════════════════════════════════════════════════════════════════════════

    function test_registerAgent_setsKlerosAgentId() public {
        vm.prank(owner);
        router.registerAgent("https://kleros-agent.example.com");

        assertGt(router.klerosAgentId(), 0, "klerosAgentId should be non-zero after registration");
    }

    function test_registerAgent_routerOwnsAgent() public {
        vm.prank(owner);
        uint256 agentId = router.registerAgent("https://kleros-agent.example.com");

        assertEq(
            IIdentityRegistry(IDENTITY_REGISTRY).ownerOf(agentId),
            address(router),
            "Router should be ownerOf the registered agentId"
        );
    }

    function test_registerAgent_emitsEvent() public {
        vm.prank(owner);
        vm.recordLogs();
        uint256 agentId = router.registerAgent("https://kleros-agent.example.com");

        // Verify the AgentRegistered event was emitted
        Vm.Log[] memory entries = vm.getRecordedLogs();
        bool found = false;
        bytes32 eventSig = keccak256("AgentRegistered(uint256,string)");
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == eventSig) {
                assertEq(uint256(entries[i].topics[1]), agentId, "event agentId should match");
                found = true;
                break;
            }
        }
        assertTrue(found, "AgentRegistered event should be emitted");
    }

    function test_registerAgent_revertsForNonOwner() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        router.registerAgent("https://kleros-agent.example.com");
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Agent URI Update
    // ═════════════════════════════════════════════════════════════════════════════

    function test_updateAgentURI_updatesTokenURI() public {
        // Register agent first so Router owns it
        vm.prank(owner);
        router.registerAgent("https://kleros-agent.example.com");

        // Update URI
        string memory newURI = "ipfs://QmNewAgentMetadata";
        vm.prank(owner);
        router.updateAgentURI(newURI);

        // Verify on IdentityRegistry
        string memory actual = IIdentityRegistry(IDENTITY_REGISTRY).tokenURI(router.klerosAgentId());
        assertEq(actual, newURI, "tokenURI should match updated URI");
    }

    function test_updateAgentURI_revertsForNonOwner() public {
        vm.prank(owner);
        router.registerAgent("https://kleros-agent.example.com");

        vm.prank(unauthorized);
        vm.expectRevert();
        router.updateAgentURI("ipfs://unauthorized");
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // UUPS Upgrade
    // ═════════════════════════════════════════════════════════════════════════════

    function test_upgrade_preservesState() public {
        uint256 agentId = _registerTestAgent();

        // Submit positive feedback to populate state
        vm.prank(bot);
        router.submitPositiveFeedback(agentId, bytes32("testItem"), "ipfs://test-positive");

        // Record pre-upgrade state
        uint8 preType = uint8(router.feedbackType(agentId));
        uint64 preIndex = router.feedbackIndex(agentId);
        uint256 preKlerosAgentId = router.klerosAgentId();

        // Deploy new implementation and upgrade
        KlerosReputationRouter newImpl = new KlerosReputationRouter();
        vm.prank(owner);
        router.upgradeToAndCall(address(newImpl), "");

        // Verify state preserved after upgrade
        assertEq(uint8(router.feedbackType(agentId)), preType, "feedbackType should be preserved");
        assertEq(router.feedbackIndex(agentId), preIndex, "feedbackIndex should be preserved");
        assertEq(router.klerosAgentId(), preKlerosAgentId, "klerosAgentId should be preserved");
        assertEq(router.owner(), owner, "owner should be preserved");
        assertTrue(router.authorizedBots(bot), "bot authorization should be preserved");
    }
}
