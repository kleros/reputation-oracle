<div align="center">

![hero](./docs/hero.png)

# Kleros Reputation Oracle
[![ERC-8004](https://img.shields.io/badge/ERC--8004-Reputation-8004ff)](https://eips.ethereum.org/EIPS/eip-8004) [![Kleros Curate](https://img.shields.io/badge/Kleros_Curate-Verified_Agents_List-00cc88)](https://curate.kleros.io/tcr/11155111/0x3162df9669affa8b6b6ff2147afa052249f00447)

</div>

**The first reputation oracle where feedback is backed by real economic stake and human jury rulings.**

Syncs [Kleros](https://kleros.io/) curated registry decisions to [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) on-chain reputation for AI agents.

When an agent is verified on a [Kleros PGTCR list](https://curate.kleros.io/tcr/11155111/0x3162df9669affa8b6b6ff2147afa052249f00447), it earns positive reputation. When removed by dispute, that reputation is revoked and replaced with negative signal. All backed by WETH bonds and decentralized arbitration.

## How it works

```
  Kleros PGTCR -----> [ Bot ] -----> [ Router ] -----> ERC-8004 ReputationRegistry
   (Subgraph)        (TypeScript)     (Solidity)            (on-chain)
```

The bot reads the current state of the registry and the chain, computes the diff, executes the minimum set of transactions, and exits. No database, no daemon -- run it on a cron.

**Three scenarios, three outcomes:**

| Trigger | What happens | Reputation |
|---------|-------------|------------|
| Agent verified on registry | `giveFeedback(+95, "verified")` | +95 |
| Agent removed by dispute | Revoke, then `giveFeedback(-95, "removed")` | -95 |
| Agent voluntarily withdraws | `revokeFeedback()` | 0 |

## Live on Sepolia

| Contract | Address |
|----------|---------|
| **KlerosReputationRouter** | [`0x9ad77EBB8c1c206168B5838eF8cbeC82cEA7c30a`](https://sepolia.etherscan.io/address/0x9ad77EBB8c1c206168B5838eF8cbeC82cEA7c30a) |
| ERC-8004 ReputationRegistry | [`0x8004B663056A597Dffe9eCcC1965A193B7388713`](https://sepolia.etherscan.io/address/0x8004B663056A597Dffe9eCcC1965A193B7388713) |
| ERC-8004 IdentityRegistry | [`0x8004A818BFB912233c491871b3d84c89A494BD9e`](https://sepolia.etherscan.io/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) |
| PGTCR Verified Agents List | [`0x3162df9669affa8b6b6ff2147afa052249f00447`](https://curate.kleros.io/tcr/11155111/0x3162df9669affa8b6b6ff2147afa052249f00447) |

Browse the list on [Kleros Curate](https://curate.kleros.io/tcr/11155111/0x3162df9669affa8b6b6ff2147afa052249f00447). Learn more about the [ERC-8004 Reputation Protocol](https://eips.ethereum.org/EIPS/eip-8004).

## Components

| Component | What | Key links |
|-----------|------|-----------|
| [`contracts/`](./contracts/) | Upgradeable Router contract (UUPS proxy) that encodes all feedback logic as hardcoded constants | [Feedback functions](./contracts/README.md#three-feedback-functions) -- [Deployment](./contracts/README.md#deployment) -- [Verification](./contracts/README.md#etherscan-verification) |
| [`bot/`](./bot/) | Stateless TypeScript bot -- reads subgraph + chain, diffs, executes, exits | [Architecture](./bot/README.md#how-it-works) -- [Setup](./bot/README.md#setup) -- [Modules](./bot/README.md#module-overview) |

## Quick start

```bash
# 1. Build contracts
cd contracts && forge build

# 2. Run fork tests (against real Sepolia registries)
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com forge test -vv

# 3. Install bot dependencies
cd ../bot && npm install

# 4. Configure bot
cp .env.example .env
# Fill in: RPC_URL, ROUTER_ADDRESS, BOT_PRIVATE_KEY, SUBGRAPH_URL, PGTCR_ADDRESS

# 5. Dry run (no transactions)
npm run start:dry-run

# 6. Execute
npm run start
```

## Tech stack

| Layer | Technology |
|-------|-----------|
| Contract | Solidity, Foundry, OpenZeppelin UUPS |
| Bot | TypeScript, viem, graphql-request |
| Testing | Foundry fork tests, Vitest |
| Tooling | Biome.js, Zod |

## Design principles

- **Stateless** -- No database. The subgraph + chain state _is_ the source of truth. Diff, act, exit.
- **Idempotent** -- Running the bot twice produces zero actions on the second run. Safe to cron aggressively.
- **Auditable** -- Every feedback transaction includes an evidence URI linking back to the PGTCR item, stake amounts, and dispute outcomes.
- **Upgradeable** -- Router uses UUPS proxy pattern. Future support for multiple PGTCR lists and Kleros products without redeployment.
- **Minimal** -- No configurable values, no feature flags, no admin dashboard. The contract encodes the rules; the bot enforces them.
