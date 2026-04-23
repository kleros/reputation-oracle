// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {KlerosReputationRouter} from "../src/KlerosReputationRouter.sol";

/// @title Deploy
/// @notice Idempotent deploy + setup orchestrator for the KlerosReputationRouter.
/// @dev Performs four steps in sequence, skipping any that are already completed:
///   1. Deploy Router implementation + ERC1967 UUPS proxy (SETUP-01)
///   2. Register Kleros agent via Router (SETUP-02)
///   3. Authorize bot address on Router (SETUP-04)
///
/// Usage:
///   # Required env vars:
///   #   BOT_ADDRESS          — address to authorize as bot caller
///   #   KLEROS_AGENT_URI     — URI to agent metadata JSON (IPFS or HTTPS, must return valid JSON)
///   #   DEPLOYER_PRIVATE_KEY — deployer wallet private key
///   #   SEPOLIA_RPC_URL      — Sepolia RPC endpoint
///
///   # Dry run (simulation):
///   forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
///
///   # Broadcast (real deployment):
///   forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY --broadcast
///
///   # Re-run after deployment (skips already-completed steps):
///   ROUTER_PROXY_ADDRESS=0x... forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY --broadcast
contract Deploy is Script {
    // ─── Sepolia deployed addresses ──────────────────────────────────────────────
    address constant REPUTATION_REGISTRY = 0x8004B663056A597Dffe9eCcC1965A193B7388713;
    address constant IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;

    function run() external {
        // Read environment variables
        address botAddress = vm.envAddress("BOT_ADDRESS");
        string memory klerosAgentURI = vm.envString("KLEROS_AGENT_URI");
        address proxyAddress = vm.envOr("ROUTER_PROXY_ADDRESS", address(0));

        vm.startBroadcast();

        KlerosReputationRouter router;

        // ─── Step 1: Deploy implementation + proxy (SETUP-01) ────────────────────
        if (proxyAddress == address(0)) {
            console.log("Step 1: Deploying Router implementation and proxy...");
            KlerosReputationRouter impl = new KlerosReputationRouter();
            console.log("  Implementation deployed at:", address(impl));

            bytes memory initData = abi.encodeCall(
                KlerosReputationRouter.initialize, (REPUTATION_REGISTRY, IDENTITY_REGISTRY, 0, msg.sender)
            );
            ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
            router = KlerosReputationRouter(address(proxy));
            console.log("  Proxy deployed at:", address(proxy));
            console.log("  >>> Save this as ROUTER_PROXY_ADDRESS for re-runs <<<");
        } else {
            console.log("Step 1: SKIP - Using existing proxy at", proxyAddress);
            router = KlerosReputationRouter(proxyAddress);
        }

        // ─── Step 2: Register Kleros agent via Router (SETUP-02) ─────────────────
        if (router.klerosAgentId() == 0) {
            console.log("Step 2: Registering Kleros agent via Router...");
            uint256 agentId = router.registerAgent(klerosAgentURI);
            console.log("  Kleros agentId:", agentId);
            console.log("  Agent owner (Router):", address(router));
        } else {
            console.log("Step 2: SKIP - Kleros agent already registered, agentId:", router.klerosAgentId());
        }

        // ─── Step 3: Authorize bot address (SETUP-04) ───────────────────────────
        if (!router.authorizedBots(botAddress)) {
            console.log("Step 3: Authorizing bot address...");
            router.setAuthorizedBot(botAddress, true);
            console.log("  Bot authorized:", botAddress);
        } else {
            console.log("Step 3: SKIP - Bot already authorized:", botAddress);
        }

        vm.stopBroadcast();

        // ─── Summary ─────────────────────────────────────────────────────────────
        console.log("");
        console.log("=== Deployment Summary ===");
        console.log("Router proxy:", address(router));
        console.log("Kleros agentId:", router.klerosAgentId());
        console.log("Bot authorized:", router.authorizedBots(botAddress));
        console.log("Owner:", router.owner());
    }
}
