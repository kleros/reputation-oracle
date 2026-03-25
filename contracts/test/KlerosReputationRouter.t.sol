// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
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
}
