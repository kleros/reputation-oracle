# Phase 2: Stateless Bot - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-26
**Phase:** 02-Stateless Bot
**Areas discussed:** Project structure & entry point, Diff engine design, Transaction execution flow, IPFS evidence upload

---

## Project Structure & Entry Point

| Option | Description | Selected |
|--------|-------------|----------|
| bot/ at repo root | Separate top-level directory alongside contracts/. Independent package.json. | :heavy_check_mark: |
| Monorepo with workspace | pnpm/npm workspace root with packages/. Shared tooling. | |
| You decide | Claude picks. | |

**User's choice:** bot/ at repo root
**Notes:** Clean separation of Solidity and TypeScript worlds.

### Entry Point

| Option | Description | Selected |
|--------|-------------|----------|
| tsx + tsc --noEmit in CI | tsx for execution, tsc --noEmit for type checking in CI/pre-commit. | :heavy_check_mark: |
| Compiled JS (tsc build) | tsc -> dist/index.js -> node. | |
| tsx for dev, tsc for prod | Both paths. | |

**User's choice:** tsx + tsc --noEmit in CI
**Notes:** User asked about type checking implications of tsx (skips runtime type checking). Confirmed that tsc --noEmit in CI is the standard modern TS workflow — editor catches types live, CI validates, tsx just runs.

---

## Diff Engine Design

| Option | Description | Selected |
|--------|-------------|----------|
| Multicall3 via viem | Batch feedbackType() calls. Viem handles chunking. | :heavy_check_mark: |
| Individual calls per agent | Simple loop, O(N) RPC calls. | |

**User's choice:** Multicall3 via viem

### Diff Purity

| Option | Description | Selected |
|--------|-------------|----------|
| Pure function | Takes (items[], state[]) -> Action[]. No I/O. | :heavy_check_mark: |
| Async with built-in reads | Fetches own data internally. | |

**User's choice:** Pure function
**Notes:** User asked for detailed pros/cons. Key differentiator: pure function enables vitest unit tests without mocks (matches CLAUDE.md's "no mock-call-ordering tests" and "pure function tests for computeActions()"). Also enables trivial dry-run.

### Validation

| Option | Description | Selected |
|--------|-------------|----------|
| Log and skip | Invalid items logged and excluded. Bot continues. | :heavy_check_mark: |
| Fail entire run | Any invalid item stops the bot. | |

**User's choice:** Log and skip

### Prior PoC Reuse

User suggested reusing code from `../erc8004-feedback-bot-fortunato/` (goldsky-items-mapper.ts, goldsky-client.ts). Analysis:
- **Reuse patterns:** CAIP-10 parsing, key0 numeric validation, chain filtering logic
- **Don't reuse code:** Uses ethers (we use viem), skip pagination (we use id_gt), class-based (we use pure functions), only fetches Submitted/Reincluded (we need all including Absent)
- **Decision:** Extract validation patterns, rewrite in viem/pure-function style

---

## Transaction Execution Flow

| Option | Description | Selected |
|--------|-------------|----------|
| Sequential, stop on first failure | One tx at a time, wait for receipt, stop run on any failure. | :heavy_check_mark: |
| Batch with Multicall | Bundle calls into single tx. | |

**User's choice:** Sequential, stop on first failure
**Notes:** User clarified that tx submission retryability and batching are separate concerns. Discussed expected volume (0-2 actions/run steady state). Sequential is appropriate for low volume. Multicall noted as deferred optimization for high-volume bootstrap scenarios. User requested documenting multicall as a future optimization path.

### Dry-Run Mode

| Option | Description | Selected |
|--------|-------------|----------|
| JSON to stdout | Print action list as JSON, exit 0. | :heavy_check_mark: |
| Human-readable table | Formatted table output. | |

**User's choice:** JSON to stdout

---

## IPFS Evidence / feedbackURI

| Option | Description | Selected |
|--------|-------------|----------|
| data: URI with base64 JSON | Embed evidence JSON directly in calldata. No external dependencies. | :heavy_check_mark: |
| Empty string | Pass "" for feedbackURI. | |
| Implement IPFS now | Pull IPFS-01/02/03 into v1 scope. | |

**User's choice:** data:application/json;base64,... URI
**Notes:** User proposed this approach. Pros: self-contained, zero infrastructure, immediately verifiable. Cons: slightly higher gas (negligible on Sepolia). User confirmed "it's fine on Sepolia" — production (v2) switches to IPFS.

---

## Claude's Discretion

- File layout within bot/src/
- Zod config schema shape
- Logging approach
- GraphQL query structure
- vitest config

## Deferred Ideas

- Multicall batching for tx execution — future optimization for high-volume scenarios
- IPFS evidence upload (IPFS-01/02/03) — v2 requirement
- Subgraph lag detection (Pitfall 1) — production hardening
- Transaction safety hardening (TXSAFE-01 through TXSAFE-04) — v2 requirements
