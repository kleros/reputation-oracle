// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {IReputationRegistry} from "../src/interfaces/IReputationRegistry.sol";
import {KlerosReputationRouter} from "../src/KlerosReputationRouter.sol";

/// @title Verify
/// @notice On-chain verification script for Kleros Reputation Oracle.
/// @dev Reads getSummary() for bot-touched agents and asserts correct ERC-8004 reputation values.
///      Covers VER-01 (Scenario 1 live assertions), VER-04 (tag-filtered getSummary).
///      VER-02, VER-03: Proven via fork tests in KlerosReputationRouter.t.sol — pending live disputes on PGTCR list.
///
/// Usage:
///   ROUTER_PROXY_ADDRESS=0x... AGENT_IDS="610,1142,1143,1440" \
///     forge script script/Verify.s.sol --rpc-url $SEPOLIA_RPC_URL
contract Verify is Script {
    // ─── Sepolia deployed addresses ──────────────────────────────────────────────
    address constant REPUTATION_REGISTRY = 0x8004B663056A597Dffe9eCcC1965A193B7388713;

    function run() external view {
        // ─── Read env ────────────────────────────────────────────────────────────
        address routerProxy = vm.envAddress("ROUTER_PROXY_ADDRESS");
        string memory agentIdsStr = vm.envString("AGENT_IDS");

        uint256[] memory agentIds = _parseAgentIds(agentIdsStr);
        KlerosReputationRouter router = KlerosReputationRouter(routerProxy);

        // Build clients array with just the router proxy
        address[] memory clients = new address[](1);
        clients[0] = routerProxy;

        console.log("=== Kleros Reputation Oracle -- Verification ===");
        console.log("Router:", routerProxy);
        console.log("Verifying %d agents...", agentIds.length);
        console.log("");

        uint256 passCount;

        for (uint256 i; i < agentIds.length; i++) {
            uint256 agentId = agentIds[i];
            console.log("Agent %d:", agentId);

            // ─── VER-01: Unfiltered getSummary ──────────────────────────────
            (uint64 count, int128 value,) =
                IReputationRegistry(REPUTATION_REGISTRY).getSummary(agentId, clients, "", "");
            console.log("  getSummary(\"\", \"\"):         count=%d, value=%s", count, _int128ToString(value));
            require(count == 1, "VER-01: Scenario 1 agent must have count=1");
            require(value == 95, "VER-01: Scenario 1 agent must have value=95");
            console.log("    [PASS]");
            passCount += 2;

            // ─── VER-04: Tag-filtered getSummary (verified) ─────────────────
            (uint64 vCount, int128 vValue,) =
                IReputationRegistry(REPUTATION_REGISTRY).getSummary(agentId, clients, "verified", "");
            console.log(
                "  getSummary(\"verified\", \"\"): count=%d, value=%s", vCount, _int128ToString(vValue)
            );
            require(vCount == 1, "VER-04: tag1='verified' must return count=1 for Scenario 1 agents");
            require(vValue == 95, "VER-04: tag1='verified' must return value=95 for Scenario 1 agents");
            console.log("    [PASS]");
            passCount += 2;

            // ─── VER-04: Tag-filtered getSummary (removed) ──────────────────
            (uint64 rCount, int128 rValue,) =
                IReputationRegistry(REPUTATION_REGISTRY).getSummary(agentId, clients, "removed", "");
            console.log(
                "  getSummary(\"removed\", \"\"):  count=%d, value=%s", rCount, _int128ToString(rValue)
            );
            require(rCount == 0, "VER-04: tag1='removed' must return count=0 for Scenario 1 agents");
            require(rValue == 0, "VER-04: tag1='removed' must return value=0 for Scenario 1 agents");
            console.log("    [PASS]");
            passCount += 2;

            // ─── Router state check ─────────────────────────────────────────
            KlerosReputationRouter.FeedbackType fType = router.feedbackType(agentId);
            console.log("  Router feedbackType: %s", _feedbackTypeToString(fType));
            require(
                fType == KlerosReputationRouter.FeedbackType.Positive,
                "Router feedbackType must be Positive for Scenario 1 agents"
            );
            console.log("    [PASS]");
            passCount++;

            console.log("");
        }

        // VER-02, VER-03: Proven via fork tests in KlerosReputationRouter.t.sol — pending live disputes on PGTCR list.
        // Scenario 2 (dispute removal) and Scenario 3 (voluntary withdrawal) cannot be verified live
        // until disputed/withdrawn items exist on the PGTCR list.

        console.log("=== All %d assertions passed ===", passCount);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────────

    /// @dev Parse comma-separated uint256 values from a string.
    function _parseAgentIds(string memory csv) internal pure returns (uint256[] memory) {
        bytes memory b = bytes(csv);
        if (b.length == 0) return new uint256[](0);

        // Count commas to determine array size
        uint256 count = 1;
        for (uint256 i; i < b.length; i++) {
            if (b[i] == 0x2c) count++;
        }

        uint256[] memory ids = new uint256[](count);
        uint256 idx;
        uint256 start;

        for (uint256 i; i <= b.length; i++) {
            if (i == b.length || b[i] == 0x2c) {
                // Extract substring [start, i)
                bytes memory segment = new bytes(i - start);
                for (uint256 j = start; j < i; j++) {
                    segment[j - start] = b[j];
                }
                ids[idx] = vm.parseUint(string(segment));
                idx++;
                start = i + 1;
            }
        }

        return ids;
    }

    /// @dev Convert int128 to string for console output.
    function _int128ToString(int128 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        if (v > 0) return vm.toString(uint256(int256(v)));
        return string.concat("-", vm.toString(uint256(int256(-v))));
    }

    /// @dev Convert FeedbackType enum to string for console output.
    function _feedbackTypeToString(KlerosReputationRouter.FeedbackType fType)
        internal
        pure
        returns (string memory)
    {
        if (fType == KlerosReputationRouter.FeedbackType.None) return "None";
        if (fType == KlerosReputationRouter.FeedbackType.Positive) return "Positive";
        return "Negative";
    }
}
