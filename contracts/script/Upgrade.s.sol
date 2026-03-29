// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {KlerosReputationRouter} from "../src/KlerosReputationRouter.sol";

/// @title Upgrade
/// @notice Deploys a new KlerosReputationRouter implementation and upgrades the existing UUPS proxy.
/// @dev Usage:
///   ROUTER_PROXY_ADDRESS=0x... forge script script/Upgrade.s.sol --rpc-url $SEPOLIA_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY --broadcast
contract Upgrade is Script {
    function run() external {
        address proxyAddress = vm.envAddress("ROUTER_PROXY_ADDRESS");
        KlerosReputationRouter router = KlerosReputationRouter(proxyAddress);

        console.log("Current proxy:", proxyAddress);
        console.log("Current owner:", router.owner());
        console.log("Current klerosAgentId:", router.klerosAgentId());

        vm.startBroadcast();

        KlerosReputationRouter newImpl = new KlerosReputationRouter();
        console.log("New implementation deployed at:", address(newImpl));

        router.upgradeToAndCall(address(newImpl), "");
        console.log("Proxy upgraded successfully");

        vm.stopBroadcast();

        // Verify state preserved
        console.log("Post-upgrade klerosAgentId:", router.klerosAgentId());
        console.log("Post-upgrade owner:", router.owner());
    }
}
