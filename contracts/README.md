# Kleros Reputation Router (Contracts)

Upgradeable Solidity contract that routes Kleros PGTCR curation decisions to the [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) ReputationRegistry as on-chain reputation feedback.

The Router is the `clientAddress` for the ReputationRegistry -- the bot never calls the registry directly, only through this contract.

## Contract

**`KlerosReputationRouter.sol`** -- UUPS upgradeable proxy (OpenZeppelin)

### Three feedback functions

| Function | Scenario | What it does |
|----------|----------|--------------|
| `submitPositiveFeedback(agentId, pgtcrItemId, feedbackURI)` | Agent verified on PGTCR | `giveFeedback(+95, "verified", "kleros-agent-registry")` |
| `submitNegativeFeedback(agentId, feedbackURI)` | Removed by dispute | Atomically revokes prior positive, then `giveFeedback(-95, "removed", ...)` |
| `revokeOnly(agentId)` | Voluntary withdrawal | `revokeFeedback()` only, no new entry |

### State tracking

The Router tracks per-agent feedback state (`FeedbackType`: None/Positive/Negative) and the last feedback index. This prevents duplicates and enables atomic revoke-then-negative (Scenario 2 yields `getSummary = -95`, not the average of +95 and -95).

### Access control

- **Owner** -- can authorize/deauthorize bots, upgrade proxy, update registry addresses
- **Authorized bots** -- can call the three feedback functions
- All feedback values (+/-95, decimals 0, tags) are hardcoded constants

## Deployed addresses (Sepolia)

| Contract | Address |
|----------|---------|
| ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| PGTCR List | `0x3162df9669affa8b6b6ff2147afa052249f00447` |

## Development

Requires [Foundry](https://book.getfoundry.sh/getting-started/installation). Solidity `^0.8.20`, compiled with `0.8.28` (Cancun EVM).

```bash
# Build
forge build

# Test (requires Sepolia fork -- tests run against real registries)
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com forge test -vv

# Format
forge fmt
```

## Deployment

The deploy script (`script/Deploy.s.sol`) is idempotent -- it skips steps already completed:

1. Deploy Router implementation + ERC1967 UUPS proxy
2. Register Kleros agent on IdentityRegistry
3. Set `klerosAgentId` on Router
4. Authorize bot address

```bash
# Required env vars
export SEPOLIA_RPC_URL=https://...
export DEPLOYER_PRIVATE_KEY=0x...
export BOT_ADDRESS=0x...
export KLEROS_AGENT_URI=ipfs://...   # points to agent-card.json

# Dry run
forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY

# Broadcast
forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY --broadcast

# Re-run (skips completed steps)
ROUTER_PROXY_ADDRESS=0x... forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY --broadcast
```

### Etherscan verification

**Option 1: During deployment** (recommended)

Add `--verify` and `--etherscan-api-key` to the broadcast command:

```bash
forge script script/Deploy.s.sol \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

Forge auto-verifies all deployed contracts (implementation + proxy) in the same run.

**Option 2: Post-deployment**

If already deployed without `--verify`:

```bash
# Verify the implementation contract
forge verify-contract <IMPLEMENTATION_ADDRESS> \
  src/KlerosReputationRouter.sol:KlerosReputationRouter \
  --chain sepolia \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

The ERC1967 proxy is auto-detected by Etherscan.

## File structure

```
contracts/
├── src/
│   ├── KlerosReputationRouter.sol   # Main contract
│   └── interfaces/
│       ├── IReputationRegistry.sol  # ERC-8004 ReputationRegistry interface
│       └── IIdentityRegistry.sol    # ERC-8004 IdentityRegistry interface
├── test/
│   └── KlerosReputationRouter.t.sol # Fork tests (all 3 scenarios + edge cases)
├── script/
│   └── Deploy.s.sol                 # Idempotent deploy + setup script
├── agent-card.json                  # Kleros 8004 agent metadata (for IdentityRegistry)
└── foundry.toml                     # Foundry config (solc 0.8.28, Cancun EVM)
```
