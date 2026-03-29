# Quick Task 260329-mxh: Fix agent registration — Context

**Gathered:** 2026-03-29
**Status:** Ready for planning

<domain>
## Task Boundary

Fix agent registration — move IdentityRegistry.register() into Router so Router owns klerosAgentId. Currently Deploy.s.sol calls register() directly, making the deployer EOA the owner of the agentId instead of the Router contract.

</domain>

<decisions>
## Implementation Decisions

### Upgrade Strategy
- Add a new `registerAgent(string calldata agentURI)` function to KlerosReputationRouter
- Deploy new implementation, upgrade existing proxy via UUPS — preserves existing state (feedbackType, feedbackIndex mappings)
- Do NOT modify initialize() — that would require fresh proxy deploy and lose Sepolia state

### Existing agentId
- Re-register fresh: Router calls `identityRegistry.register(agentURI)` to get a new agentId it owns
- Old agentId (owned by deployer EOA) becomes orphaned — existing feedback stays on old ID, acceptable for Sepolia PoC
- Deploy.s.sol steps 2-3 replaced: call `router.registerAgent(uri)` instead of calling IdentityRegistry directly

### Access Control
- `registerAgent()` is `onlyOwner` — registration is a one-time admin setup step
- Matches existing admin pattern: setKlerosAgentId, setAuthorizedBot, setReputationRegistry

### Claude's Discretion
- Whether registerAgent() should internally call setKlerosAgentId or return the ID for external setting
- Test coverage approach for the new function (fork test vs unit test)
- Whether to add an event for agent registration

</decisions>

<specifics>
## Specific Ideas

- Function name: `registerAgent(string calldata agentURI)` (not `registerKlerosAgent`)
- The function should call `identityRegistry.register(agentURI)` and store the returned agentId in `klerosAgentId`
- Deploy.s.sol step 2 becomes: `router.registerAgent(klerosAgentURI)` — step 3 (setKlerosAgentId) is no longer needed as registerAgent handles it

</specifics>

<canonical_refs>
## Canonical References

### ERC-8004 Contracts
- `contracts/src/interfaces/IIdentityRegistry.sol` — register() and ownerOf() signatures
- `contracts/src/interfaces/IReputationRegistry.sol` — giveFeedback/revokeFeedback signatures

### Router
- `contracts/src/KlerosReputationRouter.sol` — current implementation, admin functions pattern
- `contracts/script/Deploy.s.sol` — current deploy flow (steps 1-4)

### Tests
- `contracts/test/KlerosReputationRouter.t.sol` — existing fork tests

</canonical_refs>
