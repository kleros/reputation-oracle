---
phase: quick-260329-mxh
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - contracts/src/KlerosReputationRouter.sol
  - contracts/script/Deploy.s.sol
  - contracts/script/Upgrade.s.sol
  - contracts/test/KlerosReputationRouter.t.sol
autonomous: true
requirements: [FIX-AGENT-REGISTRATION]

must_haves:
  truths:
    - "Router.registerAgent() calls IdentityRegistry.register() and stores returned agentId in klerosAgentId"
    - "Router is ownerOf the newly registered agentId (not deployer EOA)"
    - "Deploy.s.sol uses router.registerAgent() instead of calling IdentityRegistry directly"
    - "Existing proxy can be upgraded via UUPS without losing state"
    - "All existing tests still pass after contract modification"
  artifacts:
    - path: "contracts/src/KlerosReputationRouter.sol"
      provides: "registerAgent() function + AgentRegistered event"
      contains: "function registerAgent"
    - path: "contracts/script/Upgrade.s.sol"
      provides: "UUPS upgrade script for existing proxy"
      contains: "upgradeToAndCall"
    - path: "contracts/script/Deploy.s.sol"
      provides: "Updated deploy using router.registerAgent()"
      contains: "router.registerAgent"
    - path: "contracts/test/KlerosReputationRouter.t.sol"
      provides: "Fork tests for registerAgent + upgrade"
      contains: "test_registerAgent"
  key_links:
    - from: "contracts/src/KlerosReputationRouter.sol"
      to: "IIdentityRegistry"
      via: "identityRegistry.register(agentURI)"
      pattern: "identityRegistry\\.register"
    - from: "contracts/script/Deploy.s.sol"
      to: "KlerosReputationRouter"
      via: "router.registerAgent(klerosAgentURI)"
      pattern: "router\\.registerAgent"
---

<objective>
Add `registerAgent(string calldata agentURI)` to KlerosReputationRouter so the Router contract (not the deployer EOA) owns the agentId on IdentityRegistry.

Purpose: Currently Deploy.s.sol calls IdentityRegistry.register() directly, making the deployer EOA the owner of agentId 2295 instead of the Router proxy. This breaks ownership semantics — the Router needs to be the agent owner.

Output: Updated Router contract, Upgrade.s.sol script, updated Deploy.s.sol, fork tests proving ownership.
</objective>

<execution_context>
@/Users/jaybuidl/project/kleros/reputation-oracle/.claude/get-shit-done/workflows/execute-plan.md
@/Users/jaybuidl/project/kleros/reputation-oracle/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@contracts/src/KlerosReputationRouter.sol
@contracts/src/interfaces/IIdentityRegistry.sol
@contracts/script/Deploy.s.sol
@contracts/test/KlerosReputationRouter.t.sol

<interfaces>
<!-- Key types and contracts the executor needs -->

From contracts/src/interfaces/IIdentityRegistry.sol:
```solidity
interface IIdentityRegistry {
    function register(string calldata agentURI) external returns (uint256 agentId);
    function ownerOf(uint256 agentId) external view returns (address);
}
```

From contracts/src/KlerosReputationRouter.sol (admin pattern):
```solidity
// All admin functions follow: external onlyOwner, no return value
function setAuthorizedBot(address bot, bool authorized) external onlyOwner { ... }
function setKlerosAgentId(uint256 _klerosAgentId) external onlyOwner { ... }
```

Storage layout (slots 0-5 + gap, NO new variables needed):
```
slot 0: reputationRegistry
slot 1: identityRegistry
slot 2: klerosAgentId        // registerAgent writes here
slot 3: authorizedBots
slot 4: feedbackType
slot 5: feedbackIndex
slot 6-55: __gap[50]
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add registerAgent() to Router + update Deploy.s.sol + create Upgrade.s.sol</name>
  <files>
    contracts/src/KlerosReputationRouter.sol,
    contracts/script/Deploy.s.sol,
    contracts/script/Upgrade.s.sol
  </files>
  <behavior>
    - registerAgent(uri) called by owner sets klerosAgentId to non-zero value
    - registerAgent(uri) makes Router the ownerOf(newAgentId) on IdentityRegistry
    - registerAgent(uri) emits AgentRegistered(agentId, agentURI)
    - registerAgent(uri) reverts when called by non-owner
    - UUPS upgrade preserves existing feedbackType/feedbackIndex state
    - All existing tests still pass (no storage layout change)
  </behavior>
  <action>
1. In `contracts/src/KlerosReputationRouter.sol`:
   - Add event: `event AgentRegistered(uint256 indexed agentId, string agentURI);` in the Events section (after BotAuthorizationChanged)
   - Add function in Admin Functions section (after setIdentityRegistry):
     ```solidity
     /// @notice Register this Router as an agent on the IdentityRegistry and store the agentId.
     /// @param agentURI URI to agent metadata JSON.
     /// @return agentId The newly registered agent ID.
     function registerAgent(string calldata agentURI) external onlyOwner returns (uint256 agentId) {
         agentId = identityRegistry.register(agentURI);
         klerosAgentId = agentId;
         emit AgentRegistered(agentId, agentURI);
     }
     ```
   - NO new state variables. NO storage layout changes. Only adds a function + event.

2. In `contracts/script/Deploy.s.sol`:
   - Replace Step 2+3 block (lines 67-79). The `if (router.klerosAgentId() == 0)` block should call `router.registerAgent(klerosAgentURI)` instead of `IIdentityRegistry(IDENTITY_REGISTRY).register(klerosAgentURI)` + `router.setKlerosAgentId(agentId)`.
   - Remove Step 3 entirely — registerAgent handles both registration and klerosAgentId setting atomically.
   - Update the NatSpec: Step 2 becomes "Register Kleros agent via Router (SETUP-02)" and Step 3 line is removed from the doc comment.
   - Keep the `IIdentityRegistry` import — still needed if referenced elsewhere, but can remove if unused after edit.

3. Create `contracts/script/Upgrade.s.sol`:
   ```solidity
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
   ```
  </action>
  <verify>
    <automated>cd /Users/jaybuidl/project/kleros/reputation-oracle/contracts && forge build 2>&1 | tail -5</automated>
  </verify>
  <done>Router compiles with registerAgent(), Deploy.s.sol uses router.registerAgent(), Upgrade.s.sol exists, no storage layout changes</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Fork tests for registerAgent + upgrade state preservation</name>
  <files>contracts/test/KlerosReputationRouter.t.sol</files>
  <behavior>
    - test_registerAgent_setsKlerosAgentId: router.registerAgent(uri) -> klerosAgentId > 0
    - test_registerAgent_routerOwnsAgent: ownerOf(newAgentId) == address(router)
    - test_registerAgent_emitsEvent: AgentRegistered event emitted with correct args
    - test_registerAgent_revertsForNonOwner: unauthorized caller gets OwnableUnauthorizedAccount revert
    - test_upgrade_preservesState: submit feedback, upgrade impl, verify feedbackType + feedbackIndex unchanged
  </behavior>
  <action>
Add tests to `contracts/test/KlerosReputationRouter.t.sol`. Add a new section after "Owner Management (ROUT-07)":

```
// ═══════════════════════════════════════════════════════════════════════════
// Agent Registration
// ═══════════════════════════════════════════════════════════════════════════
```

Tests to add:

1. `test_registerAgent_setsKlerosAgentId`:
   - `vm.prank(owner)` -> `router.registerAgent("https://kleros-agent.example.com")`
   - `assertGt(router.klerosAgentId(), 0)`

2. `test_registerAgent_routerOwnsAgent`:
   - `vm.prank(owner)` -> `uint256 agentId = router.registerAgent("https://kleros-agent.example.com")`
   - `assertEq(IIdentityRegistry(IDENTITY_REGISTRY).ownerOf(agentId), address(router))`

3. `test_registerAgent_emitsEvent`:
   - `vm.prank(owner)`
   - `vm.expectEmit(true, false, false, true)` -> emit `KlerosReputationRouter.AgentRegistered(/* any agentId */ 0, "https://kleros-agent.example.com")` — use `expectEmit(true, false, false, false)` since agentId is unknown beforehand, check indexed topic only partially. Actually simpler: just check event is emitted without asserting exact agentId. Use `vm.expectEmit(false, false, false, false)` with just the event signature, then call registerAgent.
   - Better approach: call registerAgent, capture return, then use `vm.recordLogs()` pattern. Or simplest: just expect any AgentRegistered event — `vm.expectEmit(true, false, false, true)` won't work since we don't know agentId. Use `vm.expectEmit(false, false, false, false); emit KlerosReputationRouter.AgentRegistered(0, "");` — this checks event selector only.

4. `test_registerAgent_revertsForNonOwner`:
   - `vm.prank(unauthorized)` -> `vm.expectRevert()` -> `router.registerAgent("https://agent.example.com")`

5. `test_upgrade_preservesState` — Add a new section "UUPS Upgrade":
   - Submit positive feedback via bot for a test agent
   - Record `feedbackType[agentId]` and `feedbackIndex[agentId]`
   - Deploy new implementation: `KlerosReputationRouter newImpl = new KlerosReputationRouter()`
   - `vm.prank(owner)` -> `router.upgradeToAndCall(address(newImpl), "")`
   - Assert feedbackType and feedbackIndex unchanged after upgrade
   - Assert `router.klerosAgentId()` unchanged (still 0 from setUp since registerAgent not called)
  </action>
  <verify>
    <automated>cd /Users/jaybuidl/project/kleros/reputation-oracle/contracts && forge test --fork-url $SEPOLIA_RPC_URL -vv --match-test "registerAgent|upgrade" 2>&1 | tail -20</automated>
  </verify>
  <done>All 5 new tests pass. registerAgent sets klerosAgentId, Router is ownerOf, event emitted, non-owner reverts, upgrade preserves state. Full test suite (existing + new) passes.</done>
</task>

</tasks>

<verification>
1. `cd contracts && forge build` — compiles without errors
2. `cd contracts && forge test --fork-url $SEPOLIA_RPC_URL -vv` — ALL tests pass (existing + new)
3. `forge inspect KlerosReputationRouter storageLayout` — storage slots unchanged (no new state variables)
</verification>

<success_criteria>
- Router has `registerAgent(string calldata agentURI) external onlyOwner returns (uint256)`
- Router emits `AgentRegistered(uint256 indexed agentId, string agentURI)`
- Deploy.s.sol step 2 calls `router.registerAgent()` — step 3 eliminated
- Upgrade.s.sol deploys new impl and calls `upgradeToAndCall`
- Fork tests prove: Router is ownerOf new agentId, klerosAgentId set, state preserved through upgrade
- Full existing test suite still passes (no regressions)
</success_criteria>

<output>
After completion, create `.planning/quick/260329-mxh-fix-agent-registration-move-identityregi/260329-mxh-SUMMARY.md`
</output>
