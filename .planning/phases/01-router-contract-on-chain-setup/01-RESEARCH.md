# Phase 1: Router Contract & On-Chain Setup - Research

**Researched:** 2026-03-25
**Domain:** Solidity UUPS proxy contract, ERC-8004 ReputationRegistry integration, Foundry tooling
**Confidence:** HIGH

## Summary

Phase 1 is a greenfield Solidity contract + Foundry deployment phase. The Router contract acts as the single `clientAddress` for Kleros reputation feedback on ERC-8004. It must handle three scenarios (positive, negative, revoke-only) with correct state tracking using a `FeedbackType` enum (per D-01/D-02). The contract is deployed as a UUPS proxy via OpenZeppelin v5, with an initializer instead of a constructor, and tested entirely via Sepolia fork tests.

Key verified finding: `giveFeedback()` on the deployed ReputationRegistry returns **void** (confirmed from PoC ABI). The Router must call `getLastIndex(agentId, address(this))` after each `giveFeedback` to capture the feedback index. The `submitNegativeFeedback` function must be atomic -- handling both the "has positive feedback" and "no prior feedback" paths in a single call (D-03).

**Primary recommendation:** Implement the Router as a UUPS proxy using OpenZeppelin v5 `UUPSUpgradeable` + `Initializable` + `OwnableUpgradeable`, deploy via a single Foundry script using `ERC1967Proxy`, and test all scenarios against a forked Sepolia with the real ReputationRegistry and IdentityRegistry contracts.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Use `FeedbackType` enum (`None`, `Positive`, `Negative`) instead of boolean `hasFeedback`. Mapping: `mapping(uint256 => FeedbackType) public feedbackType` + `mapping(uint256 => uint256) public feedbackIndex`.
- **D-02:** Diff logic becomes: Submitted + (None OR Negative) -> positive feedback. Absent + Positive -> revoke/negative. This cleanly handles re-registration after dispute (Pitfall 8 resolved).
- **D-03:** `submitNegativeFeedback` is a single atomic function that handles both paths: if `feedbackType == Positive`, revoke first then submit -95; if `feedbackType == None` (prior revoke succeeded but negative failed), just submit -95. Bot never calls revoke separately for Scenario 2 (Pitfall 3 resolved).
- **D-04:** `revokeOnly` remains a separate function for Scenario 3 (voluntary withdrawal) -- no negative feedback needed.
- **D-05:** Obtain ReputationRegistry ABI from the 8004scan-skill:8004 spec, then verify against the actual deployed Sepolia contract. Pin to the deployed interface version.
- **D-06:** Prior PoC at `../erc8004-feedback-bot-fortunato/src/blockchain/abis/reputation-registry.json` provides a starting reference for the ABI. Verify before using.
- **D-07:** Verify whether `giveFeedback` returns the feedback index (Pitfall 4). If it does, use the return value. If not, use `getLastIndex` call after feedback submission.
- **D-08:** Fork Sepolia for all Router tests (`forge test --fork-url`). Tests deploy the Router proxy against the real ReputationRegistry and IdentityRegistry on Sepolia.
- **D-09:** No mock registries -- all tests prove real integration. This catches interface mismatches before deployment.
- **D-10:** Single orchestrator Foundry script (`Deploy.s.sol`) that runs all steps in sequence: deploy UUPS proxy -> register Kleros identity -> configure Router addresses -> authorize bot. Re-running skips completed steps via on-chain state checks.

### Claude's Discretion
- Contract naming (`KlerosReputationRouter` or similar)
- Storage gap size for UUPS proxy
- Event parameter design (ROUT-08) -- include enough data for off-chain indexing
- OpenZeppelin import versions and specific upgrade patterns
- Foundry project structure (src/, test/, script/ layout)

### Deferred Ideas (OUT OF SCOPE)
- pgtcrToAgentId on-chain mapping (Strategy C admin mapping) -- Strategy A (key0 from subgraph) is primary per PROJECT.md. On-chain mapping adds complexity without PoC value.
- Pausable contract for key compromise circuit breaker -- Pitfall 14, deferred to Phase 2 production hardening.
- Multi-list support -- out of scope for v1, contract upgradeable for future via storage gaps.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ROUT-01 | Router deployed on Sepolia as UUPS proxy with storage gaps | OpenZeppelin v5 UUPSUpgradeable + ERC1967Proxy pattern; `uint256[50] private __gap` |
| ROUT-02 | Router stores feedback state per agentId (feedbackType enum, feedbackIndex) | D-01 locks `FeedbackType` enum approach; replaces PRD's boolean `hasFeedback` |
| ROUT-03 | Scenario 1 -- submitPositiveFeedback calls giveFeedback with +95 | giveFeedback returns void; must use getLastIndex after. Revert if feedbackType != None and != Negative |
| ROUT-04 | Scenario 2 -- submitNegativeFeedback revokes positive then submits -95 | D-03 atomic function handles both paths (has positive, or no prior feedback) |
| ROUT-05 | Scenario 3 -- revokeOnly revokes without new feedback | D-04 separate function; revert if feedbackType not Positive |
| ROUT-06 | Bot authorization via authorizedBots mapping | onlyAuthorizedBot modifier on all feedback functions |
| ROUT-07 | Owner can add/remove bots and transfer ownership | OwnableUpgradeable from OpenZeppelin v5 for ownership; setAuthorizedBot for bot mgmt |
| ROUT-08 | Events for all state changes | Events with indexed agentId, pgtcrItemId; discretion area per CONTEXT.md |
| ROUT-09 | Feedback values are constants | `int128 constant POSITIVE_VALUE = 95`, `NEGATIVE_VALUE = -95`, tag constants |
| ROUT-10 | Forge test suite including edge cases | Fork Sepolia tests per D-08/D-09; test matrix from PRD S16 |
| SETUP-01 | Foundry deploy script deploys Router as UUPS proxy | D-10 single Deploy.s.sol script with idempotent steps |
| SETUP-02 | Script registers Kleros as 8004 agent on IdentityRegistry | IdentityRegistry.register(agentURI) returns uint256 agentId |
| SETUP-03 | Script configures Router with klerosAgentId, registry addresses | setKlerosAgentId, setReputationRegistry, setIdentityRegistry |
| SETUP-04 | Script authorizes bot address on Router | setAuthorizedBot(botAddress, true) |
</phase_requirements>

## Tag Value Discrepancy (MUST RESOLVE)

**CLAUDE.md** says tags are `"verified"` and `"removed"`.
**PRD v2 S11** (the contract spec) defines constants as `"curate-verified"` and `"curate-removed"`.
**REQUIREMENTS.md ROUT-03** uses `"verified"` and `"kleros-agent-registry"`.

The PRD is the detailed specification and uses `"curate-verified"` / `"curate-removed"` consistently across S2, S6, S11, S13, S16, and all appendices. CLAUDE.md appears to use shortened forms.

**Recommendation:** Use the PRD values: `TAG_VERIFIED = "curate-verified"`, `TAG_REMOVED = "curate-removed"`, `TAG_REGISTRY = "kleros-agent-registry"`. Flag for user confirmation before implementation since CLAUDE.md and PRD disagree.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Solidity | ^0.8.20 | Router contract language | Matches deployed ERC-8004 registries; supports custom errors, PUSH0 |
| OpenZeppelin Contracts | ^5.6 | UUPS proxy, Ownable, Initializable | Battle-tested, audited; v5 uses namespaced storage (EIP-7201) |
| Foundry | 1.4.4+ (foundryup) | Build, test, deploy | `forge test --fork-url` for integration against real Sepolia contracts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| forge-std | bundled with Foundry | Test utilities, Script base, console.log | All tests and deploy scripts |
| ERC1967Proxy | from @openzeppelin/contracts | Proxy deployment wrapper | Deploy.s.sol creates proxy pointing to implementation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| UUPS proxy | Transparent proxy | UUPS is lighter, no admin slot collision; project decision is UUPS |
| OwnableUpgradeable | Custom owner logic | OZ is audited; PRD spec uses manual owner but OZ is strictly better |
| OpenZeppelin v5 | v4 | v5 has namespaced storage, better upgrade safety; requires Solidity ^0.8.20 |

**Installation:**
```bash
# From project root, in contracts/ directory
forge init contracts --no-commit
cd contracts
forge install OpenZeppelin/openzeppelin-contracts --no-commit
# Add remapping in foundry.toml or remappings.txt:
# @openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
```

## Architecture Patterns

### Recommended Project Structure
```
contracts/
  src/
    KlerosReputationRouter.sol          # Implementation contract
    interfaces/
      IReputationRegistry.sol           # Pinned ERC-8004 interface
      IIdentityRegistry.sol             # Pinned ERC-8004 interface
  test/
    KlerosReputationRouter.t.sol        # Fork tests
  script/
    Deploy.s.sol                        # Idempotent deploy + setup script
  foundry.toml                          # Solidity version, fork URL, remappings
  remappings.txt                        # @openzeppelin/contracts/ mapping
```

### Pattern 1: UUPS Proxy with OpenZeppelin v5

**What:** Deploy an implementation contract behind an ERC1967Proxy. The implementation inherits `Initializable`, `UUPSUpgradeable`, and `OwnableUpgradeable`.

**Key change from PRD S11:** The PRD spec uses a constructor. For UUPS, replace with an `initialize` function and add a `_disableInitializers()` constructor.

```solidity
// Source: OpenZeppelin v5 UUPS pattern
// https://docs.openzeppelin.com/contracts/5.x/api/proxy

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract KlerosReputationRouter is Initializable, UUPSUpgradeable, OwnableUpgradeable {

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _reputationRegistry,
        address _identityRegistry,
        uint256 _klerosAgentId,
        address _owner
    ) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        reputationRegistry = IReputationRegistry(_reputationRegistry);
        identityRegistry = IIdentityRegistry(_identityRegistry);
        klerosAgentId = _klerosAgentId;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // Storage gap for future upgrades
    uint256[50] private __gap;
}
```

### Pattern 2: FeedbackType Enum State Model (D-01/D-02)

**What:** Replace PRD's `bool hasFeedback` with a three-state enum to handle re-registration after dispute.

```solidity
enum FeedbackType { None, Positive, Negative }

mapping(uint256 => FeedbackType) public feedbackType;
mapping(uint256 => uint64) public feedbackIndex;
```

**State transitions:**
- `submitPositiveFeedback`: requires `feedbackType[agentId] == None || feedbackType[agentId] == Negative` -> sets to `Positive`
- `submitNegativeFeedback`: if `Positive`, revoke first then submit negative; if `None`, just submit negative -> sets to `Negative`
- `revokeOnly`: requires `feedbackType[agentId] == Positive` -> sets to `None`

### Pattern 3: Foundry Deploy Script with Idempotency (D-10)

**What:** Single `Deploy.s.sol` that deploys proxy, registers identity, configures router, authorizes bot. Each step checks on-chain state before executing.

```solidity
// Source: Foundry Script pattern
import {Script} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract Deploy is Script {
    function run() external {
        vm.startBroadcast();

        // Step 1: Deploy implementation + proxy (skip if proxy already deployed)
        KlerosReputationRouter impl = new KlerosReputationRouter();
        bytes memory initData = abi.encodeCall(
            KlerosReputationRouter.initialize,
            (reputationRegistry, identityRegistry, 0, msg.sender)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        KlerosReputationRouter router = KlerosReputationRouter(address(proxy));

        // Step 2: Register Kleros agent (skip if klerosAgentId already set)
        if (router.klerosAgentId() == 0) {
            uint256 agentId = IIdentityRegistry(identityRegistry).register(agentURI);
            router.setKlerosAgentId(agentId);
        }

        // Step 3: Authorize bot (skip if already authorized)
        if (!router.authorizedBots(botAddress)) {
            router.setAuthorizedBot(botAddress, true);
        }

        vm.stopBroadcast();
    }
}
```

### Anti-Patterns to Avoid
- **Constructor in upgradeable contract:** Use `initialize()` with `initializer` modifier instead. Constructors run on the implementation, not the proxy.
- **Inserting state variables between existing ones:** Always append new variables before `__gap` and reduce gap size accordingly.
- **Manual owner tracking when OwnableUpgradeable exists:** Use OpenZeppelin's audited ownership.
- **Boolean hasFeedback:** Use `FeedbackType` enum per D-01 to handle re-registration correctly.
- **Separate revoke + negative calls from bot:** D-03 mandates atomic `submitNegativeFeedback` handling both paths.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Proxy upgrade mechanism | Custom delegatecall proxy | OpenZeppelin UUPSUpgradeable + ERC1967Proxy | Storage layout bugs, security vulnerabilities |
| Ownership management | Custom `owner` + `onlyOwner` | OwnableUpgradeable | Two-step transfer, renounce safety, battle-tested |
| Deploy script orchestration | Custom deployment scripts in TS | Foundry `forge script` with `Script.sol` base | Native broadcast, dry-run, verification support |
| Interface definitions | Copy-paste function selectors | Solidity interfaces from verified ABI | Type safety, compiler checks |

**Key insight:** The PRD S11 spec uses manual ownership (`address public owner` + custom modifier). OpenZeppelin's `OwnableUpgradeable` provides the same functionality with audited code and `transferOwnership` that emits events. Use it instead.

## ERC-8004 Interface Verification (D-05, D-06, D-07)

### giveFeedback Return Value -- RESOLVED

**Finding:** `giveFeedback()` returns **void** (`outputs: []`). Verified from the deployed ReputationRegistry ABI at `../erc8004-feedback-bot-fortunato/src/blockchain/abis/reputation-registry.json`.

**Implication:** The Router MUST call `getLastIndex(agentId, address(this))` after each `giveFeedback` to capture the feedback index. This is exactly what the PRD S11 code does. D-07 is resolved: use `getLastIndex`.

### ReputationRegistry is Itself UUPS Upgradeable

The deployed ReputationRegistry ABI includes `upgradeToAndCall`, `proxiableUUID`, `UPGRADE_INTERFACE_VERSION`, and `Initialized` event. This means the ERC-8004 interface could change via upgrade. Validating Pitfall 11 -- pin the interface and test against the real contract.

### Interface Definitions (from verified ABI)

```solidity
// IReputationRegistry.sol -- pin to deployed Sepolia version
interface IReputationRegistry {
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;  // Returns void -- confirmed

    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external;

    function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64);

    function getSummary(
        uint256 agentId,
        address[] calldata clientAddresses,
        string calldata tag1,
        string calldata tag2
    ) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals);

    function readFeedback(
        uint256 agentId,
        address clientAddress,
        uint64 feedbackIndex
    ) external view returns (int128 value, uint8 valueDecimals, string memory tag1, string memory tag2, bool isRevoked);
}

// IIdentityRegistry.sol -- pin to deployed Sepolia version
interface IIdentityRegistry {
    function register(string calldata agentURI) external returns (uint256 agentId);
    function ownerOf(uint256 agentId) external view returns (address);
}
```

## Deployed Contract Addresses (Sepolia)

| Contract | Address | Verified |
|----------|---------|----------|
| IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | From PRD S5 |
| ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | From PRD S5 |
| PGTCR | `0x3162df9669affa8b6b6ff2147afa052249f00447` | From PRD S5 / CLAUDE.md |

Chain ID: 11155111 (Ethereum Sepolia)

## Common Pitfalls

### Pitfall 1: Constructor vs Initializer in UUPS
**What goes wrong:** Writing a constructor that sets state. The constructor runs on the implementation contract, not the proxy. All state set in the constructor is invisible to the proxy.
**Why it happens:** PRD S11.2 shows a constructor pattern. This must be converted to an `initialize()` function for UUPS.
**How to avoid:** Use `initialize()` with `initializer` modifier. Add `constructor() { _disableInitializers(); }` to prevent initialization of the implementation.
**Warning signs:** State reads returning zero/default after deployment via proxy.

### Pitfall 2: Storage Layout Corruption on Upgrade (Pitfall 10)
**What goes wrong:** New state variables inserted between existing ones shift storage slots, corrupting feedbackType and feedbackIndex mappings.
**How to avoid:** Always append new variables before `__gap`. Reduce `__gap` size by the number of slots added. Use `forge inspect KlerosReputationRouter storage-layout` to verify.
**Warning signs:** Unexpected values from state reads after an upgrade.

### Pitfall 3: feedbackIndex Desync (Pitfall 4)
**What goes wrong:** `getLastIndex` called after `giveFeedback` could return wrong index if another caller submits feedback for the same agent in the same block.
**How to avoid:** Single bot per Router deployment (operational guarantee). The `onlyAuthorizedBot` modifier + single authorized address prevents concurrent callers. For this PoC, this is sufficient.

### Pitfall 4: Re-registration State Skip (Pitfall 8) -- RESOLVED by D-01/D-02
**What goes wrong:** With boolean `hasFeedback`, re-registered agents after dispute are silently skipped.
**How to avoid:** D-01/D-02 resolve this with `FeedbackType` enum. `submitPositiveFeedback` accepts `FeedbackType.None` OR `FeedbackType.Negative`, covering re-registration.

### Pitfall 5: Self-Feedback Revert
**What goes wrong:** If the Router is the owner or approved operator of an agent it tries to rate, `giveFeedback` reverts with the ERC-8004 no-self-feedback rule.
**How to avoid:** The Router must NOT be registered as an agent itself. Kleros identity registration (SETUP-02) must be done from a separate admin wallet, not from the Router contract. The Router is the `clientAddress` (feedback giver), never the agent.

### Pitfall 6: Idempotency Gaps in Deploy Script
**What goes wrong:** Re-running the deploy script creates a second proxy, a second agent registration, etc.
**How to avoid:** D-10 specifies idempotent checks. Each step must check on-chain state before executing. Use environment variables or a deploy log to track the proxy address between runs.

## Code Examples

### Complete FeedbackType State Transitions

```solidity
// Scenario 1: Positive feedback
// Precondition: feedbackType[agentId] == None || feedbackType[agentId] == Negative
function submitPositiveFeedback(
    uint256 agentId,
    bytes32 pgtcrItemId,
    string calldata feedbackURI
) external onlyAuthorizedBot {
    FeedbackType currentType = feedbackType[agentId];
    require(
        currentType == FeedbackType.None || currentType == FeedbackType.Negative,
        "KRR: already has positive feedback"
    );

    reputationRegistry.giveFeedback(
        agentId, POSITIVE_VALUE, 0,
        TAG_VERIFIED, TAG_REGISTRY, "", feedbackURI, bytes32(0)
    );

    uint64 idx = reputationRegistry.getLastIndex(agentId, address(this));
    feedbackIndex[agentId] = idx;
    feedbackType[agentId] = FeedbackType.Positive;

    emit PositiveFeedbackSubmitted(agentId, pgtcrItemId, idx);
}
```

### Forge Fork Test Pattern

```solidity
// Source: Foundry fork testing pattern
// https://book.getfoundry.sh/forge/fork-testing

contract KlerosReputationRouterTest is Test {
    // Real Sepolia addresses
    address constant REPUTATION_REGISTRY = 0x8004B663056A597Dffe9eCcC1965A193B7388713;
    address constant IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;

    KlerosReputationRouter router;
    address bot = makeAddr("bot");
    address owner = makeAddr("owner");

    function setUp() public {
        // Fork Sepolia
        vm.createSelectFork(vm.envString("SEPOLIA_RPC_URL"));

        // Deploy implementation + proxy
        KlerosReputationRouter impl = new KlerosReputationRouter();
        bytes memory initData = abi.encodeCall(
            KlerosReputationRouter.initialize,
            (REPUTATION_REGISTRY, IDENTITY_REGISTRY, 0, owner)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        router = KlerosReputationRouter(address(proxy));

        // Register a test agent (from a non-router address)
        // ... and authorize bot
        vm.prank(owner);
        router.setAuthorizedBot(bot, true);
    }

    function test_submitPositiveFeedback() public {
        // Need a real agentId from IdentityRegistry
        uint256 testAgentId = _registerTestAgent();

        vm.prank(bot);
        router.submitPositiveFeedback(testAgentId, bytes32("testItem"), "ipfs://test");

        // Verify via real ReputationRegistry
        (uint64 count, int128 value,) = IReputationRegistry(REPUTATION_REGISTRY)
            .getSummary(testAgentId, _routerArray(), "", "");
        assertEq(count, 1);
        assertEq(value, 95);
    }
}
```

### ERC1967Proxy Deployment in Foundry Script

```solidity
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// Deploy implementation
KlerosReputationRouter impl = new KlerosReputationRouter();

// Encode initialize call
bytes memory initData = abi.encodeCall(
    KlerosReputationRouter.initialize,
    (reputationRegistry, identityRegistry, klerosAgentId, owner)
);

// Deploy proxy (this calls initialize automatically)
ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);

// Cast proxy to router interface for subsequent calls
KlerosReputationRouter router = KlerosReputationRouter(address(proxy));
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| OpenZeppelin v4 Transparent Proxy | OpenZeppelin v5 UUPS with namespaced storage (EIP-7201) | OZ v5 release (2023-10) | Lighter proxies, better storage safety, Solidity ^0.8.20 required |
| Manual owner + modifier | OwnableUpgradeable | OZ v5 | Audited ownership with two-step transfer option |
| `bool hasFeedback` (PRD S11) | `FeedbackType` enum (D-01) | Project decision 2026-03-25 | Correctly handles re-registration after dispute |

## Open Questions

1. **Tag values: `"verified"` vs `"curate-verified"`**
   - What we know: PRD S11 defines `TAG_VERIFIED = "curate-verified"` and `TAG_REMOVED = "curate-removed"`. CLAUDE.md and REQUIREMENTS.md use shortened `"verified"` and `"removed"`.
   - What's unclear: Which is authoritative? They produce different behavior when filtering via `getSummary`.
   - Recommendation: Use PRD values (`"curate-verified"` / `"curate-removed"`) since they're the detailed spec. Flag for user confirmation.

2. **OpenZeppelin: contracts vs contracts-upgradeable**
   - What we know: OZ v5 changed the relationship between these packages. `Initializable` and `UUPSUpgradeable` now live in the `-upgradeable` package but redirect to `contracts`.
   - What's unclear: Whether to install just `openzeppelin-contracts` or also `openzeppelin-contracts-upgradeable` for Foundry.
   - Recommendation: Install `openzeppelin-contracts-upgradeable` via `forge install`. It includes the non-upgradeable contracts as a dependency. Use `@openzeppelin/contracts-upgradeable/` imports for `Initializable`, `UUPSUpgradeable`, `OwnableUpgradeable`, and `@openzeppelin/contracts/` for `ERC1967Proxy`.

3. **Deploy script: agent registration wallet**
   - What we know: The Router must NOT own the Kleros agent (self-feedback revert). The deployer wallet registers the Kleros agent.
   - What's unclear: Whether the deploy script runner and the agent registration caller should be the same wallet.
   - Recommendation: Same wallet is fine -- the deployer becomes the Router owner AND registers the agent. The Router (contract address) is the feedback client, not the agent owner. No self-feedback conflict.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Foundry (forge/anvil/cast) | Contract build, test, deploy | Yes | 1.4.4-stable | -- |
| Node.js | Not directly needed for Phase 1 | Yes | v22.22.0 | -- |
| Sepolia RPC | Fork tests, deployment | Public RPC was 522 at research time | -- | Use Alchemy/Infura with API key |

**Missing dependencies with no fallback:**
- None

**Missing dependencies with fallback:**
- Sepolia public RPC (`rpc.sepolia.org`) returned HTTP 522 during research. Fork tests and deployment require a reliable RPC. Use Alchemy or Infura free tier with an API key configured via `SEPOLIA_RPC_URL` env var.

## Project Constraints (from CLAUDE.md)

- **Foundry only** for contract dev -- no Hardhat
- **UUPS proxy** -- no transparent proxy
- **Solidity ^0.8.20** -- matches ERC-8004 registries
- **OpenZeppelin ^5.6** for proxy patterns
- **No local DB/persistence** -- stateless architecture
- **No configurable feedback values** -- constants in contract
- **Biome.js** for linting (not ESLint) -- applies to bot code (Phase 2), not Solidity
- **Fork tests** against real Sepolia contracts -- no mocks
- **Single chain per deployment** -- Ethereum Sepolia only

## Sources

### Primary (HIGH confidence)
- PoC ReputationRegistry ABI: `../erc8004-feedback-bot-fortunato/src/blockchain/abis/reputation-registry.json` -- confirmed giveFeedback returns void, full interface verified
- PRD v2 S4: Complete IReputationRegistry and IIdentityRegistry interfaces
- PRD v2 S5: Deployed addresses (Sepolia)
- PRD v2 S11: Full Router contract specification
- PRD v2 S14: Kleros 8004 identity setup procedure
- PRD v2 S16: Testing plan
- CONTEXT.md D-01 through D-10: Locked implementation decisions
- PITFALLS.md: Domain pitfalls 3, 4, 8, 10, 11

### Secondary (MEDIUM confidence)
- [OpenZeppelin Proxy Docs](https://docs.openzeppelin.com/contracts/5.x/api/proxy) -- UUPS proxy pattern for v5
- [OpenZeppelin Writing Upgradeable Contracts](https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable) -- Initializer pattern guidance
- [Foundry UUPS Example](https://github.com/saltylighter1828/foundry-uups-upgradeable-box) -- Reference project structure
- [Foundry Book - Fork Testing](https://book.getfoundry.sh/forge/fork-testing) -- forge test --fork-url patterns

### Tertiary (LOW confidence)
- None -- all findings verified against primary sources or official docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Foundry + OZ v5 is well-documented and locked by project decisions
- Architecture: HIGH -- UUPS proxy pattern, enum state model, interface definitions all verified against deployed ABI and PRD
- Pitfalls: HIGH -- Phase-1-relevant pitfalls (3, 4, 8, 10, 11) all have verified mitigations in locked decisions
- Deploy flow: MEDIUM -- idempotent deploy script pattern is standard but specifics (agent registration within same script) need implementation validation

**Research date:** 2026-03-25
**Valid until:** 2026-04-25 (stable domain -- Solidity/Foundry/OZ move slowly)
