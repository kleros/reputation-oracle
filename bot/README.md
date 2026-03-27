# Kleros Reputation Bot

Stateless, one-shot bot that syncs [Kleros PGTCR](https://curate.kleros.io/) curation events to [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) on-chain reputation via the Router contract.

Reads the PGTCR subgraph + Router on-chain state, diffs them, and executes the minimum set of feedback transactions. No local database, no daemon loop -- run it on a cron.

## How it works

```
PGTCR Subgraph ──► fetchAllItems()
                        │
                        ▼
                validateAndTransformItem()  ← filters invalid / wrong-chain items
                        │
                        ▼
Router (chain) ──► readRouterStates()       ← Multicall3-batched hasFeedback reads
                        │
                        ▼
                  computeActions()           ← pure diff: subgraph state vs chain state
                        │
                        ▼
                  executeActions()           ← sequential Router txs (or dry-run print)
```

### Three scenarios

| # | Condition | Action |
|---|-----------|--------|
| 1 | Item Submitted/Reincluded, no feedback yet | `giveFeedback(+95, "verified")` |
| 2 | Item Absent + dispute rejection, has feedback | `revokeFeedback` then `giveFeedback(-95, "removed")` |
| 3 | Item Absent + voluntary withdrawal, has feedback | `revokeFeedback` only |

## Setup

```bash
# Requires Node.js 22+
npm install
cp .env.example .env
# Fill in ROUTER_ADDRESS and BOT_PRIVATE_KEY
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `CHAIN_ID` | Target chain (default: `11155111` for Sepolia) |
| `RPC_URL` | Ethereum RPC endpoint |
| `ROUTER_ADDRESS` | Deployed Router proxy address |
| `PGTCR_ADDRESS` | PGTCR list contract address |
| `SUBGRAPH_URL` | Goldsky subgraph GraphQL endpoint |
| `BOT_PRIVATE_KEY` | Bot wallet private key (must be authorized on Router) |

## Pre-flight check

The bot wallet **must** be authorized on the Router before it can submit transactions. Verify with:

```bash
cast call $ROUTER_ADDRESS "authorizedBots(address)(bool)" $(cast wallet address --private-key $BOT_PRIVATE_KEY) --rpc-url $RPC_URL
```

If `false`, the Router owner must authorize it:

```bash
cast send $ROUTER_ADDRESS "setAuthorizedBot(address,bool)" <BOT_ADDRESS> true --rpc-url $RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
```

Or re-run `Deploy.s.sol` with the correct `BOT_ADDRESS` — Step 4 is idempotent and will authorize the new address.

## Usage

```bash
# Dry run -- prints planned actions without submitting transactions
npm run start:dry-run

# Execute
npm run start
```

Exit codes: `0` on success (including no-ops), `1` on failure.

## Development

```bash
npm test              # run tests (vitest)
npm run test:watch    # watch mode
npm run typecheck     # tsc --noEmit
npm run lint          # biome check
npm run lint:fix      # biome auto-fix
```

## Module overview

| Module | Purpose |
|--------|---------|
| `types.ts` | Shared types: `FeedbackType`, `Action`, `ValidatedItem`, `RawSubgraphItem` |
| `config.ts` | Zod-validated env config with secret redaction in logs |
| `validation.ts` | CAIP-10 chain ID parsing, `metadata.key0` agentId extraction |
| `evidence.ts` | IPFS evidence JSON builder for feedback metadata |
| `subgraph.ts` | GraphQL client with `id_gt` cursor pagination (no `skip`) |
| `chain.ts` | viem clients, Multicall3-batched reads, sequential tx executor |
| `diff.ts` | Pure `computeActions()` -- the core business logic |
| `index.ts` | One-shot orchestrator wiring all modules together |
