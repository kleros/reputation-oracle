# Stack Research

**Domain:** Oracle bot (subgraph → on-chain reputation) + Solidity Router contract
**Researched:** 2026-03-24
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Solidity | ^0.8.20 | Router contract language | Matches ERC-8004 registry contracts; ^0.8.20 for custom errors, immutable, PUSH0 |
| Foundry | latest (foundryup) | Contract dev, test, deploy | Industry standard for Solidity; forge test with fork mode for integration tests against anvil |
| TypeScript | ^5.7 | Bot language | Strict type safety; viem requires it |
| Node.js | 22 LTS | Runtime | Native `--env-file` flag (no dotenv needed), stable fetch API, LTS until 2027 |
| viem | ^2.47 | Ethereum client library | Type-safe, native Multicall3 support via `multicall()`, first-class ABI typing, lighter than ethers |
| zod | ^4.3 | Config validation | Schema validation with `.transform()` for env parsing; `.catch()` for redacting private keys in errors |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| graphql-request | ^7.4 | Subgraph queries | Lightweight GraphQL client; cursor-based pagination with `id_gt` |
| pinata | ^2.5 | IPFS pinning | Official Pinata SDK for pinning evidence JSON; alternative: raw fetch to pinning API |
| tsx | ^4.21 | TypeScript execution | Zero-config TS runner; use for bot entry point (`tsx src/index.ts`) |
| @openzeppelin/contracts | ^5.6 | Proxy patterns | UUPS proxy for upgradeable Router; battle-tested, audited |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Biome.js ^2.4 | Linting + formatting | Replaces ESLint + Prettier; single tool, fast, opinionated. Config: `biome.json` |
| vitest ^4.1 | Bot unit/integration tests | Jest-compatible API, native TypeScript, fast; use with viem's test utilities |
| forge (Foundry) | Contract tests | `forge test --fork-url` for integration tests against Sepolia fork |
| anvil (Foundry) | Local Ethereum node | Fork Sepolia for integration testing; deploy Router locally |

## Installation

```bash
# Bot dependencies
npm install viem zod graphql-request pinata

# Bot dev dependencies
npm install -D typescript tsx vitest @biomejs/biome @types/node

# Contracts (Foundry)
forge install OpenZeppelin/openzeppelin-contracts
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| viem | ethers.js v6 | Only if existing codebase uses ethers; viem has better TypeScript types and native multicall |
| graphql-request | urql / apollo-client | Only for complex caching; graphql-request is sufficient for simple polling |
| Biome.js | ESLint + Prettier | Only if team has existing ESLint config to preserve; Biome is faster and simpler |
| vitest | Jest | Only if Jest plugins are required; vitest is API-compatible and faster |
| Pinata SDK | web3.storage / Infura IPFS | web3.storage if free tier matters; Pinata has better uptime and simpler API |
| zod | joi / yup | zod has best TypeScript inference; joi/yup are runtime-only |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| ethers.js v5 | Deprecated, no maintenance, poor TypeScript types | viem ^2.47 |
| dotenv | Node 22 has native `--env-file` flag | `node --env-file=.env` or `tsx --env-file=.env` |
| hardhat | Slower compilation, plugin overhead, config complexity | Foundry (forge/anvil) |
| axios | Unnecessary for simple HTTP; fetch is built-in | Native fetch (Node 22) |
| SQLite/LevelDB/any local DB | Violates stateless architecture; see PRD amendments | Stateless diff from subgraph + chain |
| Transparent proxy (ERC-1967) | Admin slot collision risk, higher gas | UUPS proxy (ERC-1822) via OpenZeppelin |

## Stack Patterns by Variant

**For Multicall3 batched reads with viem:**
- Use `client.multicall({ contracts: [...] })` — viem handles batching automatically
- Multicall3 at `0xcA11bde05977b3631167028862bE2a173976CA11` (all chains)
- Batch size: ~100 calls per multicall to stay under gas limits

**For UUPS proxy (upgradeable Router):**
- Inherit `UUPSUpgradeable` from OpenZeppelin
- Use `Initializable` instead of constructor
- `_authorizeUpgrade()` restricted to owner
- Deploy via `forge script` with `ERC1967Proxy`

**For subgraph pagination with graphql-request:**
- Cursor-based: `where: { id_gt: $lastId }`, `orderBy: id`, `first: 1000`
- Never use `skip` — degrades above 5000, silently truncates above 10000

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| viem ^2.47 | TypeScript ^5.7 | viem requires strict TypeScript for ABI type inference |
| @openzeppelin/contracts ^5.6 | Solidity ^0.8.20 | v5 dropped Solidity <0.8.20 support |
| Foundry (latest) | Solidity ^0.8.20 | foundryup always installs latest; pin via foundry.toml `solc_version` |
| vitest ^4.1 | Node.js ^22 | Uses native test runner hooks |

## Sources

- npm registry — versions verified via `npm view` on 2026-03-24
- viem docs — multicall API, contract interaction patterns
- OpenZeppelin docs — UUPS proxy pattern, v5 migration
- Foundry book — forge test, anvil fork mode, deployment scripts
- PRD §18 — tech stack constraints (Foundry, viem, Biome.js, vitest)

---
*Stack research for: Kleros Reputation Oracle*
*Researched: 2026-03-24*
